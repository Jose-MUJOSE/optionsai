"""
Financial history aggregator.

Pulls quarterly + annual income-statement history and earnings history from
Yahoo Finance quoteSummary in a single round-trip:
  - incomeStatementHistoryQuarterly  → last ~4 quarters of revenue/cost/EPS
  - incomeStatementHistory           → last ~4 fiscal years of same fields
  - earningsHistory                  → last ~4 quarters of EPS actual vs estimate
  - earnings                         → richer earnings chart with revenue surprise

The result powers two dashboard cards:
  - FinancialsPanel       — revenue / margins / EPS quarterly + annual trends
  - EarningsHistoryPanel  — last N earnings: surprise, post-earnings 1d move

Post-earnings price changes are computed on-the-fly by joining each earnings
date with the OHLCV bars we already fetch for the candlestick chart, so this
module does not issue an extra OHLCV request — the caller passes ohlcv_bars in.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from backend.services.data_fetcher import DataFetcher


_QUOTE_SUMMARY_MODULES = (
    "incomeStatementHistory,"
    "incomeStatementHistoryQuarterly,"
    "earnings,"
    "earningsHistory"
)


def _raw(d: Optional[dict], key: str) -> Optional[float]:
    """Pull a numeric value out of Yahoo's `{raw, fmt}` envelope (or bare float)."""
    if d is None:
        return None
    v = d.get(key)
    if v is None:
        return None
    if isinstance(v, dict):
        raw = v.get("raw")
        return raw if isinstance(raw, (int, float)) else None
    return v if isinstance(v, (int, float)) else None


def _safe_div(n: Optional[float], d: Optional[float]) -> Optional[float]:
    if n is None or d is None or d == 0:
        return None
    return n / d


def _period_label(d: Optional[dict], default: str = "") -> str:
    """Return a YYYY-MM-DD or YYYYQn label from Yahoo's endDate envelope."""
    end = (d or {}).get("endDate") if d else None
    if isinstance(end, dict):
        fmt = end.get("fmt")
        if fmt:
            return fmt
        raw = end.get("raw")
        if isinstance(raw, (int, float)):
            try:
                return datetime.fromtimestamp(raw, tz=timezone.utc).date().isoformat()
            except Exception:
                return default
    return default


def _income_row(stmt: dict) -> dict:
    """Convert one income-statement node into a flat dict of metrics."""
    revenue = _raw(stmt, "totalRevenue")
    cost_of_revenue = _raw(stmt, "costOfRevenue")
    gross_profit = _raw(stmt, "grossProfit")
    # Yahoo's quarterly statements sometimes have missing cost/gross fields
    # masquerading as zero or as revenue itself. Reject any value that would
    # produce a 0% or 100% gross margin — those are almost certainly missing data.
    if gross_profit in (None, 0) and revenue is not None and cost_of_revenue not in (None, 0):
        gross_profit = revenue - cost_of_revenue
    if gross_profit is not None and revenue and (gross_profit == revenue or gross_profit == 0):
        gross_profit = None
    operating_income = _raw(stmt, "operatingIncome")
    net_income = _raw(stmt, "netIncome")
    return {
        "period": _period_label(stmt),
        "revenue": revenue,
        "gross_profit": gross_profit,
        "operating_income": operating_income,
        "net_income": net_income,
        "gross_margin": _safe_div(gross_profit, revenue),
        "operating_margin": _safe_div(operating_income, revenue),
        "net_margin": _safe_div(net_income, revenue),
    }


