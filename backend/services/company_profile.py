"""
Company-profile aggregator.

Pulls the full quoteSummary modules needed to render the dashboard's
"Who is this company?" card on the frontend:
  - assetProfile        → sector / industry / country / employees / website / business summary
  - quoteType           → equity vs ETF detection
  - summaryDetail       → market cap, P/E, Fwd P/E, dividend yield, 52w range
  - defaultKeyStatistics→ P/B, PEG, EV, EV/EBITDA, beta, shares
  - financialData       → margins, growth, ROE, FCF
  - price               → exchange, currency, longName, shortName

This is a single Yahoo round-trip (multiple modules in one URL) so latency
is roughly the same as fetching just price data.

The result is exposed via /api/company-profile/{ticker} and consumed by
the new frontend CompanyProfile.tsx card.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

from backend.services.data_fetcher import DataFetcher


# Modules we need from Yahoo. Asking for them all in one request is much
# cheaper than 6 separate requests, even though the response is bigger.
_QUOTE_SUMMARY_MODULES = (
    "assetProfile,"
    "quoteType,"
    "summaryDetail,"
    "defaultKeyStatistics,"
    "financialData,"
    "price"
)


def _raw(d: dict, key: str) -> Optional[float]:
    """Pull a numeric value out of Yahoo's `{raw, fmt, longFmt}` envelope.

    Yahoo's quoteSummary returns numbers as either bare floats or as
    `{"raw": 1.5, "fmt": "1.5%", "longFmt": "1.5%"}`. This helper normalizes
    both shapes and returns None when the field is missing or malformed.
    """
    if d is None:
        return None
    v = d.get(key)
    if v is None:
        return None
    if isinstance(v, dict):
        raw = v.get("raw")
        return raw if isinstance(raw, (int, float)) else None
    return v if isinstance(v, (int, float)) else None


def _str(d: dict, key: str) -> Optional[str]:
    if d is None:
        return None
    v = d.get(key)
    if v is None:
        return None
    if isinstance(v, dict):
        # Some string fields are also boxed: {"longFmt": "...", "fmt": "..."}
        return v.get("longFmt") or v.get("fmt")
    return str(v) if v else None


def _domain_from_website(website: Optional[str]) -> Optional[str]:
    """Extract bare domain (e.g. 'apple.com') from a full URL for Clearbit logos.

    Returns None for empty/garbled inputs. Strips the leading 'www.' so the
    Clearbit lookup hits the canonical brand domain.
    """
    if not website:
        return None
    try:
        url = website if "://" in website else f"https://{website}"
        netloc = urlparse(url).netloc.strip().lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc or None
    except Exception:
        return None


async def fetch_company_profile(fetcher: DataFetcher, ticker: str) -> dict:
    """Fetch a unified company profile from Yahoo quoteSummary.

    Always returns a dict. Failed sub-fields land as None, never as exceptions
    — the frontend already has graceful "n/a" fallbacks for every metric.
    """
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
    try:
        data = await fetcher._yahoo_request(url, {"modules": _QUOTE_SUMMARY_MODULES})
    except Exception as e:
        # Empty payload — caller will detect via `is_etf=false` + missing names
        return {"ticker": ticker, "fetch_error": f"{type(e).__name__}: {e}"}

    result = (data.get("quoteSummary") or {}).get("result") or [{}]
    block = result[0] if result else {}

    asset = block.get("assetProfile") or {}
    qt = block.get("quoteType") or {}
    summary = block.get("summaryDetail") or {}
    stats = block.get("defaultKeyStatistics") or {}
    fin = block.get("financialData") or {}
    price = block.get("price") or {}

    quote_type_raw = (qt.get("quoteType") or price.get("quoteType") or "").upper()
    # Treat ETFs / mutual funds / indices as non-equity — frontend hides the card.
    is_etf = quote_type_raw in ("ETF", "MUTUALFUND", "INDEX")

    website = _str(asset, "website")
    logo_domain = _domain_from_website(website)

    return {
        "ticker": ticker.upper(),
        "is_etf": is_etf,
        "quote_type": quote_type_raw or None,

        # Identity
        "long_name": _str(price, "longName") or _str(qt, "longName"),
        "short_name": _str(price, "shortName") or _str(qt, "shortName"),
        "exchange": _str(price, "exchangeName") or _str(qt, "exchange"),
        "currency": _str(price, "currency"),
        "logo_url": f"https://logo.clearbit.com/{logo_domain}" if logo_domain else None,

        # Classification
        "sector": _str(asset, "sector"),
        "industry": _str(asset, "industry"),
        "country": _str(asset, "country"),
        "city": _str(asset, "city"),
        "state": _str(asset, "state"),
        "address1": _str(asset, "address1"),
        "phone": _str(asset, "phone"),
        "website": website,
        "full_time_employees": _raw(asset, "fullTimeEmployees"),

        # Valuation (P0)
        "market_cap": _raw(price, "marketCap") or _raw(summary, "marketCap"),
        "enterprise_value": _raw(stats, "enterpriseValue"),
        "trailing_pe": _raw(summary, "trailingPE") or _raw(stats, "trailingPE"),
        "forward_pe": _raw(summary, "forwardPE") or _raw(stats, "forwardPE"),
        "price_to_book": _raw(stats, "priceToBook") or _raw(summary, "priceToBook"),
        "price_to_sales_ttm": _raw(summary, "priceToSalesTrailing12Months") or _raw(stats, "priceToSalesTrailing12Months"),
        "ev_to_ebitda": _raw(stats, "enterpriseToEbitda"),
        "peg_ratio": _raw(stats, "pegRatio"),
        "dividend_yield": _raw(summary, "dividendYield") or _raw(summary, "trailingAnnualDividendYield"),
        "payout_ratio": _raw(summary, "payoutRatio"),

        # Financials (P1)
        "revenue_ttm": _raw(fin, "totalRevenue"),
        "ebitda": _raw(fin, "ebitda"),
        "net_income_ttm": _raw(stats, "netIncomeToCommon"),
        "free_cash_flow": _raw(fin, "freeCashflow"),
        "operating_cash_flow": _raw(fin, "operatingCashflow"),
        "total_cash": _raw(fin, "totalCash"),
        "total_debt": _raw(fin, "totalDebt"),
        "gross_margin": _raw(fin, "grossMargins"),
        "operating_margin": _raw(fin, "operatingMargins"),
        "profit_margin": _raw(fin, "profitMargins"),
        "return_on_equity": _raw(fin, "returnOnEquity"),
        "return_on_assets": _raw(fin, "returnOnAssets"),
        "debt_to_equity": _raw(fin, "debtToEquity"),
        "current_ratio": _raw(fin, "currentRatio"),
        "revenue_growth_yoy": _raw(fin, "revenueGrowth"),
        "earnings_growth_yoy": _raw(fin, "earningsGrowth"),

        # Market metrics
        "beta": _raw(stats, "beta") or _raw(summary, "beta"),
        "shares_outstanding": _raw(stats, "sharesOutstanding"),
        "float_shares": _raw(stats, "floatShares"),
        "current_price": _raw(price, "regularMarketPrice") or _raw(fin, "currentPrice"),
        "fifty_two_week_high": _raw(summary, "fiftyTwoWeekHigh"),
        "fifty_two_week_low": _raw(summary, "fiftyTwoWeekLow"),
        "fifty_day_avg": _raw(summary, "fiftyDayAverage"),
        "two_hundred_day_avg": _raw(summary, "twoHundredDayAverage"),

        # Description (the meaty one for newcomers)
        "long_business_summary": _str(asset, "longBusinessSummary"),
    }
