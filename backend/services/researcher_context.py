"""
Researcher-specific data enrichment.

Each of the 9 researchers in the Trader Agent should reason from data that
matches their specialty. Without this, "Technical Researcher" was just
arguing from the same raw price + IV that "Bull Researcher" had — making
its output indistinguishable from a generic LLM rephrasing.

This module computes / fetches the additional slice each researcher needs:
  - Technical: MA20/50/200, RSI(14), MACD, Bollinger bands, ATR
  - Fundamental: P/E, PEG, margins, growth rates, FCF, ROIC proxy
  - Market: SPY/QQQ recent moves, VIX, US10Y proxy, USD direction
  - Industry: sector ETF performance, ticker's relative strength
  - Financial: balance sheet ratios, debt, share count trajectory

The computations live here (not in DataFetcher) because they're pure
transforms of data DataFetcher already returns. Keeps DataFetcher focused
on HTTP, and keeps research enrichment together for easy auditing.
"""
from __future__ import annotations

import asyncio
import math
import statistics
from typing import Optional

from backend.services.data_fetcher import DataFetcher


# ==================================================================
# Sector mapping — maps ticker → sector ETF for Industry researcher
# ==================================================================
# Conservative coverage of S&P 500 + popular names. Falls back to "SPY"
# (broad market) for unknown tickers so Industry Researcher always has
# *something* relative to compare against.

TICKER_TO_SECTOR_ETF: dict[str, str] = {
    # Tech (XLK)
    "AAPL": "XLK", "MSFT": "XLK", "NVDA": "XLK", "AVGO": "XLK", "AMD": "XLK",
    "INTC": "XLK", "QCOM": "XLK", "TXN": "XLK", "CRM": "XLK", "ORCL": "XLK",
    "ADBE": "XLK", "NOW": "XLK", "INTU": "XLK", "CSCO": "XLK", "IBM": "XLK",
    "MU": "XLK", "AMAT": "XLK", "LRCX": "XLK", "KLAC": "XLK", "ASML": "XLK",
    "ARM": "XLK", "PLTR": "XLK", "SNOW": "XLK", "DDOG": "XLK", "MDB": "XLK",
    "NET": "XLK", "CRWD": "XLK",
    # Communication (XLC)
    "META": "XLC", "GOOGL": "XLC", "GOOG": "XLC", "NFLX": "XLC", "DIS": "XLC",
    "TMUS": "XLC", "CMCSA": "XLC", "T": "XLC", "VZ": "XLC",
    # Consumer Discretionary (XLY)
    "AMZN": "XLY", "TSLA": "XLY", "HD": "XLY", "MCD": "XLY", "NKE": "XLY",
    "SBUX": "XLY", "BKNG": "XLY", "TGT": "XLY", "LOW": "XLY", "F": "XLY",
    "GM": "XLY", "RIVN": "XLY", "LCID": "XLY",
    # Consumer Staples (XLP)
    "WMT": "XLP", "COST": "XLP", "PG": "XLP", "KO": "XLP", "PEP": "XLP",
    # Financials (XLF)
    "JPM": "XLF", "BAC": "XLF", "WFC": "XLF", "C": "XLF", "GS": "XLF",
    "MS": "XLF", "BLK": "XLF", "SCHW": "XLF", "AXP": "XLF", "USB": "XLF",
    "PNC": "XLF", "V": "XLF", "MA": "XLF",
    # Healthcare (XLV)
    "UNH": "XLV", "JNJ": "XLV", "LLY": "XLV", "PFE": "XLV", "ABBV": "XLV",
    "MRK": "XLV", "TMO": "XLV", "ABT": "XLV", "DHR": "XLV", "BMY": "XLV",
    "AMGN": "XLV", "GILD": "XLV", "REGN": "XLV", "VRTX": "XLV", "BIIB": "XLV",
    "MRNA": "XLV", "ILMN": "XLV", "INCY": "XLV",
    # Energy (XLE)
    "XOM": "XLE", "CVX": "XLE", "COP": "XLE", "OXY": "XLE", "SLB": "XLE",
    "EOG": "XLE", "MPC": "XLE", "PSX": "XLE", "VLO": "XLE",
    # Industrials (XLI)
    "BA": "XLI", "CAT": "XLI", "HON": "XLI", "MMM": "XLI", "GE": "XLI",
    # Utilities (XLU)
    "NEE": "XLU", "DUK": "XLU", "SO": "XLU",
    # Real Estate (XLRE)
    "AMT": "XLRE", "PLD": "XLRE", "EQIX": "XLRE",
    # ADRs default to broad market
    "BABA": "SPY", "PDD": "SPY", "JD": "SPY", "NIO": "SPY", "BIDU": "SPY",
    "TM": "SPY", "TSM": "XLK",
}