def _attach_growth(rows: list[dict], yoy_lag: int = 4) -> list[dict]:
    """Attach QoQ (one-period) and YoY (yoy_lag-periods-ago) growth rates.

    Yahoo returns rows newest-first; we reorder to oldest-first so growth math
    is unambiguous, then put back to newest-first for the response. yoy_lag=4
    is correct for quarterly data (4 quarters back = 1 year). For annual data
    pass yoy_lag=1.
    """
    if not rows:
        return rows
    # Yahoo gives newest-first — flip to oldest-first for the math.
    asc = list(reversed(rows))
    for i, row in enumerate(asc):
        rev_now = row.get("revenue")
        ni_now = row.get("net_income")
        # QoQ / sequential
        if i >= 1:
            prev = asc[i - 1]
            row["revenue_qoq"] = _safe_div(
                (rev_now - prev["revenue"]) if rev_now is not None and prev.get("revenue") is not None else None,
                prev.get("revenue"),
            )
            row["net_income_qoq"] = _safe_div(
                (ni_now - prev["net_income"]) if ni_now is not None and prev.get("net_income") is not None else None,
                abs(prev["net_income"]) if prev.get("net_income") else None,
            )
        else:
            row["revenue_qoq"] = None
            row["net_income_qoq"] = None
        # YoY
        if i >= yoy_lag:
            prev = asc[i - yoy_lag]
            row["revenue_yoy"] = _safe_div(
                (rev_now - prev["revenue"]) if rev_now is not None and prev.get("revenue") is not None else None,
                prev.get("revenue"),
            )
            row["net_income_yoy"] = _safe_div(
                (ni_now - prev["net_income"]) if ni_now is not None and prev.get("net_income") is not None else None,
                abs(prev["net_income"]) if prev.get("net_income") else None,
            )
        else:
            row["revenue_yoy"] = None
            row["net_income_yoy"] = None
    # Back to newest-first
    return list(reversed(asc))


def _post_earnings_move(
    earnings_date_iso: str,
    bars: list[dict],
) -> Optional[dict]:
    """Compute next-trading-day price change after an earnings announcement.

    Yahoo's earningsHistory only gives the date of the announcement, not whether
    it was BMO (before market open) or AMC (after market close). We use the
    convention of "first trading day on or after the announcement vs the
    previous trading day's close" to capture the gap-and-go move regardless.
    """
    if not bars or not earnings_date_iso:
        return None
    try:
        target = date.fromisoformat(earnings_date_iso[:10])
    except ValueError:
        return None
    # bars are oldest-first with `time` (epoch seconds) and OHLCV.
    # Find the index of the first bar with date >= target.
    idx = None
    for i, b in enumerate(bars):
        ts = b.get("time")
        if ts is None:
            continue
        try:
            bar_date = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        except (ValueError, OSError):
            continue
        if bar_date >= target:
            idx = i
            break
    if idx is None or idx == 0:
        return None
    prev_close = bars[idx - 1].get("close")
    earnings_open = bars[idx].get("open")
    earnings_close = bars[idx].get("close")
    if prev_close is None or earnings_close is None:
        return None
    pct_close = (earnings_close - prev_close) / prev_close if prev_close else None
    pct_open = ((earnings_open - prev_close) / prev_close) if prev_close and earnings_open is not None else None
    return {
        "prev_close": prev_close,
        "earnings_open": earnings_open,
        "earnings_close": earnings_close,
        "pct_close": pct_close,   # close-to-close % move (the headline number)
        "pct_open": pct_open,     # gap-and-go % move (open vs prev close)
    }


def _reported_date(item: dict) -> Optional[str]:
    """Pull the actual announcement date from earnings.earningsChart.quarterly.

    Falls back to periodEndDate when reportedDate is missing (older entries).
    Returns ISO YYYY-MM-DD or None.
    """
    rd = item.get("reportedDate")
    if isinstance(rd, dict):
        fmt = rd.get("fmt")
        if fmt:
            return fmt[:10]
    pe = item.get("periodEndDate")
    if isinstance(pe, dict):
        fmt = pe.get("fmt")
        if fmt:
            return fmt[:10]
    return None


def _normalize_pct(v: Optional[float]) -> Optional[float]:
    """Yahoo returns surprisePct sometimes as 1.5 (meaning 1.5%) and sometimes as 0.015.
    Anything with absolute value > 1 is heuristically treated as already-in-percent.
    """
    if v is None:
        return None
    return v / 100.0 if abs(v) > 1 else v


