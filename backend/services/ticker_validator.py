"""
US-only ticker validation.

OptionsAI focuses on the US options market. A-shares (000001.SZ, 600519.SS),
HK shares (0700.HK), forex pairs (EURUSD=X), and commodity futures (GC=F)
either have no individual stock options or no public retail-accessible chain.

Allowed formats:
  - 1-5 letter US tickers:                 AAPL, TSLA, BRK
  - With class suffix:                     BRK.A, BRK.B
  - Index tickers (^GSPC, ^DJI, ^IXIC):    minimal support, options not available
  - Crypto-USD pairs (BTC-USD):            blocked (no options)

Rejected:
  - .SS / .SZ / .HK / .L / .T / .TO / .DE / .HK suffixes
  - =X, =F suffixes
"""
from __future__ import annotations

import re
from dataclasses import dataclass


_US_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{0,4}(\.[AB])?$")
_INDEX_RE = re.compile(r"^\^[A-Z]{2,6}$")  # ^GSPC, ^DJI, ^IXIC, ^VIX, ^RUT


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    reason_en: str = ""
    reason_zh: str = ""


def validate_us_ticker(ticker: str) -> ValidationResult:
    """
    Validate a ticker symbol for the US market.

    Returns ValidationResult.valid=True only if the symbol matches the
    documented US format. Otherwise returns a human-friendly reason in
    both English and Chinese.
    """
    if not ticker:
        return ValidationResult(
            valid=False,
            reason_en="Ticker cannot be empty.",
            reason_zh="股票代码不能为空。",
        )

    t = ticker.strip().upper()

    # Reject explicit non-US suffixes
    if "." in t:
        suffix = t.split(".", 1)[1]
        if suffix in {"SS", "SZ"}:
            return ValidationResult(
                valid=False,
                reason_en=(
                    "A-shares (China mainland) are not supported. "
                    "A-shares have no individual stock options — only ETF & index options. "
                    "OptionsAI focuses on the US options market."
                ),
                reason_zh=(
                    "暂不支持 A 股。A 股没有个股期权，只有 ETF 和股指期权。"
                    "OptionsAI 专注于美股期权市场，请输入美股代码（如 AAPL、TSLA）。"
                ),
            )
        if suffix == "HK":
            return ValidationResult(
                valid=False,
                reason_en="Hong Kong stocks are not supported. Please enter a US ticker (e.g. AAPL, TSLA).",
                reason_zh="暂不支持港股，请输入美股代码（如 AAPL、TSLA）。",
            )
        if suffix in {"L", "T", "TO", "DE", "PA", "AS", "MI", "MC"}:
            return ValidationResult(
                valid=False,
                reason_en="International tickers are not supported. Please enter a US ticker.",
                reason_zh="暂不支持非美股市场，请输入美股代码。",
            )
        if suffix not in {"A", "B"}:
            return ValidationResult(
                valid=False,
                reason_en=f"Unrecognized ticker suffix '.{suffix}'. Please enter a US ticker.",
                reason_zh=f"无法识别的代码后缀「.{suffix}」，请输入美股代码。",
            )

    # Reject futures (=F), forex (=X)
    if "=" in t:
        return ValidationResult(
            valid=False,
            reason_en="Futures and forex pairs are not supported. Please enter a US stock or ETF ticker.",
            reason_zh="暂不支持期货和外汇代码，请输入美股或 ETF 代码。",
        )

    # Reject crypto pairs (BTC-USD)
    if "-" in t:
        return ValidationResult(
            valid=False,
            reason_en="Crypto pairs are not supported (no options market). Please enter a US ticker.",
            reason_zh="暂不支持加密货币对（无期权市场），请输入美股代码。",
        )

    # Index tickers — allow but flag (no options on raw index)
    if t.startswith("^"):
        if _INDEX_RE.match(t):
            return ValidationResult(
                valid=False,
                reason_en=(
                    "Raw index tickers have no tradable options. "
                    "Try the corresponding ETF instead (e.g. ^GSPC → SPY, ^IXIC → QQQ, ^DJI → DIA)."
                ),
                reason_zh=(
                    "指数代码没有可交易期权。请改用对应 ETF："
                    "标普 500 → SPY，纳指 → QQQ，道指 → DIA。"
                ),
            )

    # Standard US ticker
    if _US_TICKER_RE.match(t):
        return ValidationResult(valid=True)

    return ValidationResult(
        valid=False,
        reason_en=(
            f"'{t}' is not a valid US ticker. "
            "Use 1-5 letters, optionally followed by .A or .B (e.g. AAPL, TSLA, BRK.B)."
        ),
        reason_zh=(
            f"「{t}」不是有效的美股代码。"
            "请使用 1-5 个字母，可选 .A / .B 后缀（如 AAPL、TSLA、BRK.B）。"
        ),
    )