# ==================================================================
# Technical indicators — pure functions over closing-price series
# ==================================================================

def _sma(closes: list[float], window: int) -> Optional[float]:
    if len(closes) < window:
        return None
    return sum(closes[-window:]) / window


def _ema(closes: list[float], window: int) -> Optional[float]:
    if len(closes) < window:
        return None
    k = 2.0 / (window + 1)
    ema = sum(closes[:window]) / window
    for x in closes[window:]:
        ema = x * k + ema * (1 - k)
    return ema


def _rsi(closes: list[float], window: int = 14) -> Optional[float]:
    if len(closes) < window + 1:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    # Wilder's smoothing
    avg_gain = sum(gains[:window]) / window
    avg_loss = sum(losses[:window]) / window
    for i in range(window, len(gains)):
        avg_gain = (avg_gain * (window - 1) + gains[i]) / window
        avg_loss = (avg_loss * (window - 1) + losses[i]) / window
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _macd(closes: list[float]) -> dict[str, Optional[float]]:
    """MACD line, signal line, histogram (12/26/9 standard)."""
    if len(closes) < 35:
        return {"macd": None, "signal": None, "histogram": None}
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    if ema12 is None or ema26 is None:
        return {"macd": None, "signal": None, "histogram": None}
    macd_line = ema12 - ema26
    # Approximate signal as EMA9 of recent macd values — tradeoff for simplicity
    macd_series: list[float] = []
    for i in range(26, len(closes) + 1):
        e12 = _ema(closes[:i], 12)
        e26 = _ema(closes[:i], 26)
        if e12 is not None and e26 is not None:
            macd_series.append(e12 - e26)
    if len(macd_series) < 9:
        return {"macd": macd_line, "signal": None, "histogram": None}
    signal = _ema(macd_series, 9)
    if signal is None:
        return {"macd": macd_line, "signal": None, "histogram": None}
    return {"macd": macd_line, "signal": signal, "histogram": macd_line - signal}


def _bollinger(closes: list[float], window: int = 20, num_std: float = 2.0) -> dict[str, Optional[float]]:
    if len(closes) < window:
        return {"upper": None, "middle": None, "lower": None}
    window_data = closes[-window:]
    middle = sum(window_data) / window
    std = statistics.stdev(window_data) if window > 1 else 0.0
    return {"upper": middle + num_std * std, "middle": middle, "lower": middle - num_std * std}


def _atr(highs: list[float], lows: list[float], closes: list[float], window: int = 14) -> Optional[float]:
    """Average True Range — measures realized volatility."""
    if len(closes) < window + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < window:
        return None
    return sum(trs[-window:]) / window