def _earnings_rows(block: dict, ohlcv_bars: Optional[list[dict]]) -> list[dict]:
    """Extract last N earnings announcements with EPS surprise and 1d price move.

    Prefers `earnings.earningsChart.quarterly` (has reportedDate) over
    `earningsHistory.history` (only periodEndDate). Falls back to the latter
    when the former is empty.
    """
    earnings_block = (block.get("earnings") or {})
    chart_quarterly = ((earnings_block.get("earningsChart") or {}).get("quarterly")) or []

    out: list[dict] = []
    if chart_quarterly:
        for item in chart_quarterly:
            reported = _reported_date(item)
            actual = _raw(item, "actual")
            estimate = _raw(item, "estimate")
            # surprisePct is sometimes a string ("10.12"), sometimes a number.
            sp_raw = item.get("surprisePct")
            try:
                surprise = float(sp_raw) if sp_raw is not None else None
            except (TypeError, ValueError):
                surprise = None
            surprise = _normalize_pct(surprise)
            if surprise is None and actual is not None and estimate not in (None, 0):
                surprise = (actual - estimate) / abs(estimate)
            post_move = _post_earnings_move(reported or "", ohlcv_bars or [])
            out.append({
                "date": reported,
                "quarter": item.get("fiscalQuarter") or item.get("date"),
                "eps_actual": actual,
                "eps_estimate": estimate,
                "eps_surprise_pct": surprise,
                "post_earnings": post_move,
            })
        # earningsChart is oldest-first; flip to newest-first.
        return list(reversed(out))

    # Fallback: legacy earningsHistory shape (no reportedDate).
    history = ((block.get("earningsHistory") or {}).get("history")) or []
    for item in history:
        date_label = _period_label(item)
        eps_actual = _raw(item, "epsActual")
        eps_estimate = _raw(item, "epsEstimate")
        eps_diff = _raw(item, "epsDifference")
        surprise_pct = _normalize_pct(_raw(item, "surprisePercent"))
        if surprise_pct is None and eps_diff is not None and eps_estimate not in (None, 0):
            surprise_pct = eps_diff / abs(eps_estimate)
        post_move = _post_earnings_move(date_label, ohlcv_bars or [])
        out.append({
            "date": date_label,
            "quarter": _str_quarter(item),
            "eps_actual": eps_actual,
            "eps_estimate": eps_estimate,
            "eps_surprise_pct": surprise_pct,
            "post_earnings": post_move,
        })
    return list(reversed(out))


def _str_quarter(item: dict) -> Optional[str]:
    """Extract quarter label like '2024Q3' from earningsHistory item."""
    q = item.get("quarter")
    if isinstance(q, dict):
        fmt = q.get("fmt")
        if fmt:
            # Yahoo ships quarter as the period-end fmt; turn it into FYxxQn.
            try:
                d = datetime.strptime(fmt, "%Y-%m-%d").date()
                quarter_num = (d.month - 1) // 3 + 1
                return f"{d.year}Q{quarter_num}"
            except ValueError:
                return fmt
    return None


async def fetch_financials(
    fetcher: DataFetcher,
    ticker: str,
    ohlcv_bars: Optional[list[dict]] = None,
) -> dict:
    """Fetch quarterly + annual financials and earnings history.

    Always returns a dict. Failed fields are None — the frontend renders
    'n/a' rather than throwing.

    Args:
        fetcher: shared DataFetcher with httpx client
        ticker: US-listed ticker (already validated upstream)
        ohlcv_bars: optional list of bars from /api/ohlcv used to compute
                   post-earnings 1d price moves. Pass None to skip the
                   join — earnings rows will still come back without prices.
    """
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
    try:
        data = await fetcher._yahoo_request(url, {"modules": _QUOTE_SUMMARY_MODULES})
    except Exception as e:
        return {
            "ticker": ticker.upper(),
            "fetch_error": f"{type(e).__name__}: {e}",
            "quarterly": [],
            "annual": [],
            "earnings_history": [],
        }

    result = (data.get("quoteSummary") or {}).get("result") or [{}]
    block = result[0] if result else {}

    quarterly_raw = ((block.get("incomeStatementHistoryQuarterly") or {}).get("incomeStatementHistory")) or []
    annual_raw = ((block.get("incomeStatementHistory") or {}).get("incomeStatementHistory")) or []

    quarterly = _attach_growth([_income_row(s) for s in quarterly_raw], yoy_lag=4)
    annual = _attach_growth([_income_row(s) for s in annual_raw], yoy_lag=1)

    earnings = _earnings_rows(block, ohlcv_bars)

    return {
        "ticker": ticker.upper(),
        "quarterly": quarterly,
        "annual": annual,
        "earnings_history": earnings,
    }
