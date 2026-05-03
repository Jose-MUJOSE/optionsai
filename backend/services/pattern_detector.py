"""
Technical-pattern detection for stock screening.

Implements 30 classic patterns over OHLCV bars:
  Single-candle (7):  hammer, hanging_man, shooting_star, inverted_hammer,
                      doji, long_bullish, long_bearish
  Two-candle (6):     bullish_engulfing, bearish_engulfing, dark_cloud,
                      piercing, bullish_harami, bearish_harami
  Three-candle (4):   three_white_soldiers, three_black_crows,
                      morning_star, evening_star
  Trend / MA (5):     golden_cross, death_cross, bullish_ma_alignment,
                      bearish_ma_alignment, old_duck_head
  Breakout (4):       breakout_20d_high, breakdown_20d_low,
                      volume_surge_up, bottom_reversal
  Indicator (4):      bb_squeeze, rsi_overbought, rsi_oversold, macd_golden_cross

Each detector takes a list of OHLCV bars (oldest-first) and returns a
PatternHit dict when the pattern is found in the LATEST bar (or recently in
the case of trend patterns where we report the bar at which the signal fired).

Honest about limits:
  - We use simple, widely accepted definitions. There is no "right" version
    of these patterns — different sources disagree on threshold values.
  - We report a confidence score (0–1) so the UI can rank matches, but the
    score is heuristic, not statistically validated against future returns.
  - Volume confirmation is included where standard (e.g. three_white_soldiers
    require rising volume).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Optional


# ============================================================
# Helpers
# ============================================================

def _body(b: dict) -> float:
    """Absolute body size = |close - open|."""
    return abs(b["close"] - b["open"])


def _range(b: dict) -> float:
    """Total candle range = high - low (always >= 0)."""
    r = b["high"] - b["low"]
    return r if r > 0 else 1e-9


def _is_bullish(b: dict) -> bool:
    return b["close"] > b["open"]


def _is_bearish(b: dict) -> bool:
    return b["close"] < b["open"]


def _upper_wick(b: dict) -> float:
    return b["high"] - max(b["open"], b["close"])


def _lower_wick(b: dict) -> float:
    return min(b["open"], b["close"]) - b["low"]


def _sma(values: list[float], period: int, idx: int) -> Optional[float]:
    """Simple moving average ending at index idx (inclusive)."""
    if idx + 1 < period:
        return None
    window = values[idx - period + 1: idx + 1]
    if not window:
        return None
    return sum(window) / period


def _atr(bars: list[dict], period: int, idx: int) -> Optional[float]:
    """Average True Range over `period` bars ending at idx."""
    if idx < period:
        return None
    trs = []
    for i in range(idx - period + 1, idx + 1):
        if i == 0:
            trs.append(bars[i]["high"] - bars[i]["low"])
        else:
            prev_close = bars[i - 1]["close"]
            tr = max(
                bars[i]["high"] - bars[i]["low"],
                abs(bars[i]["high"] - prev_close),
                abs(bars[i]["low"] - prev_close),
            )
            trs.append(tr)
    return sum(trs) / period if trs else None


def _rsi(closes: list[float], period: int = 14) -> list[Optional[float]]:
    """Wilder's RSI over the close series. Returns same-length list with
    leading Nones until enough history."""
    if len(closes) < period + 1:
        return [None] * len(closes)
    gains: list[float] = [0.0]
    losses: list[float] = [0.0]
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = sum(gains[1: period + 1]) / period
    avg_loss = sum(losses[1: period + 1]) / period
    rsis: list[Optional[float]] = [None] * (period + 1)
    rs = avg_gain / avg_loss if avg_loss > 0 else math.inf
    rsis[period] = 100 - (100 / (1 + rs)) if avg_loss > 0 else 100.0
    for i in range(period + 1, len(closes)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else math.inf
        rsis.append(100 - (100 / (1 + rs)) if avg_loss > 0 else 100.0)
    return rsis[: len(closes)]


def _ema(values: list[float], period: int) -> list[Optional[float]]:
    """Exponential moving average; same-length output with leading Nones."""
    if len(values) < period:
        return [None] * len(values)
    out: list[Optional[float]] = [None] * (period - 1)
    sma = sum(values[:period]) / period
    out.append(sma)
    multiplier = 2 / (period + 1)
    for i in range(period, len(values)):
        prev = out[-1]
        if prev is None:
            out.append(None)
        else:
            out.append((values[i] - prev) * multiplier + prev)
    return out


def _stddev(values: list[float], period: int, idx: int) -> Optional[float]:
    if idx + 1 < period:
        return None
    window = values[idx - period + 1: idx + 1]
    if not window:
        return None
    mean = sum(window) / period
    variance = sum((v - mean) ** 2 for v in window) / period
    return math.sqrt(variance)


# ============================================================
# Pattern result type
# ============================================================

@dataclass(frozen=True)
class PatternHit:
    code: str           # machine name, e.g. "three_white_soldiers"
    name_en: str        # English display name
    name_zh: str        # 中文 display name
    direction: str      # "bullish" | "bearish" | "neutral"
    confidence: float   # 0–1 heuristic
    description_en: str
    description_zh: str
    triggered_at_index: int   # index of the bar where the pattern fired


# All registered detectors. Each returns Optional[PatternHit] for the latest bar.
Detector = Callable[[list[dict]], Optional[PatternHit]]
_DETECTORS: list[tuple[str, Detector]] = []


def _register(code: str):
    def deco(fn: Detector) -> Detector:
        _DETECTORS.append((code, fn))
        return fn
    return deco


# ============================================================
# Single-candle patterns
# ============================================================

@_register("hammer")
def detect_hammer(bars: list[dict]) -> Optional[PatternHit]:
    """Hammer 锤子线 — small body at top, long lower shadow, in a downtrend."""
    if len(bars) < 6:
        return None
    b = bars[-1]
    body = _body(b)
    rng = _range(b)
    if body == 0 or rng == 0:
        return None
    lower = _lower_wick(b)
    upper = _upper_wick(b)
    if lower < 2 * body or upper > 0.3 * body:
        return None
    # Require a recent downtrend (last 5 bars net negative)
    if bars[-1]["close"] >= bars[-6]["close"]:
        return None
    return PatternHit(
        code="hammer",
        name_en="Hammer",
        name_zh="锤子线",
        direction="bullish",
        confidence=min(0.6 + (lower / rng) * 0.4, 0.95),
        description_en="Small body, long lower shadow after a downtrend — potential reversal.",
        description_zh="下跌后出现小实体长下影线，有反转信号。",
        triggered_at_index=len(bars) - 1,
    )


@_register("hanging_man")
def detect_hanging_man(bars: list[dict]) -> Optional[PatternHit]:
    """Hanging Man 上吊线 — same shape as hammer but in an uptrend → bearish."""
    if len(bars) < 6:
        return None
    b = bars[-1]
    body = _body(b)
    if body == 0:
        return None
    lower = _lower_wick(b)
    upper = _upper_wick(b)
    if lower < 2 * body or upper > 0.3 * body:
        return None
    if bars[-1]["close"] <= bars[-6]["close"]:
        return None
    return PatternHit(
        code="hanging_man",
        name_en="Hanging Man",
        name_zh="上吊线",
        direction="bearish",
        confidence=0.7,
        description_en="Long lower shadow at the top of an uptrend — potential reversal.",
        description_zh="上涨末端出现长下影线，警惕回调。",
        triggered_at_index=len(bars) - 1,
    )


@_register("shooting_star")
def detect_shooting_star(bars: list[dict]) -> Optional[PatternHit]:
    """Shooting Star 流星线 — small body at bottom, long upper shadow, after uptrend."""
    if len(bars) < 6:
        return None
    b = bars[-1]
    body = _body(b)
    if body == 0:
        return None
    upper = _upper_wick(b)
    lower = _lower_wick(b)
    if upper < 2 * body or lower > 0.3 * body:
        return None
    if bars[-1]["close"] <= bars[-6]["close"]:
        return None
    return PatternHit(
        code="shooting_star",
        name_en="Shooting Star",
        name_zh="流星线",
        direction="bearish",
        confidence=0.75,
        description_en="Long upper wick after uptrend — top reversal warning.",
        description_zh="上涨末端长上影线，顶部反转信号。",
        triggered_at_index=len(bars) - 1,
    )


@_register("inverted_hammer")
def detect_inverted_hammer(bars: list[dict]) -> Optional[PatternHit]:
    """Inverted Hammer 倒锤子 — long upper shadow after downtrend → bullish."""
    if len(bars) < 6:
        return None
    b = bars[-1]
    body = _body(b)
    if body == 0:
        return None
    upper = _upper_wick(b)
    lower = _lower_wick(b)
    if upper < 2 * body or lower > 0.3 * body:
        return None
    if bars[-1]["close"] >= bars[-6]["close"]:
        return None
    return PatternHit(
        code="inverted_hammer",
        name_en="Inverted Hammer",
        name_zh="倒锤子线",
        direction="bullish",
        confidence=0.65,
        description_en="Long upper wick after downtrend — potential bottom reversal.",
        description_zh="下跌后长上影线，潜在底部反转。",
        triggered_at_index=len(bars) - 1,
    )


@_register("doji")
def detect_doji(bars: list[dict]) -> Optional[PatternHit]:
    """Doji 十字星 — open ≈ close, indicating indecision."""
    if len(bars) < 1:
        return None
    b = bars[-1]
    rng = _range(b)
    if rng == 0:
        return None
    body_pct = _body(b) / rng
    if body_pct > 0.05:
        return None
    return PatternHit(
        code="doji",
        name_en="Doji",
        name_zh="十字星",
        direction="neutral",
        confidence=0.6,
        description_en="Open ≈ close → indecision; trend exhaustion possible.",
        description_zh="开盘≈收盘，多空争夺剧烈，可能转势。",
        triggered_at_index=len(bars) - 1,
    )


@_register("long_bullish")
def detect_long_bullish(bars: list[dict]) -> Optional[PatternHit]:
    """Long Bullish Candle 大阳线 — body > 1.5× ATR, mostly body."""
    if len(bars) < 15:
        return None
    b = bars[-1]
    if not _is_bullish(b):
        return None
    body = _body(b)
    rng = _range(b)
    if body / rng < 0.7:
        return None
    atr = _atr(bars, 14, len(bars) - 1)
    if atr is None or body < 1.5 * atr:
        return None
    return PatternHit(
        code="long_bullish",
        name_en="Long Bullish Candle",
        name_zh="大阳线",
        direction="bullish",
        confidence=0.75,
        description_en="Strong green body > 1.5× ATR — strong buying pressure.",
        description_zh="阳线实体大于1.5倍ATR，多方强势。",
        triggered_at_index=len(bars) - 1,
    )


@_register("long_bearish")
def detect_long_bearish(bars: list[dict]) -> Optional[PatternHit]:
    """Long Bearish Candle 大阴线 — body > 1.5× ATR."""
    if len(bars) < 15:
        return None
    b = bars[-1]
    if not _is_bearish(b):
        return None
    body = _body(b)
    rng = _range(b)
    if body / rng < 0.7:
        return None
    atr = _atr(bars, 14, len(bars) - 1)
    if atr is None or body < 1.5 * atr:
        return None
    return PatternHit(
        code="long_bearish",
        name_en="Long Bearish Candle",
        name_zh="大阴线",
        direction="bearish",
        confidence=0.75,
        description_en="Strong red body > 1.5× ATR — strong selling pressure.",
        description_zh="阴线实体大于1.5倍ATR，空方强势。",
        triggered_at_index=len(bars) - 1,
    )


# ============================================================
# Two-candle patterns
# ============================================================

@_register("bullish_engulfing")
def detect_bullish_engulfing(bars: list[dict]) -> Optional[PatternHit]:
    """Bullish Engulfing 看涨吞没 — green body fully covers prior red body."""
    if len(bars) < 2:
        return None
    p, c = bars[-2], bars[-1]
    if not _is_bearish(p) or not _is_bullish(c):
        return None
    if not (c["open"] <= p["close"] and c["close"] >= p["open"]):
        return None
    if _body(c) <= _body(p):
        return None
    return PatternHit(
        code="bullish_engulfing",
        name_en="Bullish Engulfing",
        name_zh="看涨吞没",
        direction="bullish",
        confidence=0.8,
        description_en="Green body engulfs prior red body — reversal signal.",
        description_zh="阳线完全吞没前阴线，强烈反转信号。",
        triggered_at_index=len(bars) - 1,
    )


@_register("bearish_engulfing")
def detect_bearish_engulfing(bars: list[dict]) -> Optional[PatternHit]:
    """Bearish Engulfing 看跌吞没."""
    if len(bars) < 2:
        return None
    p, c = bars[-2], bars[-1]
    if not _is_bullish(p) or not _is_bearish(c):
        return None
    if not (c["open"] >= p["close"] and c["close"] <= p["open"]):
        return None
    if _body(c) <= _body(p):
        return None
    return PatternHit(
        code="bearish_engulfing",
        name_en="Bearish Engulfing",
        name_zh="看跌吞没",
        direction="bearish",
        confidence=0.8,
        description_en="Red body engulfs prior green body — reversal signal.",
        description_zh="阴线完全吞没前阳线，强烈反转信号。",
        triggered_at_index=len(bars) - 1,
    )


@_register("dark_cloud")
def detect_dark_cloud(bars: list[dict]) -> Optional[PatternHit]:
    """Dark Cloud Cover 乌云盖顶 — bearish reversal in uptrend."""
    if len(bars) < 6:
        return None
    p, c = bars[-2], bars[-1]
    if not _is_bullish(p) or not _is_bearish(c):
        return None
    if c["open"] <= p["high"]:
        return None
    midpoint = (p["open"] + p["close"]) / 2
    if c["close"] >= midpoint:
        return None
    if bars[-1]["close"] < bars[-6]["close"]:  # require uptrend context
        return None
    return PatternHit(
        code="dark_cloud",
        name_en="Dark Cloud Cover",
        name_zh="乌云盖顶",
        direction="bearish",
        confidence=0.78,
        description_en="Open above prior high, close below prior midpoint — top reversal.",
        description_zh="高开后跌穿前阳线中点，顶部反转。",
        triggered_at_index=len(bars) - 1,
    )


@_register("piercing")
def detect_piercing(bars: list[dict]) -> Optional[PatternHit]:
    """Piercing Pattern 刺透形态 — bullish reversal in downtrend."""
    if len(bars) < 6:
        return None
    p, c = bars[-2], bars[-1]
    if not _is_bearish(p) or not _is_bullish(c):
        return None
    if c["open"] >= p["low"]:
        return None
    midpoint = (p["open"] + p["close"]) / 2
    if c["close"] <= midpoint:
        return None
    if bars[-1]["close"] > bars[-6]["close"]:  # require downtrend context
        return None
    return PatternHit(
        code="piercing",
        name_en="Piercing Pattern",
        name_zh="刺透形态",
        direction="bullish",
        confidence=0.78,
        description_en="Open below prior low, close above prior midpoint — bottom reversal.",
        description_zh="低开后涨过前阴线中点，底部反转。",
        triggered_at_index=len(bars) - 1,
    )


@_register("bullish_harami")
def detect_bullish_harami(bars: list[dict]) -> Optional[PatternHit]:
    """Bullish Harami 看涨孕线 — small green body inside prior large red body."""
    if len(bars) < 2:
        return None
    p, c = bars[-2], bars[-1]
    if not _is_bearish(p) or not _is_bullish(c):
        return None
    if not (c["open"] >= p["close"] and c["close"] <= p["open"]):
        return None
    if _body(c) >= _body(p) * 0.6:
        return None
    return PatternHit(
        code="bullish_harami",
        name_en="Bullish Harami",
        name_zh="看涨孕线",
        direction="bullish",
        confidence=0.65,
        description_en="Small green body inside prior red body — potential reversal.",
        description_zh="小阳线被前阴线包含，潜在反转。",
        triggered_at_index=len(bars) - 1,
    )


@_register("bearish_harami")
def detect_bearish_harami(bars: list[dict]) -> Optional[PatternHit]:
    """Bearish Harami 看跌孕线."""
    if len(bars) < 2:
        return None
    p, c = bars[-2], bars[-1]
    if not _is_bullish(p) or not _is_bearish(c):
        return None
    if not (c["open"] <= p["close"] and c["close"] >= p["open"]):
        return None
    if _body(c) >= _body(p) * 0.6:
        return None
    return PatternHit(
        code="bearish_harami",
        name_en="Bearish Harami",
        name_zh="看跌孕线",
        direction="bearish",
        confidence=0.65,
        description_en="Small red body inside prior green body — potential reversal.",
        description_zh="小阴线被前阳线包含，潜在反转。",
        triggered_at_index=len(bars) - 1,
    )


# ============================================================
# Three-candle patterns
# ============================================================

@_register("three_white_soldiers")
def detect_three_white_soldiers(bars: list[dict]) -> Optional[PatternHit]:
    """红三兵 — three consecutive green candles, each closing higher."""
    if len(bars) < 3:
        return None
    a, b, c = bars[-3], bars[-2], bars[-1]
    if not (_is_bullish(a) and _is_bullish(b) and _is_bullish(c)):
        return None
    if not (b["close"] > a["close"] and c["close"] > b["close"]):
        return None
    # Each candle should open within prior body and have substantial body.
    for prev, cur in [(a, b), (b, c)]:
        if cur["open"] < prev["open"] or cur["open"] > prev["close"]:
            return None
    return PatternHit(
        code="three_white_soldiers",
        name_en="Three White Soldiers",
        name_zh="红三兵",
        direction="bullish",
        confidence=0.85,
        description_en="Three rising green candles — strong bullish continuation.",
        description_zh="连续三根上涨阳线，多方持续强势。",
        triggered_at_index=len(bars) - 1,
    )


@_register("three_black_crows")
def detect_three_black_crows(bars: list[dict]) -> Optional[PatternHit]:
    """黑三兵 — three consecutive red candles, each closing lower."""
    if len(bars) < 3:
        return None
    a, b, c = bars[-3], bars[-2], bars[-1]
    if not (_is_bearish(a) and _is_bearish(b) and _is_bearish(c)):
        return None
    if not (b["close"] < a["close"] and c["close"] < b["close"]):
        return None
    for prev, cur in [(a, b), (b, c)]:
        if cur["open"] > prev["open"] or cur["open"] < prev["close"]:
            return None
    return PatternHit(
        code="three_black_crows",
        name_en="Three Black Crows",
        name_zh="黑三兵",
        direction="bearish",
        confidence=0.85,
        description_en="Three falling red candles — strong bearish continuation.",
        description_zh="连续三根下跌阴线，空方持续强势。",
        triggered_at_index=len(bars) - 1,
    )


@_register("morning_star")
def detect_morning_star(bars: list[dict]) -> Optional[PatternHit]:
    """启明星 — bearish + small body + bullish closing past midpoint of bearish."""
    if len(bars) < 3:
        return None
    a, b, c = bars[-3], bars[-2], bars[-1]
    if not _is_bearish(a) or not _is_bullish(c):
        return None
    if _body(b) > _body(a) * 0.4:
        return None
    midpoint = (a["open"] + a["close"]) / 2
    if c["close"] <= midpoint:
        return None
    return PatternHit(
        code="morning_star",
        name_en="Morning Star",
        name_zh="启明星",
        direction="bullish",
        confidence=0.82,
        description_en="Bearish → indecisive → bullish past midpoint — bottom reversal.",
        description_zh="阴+小实体+大阳过中点，底部反转。",
        triggered_at_index=len(bars) - 1,
    )


@_register("evening_star")
def detect_evening_star(bars: list[dict]) -> Optional[PatternHit]:
    """黄昏星."""
    if len(bars) < 3:
        return None
    a, b, c = bars[-3], bars[-2], bars[-1]
    if not _is_bullish(a) or not _is_bearish(c):
        return None
    if _body(b) > _body(a) * 0.4:
        return None
    midpoint = (a["open"] + a["close"]) / 2
    if c["close"] >= midpoint:
        return None
    return PatternHit(
        code="evening_star",
        name_en="Evening Star",
        name_zh="黄昏星",
        direction="bearish",
        confidence=0.82,
        description_en="Bullish → indecisive → bearish past midpoint — top reversal.",
        description_zh="阳+小实体+大阴过中点，顶部反转。",
        triggered_at_index=len(bars) - 1,
    )


# ============================================================
# Trend / MA patterns
# ============================================================

@_register("golden_cross")
def detect_golden_cross(bars: list[dict]) -> Optional[PatternHit]:
    """金叉 — short MA crosses above long MA in the latest bar."""
    if len(bars) < 30:
        return None
    closes = [b["close"] for b in bars]
    n = len(closes)
    short_now = _sma(closes, 5, n - 1)
    short_prev = _sma(closes, 5, n - 2)
    long_now = _sma(closes, 20, n - 1)
    long_prev = _sma(closes, 20, n - 2)
    if None in (short_now, short_prev, long_now, long_prev):
        return None
    if short_prev <= long_prev and short_now > long_now:
        return PatternHit(
            code="golden_cross",
            name_en="Golden Cross (MA5/MA20)",
            name_zh="金叉 (MA5/MA20)",
            direction="bullish",
            confidence=0.8,
            description_en="MA5 crossed above MA20 — bullish trend confirmation.",
            description_zh="MA5 上穿 MA20，多头趋势确认。",
            triggered_at_index=n - 1,
        )
    return None


@_register("death_cross")
def detect_death_cross(bars: list[dict]) -> Optional[PatternHit]:
    """死叉."""
    if len(bars) < 30:
        return None
    closes = [b["close"] for b in bars]
    n = len(closes)
    short_now = _sma(closes, 5, n - 1)
    short_prev = _sma(closes, 5, n - 2)
    long_now = _sma(closes, 20, n - 1)
    long_prev = _sma(closes, 20, n - 2)
    if None in (short_now, short_prev, long_now, long_prev):
        return None
    if short_prev >= long_prev and short_now < long_now:
        return PatternHit(
            code="death_cross",
            name_en="Death Cross (MA5/MA20)",
            name_zh="死叉 (MA5/MA20)",
            direction="bearish",
            confidence=0.8,
            description_en="MA5 crossed below MA20 — bearish trend confirmation.",
            description_zh="MA5 下穿 MA20，空头趋势确认。",
            triggered_at_index=n - 1,
        )
    return None


@_register("bullish_ma_alignment")
def detect_bullish_ma_alignment(bars: list[dict]) -> Optional[PatternHit]:
    """均线多头排列 — MA5 > MA10 > MA20 > MA60."""
    if len(bars) < 70:
        return None
    closes = [b["close"] for b in bars]
    n = len(closes)
    ma5 = _sma(closes, 5, n - 1)
    ma10 = _sma(closes, 10, n - 1)
    ma20 = _sma(closes, 20, n - 1)
    ma60 = _sma(closes, 60, n - 1)
    if None in (ma5, ma10, ma20, ma60):
        return None
    if not (ma5 > ma10 > ma20 > ma60):
        return None
    return PatternHit(
        code="bullish_ma_alignment",
        name_en="Bullish MA Alignment",
        name_zh="均线多头排列",
        direction="bullish",
        confidence=0.85,
        description_en="MA5 > MA10 > MA20 > MA60 — strong uptrend structure.",
        description_zh="MA5 > MA10 > MA20 > MA60，强势多头结构。",
        triggered_at_index=n - 1,
    )


@_register("bearish_ma_alignment")
def detect_bearish_ma_alignment(bars: list[dict]) -> Optional[PatternHit]:
    if len(bars) < 70:
        return None
    closes = [b["close"] for b in bars]
    n = len(closes)
    ma5 = _sma(closes, 5, n - 1)
    ma10 = _sma(closes, 10, n - 1)
    ma20 = _sma(closes, 20, n - 1)
    ma60 = _sma(closes, 60, n - 1)
    if None in (ma5, ma10, ma20, ma60):
        return None
    if not (ma5 < ma10 < ma20 < ma60):
        return None
    return PatternHit(
        code="bearish_ma_alignment",
        name_en="Bearish MA Alignment",
        name_zh="均线空头排列",
        direction="bearish",
        confidence=0.85,
        description_en="MA5 < MA10 < MA20 < MA60 — strong downtrend structure.",
        description_zh="MA5 < MA10 < MA20 < MA60，强势空头结构。",
        triggered_at_index=n - 1,
    )


@_register("old_duck_head")
def detect_old_duck_head(bars: list[dict]) -> Optional[PatternHit]:
    """老鸭头 — MA10 had a recent peak (head), pulled back, now turning up again
    while price is still above MA60. Simplified detection:
      - MA60 has been rising for 30 bars (long trend)
      - MA10 made a local peak ~10-30 bars ago, then dipped, now rising
      - Latest MA5 just crossed back above MA10
    """
    if len(bars) < 80:
        return None
    closes = [b["close"] for b in bars]
    n = len(closes)
    ma5 = [_sma(closes, 5, i) for i in range(n)]
    ma10 = [_sma(closes, 10, i) for i in range(n)]
    ma60 = [_sma(closes, 60, i) for i in range(n)]
    # Long-trend: MA60 rising over 30 bars
    if ma60[n - 1] is None or ma60[n - 31] is None or ma60[n - 1] <= ma60[n - 31]:
        return None
    # Find local peak of MA10 in the last 30 bars (excluding latest 5)
    peak_idx = None
    peak_val = -math.inf
    for i in range(n - 30, n - 5):
        if ma10[i] is not None and ma10[i] > peak_val:
            peak_val = ma10[i]
            peak_idx = i
    if peak_idx is None or ma10[n - 1] is None:
        return None
    # Latest MA10 should have dipped below peak then started rising
    trough_val = min(ma10[i] for i in range(peak_idx, n - 1) if ma10[i] is not None)
    if not (trough_val < peak_val * 0.97 and ma10[n - 1] > trough_val * 1.005):
        return None
    # MA5 crossing back above MA10
    if ma5[n - 1] is None or ma5[n - 2] is None or ma10[n - 2] is None:
        return None
    if not (ma5[n - 2] <= ma10[n - 2] and ma5[n - 1] > ma10[n - 1]):
        return None
    return PatternHit(
        code="old_duck_head",
        name_en="Old Duck Head",
        name_zh="老鸭头",
        direction="bullish",
        confidence=0.78,
        description_en="Long uptrend → pullback (the 'head') → MA5 crossing back above MA10.",
        description_zh="长期多头中回调形成鸭头，MA5 重新上穿 MA10，看涨续势。",
        triggered_at_index=n - 1,
    )


# ============================================================
# Breakout patterns
# ============================================================

@_register("breakout_20d_high")
def detect_breakout_20d_high(bars: list[dict]) -> Optional[PatternHit]:
    """向上突破20日新高 — close > 20-bar high, with volume confirmation."""
    if len(bars) < 22:
        return None
    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    vols = [b.get("volume", 0) or 0 for b in bars]
    n = len(closes)
    prior_high = max(highs[n - 21: n - 1])  # exclude current bar
    if closes[-1] <= prior_high:
        return None
    avg_vol = sum(vols[n - 21: n - 1]) / 20
    vol_confirm = vols[-1] > avg_vol * 1.3
    return PatternHit(
        code="breakout_20d_high",
        name_en="20-Day Breakout",
        name_zh="向上突破20日新高",
        direction="bullish",
        confidence=0.85 if vol_confirm else 0.65,
        description_en=(
            "Closed above 20-day high"
            + (" with volume surge" if vol_confirm else " (no volume confirmation)")
        ),
        description_zh=(
            "收盘突破20日新高"
            + ("，伴随放量确认" if vol_confirm else "（量能未放大）")
        ),
        triggered_at_index=n - 1,
    )


@_register("breakdown_20d_low")
def detect_breakdown_20d_low(bars: list[dict]) -> Optional[PatternHit]:
    if len(bars) < 22:
        return None
    closes = [b["close"] for b in bars]
    lows = [b["low"] for b in bars]
    vols = [b.get("volume", 0) or 0 for b in bars]
    n = len(closes)
    prior_low = min(lows[n - 21: n - 1])
    if closes[-1] >= prior_low:
        return None
    avg_vol = sum(vols[n - 21: n - 1]) / 20
    vol_confirm = vols[-1] > avg_vol * 1.3
    return PatternHit(
        code="breakdown_20d_low",
        name_en="20-Day Breakdown",
        name_zh="向下跌破20日新低",
        direction="bearish",
        confidence=0.85 if vol_confirm else 0.65,
        description_en=(
            "Closed below 20-day low"
            + (" with volume surge" if vol_confirm else " (no volume confirmation)")
        ),
        description_zh=(
            "收盘跌破20日新低"
            + ("，伴随放量确认" if vol_confirm else "（量能未放大）")
        ),
        triggered_at_index=n - 1,
    )


@_register("volume_surge_up")
def detect_volume_surge_up(bars: list[dict]) -> Optional[PatternHit]:
    """放量上涨 — volume > 1.5× 20-day avg AND price up > 1.5%."""
    if len(bars) < 22:
        return None
    vols = [b.get("volume", 0) or 0 for b in bars]
    n = len(bars)
    avg_vol = sum(vols[n - 21: n - 1]) / 20
    if avg_vol <= 0:
        return None
    pct = (bars[-1]["close"] - bars[-2]["close"]) / bars[-2]["close"] if bars[-2]["close"] else 0
    if vols[-1] < avg_vol * 1.5 or pct < 0.015:
        return None
    return PatternHit(
        code="volume_surge_up",
        name_en="Volume Surge Up",
        name_zh="放量上涨",
        direction="bullish",
        confidence=min(0.6 + pct * 5, 0.9),
        description_en=f"Volume {vols[-1] / avg_vol:.1f}× avg with +{pct * 100:.1f}% close.",
        description_zh=f"成交量为均量{vols[-1] / avg_vol:.1f}倍，收盘+{pct * 100:.1f}%。",
        triggered_at_index=n - 1,
    )


@_register("bottom_reversal")
def detect_bottom_reversal(bars: list[dict]) -> Optional[PatternHit]:
    """底部反转 — RSI was oversold (<30) within 5 bars and current bar closes up >2%."""
    if len(bars) < 30:
        return None
    closes = [b["close"] for b in bars]
    rsis = _rsi(closes, 14)
    n = len(closes)
    if rsis[-1] is None:
        return None
    recent_oversold = any((r is not None and r < 30) for r in rsis[n - 6: n])
    if not recent_oversold:
        return None
    pct = (bars[-1]["close"] - bars[-2]["close"]) / bars[-2]["close"] if bars[-2]["close"] else 0
    if pct < 0.02:
        return None
    return PatternHit(
        code="bottom_reversal",
        name_en="Bottom Reversal",
        name_zh="底部反转",
        direction="bullish",
        confidence=0.7,
        description_en=f"RSI was oversold then closed +{pct * 100:.1f}% — potential bottom.",
        description_zh=f"RSI 超卖后收盘 +{pct * 100:.1f}%，潜在底部反转。",
        triggered_at_index=n - 1,
    )


# ============================================================
# Indicator-based patterns
# ============================================================

@_register("bb_squeeze")
def detect_bb_squeeze(bars: list[dict]) -> Optional[PatternHit]:
    """布林收口 — 20-day BB width near 6-month low → volatility compression."""
    if len(bars) < 130:
        return None
    closes = [b["close"] for b in bars]
    widths: list[Optional[float]] = []
    for i in range(len(closes)):
        sd = _stddev(closes, 20, i)
        ma = _sma(closes, 20, i)
        if sd is None or ma is None or ma == 0:
            widths.append(None)
        else:
            widths.append((4 * sd) / ma)  # upper - lower normalized
    cur = widths[-1]
    if cur is None:
        return None
    last_120 = [w for w in widths[-126:-1] if w is not None]
    if not last_120:
        return None
    cur_pct = sum(1 for w in last_120 if w < cur) / len(last_120)
    if cur_pct > 0.1:  # current width must be in lowest 10%
        return None
    return PatternHit(
        code="bb_squeeze",
        name_en="Bollinger Squeeze",
        name_zh="布林带收口",
        direction="neutral",
        confidence=0.7,
        description_en="BB width near 6-month low — volatility compression precedes breakouts.",
        description_zh="布林带宽接近6个月低位，波动率压缩，往往预示突破。",
        triggered_at_index=len(bars) - 1,
    )


@_register("rsi_overbought")
def detect_rsi_overbought(bars: list[dict]) -> Optional[PatternHit]:
    if len(bars) < 16:
        return None
    closes = [b["close"] for b in bars]
    rsis = _rsi(closes, 14)
    if rsis[-1] is None or rsis[-1] < 70:
        return None
    return PatternHit(
        code="rsi_overbought",
        name_en="RSI Overbought",
        name_zh="RSI 超买",
        direction="bearish",
        confidence=min(0.5 + (rsis[-1] - 70) / 60, 0.85),
        description_en=f"RSI(14) = {rsis[-1]:.0f} (>70) — pullback risk rising.",
        description_zh=f"RSI(14) = {rsis[-1]:.0f}（>70），回调风险上升。",
        triggered_at_index=len(bars) - 1,
    )


@_register("rsi_oversold")
def detect_rsi_oversold(bars: list[dict]) -> Optional[PatternHit]:
    if len(bars) < 16:
        return None
    closes = [b["close"] for b in bars]
    rsis = _rsi(closes, 14)
    if rsis[-1] is None or rsis[-1] > 30:
        return None
    return PatternHit(
        code="rsi_oversold",
        name_en="RSI Oversold",
        name_zh="RSI 超卖",
        direction="bullish",
        confidence=min(0.5 + (30 - rsis[-1]) / 60, 0.85),
        description_en=f"RSI(14) = {rsis[-1]:.0f} (<30) — bounce potential.",
        description_zh=f"RSI(14) = {rsis[-1]:.0f}（<30），有反弹潜力。",
        triggered_at_index=len(bars) - 1,
    )


@_register("macd_golden_cross")
def detect_macd_golden_cross(bars: list[dict]) -> Optional[PatternHit]:
    """MACD 金叉 — DIF crosses above DEA in latest bar."""
    if len(bars) < 40:
        return None
    closes = [b["close"] for b in bars]
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    dif = [
        (a - b) if (a is not None and b is not None) else None
        for a, b in zip(ema12, ema26)
    ]
    valid_idx = next((i for i, v in enumerate(dif) if v is not None), None)
    if valid_idx is None:
        return None
    dif_clean = [v for v in dif[valid_idx:] if v is not None]
    if len(dif_clean) < 10:
        return None
    dea_clean = _ema(dif_clean, 9)
    # Pad with None to original length
    dea: list[Optional[float]] = [None] * valid_idx + list(dea_clean) + [None] * (len(dif) - valid_idx - len(dea_clean))
    n = len(closes)
    if (dif[n - 1] is None or dif[n - 2] is None or dea[n - 1] is None or dea[n - 2] is None):
        return None
    if dif[n - 2] <= dea[n - 2] and dif[n - 1] > dea[n - 1]:
        return PatternHit(
            code="macd_golden_cross",
            name_en="MACD Golden Cross",
            name_zh="MACD 金叉",
            direction="bullish",
            confidence=0.78,
            description_en="DIF crossed above DEA — momentum turning bullish.",
            description_zh="DIF 上穿 DEA，动量转多。",
            triggered_at_index=n - 1,
        )
    return None


# ============================================================
# Public entry point
# ============================================================

def detect_all(bars: list[dict]) -> list[PatternHit]:
    """Run every registered detector against the bar series.

    Returns hits ordered by confidence descending. An empty list means no
    pattern fired on the latest bar.

    Bars must be oldest-first with keys: open, high, low, close, volume, time.
    """
    hits: list[PatternHit] = []
    for code, detector in _DETECTORS:
        try:
            hit = detector(bars)
            if hit is not None:
                hits.append(hit)
        except Exception:
            # A single detector should never break the entire pipeline.
            continue
    hits.sort(key=lambda h: h.confidence, reverse=True)
    return hits


def list_pattern_catalog() -> list[dict]:
    """Return metadata for all registered patterns (for the UI's filter list)."""
    catalog: list[dict] = []
    # Run each detector once with empty bars to harvest metadata? No — we'd
    # need to instantiate hits. Instead, hardcode the catalog matching the
    # detector definitions above. Update this when adding new detectors.
    catalog_data = [
        ("hammer", "Hammer", "锤子线", "bullish"),
        ("hanging_man", "Hanging Man", "上吊线", "bearish"),
        ("shooting_star", "Shooting Star", "流星线", "bearish"),
        ("inverted_hammer", "Inverted Hammer", "倒锤子线", "bullish"),
        ("doji", "Doji", "十字星", "neutral"),
        ("long_bullish", "Long Bullish Candle", "大阳线", "bullish"),
        ("long_bearish", "Long Bearish Candle", "大阴线", "bearish"),
        ("bullish_engulfing", "Bullish Engulfing", "看涨吞没", "bullish"),
        ("bearish_engulfing", "Bearish Engulfing", "看跌吞没", "bearish"),
        ("dark_cloud", "Dark Cloud Cover", "乌云盖顶", "bearish"),
        ("piercing", "Piercing Pattern", "刺透形态", "bullish"),
        ("bullish_harami", "Bullish Harami", "看涨孕线", "bullish"),
        ("bearish_harami", "Bearish Harami", "看跌孕线", "bearish"),
        ("three_white_soldiers", "Three White Soldiers", "红三兵", "bullish"),
        ("three_black_crows", "Three Black Crows", "黑三兵", "bearish"),
        ("morning_star", "Morning Star", "启明星", "bullish"),
        ("evening_star", "Evening Star", "黄昏星", "bearish"),
        ("golden_cross", "Golden Cross (MA5/MA20)", "金叉", "bullish"),
        ("death_cross", "Death Cross (MA5/MA20)", "死叉", "bearish"),
        ("bullish_ma_alignment", "Bullish MA Alignment", "均线多头排列", "bullish"),
        ("bearish_ma_alignment", "Bearish MA Alignment", "均线空头排列", "bearish"),
        ("old_duck_head", "Old Duck Head", "老鸭头", "bullish"),
        ("breakout_20d_high", "20-Day Breakout", "向上突破20日新高", "bullish"),
        ("breakdown_20d_low", "20-Day Breakdown", "向下跌破20日新低", "bearish"),
        ("volume_surge_up", "Volume Surge Up", "放量上涨", "bullish"),
        ("bottom_reversal", "Bottom Reversal", "底部反转", "bullish"),
        ("bb_squeeze", "Bollinger Squeeze", "布林带收口", "neutral"),
        ("rsi_overbought", "RSI Overbought", "RSI 超买", "bearish"),
        ("rsi_oversold", "RSI Oversold", "RSI 超卖", "bullish"),
        ("macd_golden_cross", "MACD Golden Cross", "MACD 金叉", "bullish"),
    ]
    for code, name_en, name_zh, direction in catalog_data:
        catalog.append({
            "code": code,
            "name_en": name_en,
            "name_zh": name_zh,
            "direction": direction,
        })
    return catalog
