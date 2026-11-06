"""Tests for backend.services.backtest_engine — BSM pricing + walk-forward P&L.

All tests are offline and deterministic (synthetic price series).
Reference BSM values are standard textbook numbers:
  S=100, K=100, T=1y, r=5%, sigma=20%  ->  call 10.4506, put 5.5735
"""
import math

import numpy as np
import pandas as pd
import pytest

from backend.services.backtest_engine import (
    BacktestBar,
    StrategyLeg,
    _bsm_price,
    _compute_metrics,
    _portfolio_price,
    _rolling_hv,
    build_legs,
    run_backtest,
)


# ------------------------------------------------------------------
# BSM pricing
# ------------------------------------------------------------------

class TestBsmPrice:
    def test_textbook_call(self):
        assert _bsm_price(100, 100, 1.0, 0.05, 0.20, "call") == pytest.approx(10.4506, abs=1e-3)

    def test_textbook_put(self):
        assert _bsm_price(100, 100, 1.0, 0.05, 0.20, "put") == pytest.approx(5.5735, abs=1e-3)

    def test_put_call_parity(self):
        # C - P = S - K * e^(-rT) must hold for any params.
        for S, K, T, r, sigma in [
            (100, 100, 1.0, 0.05, 0.2),
            (50, 55, 0.5, 0.045, 0.35),
            (250, 200, 0.1, 0.045, 0.6),
        ]:
            c = _bsm_price(S, K, T, r, sigma, "call")
            p = _bsm_price(S, K, T, r, sigma, "put")
            assert c - p == pytest.approx(S - K * math.exp(-r * T), abs=1e-9)

    def test_expiry_returns_intrinsic(self):
        assert _bsm_price(110, 100, 0.0, 0.05, 0.2, "call") == 110 - 100
        assert _bsm_price(90, 100, 0.0, 0.05, 0.2, "call") == 0.0
        assert _bsm_price(90, 100, 0.0, 0.05, 0.2, "put") == 100 - 90

    def test_deep_itm_call_approaches_forward_intrinsic(self):
        # Deep ITM call ≈ S - K*e^(-rT)
        c = _bsm_price(200, 100, 0.25, 0.045, 0.2, "call")
        assert c == pytest.approx(200 - 100 * math.exp(-0.045 * 0.25), abs=0.01)

    def test_price_never_negative(self):
        assert _bsm_price(50, 100, 0.01, 0.045, 0.1, "call") >= 0.0


# ------------------------------------------------------------------
# Rolling HV
# ------------------------------------------------------------------

class TestRollingHv:
    def test_alternating_series(self):
        closes = pd.Series([100.0, 101.0] * 40)
        hv = _rolling_hv(closes, window=30)
        # First `window` values are NaN.
        assert hv.iloc[:30].isna().all()
        # Alternating ±1% returns -> annualized HV ~ 0.00995 * sqrt(252) ~ 0.158
        assert hv.iloc[-1] == pytest.approx(0.00995 * math.sqrt(252), rel=0.1)

    def test_constant_series_zero_vol(self):
        closes = pd.Series([100.0] * 50)
        hv = _rolling_hv(closes, window=30)
        assert hv.iloc[-1] == pytest.approx(0.0, abs=1e-12)


# ------------------------------------------------------------------
# build_legs / portfolio pricing
# ------------------------------------------------------------------

class TestBuildLegs:
    def test_single_leg_atm(self):
        legs = build_legs("long_call", spot=100.4)
        assert len(legs) == 1
        assert legs[0].strike == 100
        assert legs[0].action == "buy"

    def test_bull_call_spread_strikes(self):
        legs = build_legs("bull_call_spread", spot=100.0, width_pct=5.0)
        assert [l.strike for l in legs] == [100, 105]
        assert [l.action for l in legs] == ["buy", "sell"]

    def test_unsupported_raises(self):
        # iron_condor became a built-in template in v2; use a real unknown.
        with pytest.raises(ValueError):
            build_legs("jade_lizard", spot=100.0)

    def test_portfolio_price_spread_cheaper_than_naked(self):
        spread = build_legs("bull_call_spread", spot=100.0)
        naked = build_legs("long_call", spot=100.0)
        p_spread = _portfolio_price(spread, 100.0, 0.1, 0.045, 0.3)
        p_naked = _portfolio_price(naked, 100.0, 0.1, 0.045, 0.3)
        assert 0 < p_spread < p_naked


# ------------------------------------------------------------------
# Metrics
# ------------------------------------------------------------------

def _bar(date: str, pnl: float) -> BacktestBar:
    return BacktestBar(
        date=date, spot=100.0, theoretical_price=1.0,
        pnl_per_contract=pnl, pnl_pct=0.0, days_to_expiry=10, sigma=0.2,
    )


