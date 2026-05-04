"""
A-share data fetcher backed by AKShare.

AKShare wraps 东方财富 / 同花顺 / 新浪 endpoints — well-maintained, MIT-licensed,
no API key required. We use it for everything Yahoo Finance can't deliver for
A-shares:
  - 公司概况  (stock_individual_info_em)        → company profile fields
  - 财务摘要  (stock_financial_abstract)         → 80+ indicators × 50+ quarters
  - 主要指标  (stock_financial_analysis_indicator) → margins/ROE in formal form
  - 公司新闻  (stock_news_em)                     → real Chinese-language news

AKShare calls are synchronous; we offload them to a threadpool to keep the
FastAPI event loop unblocked.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Optional

import akshare as ak


def _ticker_to_code(ticker: str) -> Optional[str]:
    """Normalize Yahoo-style A-share ticker (e.g. '600519.SS') to 6-digit code.

    Returns None for non-A-share tickers so the caller can fall through.
    """
    t = ticker.upper().strip()
    m = re.match(r"^(\d{6})\.(SS|SZ)$", t)
    return m.group(1) if m else None


# ============================================================
# Company profile
# ============================================================

async def fetch_cn_company_profile(ticker: str) -> Optional[dict]:
    """A-share company profile shaped to match the US CompanyProfile schema.

    Pulls from `stock_individual_info_em` (basic identity + market cap +
    industry) plus `stock_individual_basic_info_xq` for richer fields when
    available. Returns None if the ticker isn't an A-share or the lookup fails.
    """
    code = _ticker_to_code(ticker)
    if not code:
        return None

    def _sync():
        try:
            basic = ak.stock_individual_info_em(symbol=code)
        except Exception:
            return None
        # Convert "key/value" rows into a dict for easier lookup
        rows = {row["item"]: row["value"] for _, row in basic.iterrows()}
        return rows

    rows = await asyncio.to_thread(_sync)
    if not rows:
        return None

    # Industry text and listing date come back as strings/numbers; normalize.
    industry = str(rows.get("行业", "") or "")
    listing_date = str(rows.get("上市时间", "") or "")
    try:
        market_cap = float(rows.get("总市值") or 0)
    except (TypeError, ValueError):
        market_cap = None
    try:
        float_cap = float(rows.get("流通市值") or 0)
    except (TypeError, ValueError):
        float_cap = None
    try:
        shares = float(rows.get("总股本") or 0)
    except (TypeError, ValueError):
        shares = None
    try:
        float_shares = float(rows.get("流通股") or 0)
    except (TypeError, ValueError):
        float_shares = None

    # Try to pull a richer business description from xueqiu (snowball) endpoint.
    business_summary = None
    try:
        async def _try_xq():
            return await asyncio.to_thread(ak.stock_individual_basic_info_xq, symbol=f"SH{code}" if code.startswith("6") else f"SZ{code}")
        xq = await _try_xq()
        if xq is not None and not xq.empty:
            xq_rows = {r["item"]: r["value"] for _, r in xq.iterrows()}
            business_summary = xq_rows.get("公司简介") or xq_rows.get("主营业务") or None
    except Exception:
        pass

    return {
        "ticker": ticker.upper(),
        "is_etf": False,
        "quote_type": "EQUITY",
        "long_name": str(rows.get("股票简称") or ""),
        "short_name": str(rows.get("股票简称") or ""),
        "exchange": "Shanghai" if code.startswith("6") else "Shenzhen",
        "currency": "CNY",
        "logo_url": None,  # No clean Chinese logo source
        "sector": industry.split("Ⅱ")[0] if "Ⅱ" in industry else industry,
        "industry": industry,
        "country": "China",
        "city": None,
        "state": None,
        "address1": None,
        "phone": None,
        "website": None,
        "full_time_employees": None,
        # Valuation / market metrics
        "market_cap": market_cap,
        "enterprise_value": None,
        "trailing_pe": None,
        "forward_pe": None,
        "price_to_book": None,
        "price_to_sales_ttm": None,
        "ev_to_ebitda": None,
        "peg_ratio": None,
        "dividend_yield": None,
        "payout_ratio": None,
        # Financials (filled by /api/financials separately)
        "revenue_ttm": None,
        "ebitda": None,
        "net_income_ttm": None,
        "free_cash_flow": None,
        "operating_cash_flow": None,
        "total_cash": None,
        "total_debt": None,
        "gross_margin": None,
        "operating_margin": None,
        "profit_margin": None,
        "return_on_equity": None,
        "return_on_assets": None,
        "debt_to_equity": None,
        "current_ratio": None,
        "revenue_growth_yoy": None,
        "earnings_growth_yoy": None,
        # Market metrics
        "beta": None,
        "shares_outstanding": shares,
        "float_shares": float_shares,
        "current_price": None,  # filled by spot endpoint elsewhere
        "fifty_two_week_high": None,
        "fifty_two_week_low": None,
        "fifty_day_avg": None,
        "two_hundred_day_avg": None,
        "long_business_summary": business_summary,
        # A-share-specific extras
        "listing_date": listing_date,
        "float_market_cap": float_cap,
        "data_source": "eastmoney_via_akshare",
    }


# ============================================================
# Financial history (quarterly + annual + key margins)
# ============================================================

# AKShare's stock_financial_abstract returns rows like:
#   选项 / 指标 / 20260331 / 20251231 / ... / 20051231
# where '指标' values include:
#   营业总收入 / 净利润 / 归属于母公司股东的净利润 / 营业利润 / 毛利率 / 净利率 / ...
# We pivot it into per-period rows.

_INDICATOR_REVENUE = "营业总收入"
_INDICATOR_NET_INCOME = "归母净利润"
_INDICATOR_OP_INCOME = "营业利润"
_INDICATOR_GROSS_MARGIN = "毛利率"
_INDICATOR_NET_MARGIN = "净利率"


def _norm_period(date_str: str) -> str:
    """Convert '20260331' to '2026-03-31'."""
    if len(date_str) == 8 and date_str.isdigit():
        return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    return date_str


async def fetch_cn_financials(
    ticker: str,
    *,
    quarters: int = 8,
    years: int = 5,
) -> Optional[dict]:
    """Quarterly + annual financial rows for an A-share ticker."""
    code = _ticker_to_code(ticker)
    if not code:
        return None

    def _sync():
        try:
            return ak.stock_financial_abstract(symbol=code)
        except Exception:
            return None

    df = await asyncio.to_thread(_sync)
    if df is None or df.empty:
        return None

    # Build a {indicator: {period_iso: value}} map
    by_indicator: dict[str, dict[str, float]] = {}
    period_cols = [c for c in df.columns if c.isdigit() and len(c) == 8]
    for _, row in df.iterrows():
        ind = row.get("指标")
        if not isinstance(ind, str):
            continue
        per_period: dict[str, float] = {}
        for col in period_cols:
            v = row[col]
            try:
                fv = float(v)
                if fv == fv:  # NaN check
                    per_period[_norm_period(col)] = fv
            except (TypeError, ValueError):
                continue
        if per_period:
            by_indicator[ind] = per_period

    # Identify the available periods, sort newest-first
    all_periods = sorted({p for d in by_indicator.values() for p in d.keys()}, reverse=True)
    if not all_periods:
        return None

    # Distinguish quarterly (Mar/Jun/Sep) from annual (Dec)
    quarterly_periods = [p for p in all_periods if not p.endswith("-12-31")]
    annual_periods = [p for p in all_periods if p.endswith("-12-31")]

    def _pct(v: Optional[float]) -> Optional[float]:
        # AKShare returns margins as already-percent (e.g. 91.45 means 91.45%).
        # Convert to fraction so the frontend can use the same formatting code.
        if v is None:
            return None
        return v / 100.0

    def _build_rows(periods: list[str], limit: int) -> list[dict]:
        rev_map = by_indicator.get(_INDICATOR_REVENUE) or {}
        ni_map = by_indicator.get(_INDICATOR_NET_INCOME) or by_indicator.get("净利润") or {}
        op_map = by_indicator.get(_INDICATOR_OP_INCOME) or {}
        gm_map = by_indicator.get(_INDICATOR_GROSS_MARGIN) or {}
        nm_map = by_indicator.get(_INDICATOR_NET_MARGIN) or {}
        rows: list[dict] = []
        for p in periods[:limit]:
            rev = rev_map.get(p)
            ni = ni_map.get(p)
            op = op_map.get(p)
            gm = _pct(gm_map.get(p))
            nm = _pct(nm_map.get(p))
            # Compute net_margin if AKShare didn't include it directly
            if nm is None and rev not in (None, 0) and ni is not None:
                nm = ni / rev
            # Estimate gross_profit from revenue × gross_margin when the raw
            # gross_profit field isn't disclosed.
            gp = (rev * gm) if (rev is not None and gm is not None) else None
            rows.append({
                "period": p,
                "revenue": rev,
                "gross_profit": gp,
                "operating_income": op,
                "net_income": ni,
                "gross_margin": gm,
                "operating_margin": (op / rev) if (op is not None and rev) else None,
                "net_margin": nm,
            })
        return rows

    quarterly = _build_rows(quarterly_periods + [p for p in annual_periods if p in quarterly_periods], quarters)
    # For annual, include only Dec 31 rows
    annual = _build_rows(annual_periods, years)

    # Attach growth rates
    def _attach(rows: list[dict], yoy_lag: int) -> list[dict]:
        if not rows:
            return rows
        asc = list(reversed(rows))
        for i, r in enumerate(asc):
            for field, lag_field in (("revenue", "revenue_yoy"), ("net_income", "net_income_yoy")):
                if i >= yoy_lag:
                    prev = asc[i - yoy_lag].get(field)
                    cur = r.get(field)
                    r[lag_field] = (cur - prev) / abs(prev) if (cur is not None and prev not in (None, 0)) else None
                else:
                    r[lag_field] = None
            for field, qoq_field in (("revenue", "revenue_qoq"), ("net_income", "net_income_qoq")):
                if i >= 1:
                    prev = asc[i - 1].get(field)
                    cur = r.get(field)
                    r[qoq_field] = (cur - prev) / abs(prev) if (cur is not None and prev not in (None, 0)) else None
                else:
                    r[qoq_field] = None
        return list(reversed(asc))

    return {
        "ticker": ticker.upper(),
        "quarterly": _attach(quarterly, yoy_lag=4),
        "annual": _attach(annual, yoy_lag=1),
        "earnings_history": [],  # AKShare doesn't have EPS surprise history readily
        "source": "eastmoney_via_akshare",
    }


# ============================================================
# News
# ============================================================

async def fetch_cn_news(ticker: str, *, limit: int = 10) -> list[dict]:
    """Real Chinese-language news from 东方财富 for an A-share ticker."""
    code = _ticker_to_code(ticker)
    if not code:
        return []

    def _sync():
        try:
            return ak.stock_news_em(symbol=code)
        except Exception:
            return None

    df = await asyncio.to_thread(_sync)
    if df is None or df.empty:
        return []

    out: list[dict] = []
    for _, row in df.head(limit).iterrows():
        title = str(row.get("新闻标题") or "")
        ts = str(row.get("发布时间") or "")
        url = str(row.get("新闻链接") or row.get("链接") or "")
        source = str(row.get("文章来源") or row.get("来源") or "东方财富")
        out.append({
            "title": title,
            "url": url,
            "source": source,
            "published_at": ts,
        })
    return out
