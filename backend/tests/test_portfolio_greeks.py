"""Tests for backend.services.portfolio_greeks — BSM Greeks + scenario shocks.

Reference values (textbook): S=100, K=100, T=1y, r=5%, sigma=20%
  call delta 0.6368, gamma 0.018762, vega(per 1pt) 0.3752, theta -6.414/yr
"""
import math

import pytest

from backend.services.portfolio_greeks import (
    PortfolioPosition,
    _bsm_value,
    bsm_greeks,
    compute_position_greeks,
    compute_scenario_pnl,
)


class TestBsmGreeks:
    def test_textbook_call_delta(self):
        g = bsm_greeks(100, 100, 1.0, 0.05, 0.20, "call")
        assert g["delta"] == pytest.approx(0.6368, abs=1e-3)

    def test_textbook_gamma(self):
        g = bsm_greeks(100, 100, 1.0, 0.05, 0.20, "call")
        assert g["gamma"] == pytest.approx(0.018762, abs=1e-4)

    def test_textbook_vega_per_point(self):
        g = bsm_greeks(100, 100, 1.0, 0.05, 0.20, "call")
        assert g["vega"] == pytest.approx(0.3752, abs=1e-3)

    def test_textbook_theta_per_day(self):
        g = bsm_greeks(100, 100, 1.0, 0.05, 0.20, "call")
        assert g["theta"] == pytest.approx(-6.414 / 365.0, abs=1e-3)

    def test_put_call_delta_parity(self):
        # delta_call - delta_put = 1 (no dividends)
        for S, K, T, sigma in [(100, 100, 1.0, 0.2), (80, 100, 0.3, 0.4), (120, 100, 0.1, 0.25)]:
            c = bsm_greeks(S, K, T, 0.045, sigma, "call")["delta"]
            p = bsm_greeks(S, K, T, 0.045, sigma, "put")["delta"]
            assert c - p == pytest.approx(1.0, abs=1e-9)

    def test_gamma_vega_same_for_call_and_put(self):
        c = bsm_greeks(95, 100, 0.5, 0.045, 0.3, "call")
        p = bsm_greeks(95, 100, 0.5, 0.045, 0.3, "put")
        assert c["gamma"] == pytest.approx(p["gamma"], abs=1e-12)
        assert c["vega"] == pytest.approx(p["vega"], abs=1e-12)

    def test_expiry_degenerate_greeks(self):
        itm_call = bsm_greeks(110, 100, 0.0, 0.045, 0.2, "call")
        assert itm_call == {"delta": 1.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
        itm_put = bsm_greeks(90, 100, 0.0, 0.045, 0.2, "put")
        assert itm_put["delta"] == -1.0

    def test_delta_bounds(self):
        for K in (50, 80, 100, 120, 200):
            g = bsm_greeks(100, K, 0.5, 0.045, 0.3, "call")
            assert 0.0 <= g["delta"] <= 1.0
            g = bsm_greeks(100, K, 0.5, 0.045, 0.3, "put")
            assert -1.0 <= g["delta"] <= 0.0

    def test_delta_matches_finite_difference(self):
        # Analytic delta should agree with numerical dV/dS.
        S, K, T, r, sigma = 105, 100, 0.4, 0.045, 0.3
        h = 0.01
        numeric = (_bsm_value(S + h, K, T, r, sigma, "call")
                   - _bsm_value(S - h, K, T, r, sigma, "call")) / (2 * h)
        analytic = bsm_greeks(S, K, T, r, sigma, "call")["delta"]
        assert analytic == pytest.approx(numeric, abs=1e-4)


class TestPositionAggregation:
    def test_buy_and_sell_same_leg_cancels(self):
        pos = PortfolioPosition(
            ticker="TEST",
            legs=[
                {"action": "buy", "opt_type": "call", "strike": 100, "quantity": 1},
                {"action": "sell", "opt_type": "call", "strike": 100, "quantity": 1},
            ],
            dte_days=30,
        )
        r = compute_position_greeks(pos, spot=100.0, sigma=0.25)
        assert r["raw_delta"] == pytest.approx(0.0, abs=1e-12)
        assert r["raw_gamma"] == pytest.approx(0.0, abs=1e-12)
        assert r["delta_dollars"] == pytest.approx(0.0, abs=1e-9)

    def test_quantity_scales_linearly(self):
        leg1 = {"action": "buy", "opt_type": "call", "strike": 100, "quantity": 1}
        leg3 = {"action": "buy", "opt_type": "call", "strike": 100, "quantity": 3}
        r1 = compute_position_greeks(
            PortfolioPosition("T", [leg1], 30), spot=100.0, sigma=0.25)
        r3 = compute_position_greeks(
            PortfolioPosition("T", [leg3], 30), spot=100.0, sigma=0.25)
        assert r3["raw_delta"] == pytest.approx(3 * r1["raw_delta"], rel=1e-9)
        assert r3["vega_dollars"] == pytest.approx(3 * r1["vega_dollars"], rel=1e-9)

    def test_short_position_negative_greeks(self):
        pos = PortfolioPosition(
            "T", [{"action": "sell", "opt_type": "call", "strike": 100, "quantity": 1}], 30)
        r = compute_position_greeks(pos, spot=100.0, sigma=0.25)
        assert r["raw_delta"] < 0
        assert r["raw_vega"] < 0
        assert r["raw_theta"] > 0      # short options collect decay

    def test_days_elapsed_reduces_dte(self):
        pos = PortfolioPosition(
            "T", [{"action": "buy", "opt_type": "call", "strike": 100, "quantity": 1}], 30)
        r = compute_position_greeks(pos, spot=100.0, sigma=0.25, days_elapsed=10)
        assert r["dte_remaining"] == 20


class TestScenarioPnl:
    def _long_call_portfolio(self):
        return [PortfolioPosition(
            "T", [{"action": "buy", "opt_type": "call", "strike": 100, "quantity": 1}], 30)]

    def test_long_call_gains_on_rally(self):
        pnl = compute_scenario_pnl(
            self._long_call_portfolio(), {"T": 100.0}, {"T": 0.25}, spot_shock_pct=0.05)
        assert pnl > 0

    def test_long_call_loses_on_selloff(self):
        pnl = compute_scenario_pnl(
            self._long_call_portfolio(), {"T": 100.0}, {"T": 0.25}, spot_shock_pct=-0.05)
        assert pnl < 0

    def test_long_call_gains_on_iv_spike(self):
        pnl = compute_scenario_pnl(
            self._long_call_portfolio(), {"T": 100.0}, {"T": 0.25}, iv_shock_pts=0.05)
        assert pnl > 0

    def test_zero_shock_zero_pnl(self):
        pnl = compute_scenario_pnl(
            self._long_call_portfolio(), {"T": 100.0}, {"T": 0.25})
        assert pnl == pytest.approx(0.0, abs=1e-9)

    def test_missing_market_data_skipped(self):
        pnl = compute_scenario_pnl(
            self._long_call_portfolio(), {}, {}, spot_shock_pct=0.10)
        assert pnl == 0.0

    def test_scenario_consistent_with_delta_for_small_move(self):
        # For a tiny shock, full revaluation ≈ delta-dollar linearization.
        positions = self._long_call_portfolio()
        spot, sigma = 100.0, 0.25
        greeks = compute_position_greeks(positions[0], spot, sigma)
        shock = 0.001  # 0.1%
        pnl = compute_scenario_pnl(positions, {"T": spot}, {"T": sigma}, spot_shock_pct=shock)
        linear = greeks["raw_delta"] * 100.0 * spot * shock
        assert pnl == pytest.approx(linear, rel=0.05)
