"""
Analyst ratings aggregator.

Pulls per-firm rating actions WITH price targets (Yahoo does expose these in
the free tier — `upgradeDowngradeHistory.history` items include
`currentPriceTarget` and `priorPriceTarget`).

Returns:
  - consensus: mean/high/low target + analyst count + rating distribution
  - rating_changes: last N firm-level actions (firm, date, from/to grade,
                    action label, price target with delta)

The result powers the dashboard's AnalystRatingsPanel — a list view much like
moomoo/Snowball's "Wall St consensus" card with each firm's specific target.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from backend.services.data_fetcher import DataFetcher


_QUOTE_SUMMARY_MODULES = (
    "upgradeDowngradeHistory,"
    "recommendationTrend,"
    "financialData,"
    "price"
)

# Action codes used by Yahoo. We expose a normalized label downstream so the
# frontend doesn't have to know these magic strings.
_ACTION_LABELS = {
    "init": "Initiate",
    "main": "Maintain",
    "reit": "Reiterate",
    "up":   "Upgrade",
    "down": "Downgrade",
}


def _raw(d: Optional[dict], key: str) -> Optional[float]:
    if d is None:
        return None
    v = d.get(key)
    if v is None:
        return None
    if isinstance(v, dict):
        raw = v.get("raw")
        return raw if isinstance(raw, (int, float)) else None
    return v if isinstance(v, (int, float)) else None


def _epoch_to_iso(epoch: Optional[int]) -> Optional[str]:
    if epoch is None or not isinstance(epoch, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(int(epoch), tz=timezone.utc).date().isoformat()
    except (ValueError, OSError):
        return None


def _aggregate_recommendation(rt: dict) -> dict:
    """Sum the most-recent period's rating distribution.

    Yahoo returns 4 trend periods (0m, -1m, -2m, -3m). The 0m period is the
    current month's distribution — that's what we surface as 'consensus'.
    """
    trend = rt.get("trend") or []
    current = next((p for p in trend if (p.get("period") or "") == "0m"), None) or (trend[0] if trend else None)
    if not current:
        return {"strong_buy": 0, "buy": 0, "hold": 0, "sell": 0, "strong_sell": 0, "total": 0}
    sb = int(current.get("strongBuy") or 0)
    b = int(current.get("buy") or 0)
    h = int(current.get("hold") or 0)
    s = int(current.get("sell") or 0)
    ss = int(current.get("strongSell") or 0)
    return {
        "strong_buy": sb,
        "buy": b,
        "hold": h,
        "sell": s,
        "strong_sell": ss,
        "total": sb + b + h + s + ss,
    }


def _consensus_label(agg: dict) -> str:
    """Map rating distribution to a human label (Strong Buy / Buy / Hold / Sell)."""
    total = agg.get("total") or 0
    if total == 0:
        return "n/a"
    # Score: strong_buy=2, buy=1, hold=0, sell=-1, strong_sell=-2 → average
    score = (
        agg["strong_buy"] * 2 + agg["buy"] * 1 - agg["sell"] * 1 - agg["strong_sell"] * 2
    ) / total
    if score >= 1.5:
        return "Strong Buy"
    if score >= 0.5:
        return "Buy"
    if score >= -0.5:
        return "Hold"
    if score >= -1.5:
        return "Sell"
    return "Strong Sell"


async def fetch_analyst_ratings(
    fetcher: DataFetcher,
    ticker: str,
    limit: int = 25,
) -> dict:
    """Fetch consensus + per-firm rating changes (with price targets).

    Args:
        fetcher: shared DataFetcher
        ticker:  US ticker (validated upstream)
        limit:   max number of recent rating actions to return (default 25)
    """
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
    try:
        data = await fetcher._yahoo_request(url, {"modules": _QUOTE_SUMMARY_MODULES})
    except Exception as e:
        return {
            "ticker": ticker.upper(),
            "fetch_error": f"{type(e).__name__}: {e}",
            "consensus": None,
            "rating_changes": [],
        }

    result = (data.get("quoteSummary") or {}).get("result") or [{}]
    block = result[0] if result else {}

    fin = block.get("financialData") or {}
    price = block.get("price") or {}
    rt = block.get("recommendationTrend") or {}
    ud = block.get("upgradeDowngradeHistory") or {}

    aggregate = _aggregate_recommendation(rt)
    target_mean = _raw(fin, "targetMeanPrice")
    target_high = _raw(fin, "targetHighPrice")
    target_low = _raw(fin, "targetLowPrice")
    target_median = _raw(fin, "targetMedianPrice")
    analyst_count = _raw(fin, "numberOfAnalystOpinions")
    current_price = _raw(price, "regularMarketPrice") or _raw(fin, "currentPrice")

    upside_pct = None
    if target_mean is not None and current_price not in (None, 0):
        upside_pct = (target_mean - current_price) / current_price

    consensus = {
        "label": _consensus_label(aggregate),
        "target_mean": target_mean,
        "target_median": target_median,
        "target_high": target_high,
        "target_low": target_low,
        "current_price": current_price,
        "upside_pct": upside_pct,
        "analyst_count": int(analyst_count) if analyst_count is not None else None,
        "distribution": aggregate,
    }

    history = (ud.get("history") or [])
    # Yahoo gives newest-first already, but sort defensively.
    history = sorted(history, key=lambda h: h.get("epochGradeDate") or 0, reverse=True)

    changes: list[dict] = []
    for item in history[:limit]:
        if not isinstance(item, dict):
            continue
        action_code = (item.get("action") or "").strip().lower()
        target = _raw(item, "currentPriceTarget")
        prior = _raw(item, "priorPriceTarget")
        delta = None
        if target is not None and prior not in (None, 0):
            delta = (target - prior) / prior
        changes.append({
            "date": _epoch_to_iso(item.get("epochGradeDate")),
            "firm": item.get("firm") or None,
            "from_grade": item.get("fromGrade") or None,
            "to_grade": item.get("toGrade") or None,
            "action_code": action_code or None,
            "action_label": _ACTION_LABELS.get(action_code, action_code.title() or None),
            "price_target": target,
            "prior_price_target": prior,
            "price_target_delta_pct": delta,
            "price_target_action": item.get("priceTargetAction") or None,
        })

    return {
        "ticker": ticker.upper(),
        "consensus": consensus,
        "rating_changes": changes,
    }