def compute_technical_indicators(ohlcv_bars: list[dict]) -> dict:
    """
    Compute the full technical indicator suite from OHLCV bars.

    Expected bar shape: {"open": float, "high": float, "low": float,
                         "close": float, "volume": int, "time": int}
    """
    if not ohlcv_bars or len(ohlcv_bars) < 20:
        return {"insufficient_data": True}

    closes = [b["close"] for b in ohlcv_bars if b.get("close") is not None]
    highs = [b.get("high", b.get("close", 0)) for b in ohlcv_bars]
    lows = [b.get("low", b.get("close", 0)) for b in ohlcv_bars]
    volumes = [b.get("volume", 0) for b in ohlcv_bars]

    last = closes[-1] if closes else None
    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, 50)
    sma200 = _sma(closes, 200)
    rsi14 = _rsi(closes, 14)
    macd = _macd(closes)
    bb = _bollinger(closes, 20)
    atr14 = _atr(highs, lows, closes, 14)

    # Trend assessment: how MAs stack
    trend_label = "neutral"
    if sma20 and sma50 and sma200:
        if sma20 > sma50 > sma200 and last and last > sma20:
            trend_label = "strong uptrend"
        elif sma20 < sma50 < sma200 and last and last < sma20:
            trend_label = "strong downtrend"
        elif last and last > sma50:
            trend_label = "uptrend"
        elif last and last < sma50:
            trend_label = "downtrend"

    # Volume vs 20-day average
    avg_vol_20 = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else None
    last_vol = volumes[-1] if volumes else None
    vol_ratio = (last_vol / avg_vol_20) if avg_vol_20 and last_vol else None

    # 30D / 90D / 1Y returns
    def pct_return(periods: int) -> Optional[float]:
        if len(closes) <= periods:
            return None
        return (closes[-1] / closes[-1 - periods] - 1) * 100

    return {
        "last_close": last,
        "sma20": sma20,
        "sma50": sma50,
        "sma200": sma200,
        "rsi14": rsi14,
        "macd_line": macd["macd"],
        "macd_signal": macd["signal"],
        "macd_histogram": macd["histogram"],
        "bb_upper": bb["upper"],
        "bb_middle": bb["middle"],
        "bb_lower": bb["lower"],
        "atr14": atr14,
        "trend_label": trend_label,
        "volume_ratio_vs_20d": vol_ratio,
        "return_30d_pct": pct_return(30),
        "return_90d_pct": pct_return(90),
        "return_1y_pct": pct_return(252),
    }


# ==================================================================
# Fundamental data — Yahoo quoteSummary
# ==================================================================

async def fetch_fundamental_metrics(fetcher: DataFetcher, ticker: str) -> dict:
    """
    Fetch fundamental ratios + financial-health metrics from Yahoo.

    All values are best-effort; missing fields return None so the LLM
    can recognize incomplete data instead of getting an exception.
    """
    try:
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
        modules = "financialData,defaultKeyStatistics,summaryDetail,earnings"
        data = await fetcher._yahoo_request(url, {"modules": modules})
        result = data.get("quoteSummary", {}).get("result", [{}])[0]

        fin = result.get("financialData", {}) or {}
        stats = result.get("defaultKeyStatistics", {}) or {}
        detail = result.get("summaryDetail", {}) or {}
        earnings = result.get("earnings", {}) or {}

        def raw(d: dict, key: str) -> Optional[float]:
            v = d.get(key)
            if isinstance(v, dict):
                return v.get("raw")
            return None if v is None else (v if isinstance(v, (int, float)) else None)

        # Earnings growth from quarterly history
        eps_growth_yoy = None
        try:
            quarters = earnings.get("financialsChart", {}).get("quarterly", [])
            if len(quarters) >= 5:
                # year-over-year same quarter
                # quarters are ordered oldest → newest; -1 vs -5 is YoY for current quarter
                latest = quarters[-1].get("earnings", {})
                year_ago = quarters[-5].get("earnings", {})
                latest_v = latest.get("raw") if isinstance(latest, dict) else latest
                year_v = year_ago.get("raw") if isinstance(year_ago, dict) else year_ago
                if latest_v and year_v and year_v != 0:
                    eps_growth_yoy = (latest_v / year_v - 1) * 100
        except Exception:
            pass

        return {
            "pe_ratio": raw(detail, "trailingPE"),
            "forward_pe": raw(detail, "forwardPE"),
            "peg_ratio": raw(stats, "pegRatio"),
            "price_to_book": raw(stats, "priceToBook"),
            "price_to_sales": raw(stats, "priceToSalesTrailing12Months") or raw(detail, "priceToSalesTrailing12Months"),
            "profit_margin": raw(fin, "profitMargins"),
            "operating_margin": raw(fin, "operatingMargins"),
            "gross_margin": raw(fin, "grossMargins"),
            "revenue_growth_yoy": raw(fin, "revenueGrowth"),
            "earnings_growth_yoy": raw(fin, "earningsGrowth"),
            "eps_growth_yoy_pct": eps_growth_yoy,
            "return_on_equity": raw(fin, "returnOnEquity"),
            "return_on_assets": raw(fin, "returnOnAssets"),
            "debt_to_equity": raw(fin, "debtToEquity"),
            "current_ratio": raw(fin, "currentRatio"),
            "quick_ratio": raw(fin, "quickRatio"),
            "free_cash_flow": raw(fin, "freeCashflow"),
            "operating_cash_flow": raw(fin, "operatingCashflow"),
            "total_cash": raw(fin, "totalCash"),
            "total_debt": raw(fin, "totalDebt"),
            "shares_outstanding": raw(stats, "sharesOutstanding"),
            "shares_short": raw(stats, "sharesShort"),
            "short_ratio": raw(stats, "shortRatio"),
            "short_pct_float": raw(stats, "shortPercentOfFloat"),
            "beta": raw(stats, "beta") or raw(detail, "beta"),
            "dividend_yield": raw(detail, "dividendYield"),
            "market_cap": raw(detail, "marketCap"),
        }
    except Exception:
        return {}


