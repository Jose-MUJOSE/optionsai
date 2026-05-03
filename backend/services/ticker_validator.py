"""
Ticker validation with multi-market support.

OptionsAI's primary focus is the US options market, but we also accept
A-shares (.SS / .SZ) and Hong Kong stocks (.HK) for STOCK RESEARCH ONLY.
The frontend reads the `market` flag returned by validation and disables
options-related views (chain, IV term, GEX, strategies) for non-US tickers.

Allowed formats:
  - 1-5 letter US tickers:                 AAPL, TSLA, BRK
  - With class suffix:                     BRK.A, BRK.B
  - A-shares (Shanghai):                   600519.SS, 600036.SS, 601318.SS
  - A-shares (Shenzhen):                   000858.SZ, 000001.SZ, 300750.SZ
  - HK stocks:                             0700.HK, 9988.HK, 1810.HK

Rejected:
  - Indices (^GSPC, ^DJI):                 no options
  - Forex / futures (=X, =F):              no options
  - Crypto (BTC-USD):                      no options
  - Other international suffixes (.L, .T, .TO, .DE, .PA, ...): out of scope
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Market = Literal["us", "cn_a", "hk"]


_US_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{0,4}(\.[AB])?$")
_CN_SS_RE = re.compile(r"^\d{6}\.SS$")  # Shanghai A-shares
_CN_SZ_RE = re.compile(r"^\d{6}\.SZ$")  # Shenzhen A-shares
_HK_RE = re.compile(r"^\d{4,5}\.HK$")    # Hong Kong stocks
_INDEX_RE = re.compile(r"^\^[A-Z]{2,6}$")


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    market: Market = "us"
    has_options: bool = True   # only US tickers have a US-style options chain
    reason_en: str = ""
    reason_zh: str = ""


def validate_us_ticker(ticker: str) -> ValidationResult:
    """Validate ticker symbol; identify market and options availability.

    Returns ValidationResult.valid=True for any of:
      - US stock/ETF (AAPL, BRK.B, ...)
      - A-share (600519.SS, 000001.SZ)
      - HK stock (0700.HK)

    `market` distinguishes the three; `has_options` is True only for US.
    """
    if not ticker:
        return ValidationResult(
            valid=False,
            reason_en="Ticker cannot be empty.",
            reason_zh="股票代码不能为空。",
        )

    t = ticker.strip().upper()

    # A-shares (Shanghai) — 6-digit + .SS, e.g. 600519.SS
    if _CN_SS_RE.match(t):
        return ValidationResult(valid=True, market="cn_a", has_options=False)

    # A-shares (Shenzhen) — 6-digit + .SZ, e.g. 000001.SZ
    if _CN_SZ_RE.match(t):
        return ValidationResult(valid=True, market="cn_a", has_options=False)

    # Hong Kong — 4-5 digit + .HK, e.g. 0700.HK
    if _HK_RE.match(t):
        return ValidationResult(valid=True, market="hk", has_options=False)

    # Reject other international suffixes
    if "." in t:
        suffix = t.split(".", 1)[1]
        if suffix in {"L", "T", "TO", "DE", "PA", "AS", "MI", "MC"}:
            return ValidationResult(
                valid=False,
                reason_en="Other international markets are not supported.",
                reason_zh="暂不支持其他国际市场代码。",
            )
        # Fall through to standard US (.A / .B) check below if it's not above.
        if suffix not in {"A", "B"}:
            return ValidationResult(
                valid=False,
                reason_en=(
                    f"Unrecognized ticker suffix '.{suffix}'. "
                    "Use US (AAPL), A-share (600519.SS, 000001.SZ), or HK (0700.HK)."
                ),
                reason_zh=(
                    f"无法识别的代码后缀「.{suffix}」。"
                    "请输入美股（如 AAPL）、A 股（如 600519.SS）或港股（如 0700.HK）代码。"
                ),
            )

    # Reject futures (=F), forex (=X)
    if "=" in t:
        return ValidationResult(
            valid=False,
            reason_en="Futures and forex pairs are not supported.",
            reason_zh="暂不支持期货和外汇代码。",
        )

    # Reject crypto pairs (BTC-USD)
    if "-" in t:
        return ValidationResult(
            valid=False,
            reason_en="Crypto pairs are not supported (no options market).",
            reason_zh="暂不支持加密货币对（无期权市场）。",
        )

    # Index tickers — no options
    if t.startswith("^"):
        if _INDEX_RE.match(t):
            return ValidationResult(
                valid=False,
                reason_en=(
                    "Raw index tickers have no tradable options. "
                    "Try the corresponding ETF (e.g. ^GSPC → SPY, ^IXIC → QQQ)."
                ),
                reason_zh=(
                    "指数代码没有可交易期权。请改用对应 ETF："
                    "标普 500 → SPY，纳指 → QQQ。"
                ),
            )

    # Standard US ticker
    if _US_TICKER_RE.match(t):
        return ValidationResult(valid=True, market="us", has_options=True)

    return ValidationResult(
        valid=False,
        reason_en=(
            f"'{t}' is not a valid ticker. "
            "Use US (AAPL), A-share (600519.SS, 000001.SZ), or HK (0700.HK) format."
        ),
        reason_zh=(
            f"「{t}」不是有效的代码格式。"
            "请输入美股（AAPL）、A 股（600519.SS、000001.SZ）或港股（0700.HK）代码。"
        ),
    )
