"""
SEC EDGAR XBRL financial-data fetcher.

Yahoo Finance's free quoteSummary modules cap at 4 quarters and frequently
return missing/zero values for grossProfit. SEC EDGAR exposes the same XBRL
filings the SEC requires from public companies — going back 10+ years, with
every standard concept reliably populated. It's free, no API key, official.

We pull quarterly (10-Q + Q4-from-10-K) and annual (10-K) values for the
core income-statement line items, then derive margins and growth rates.

References:
  - https://www.sec.gov/cgi-bin/browse-edgar
  - https://www.sec.gov/edgar/sec-api-documentation
  - Concept definitions: https://xbrl.us/data-rule/dqc_0001/

Concept fallback chain (companies disclose under different XBRL tags):
  Revenue:    RevenueFromContractWithCustomerExcludingAssessedTax →
              RevenueFromContractWithCustomerIncludingAssessedTax → Revenues →
              SalesRevenueNet
  Gross:      GrossProfit
  OpInc:      OperatingIncomeLoss
  NetInc:     NetIncomeLoss
  COGS:       CostOfRevenue → CostOfGoodsAndServicesSold → CostOfGoodsSold
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

import httpx


# SEC requires identifying user-agent. Replace email if you fork.
_HEADERS = {
    "User-Agent": "OptionsAI optionsai-research@example.com",
    "Accept": "application/json",
}

_REVENUE_CONCEPTS = (
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
)
_GROSS_PROFIT_CONCEPTS = ("GrossProfit",)
_OPERATING_INCOME_CONCEPTS = ("OperatingIncomeLoss",)
_NET_INCOME_CONCEPTS = ("NetIncomeLoss",)
_COGS_CONCEPTS = (
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
)


# Process-wide cache (ticker → CIK). The ticker map is ~12k entries and rarely
# changes; loading it once per process is plenty.
_TICKER_TO_CIK: dict[str, str] = {}
_TICKER_MAP_LOADED = False


async def _load_ticker_map(client: httpx.AsyncClient) -> None:
    global _TICKER_MAP_LOADED
    if _TICKER_MAP_LOADED:
        return
    r = await client.get("https://www.sec.gov/files/company_tickers.json", timeout=20)
    r.raise_for_status()
    data = r.json()
    for entry in data.values():
        ticker = (entry.get("ticker") or "").upper()
        cik = entry.get("cik_str")
        if ticker and cik is not None:
            _TICKER_TO_CIK[ticker] = str(cik).zfill(10)
    _TICKER_MAP_LOADED = True


async def _get_company_facts(client: httpx.AsyncClient, cik: str) -> Optional[dict]:
    """Fetch /companyfacts/CIK{cik}.json — the full XBRL fact set for a company."""
    r = await client.get(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
        timeout=30,
    )
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def _is_quarterly_3mo(unit: dict) -> bool:
    """Detect a single-quarter (3-month) entry vs a 6/9-month cumulative.

    XBRL filings include both 3-month and YTD-cumulative versions of the
    same concept for the same period-end. We want only 3-month windows.
    """
    start = unit.get("start")
    end = unit.get("end")
    if not start or not end:
        # Annual (10-K FY) filings sometimes lack start; treat as non-quarter.
        return False
    try:
        d1 = date.fromisoformat(start)
        d2 = date.fromisoformat(end)
    except ValueError:
        return False
    days = (d2 - d1).days
    # 3-month window = ~90 days; allow 70-110 to handle early/late filings.
    return 70 <= days <= 110


def _is_annual(unit: dict) -> bool:
    """Detect a fiscal-year (10-K) annual entry — 12-month window."""
    start = unit.get("start")
    end = unit.get("end")
    if not start or not end:
        return False
    try:
        d1 = date.fromisoformat(start)
        d2 = date.fromisoformat(end)
    except ValueError:
        return False
    days = (d2 - d1).days
    return 350 <= days <= 380 and unit.get("form") == "10-K"


def _extract_concept(facts: dict, concepts: tuple[str, ...]) -> dict[str, list[dict]]:
    """Pull the first concept from `concepts` that has data, returning USD entries."""
    gaap = (facts.get("facts") or {}).get("us-gaap") or {}
    for concept in concepts:
        if concept in gaap:
            units = (gaap[concept].get("units") or {}).get("USD") or []
            if units:
                return {"concept": concept, "units": units}
    return {"concept": None, "units": []}


def _index_by_end_date(units: list[dict], filter_fn) -> dict[str, dict]:
    """Build {end_date_iso: unit} map for entries matching filter_fn.

    When duplicates exist for the same period-end (different filings or
    different from-dates), keep the latest filing date.
    """
    out: dict[str, dict] = {}
    for u in units:
        if not filter_fn(u):
            continue
        end = u.get("end")
        if not end:
            continue
        existing = out.get(end)
        if existing is None or (u.get("filed", "") > existing.get("filed", "")):
            out[end] = u
    return out


def _index_by_end_date_annual(units: list[dict]) -> dict[str, dict]:
    """Build {end_date_iso: unit} for ANNUAL (12-month, 10-K) entries."""
    out: dict[str, dict] = {}
    for u in units:
        if not _is_annual(u):
            continue
        end = u.get("end")
        if not end:
            continue
        existing = out.get(end)
        if existing is None or (u.get("filed", "") > existing.get("filed", "")):
            out[end] = u
    return out


def _derive_missing_q4(
    quarterly_idx: dict[str, dict],
    annual_idx: dict[str, dict],
    units: list[dict],
) -> None:
    """Some 10-K filers don't disclose a 3-month Q4 entry — only the annual.
    Compute Q4 = annual − sum(Q1+Q2+Q3 of the same fiscal year) and inject
    a synthetic 3-month entry into the quarterly index.

    Mutates quarterly_idx in place. No-op for tickers that already disclose Q4.
    """
    # Build start-date index of quarterly entries to find Q1/Q2/Q3 of a fiscal year.
    by_start: dict[str, list[dict]] = {}
    for end, u in quarterly_idx.items():
        start = u.get("start")
        if start:
            by_start.setdefault(start, []).append(u)

    for fy_end, ann in annual_idx.items():
        fy_start = ann.get("start")
        if not fy_start:
            continue
        # Already have the Q4 quarter? Skip.
        if fy_end in quarterly_idx:
            continue
        # Find the Q1/Q2/Q3 quarterly entries that fall inside [fy_start, fy_end].
        try:
            fy_start_d = date.fromisoformat(fy_start)
            fy_end_d = date.fromisoformat(fy_end)
        except ValueError:
            continue
        sum_val = 0.0
        n = 0
        for u in quarterly_idx.values():
            us = u.get("start")
            ue = u.get("end")
            if not isinstance(us, str) or not isinstance(ue, str):
                continue
            try:
                u_start = date.fromisoformat(us)
                u_end = date.fromisoformat(ue)
            except ValueError:
                continue
            if fy_start_d <= u_start and u_end < fy_end_d:
                sum_val += u.get("val") or 0
                n += 1
        if n != 3 or not isinstance(ann.get("val"), (int, float)):
            continue
        q4_val = ann["val"] - sum_val
        # Synthesize a quarterly entry. Mark `derived: True` for transparency.
        quarterly_idx[fy_end] = {
            "end": fy_end,
            "start": None,
            "val": q4_val,
            "form": "derived-from-10K",
            "filed": ann.get("filed", ""),
            "derived": True,
        }


def _build_quarterly_rows(facts: dict, max_quarters: int = 12) -> list[dict]:
    """Assemble the per-quarter dataset from the indexed concepts."""
    rev = _extract_concept(facts, _REVENUE_CONCEPTS)
    gp = _extract_concept(facts, _GROSS_PROFIT_CONCEPTS)
    op = _extract_concept(facts, _OPERATING_INCOME_CONCEPTS)
    ni = _extract_concept(facts, _NET_INCOME_CONCEPTS)
    cogs = _extract_concept(facts, _COGS_CONCEPTS)

    rev_idx = _index_by_end_date(rev["units"], _is_quarterly_3mo)
    gp_idx = _index_by_end_date(gp["units"], _is_quarterly_3mo)
    op_idx = _index_by_end_date(op["units"], _is_quarterly_3mo)
    ni_idx = _index_by_end_date(ni["units"], _is_quarterly_3mo)
    cogs_idx = _index_by_end_date(cogs["units"], _is_quarterly_3mo)

    # Derive missing Q4 quarters from annual − Q1−Q2−Q3 for filers like AAPL
    # that report fiscal-year aggregates without a separate Q4 disclosure.
    rev_ann = _index_by_end_date_annual(rev["units"])
    gp_ann = _index_by_end_date_annual(gp["units"])
    op_ann = _index_by_end_date_annual(op["units"])
    ni_ann = _index_by_end_date_annual(ni["units"])
    cogs_ann = _index_by_end_date_annual(cogs["units"])
    _derive_missing_q4(rev_idx, rev_ann, rev["units"])
    _derive_missing_q4(gp_idx, gp_ann, gp["units"])
    _derive_missing_q4(op_idx, op_ann, op["units"])
    _derive_missing_q4(ni_idx, ni_ann, ni["units"])
    _derive_missing_q4(cogs_idx, cogs_ann, cogs["units"])

    # Take the union of all end-dates that have at least revenue OR net income;
    # newest-first, capped at max_quarters.
    end_dates = sorted(set(rev_idx.keys()) | set(ni_idx.keys()), reverse=True)[:max_quarters]

    rows: list[dict] = []
    for end in end_dates:
        revenue = (rev_idx.get(end) or {}).get("val")
        gross = (gp_idx.get(end) or {}).get("val")
        cost = (cogs_idx.get(end) or {}).get("val")
        # Derive gross_profit from revenue - cogs when not directly disclosed.
        if gross is None and revenue is not None and cost is not None:
            gross = revenue - cost
        net_inc = (ni_idx.get(end) or {}).get("val")
        op_inc = (op_idx.get(end) or {}).get("val")
        rows.append({
            "period": end,
            "revenue": revenue,
            "gross_profit": gross,
            "operating_income": op_inc,
            "net_income": net_inc,
            "gross_margin": (gross / revenue) if (gross is not None and revenue) else None,
            "operating_margin": (op_inc / revenue) if (op_inc is not None and revenue) else None,
            "net_margin": (net_inc / revenue) if (net_inc is not None and revenue) else None,
        })
    return rows


def _build_annual_rows(facts: dict, max_years: int = 6) -> list[dict]:
    """Same as quarterly but using 12-month entries from 10-K filings."""
    rev = _extract_concept(facts, _REVENUE_CONCEPTS)
    gp = _extract_concept(facts, _GROSS_PROFIT_CONCEPTS)
    op = _extract_concept(facts, _OPERATING_INCOME_CONCEPTS)
    ni = _extract_concept(facts, _NET_INCOME_CONCEPTS)
    cogs = _extract_concept(facts, _COGS_CONCEPTS)

    rev_idx = _index_by_end_date(rev["units"], _is_annual)
    gp_idx = _index_by_end_date(gp["units"], _is_annual)
    op_idx = _index_by_end_date(op["units"], _is_annual)
    ni_idx = _index_by_end_date(ni["units"], _is_annual)
    cogs_idx = _index_by_end_date(cogs["units"], _is_annual)

    end_dates = sorted(set(rev_idx.keys()) | set(ni_idx.keys()), reverse=True)[:max_years]

    rows: list[dict] = []
    for end in end_dates:
        revenue = (rev_idx.get(end) or {}).get("val")
        gross = (gp_idx.get(end) or {}).get("val")
        cost = (cogs_idx.get(end) or {}).get("val")
        if gross is None and revenue is not None and cost is not None:
            gross = revenue - cost
        net_inc = (ni_idx.get(end) or {}).get("val")
        op_inc = (op_idx.get(end) or {}).get("val")
        rows.append({
            "period": end,
            "revenue": revenue,
            "gross_profit": gross,
            "operating_income": op_inc,
            "net_income": net_inc,
            "gross_margin": (gross / revenue) if (gross is not None and revenue) else None,
            "operating_margin": (op_inc / revenue) if (op_inc is not None and revenue) else None,
            "net_margin": (net_inc / revenue) if (net_inc is not None and revenue) else None,
        })
    return rows


def _attach_growth(rows: list[dict], yoy_lag: int) -> list[dict]:
    """Add YoY (yoy_lag periods back) and QoQ (1 period back) growth fractions."""
    if not rows:
        return rows
    # rows are newest-first; reverse to oldest-first for index math
    asc = list(reversed(rows))
    for i, row in enumerate(asc):
        rev_now = row.get("revenue")
        ni_now = row.get("net_income")
        if i >= 1:
            prev = asc[i - 1]
            prev_rev = prev.get("revenue")
            prev_ni = prev.get("net_income")
            row["revenue_qoq"] = (
                (rev_now - prev_rev) / prev_rev
                if (rev_now is not None and prev_rev not in (None, 0))
                else None
            )
            row["net_income_qoq"] = (
                (ni_now - prev_ni) / abs(prev_ni)
                if (ni_now is not None and prev_ni not in (None, 0))
                else None
            )
        else:
            row["revenue_qoq"] = None
            row["net_income_qoq"] = None
        if i >= yoy_lag:
            prev = asc[i - yoy_lag]
            prev_rev = prev.get("revenue")
            prev_ni = prev.get("net_income")
            row["revenue_yoy"] = (
                (rev_now - prev_rev) / prev_rev
                if (rev_now is not None and prev_rev not in (None, 0))
                else None
            )
            row["net_income_yoy"] = (
                (ni_now - prev_ni) / abs(prev_ni)
                if (ni_now is not None and prev_ni not in (None, 0))
                else None
            )
        else:
            row["revenue_yoy"] = None
            row["net_income_yoy"] = None
    return list(reversed(asc))


async def fetch_us_financials(
    ticker: str,
    *,
    quarters: int = 12,
    years: int = 6,
) -> Optional[dict]:
    """Fetch 10+ years of US income-statement data via SEC EDGAR.

    Returns a dict matching the existing FinancialsResponse shape:
      { ticker, quarterly: [...], annual: [...] }

    Earnings history is NOT included — that comes from Yahoo (it has reported
    EPS surprise data EDGAR doesn't). Returns None when CIK is unknown,
    so the caller can fall back to Yahoo for non-EDGAR tickers (foreign
    companies, brand-new IPOs).
    """
    async with httpx.AsyncClient(headers=_HEADERS, timeout=30) as client:
        await _load_ticker_map(client)
        cik = _TICKER_TO_CIK.get(ticker.upper())
        if not cik:
            return None
        try:
            facts = await _get_company_facts(client, cik)
        except httpx.HTTPError:
            return None
        if not facts:
            return None

    quarterly = _attach_growth(_build_quarterly_rows(facts, max_quarters=quarters), yoy_lag=4)
    annual = _attach_growth(_build_annual_rows(facts, max_years=years), yoy_lag=1)

    return {
        "ticker": ticker.upper(),
        "quarterly": quarterly,
        "annual": annual,
        "source": "sec_edgar",
    }