# ==================================================================
# Sector / Market context
# ==================================================================

async def fetch_market_context(fetcher: DataFetcher) -> dict:
    """
    Fetch broad-market regime indicators.
    SPY/QQQ recent returns + VIX level + US10Y proxy (TLT inverse).
    """
    indicators = ["SPY", "QQQ", "^VIX", "TLT", "DXY", "^TNX"]

    async def safe_fetch(sym: str) -> tuple[str, dict]:
        try:
            spot = await fetcher.get_spot_price(sym)
            return sym, spot
        except Exception:
            return sym, {}

    results = await asyncio.gather(*[safe_fetch(s) for s in indicators], return_exceptions=True)
    out: dict = {}
    for r in results:
        if isinstance(r, Exception):
            continue
        sym, spot = r
        if spot:
            out[sym] = {
                "price": spot.get("spot_price"),
                "change_pct": spot.get("change_pct"),
            }
    return out


async def fetch_sector_etf_context(fetcher: DataFetcher, ticker: str) -> dict:
    """
    Fetch the ticker's sector-ETF context for the Industry researcher.
    Returns the sector ETF's current price + recent return for relative-strength comparison.
    """
    sector_etf = TICKER_TO_SECTOR_ETF.get(ticker.upper(), "SPY")
    try:
        spot = await fetcher.get_spot_price(sector_etf)
        return {
            "sector_etf": sector_etf,
            "etf_price": spot.get("spot_price"),
            "etf_change_pct": spot.get("change_pct"),
        }
    except Exception:
        return {"sector_etf": sector_etf}


# ==================================================================
# Researcher-specific context formatting
#
# Each function below takes the FULL gathered context and returns a
# focused markdown block that highlights the data MOST relevant to
# that researcher's specialty. Bull/Bear/News/Options keep the full
# block since their reasoning genuinely needs all data.
# ==================================================================

def _fmt_pct(v: Optional[float], scale_to_pct: bool = False) -> str:
    if v is None:
        return "n/a"
    val = v * 100 if scale_to_pct else v
    return f"{val:+.2f}%"


def _fmt_num(v: Optional[float], unit: str = "") -> str:
    if v is None:
        return "n/a"
    if abs(v) >= 1_000_000_000:
        return f"${v / 1_000_000_000:.2f}B{unit}"
    if abs(v) >= 1_000_000:
        return f"${v / 1_000_000:.2f}M{unit}"
    return f"{v:.2f}{unit}"


