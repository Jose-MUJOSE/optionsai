"""
Portfolio Greeks aggregation.

Given a list of option legs (paper-portfolio positions), compute:
  - Aggregated Δ (delta) — total $ exposure per $1 spot move
  - Aggregated Γ (gamma) — Δ change per $1 spot move
  - Aggregated Θ (theta) — daily time decay in $
  - Aggregated ν (vega) — $ change per 1% IV change

Plus risk scenarios:
  - "What if spot moves -5% / -2% / +2% / +5%"
  - "What if IV moves +5pts / -5pts"

All Greeks come from BSM theoretical calc using current spot + 30-day HV.
We don't pull live option-chain Greeks for each leg because:
  1. Many user legs may be off-chain (custom strikes from backtest)
  2. Latency would be 1-3s per leg
  3. Theoretical Greeks at HV match the backtest engine — consistent UX

Sign conventions:
  - BUY: Greeks contribute positively
  - SELL: Greeks contribute negatively
  - Multiplier: 100 (standard contract size)
  - Theta is reported as $ per calendar day (positive = decay loss for long)
  - Delta dollars = aggregate Δ × contracts × 100 × spot
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from backend.services.data_fetcher import DataFetcher


# Reasonable defaults — same as backtest_engine
RISK_FREE_RATE = 0.045
TRADING_DAYS_PER_YEAR = 252


# ==================================================================
# BSM Greek calculations
# ==================================================================

def _norm_cdf(x: float) -> float:
    """Standard normal CDF using error function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _d1_d2(S: float, K: float, T: float, r: float, sigma: float) -> tuple[float, float]:
    if T <= 0 or sigma <= 0:
        return 0.0, 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return d1, d2