class TestComputeMetrics:
    def test_crafted_series(self):
        # P&L path 0 -> 10 -> 5 -> 20: returns [+10, -5, +15]
        bars = [_bar("d0", 0), _bar("d1", 10), _bar("d2", 5), _bar("d3", 20)]
        m = _compute_metrics(bars, initial_price=1.0)
        assert m.win_rate_pct == pytest.approx(66.67, abs=0.01)
        assert m.max_drawdown_dollars == pytest.approx(5.0)
        assert m.profit_factor == pytest.approx(5.0)       # 25 / 5
        assert m.avg_win == pytest.approx(12.5)
        assert m.avg_loss == pytest.approx(-5.0)
        # Cost = 0.005 * |1.0| * 100 + 1.30 = 1.80
        assert m.transaction_cost_total == pytest.approx(1.80)
        assert m.final_pnl_after_costs == pytest.approx(20 - 1.80)

    def test_all_winning_days_no_profit_factor(self):
        bars = [_bar("d0", 0), _bar("d1", 5), _bar("d2", 12)]
        m = _compute_metrics(bars, initial_price=1.0)
        assert m.profit_factor is None       # no losing days
        assert m.win_rate_pct == 100.0
        assert m.max_drawdown_dollars == 0.0

    def test_too_few_bars_degrades_gracefully(self):
        m = _compute_metrics([_bar("d0", 3.0)], initial_price=1.0)
        assert m.sharpe_ratio is None
        assert m.final_pnl_after_costs == 3.0


# ------------------------------------------------------------------
# run_backtest end-to-end (synthetic data)
# ------------------------------------------------------------------

def _make_series(n_flat: int = 50, n_trend: int = 30, drift: float = 0.01):
    """Deterministic series: small oscillation, then a steady trend."""
    increments = [0.005 * math.sin(i * 1.3) for i in range(n_flat)]
    increments += [drift] * n_trend
    log_prices = np.cumsum(increments)
    closes = pd.Series(100.0 * np.exp(log_prices))
    dates = [f"2025-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(len(closes))]
    return closes, dates


class TestRunBacktest:
    def test_long_call_uptrend_profits(self):
        closes, dates = _make_series(drift=0.01)   # +30% during hold window
        result = run_backtest("TEST", "long_call", closes, dates, entry_date=dates[50],
                              dte_days=30, hold_days=25)
        assert result.final_pnl_per_contract > 0
        assert result.bars[0]["pnl_per_contract"] == pytest.approx(0.0, abs=1e-6)
        assert result.initial_price_per_share > 0          # debit strategy
        assert len(result.bars) == 26                       # entry day + 25

    def test_long_put_uptrend_loses(self):
        closes, dates = _make_series(drift=0.01)
        result = run_backtest("TEST", "long_put", closes, dates, entry_date=dates[50],
                              dte_days=30, hold_days=25)
        assert result.final_pnl_per_contract < 0

    def test_short_strangle_is_credit(self):
        closes, dates = _make_series(drift=0.0)
        result = run_backtest("TEST", "short_strangle", closes, dates, entry_date=dates[50],
                              dte_days=30, hold_days=20)
        assert result.initial_price_per_share < 0          # net credit

    def test_bull_call_spread_pnl_bounded(self):
        closes, dates = _make_series(drift=0.01)
        result = run_backtest("TEST", "bull_call_spread", closes, dates, entry_date=dates[50],
                              dte_days=30, hold_days=30)
        width = abs(result.legs[1]["strike"] - result.legs[0]["strike"])
        debit = result.initial_price_per_share
        assert result.max_pnl_per_contract <= (width - debit) * 100 + 1.0
        assert result.min_pnl_per_contract >= -debit * 100 - 1.0

    def test_custom_legs_iron_condor(self):
        closes, dates = _make_series(drift=0.0)
        spot = float(closes.iloc[50])
        legs = [
            StrategyLeg("sell", "put", round(spot * 0.95)),
            StrategyLeg("buy", "put", round(spot * 0.90)),
            StrategyLeg("sell", "call", round(spot * 1.05)),
            StrategyLeg("buy", "call", round(spot * 1.10)),
        ]
        result = run_backtest("TEST", "iron_condor", closes, dates, entry_date=dates[50],
                              dte_days=30, hold_days=20, custom_legs=legs)
        assert len(result.legs) == 4
        assert result.strategy_type == "iron_condor"
        assert result.initial_price_per_share < 0          # net credit

    def test_insufficient_history_raises(self):
        closes, dates = _make_series()
        with pytest.raises(ValueError, match="30 days"):
            run_backtest("TEST", "long_call", closes, dates, entry_date=dates[10])

    def test_mismatched_lengths_raise(self):
        closes, dates = _make_series()
        with pytest.raises(ValueError, match="same length"):
            run_backtest("TEST", "long_call", closes, dates[:-5], entry_date=dates[50])

    def test_assumptions_disclose_model(self):
        closes, dates = _make_series()
        result = run_backtest("TEST", "long_call", closes, dates, entry_date=dates[50])
        assert "Black-Scholes" in result.assumptions["pricing_model"]
        assert "theoretical" in result.data_sources["option_prices"]