def format_technical_block(tech: dict, locale: str) -> str:
    """Block for Technical Researcher. Shows MA stack, RSI, MACD, BB, ATR, volume."""
    if not tech or tech.get("insufficient_data"):
        return ""
    is_zh = locale == "zh"

    last = tech.get("last_close")
    sma20 = tech.get("sma20")
    sma50 = tech.get("sma50")
    sma200 = tech.get("sma200")
    rsi = tech.get("rsi14")
    macd = tech.get("macd_line")
    macd_sig = tech.get("macd_signal")
    macd_hist = tech.get("macd_histogram")
    bb_upper = tech.get("bb_upper")
    bb_lower = tech.get("bb_lower")
    atr = tech.get("atr14")
    trend = tech.get("trend_label", "neutral")
    vol_ratio = tech.get("volume_ratio_vs_20d")
    r30 = tech.get("return_30d_pct")
    r90 = tech.get("return_90d_pct")
    r1y = tech.get("return_1y_pct")

    title = "### 技术指标（你的专属数据）" if is_zh else "### Technical Indicators (your specialty)"
    lines = [title]
    if last is not None:
        lines.append(f"- {'最新收盘' if is_zh else 'Last close'}: ${last:.2f}")
    if sma20 is not None:
        sma50_str = f"${sma50:.2f}" if sma50 is not None else "n/a"
        sma200_str = f"${sma200:.2f}" if sma200 is not None else "n/a"
        lines.append(f"- MA20 / MA50 / MA200: ${sma20:.2f} / {sma50_str} / {sma200_str}")
    if sma20 and sma50 and sma200 and last:
        lines.append(f"- {'MA 排列' if is_zh else 'MA stack'}: {trend}")
    if rsi is not None:
        zone = ("超买" if is_zh else "overbought") if rsi > 70 else ("超卖" if is_zh else "oversold") if rsi < 30 else ("中性" if is_zh else "neutral")
        lines.append(f"- RSI(14): {rsi:.1f} ({zone})")
    if macd is not None and macd_sig is not None:
        cross = ("MACD 在信号线上方" if is_zh else "MACD above signal") if macd > macd_sig else ("MACD 在信号线下方" if is_zh else "MACD below signal")
        hist_str = f"{macd_hist:.3f}" if macd_hist is not None else "n/a"
        lines.append(f"- MACD: {macd:.3f}, Signal: {macd_sig:.3f}, Hist: {hist_str} ({cross})")
    if bb_upper and bb_lower:
        bb_pos = ((last - bb_lower) / (bb_upper - bb_lower) * 100) if last and bb_upper > bb_lower else None
        lines.append(f"- {'布林带' if is_zh else 'Bollinger'}: upper ${bb_upper:.2f} / lower ${bb_lower:.2f}" + (f" ({'位置' if is_zh else 'position'} {bb_pos:.0f}%)" if bb_pos is not None else ""))
    if atr is not None:
        lines.append(f"- ATR(14): ${atr:.2f}")
    if vol_ratio is not None:
        vlabel = ("放量" if is_zh else "above-avg volume") if vol_ratio > 1.5 else ("缩量" if is_zh else "below-avg volume") if vol_ratio < 0.7 else ("正常" if is_zh else "normal volume")
        lines.append(f"- {'今日量能' if is_zh else 'Today volume'}: {vol_ratio:.2f}x 20D avg ({vlabel})")
    if r30 is not None or r90 is not None or r1y is not None:
        parts = []
        if r30 is not None: parts.append(f"30D {r30:+.2f}%")
        if r90 is not None: parts.append(f"90D {r90:+.2f}%")
        if r1y is not None: parts.append(f"1Y {r1y:+.2f}%")
        lines.append(f"- {'近期表现' if is_zh else 'Recent return'}: {' | '.join(parts)}")
    return "\n".join(lines)