def bsm_greeks(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    opt_type: str,
) -> dict:
    """
    Compute BSM Greeks for a single option.

    Returns:
      {"delta": float, "gamma": float, "theta": float, "vega": float}

    Delta:  ∂V/∂S
    Gamma:  ∂²V/∂S² — same for call and put
    Theta:  ∂V/∂t — converted to per-calendar-day from per-year
    Vega:   ∂V/∂σ — per 1% IV change (×0.01 from raw)

    For very short DTE (T → 0) or zero sigma, returns intrinsic-only Greeks.
    """
    if T <= 1e-9 or sigma <= 1e-9:
        # Edge case: at expiration or zero vol → degenerate Greeks
        if opt_type == "call":
            return {"delta": 1.0 if S > K else 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
        return {"delta": -1.0 if S < K else 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}

    d1, d2 = _d1_d2(S, K, T, r, sigma)
    pdf_d1 = _norm_pdf(d1)
    sqrt_T = math.sqrt(T)

    gamma = pdf_d1 / (S * sigma * sqrt_T)
    # Vega per 1% IV change — divide raw by 100 to get sensitivity per 1pt of IV
    vega = S * pdf_d1 * sqrt_T / 100.0

    if opt_type == "call":
        delta = _norm_cdf(d1)
        # Theta per year, then convert to per calendar day (÷ 365)
        theta_year = -(S * pdf_d1 * sigma) / (2 * sqrt_T) - r * K * math.exp(-r * T) * _norm_cdf(d2)
    else:  # put
        delta = _norm_cdf(d1) - 1.0
        theta_year = -(S * pdf_d1 * sigma) / (2 * sqrt_T) + r * K * math.exp(-r * T) * _norm_cdf(-d2)

    theta_day = theta_year / 365.0  # calendar days

    return {
        "delta": delta,
        "gamma": gamma,
        "theta": theta_day,
        "vega": vega,
    }


# ==================================================================
# Position-level aggregation
# ==================================================================

@dataclass
class PortfolioPosition:
    """One paper-portfolio position. Mirrors PaperPosition shape from frontend."""
    ticker: str
    legs: list[dict]            # [{"action": "buy"/"sell", "opt_type": "call"/"put", "strike": float, "quantity": int}, ...]
    dte_days: int               # remaining days to expiration
    entry_date: str = ""        # informational only

    def signed_quantity(self, leg: dict) -> int:
        """Positive for BUY, negative for SELL."""
        sign = 1 if leg.get("action", "buy").lower() == "buy" else -1
        return sign * int(leg.get("quantity", 1))


def compute_position_greeks(
    pos: PortfolioPosition,
    spot: float,
    sigma: float,
    days_elapsed: int = 0,
) -> dict:
    """
    Compute aggregated Greeks for a single position (sum across legs).

    Returns a dict with both raw Greeks and "dollar exposure" Greeks
    (Greek × signed_qty × 100 multiplier).
    """
    raw_delta = 0.0
    raw_gamma = 0.0
    raw_theta = 0.0
    raw_vega = 0.0

    dte_remaining = max(pos.dte_days - days_elapsed, 0)
    T = dte_remaining / TRADING_DAYS_PER_YEAR

    for leg in pos.legs:
        opt_type = leg.get("opt_type", "call").lower()
        strike = float(leg.get("strike", spot))
        signed_qty = pos.signed_quantity(leg)
        g = bsm_greeks(spot, strike, T, RISK_FREE_RATE, sigma, opt_type)
        raw_delta += g["delta"] * signed_qty
        raw_gamma += g["gamma"] * signed_qty
        raw_theta += g["theta"] * signed_qty
        raw_vega += g["vega"] * signed_qty

    return {
        "ticker": pos.ticker,
        "dte_remaining": dte_remaining,
        "raw_delta": raw_delta,
        "raw_gamma": raw_gamma,
        "raw_theta": raw_theta,
        "raw_vega": raw_vega,
        # Dollar exposures (× 100 contract multiplier)
        "delta_dollars": raw_delta * 100.0 * spot,        # $ exposure to spot
        "gamma_dollars": raw_gamma * 100.0,                # Δ change per $1 move
        "theta_dollars": raw_theta * 100.0,                # daily $ decay
        "vega_dollars": raw_vega * 100.0,                  # $ per 1pt IV change
    }


# ==================================================================
# Portfolio-level scenarios
# ==================================================================

def compute_scenario_pnl(
    positions: list[PortfolioPosition],
    spots_by_ticker: dict[str, float],
    sigmas_by_ticker: dict[str, float],
    spot_shock_pct: float = 0.0,
    iv_shock_pts: float = 0.0,
) -> float:
    """
    Re-price the entire portfolio under a spot/IV shock and return
    aggregate $ P&L change vs current value.

    spot_shock_pct = +0.05 means "spot up 5%"
    iv_shock_pts = +0.05 means "IV up 5 percentage points" (e.g. 25% → 30%)
    """
    pnl = 0.0
    for pos in positions:
        spot = spots_by_ticker.get(pos.ticker)
        sigma = sigmas_by_ticker.get(pos.ticker)
        if spot is None or sigma is None or sigma <= 0:
            continue

        shocked_spot = spot * (1.0 + spot_shock_pct)
        shocked_sigma = max(sigma + iv_shock_pts, 0.01)
        T = max(pos.dte_days, 0) / TRADING_DAYS_PER_YEAR

        # Sum the value change across legs
        for leg in pos.legs:
            opt_type = leg.get("opt_type", "call").lower()
            strike = float(leg.get("strike", spot))
            signed_qty = pos.signed_quantity(leg)

            # Current value (at current spot/sigma)
            current_val = _bsm_value(spot, strike, T, RISK_FREE_RATE, sigma, opt_type)
            # Shocked value
            shocked_val = _bsm_value(shocked_spot, strike, T, RISK_FREE_RATE, shocked_sigma, opt_type)

            pnl += (shocked_val - current_val) * signed_qty * 100.0
    return pnl


def _bsm_value(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    """BSM theoretical price (single option, per share)."""
    if T <= 0:
        if opt_type == "call":
            return max(S - K, 0.0)
        return max(K - S, 0.0)
    if sigma <= 0:
        return 0.0
    d1, d2 = _d1_d2(S, K, T, r, sigma)
    if opt_type == "call":
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


# ==================================================================
# High-level API: aggregate full portfolio with live data
# ==================================================================

async def aggregate_portfolio_greeks(
    positions: list[PortfolioPosition],
    fetcher: DataFetcher,
) -> dict:
    """
    Fetch live spot + HV for each unique ticker, compute per-position Greeks
    and portfolio totals + scenario shocks.
    """
    if not positions:
        return _empty_result()

    # Unique tickers — one fetch per ticker, even if multiple positions share it
    tickers = list({p.ticker for p in positions})

    spots: dict[str, float] = {}
    sigmas: dict[str, float] = {}
    fetch_errors: list[str] = []

    import asyncio
    spot_tasks = [fetcher.get_spot_price(t) for t in tickers]
    hv_tasks = [fetcher.get_historical_volatility(t) for t in tickers]
    spot_results = await asyncio.gather(*spot_tasks, return_exceptions=True)
    hv_results = await asyncio.gather(*hv_tasks, return_exceptions=True)

    for tk, sr, hr in zip(tickers, spot_results, hv_results):
        if isinstance(sr, Exception) or not sr:
            fetch_errors.append(f"{tk}: spot fetch failed")
            continue
        if isinstance(hr, Exception) or not hr:
            fetch_errors.append(f"{tk}: HV fetch failed")
            continue
        spot = sr.get("spot_price")
        # HV from data_fetcher returns percent; convert to decimal for BSM
        hv_30 = hr.get("hv_30")
        if spot is None or hv_30 is None:
            fetch_errors.append(f"{tk}: incomplete data")
            continue
        spots[tk] = float(spot)
        sigmas[tk] = float(hv_30) / 100.0

    # Per-position Greeks
    position_results: list[dict] = []
    total_delta_dollars = 0.0
    total_gamma_dollars = 0.0
    total_theta_dollars = 0.0
    total_vega_dollars = 0.0

    for pos in positions:
        spot = spots.get(pos.ticker)
        sigma = sigmas.get(pos.ticker)
        if spot is None or sigma is None:
            continue
        result = compute_position_greeks(pos, spot, sigma)
        position_results.append({
            **result,
            "spot_price": spot,
            "sigma_pct": round(sigma * 100, 2),
            "raw_delta": round(result["raw_delta"], 4),
            "raw_gamma": round(result["raw_gamma"], 4),
            "raw_theta": round(result["raw_theta"], 4),
            "raw_vega": round(result["raw_vega"], 4),
            "delta_dollars": round(result["delta_dollars"], 2),
            "gamma_dollars": round(result["gamma_dollars"], 2),
            "theta_dollars": round(result["theta_dollars"], 2),
            "vega_dollars": round(result["vega_dollars"], 2),
        })
        total_delta_dollars += result["delta_dollars"]
        total_gamma_dollars += result["gamma_dollars"]
        total_theta_dollars += result["theta_dollars"]
        total_vega_dollars += result["vega_dollars"]

    # Scenarios (full revaluation, not linearization — more accurate for OTM/long-dated)
    scenarios = {}
    for label, spot_pct, iv_pts in [
        ("spot_-5pct", -0.05, 0.0),
        ("spot_-2pct", -0.02, 0.0),
        ("spot_+2pct", +0.02, 0.0),
        ("spot_+5pct", +0.05, 0.0),
        ("iv_+5pts", 0.0, +0.05),
        ("iv_-5pts", 0.0, -0.05),
        ("crash", -0.10, +0.10),       # -10% spot, +10pts IV (VIX spike)
        ("rally", +0.05, -0.05),        # +5% spot, IV down
    ]:
        scenarios[label] = round(
            compute_scenario_pnl(positions, spots, sigmas, spot_pct, iv_pts),
            2,
        )

    return {
        "position_count": len(position_results),
        "ticker_count": len(spots),
        "totals": {
            "delta_dollars": round(total_delta_dollars, 2),
            "gamma_dollars": round(total_gamma_dollars, 2),
            "theta_dollars": round(total_theta_dollars, 2),
            "vega_dollars": round(total_vega_dollars, 2),
        },
        "positions": position_results,
        "scenarios": scenarios,
        "fetch_errors": fetch_errors,
        "assumptions": {
            "pricing_model": "Black-Scholes (theoretical)",
            "risk_free_rate": RISK_FREE_RATE,
            "sigma_source": "30-day historical volatility",
            "scenario_method": "full BSM revaluation under shock",
            "contract_multiplier": 100,
            "theta_units": "$ per calendar day",
            "vega_units": "$ per 1pt IV change",
        },
    }


def _empty_result() -> dict:
    return {
        "position_count": 0,
        "ticker_count": 0,
        "totals": {"delta_dollars": 0.0, "gamma_dollars": 0.0, "theta_dollars": 0.0, "vega_dollars": 0.0},
        "positions": [],
        "scenarios": {},
        "fetch_errors": [],
        "assumptions": {},
    }