def format_fundamental_block(fund: dict, locale: str) -> str:
    """Block for Fundamental Researcher. Valuation + growth + profitability."""
    if not fund:
        return ""
    is_zh = locale == "zh"
    title = "### 基本面指标（你的专属数据）" if is_zh else "### Fundamental Metrics (your specialty)"
    lines = [title]

    # Valuation
    pe = fund.get("pe_ratio")
    fpe = fund.get("forward_pe")
    peg = fund.get("peg_ratio")
    pb = fund.get("price_to_book")
    ps = fund.get("price_to_sales")
    parts = []
    if pe is not None: parts.append(f"P/E {pe:.2f}")
    if fpe is not None: parts.append(f"Fwd P/E {fpe:.2f}")
    if peg is not None: parts.append(f"PEG {peg:.2f}")
    if pb is not None: parts.append(f"P/B {pb:.2f}")
    if ps is not None: parts.append(f"P/S {ps:.2f}")
    if parts:
        lines.append(f"- {'估值' if is_zh else 'Valuation'}: {' | '.join(parts)}")

    # Margins (Yahoo returns these as decimals, scale to %)
    pm = fund.get("profit_margin")
    om = fund.get("operating_margin")
    gm = fund.get("gross_margin")
    margin_parts = []
    if gm is not None: margin_parts.append(f"Gross {gm * 100:.2f}%")
    if om is not None: margin_parts.append(f"Operating {om * 100:.2f}%")
    if pm is not None: margin_parts.append(f"Net {pm * 100:.2f}%")
    if margin_parts:
        lines.append(f"- {'利润率' if is_zh else 'Margins'}: {' | '.join(margin_parts)}")

    # Growth
    rev_growth = fund.get("revenue_growth_yoy")
    earn_growth = fund.get("earnings_growth_yoy")
    eps_growth = fund.get("eps_growth_yoy_pct")
    growth_parts = []
    if rev_growth is not None: growth_parts.append(f"Revenue YoY {rev_growth * 100:+.2f}%")
    if earn_growth is not None: growth_parts.append(f"Earnings YoY {earn_growth * 100:+.2f}%")
    if eps_growth is not None: growth_parts.append(f"EPS YoY {eps_growth:+.2f}%")
    if growth_parts:
        lines.append(f"- {'增长' if is_zh else 'Growth'}: {' | '.join(growth_parts)}")

    # Quality / capital efficiency
    roe = fund.get("return_on_equity")
    roa = fund.get("return_on_assets")
    if roe is not None or roa is not None:
        qparts = []
        if roe is not None: qparts.append(f"ROE {roe * 100:.2f}%")
        if roa is not None: qparts.append(f"ROA {roa * 100:.2f}%")
        lines.append(f"- {'资本回报' if is_zh else 'Capital efficiency'}: {' | '.join(qparts)}")

    # Cash flow
    fcf = fund.get("free_cash_flow")
    ocf = fund.get("operating_cash_flow")
    if fcf is not None or ocf is not None:
        cparts = []
        if ocf is not None: cparts.append(f"OCF {_fmt_num(ocf)}")
        if fcf is not None: cparts.append(f"FCF {_fmt_num(fcf)}")
        lines.append(f"- {'现金流' if is_zh else 'Cash flow'}: {' | '.join(cparts)}")

    # Other
    beta = fund.get("beta")
    div = fund.get("dividend_yield")
    mc = fund.get("market_cap")
    other_parts = []
    if mc is not None: other_parts.append(f"{'市值' if is_zh else 'Market Cap'} {_fmt_num(mc)}")
    if beta is not None: other_parts.append(f"Beta {beta:.2f}")
    if div is not None and div > 0: other_parts.append(f"Div Yield {div * 100:.2f}%")
    if other_parts:
        lines.append(f"- {'其他' if is_zh else 'Other'}: {' | '.join(other_parts)}")

    return "\n".join(lines)


def format_financial_block(fund: dict, locale: str) -> str:
    """Block for Financial Researcher — focus on balance-sheet quality."""
    if not fund:
        return ""
    is_zh = locale == "zh"
    title = "### 财务质量指标（你的专属数据）" if is_zh else "### Financial-Quality Metrics (your specialty)"
    lines = [title]

    debt_eq = fund.get("debt_to_equity")
    cur_ratio = fund.get("current_ratio")
    quick = fund.get("quick_ratio")
    parts = []
    if debt_eq is not None: parts.append(f"D/E {debt_eq:.2f}")
    if cur_ratio is not None: parts.append(f"Current {cur_ratio:.2f}")
    if quick is not None: parts.append(f"Quick {quick:.2f}")
    if parts:
        lines.append(f"- {'偿债能力' if is_zh else 'Solvency'}: {' | '.join(parts)}")

    cash = fund.get("total_cash")
    debt = fund.get("total_debt")
    if cash is not None and debt is not None:
        net_cash = cash - debt
        net_label = ("净现金" if is_zh else "net cash") if net_cash > 0 else ("净负债" if is_zh else "net debt")
        lines.append(f"- {'资产负债表' if is_zh else 'Balance sheet'}: Cash {_fmt_num(cash)} | Debt {_fmt_num(debt)} | {net_label} {_fmt_num(abs(net_cash))}")

    fcf = fund.get("free_cash_flow")
    ocf = fund.get("operating_cash_flow")
    mc = fund.get("market_cap")
    if fcf is not None and mc is not None and mc > 0:
        fcf_yield = fcf / mc * 100
        lines.append(f"- FCF Yield: {fcf_yield:.2f}% (FCF {_fmt_num(fcf)} / Cap {_fmt_num(mc)})")

    short_pct = fund.get("short_pct_float")
    if short_pct is not None:
        signal = ("空头拥挤" if is_zh else "crowded short") if short_pct > 0.10 else ("空头偏低" if is_zh else "low short")
        lines.append(f"- {'空头占流通股' if is_zh else 'Short % float'}: {short_pct * 100:.2f}% ({signal})")

    return "\n".join(lines)


def format_market_block(market_ctx: dict, locale: str) -> str:
    """Block for Market Researcher — broad market regime."""
    if not market_ctx:
        return ""
    is_zh = locale == "zh"
    title = "### 宏观市场环境（你的专属数据）" if is_zh else "### Macro Market Context (your specialty)"
    lines = [title]

    spy = market_ctx.get("SPY", {})
    qqq = market_ctx.get("QQQ", {})
    vix = market_ctx.get("^VIX", {})
    tnx = market_ctx.get("^TNX", {})
    tlt = market_ctx.get("TLT", {})

    if spy.get("price"):
        lines.append(f"- SPY: ${spy['price']:.2f} ({spy.get('change_pct', 0):+.2f}% today)")
    if qqq.get("price"):
        lines.append(f"- QQQ: ${qqq['price']:.2f} ({qqq.get('change_pct', 0):+.2f}% today)")
    if vix.get("price"):
        v = vix["price"]
        regime = ("市场恐慌" if is_zh else "fearful") if v > 25 else ("市场担忧" if is_zh else "elevated") if v > 18 else ("市场平静" if is_zh else "calm")
        lines.append(f"- VIX: {v:.2f} ({regime})")
    if tnx.get("price"):
        # ^TNX is 10Y yield × 10
        yld = tnx["price"] / 10 if tnx["price"] > 10 else tnx["price"]
        lines.append(f"- {'美 10 年期收益率' if is_zh else 'US 10Y yield'}: {yld:.2f}%")
    if tlt.get("change_pct") is not None:
        bond_dir = ("利率走低" if is_zh else "rates falling") if tlt["change_pct"] > 0 else ("利率走高" if is_zh else "rates rising")
        lines.append(f"- TLT: {tlt['change_pct']:+.2f}% today ({bond_dir})")

    return "\n".join(lines)


def format_industry_block(sector_ctx: dict, ticker_change_pct: Optional[float], locale: str) -> str:
    """Block for Industry Researcher — sector ETF + relative strength."""
    if not sector_ctx:
        return ""
    is_zh = locale == "zh"
    title = "### 行业板块对比（你的专属数据）" if is_zh else "### Industry / Sector Context (your specialty)"
    lines = [title]

    etf_sym = sector_ctx.get("sector_etf", "SPY")
    etf_price = sector_ctx.get("etf_price")
    etf_chg = sector_ctx.get("etf_change_pct")

    if etf_price is not None:
        lines.append(f"- {'所属板块 ETF' if is_zh else 'Sector ETF'}: {etf_sym} @ ${etf_price:.2f} ({etf_chg:+.2f}% today)" if etf_chg is not None else f"- Sector ETF: {etf_sym} @ ${etf_price:.2f}")

    # Relative strength: ticker vs sector ETF today
    if ticker_change_pct is not None and etf_chg is not None:
        rel = ticker_change_pct - etf_chg
        signal = ("强于板块" if is_zh else "outperforming") if rel > 0.5 else ("弱于板块" if is_zh else "underperforming") if rel < -0.5 else ("跟随板块" if is_zh else "in line")
        lines.append(f"- {'相对板块强弱' if is_zh else 'Relative strength'}: {rel:+.2f}% vs {etf_sym} ({signal})")

    return "\n".join(lines)
