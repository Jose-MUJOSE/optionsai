"""Tests for backtest engine v2 — 4-leg templates, real-IV pricing, early exit."""
import math

import numpy as np
import pandas as pd
import pytest

from backend.services.backtest_engine import (
    SUPPORTED_STRATEGIES,
    StrategyLeg,
    build_legs,
    run_backtest,
)


def _make_series(n_flat: int = 50, n_trend: int = 30, drift: float = 0.01):
    """Deterministic series: small oscillation, then a steady trend."""
    increments = [0.005 * math.sin(i * 1.3) for i in range(n_flat)]
    increments += [drift] * n_trend
    log_prices = np.cumsum(increments)
    closes = pd.Series(100.0 * np.exp(log_prices))
    dates = [f"2025-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}" for i in range(len(closes))]
    return closes, dates


# ------------------------------------------------------------------
# 4-leg built-in templates
# ------------------------------------------------------------------

class TestFourLegTemplates:
    def test_supported_set_contains_new_templates(self):
        for s in ("iron_condor", "iron_butterfly", "call_butterfly",
                  "put_butterfly", "short_straddle", "long_strangle"):
            assert s in SUPPORTED_STRATEGIES

    def test_iron_condor_legs(self):
        legs = build_legs("iron_condor", spot=100.0, width_pct=5.0)
        assert len(legs) == 4
        # sell put 95 / buy put 90 / sell call 105 / buy call 110
        by_key = {(l.action, l.opt_type): l.strike for l in legs}
        assert by_key[("sell", "put")] == 95
        assert by_key[("buy", "put")] == 90
        assert by_key[("sell", "call")] == 105
        assert by_key[("buy", "call")] == 110

    def test_iron_butterfly_legs(self):
        legs = build_legs("iron_butterfly", spot=100.0, width_pct=5.0)
        assert len(legs) == 4
        sells = [l for l in legs if l.action == "sell"]
        buys = [l for l in legs if l.action == "buy"]
        assert {l.strike for l in sells} == {100}        # short ATM straddle
        assert {l.strike for l in buys} == {95, 105}     # protective wings

    def test_call_butterfly_middle_quantity_2(self):
        legs = build_legs("call_butterfly", spot=100.0, width_pct=5.0)
        assert len(legs) == 3
        middle = [l for l in legs if l.action == "sell"][0]
        assert middle.quantity == 2 and middle.strike == 100

    def test_iron_condor_backtest_runs_credit(self):
        closes, dates = _make_series(drift=0.0)
        result = run_backtest("TEST", "iron_condor", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=20)
        assert result.initial_price_per_share < 0       # net credit
        assert len(result.legs) == 4
        # Defined-risk: loss can never exceed wing width minus credit
        width = 5.0
        credit = -result.initial_price_per_share
        assert result.min_pnl_per_contract >= -(width - credit) * 100 - 1.0

    def test_butterfly_backtest_runs(self):
        closes, dates = _make_series(drift=0.0)
        result = run_backtest("TEST", "call_butterfly", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=20)
        assert result.strategy_type == "call_butterfly"
        assert len(result.bars) > 0


# ------------------------------------------------------------------
# Real-IV pricing with HV fallback
# ------------------------------------------------------------------

class TestRealIvPricing:
    def test_iv_snapshot_used_when_available(self):
        closes, dates = _make_series()
        iv_map = {d: 40.0 for d in dates}               # 40% IV on every date
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=10,
                              iv_by_date=iv_map)
        assert all(b["sigma_source"] == "iv_snapshot" for b in result.bars)
        assert all(abs(b["sigma"] - 0.40) < 1e-9 for b in result.bars)
        assert "all bars" in result.assumptions["sigma_source"]

    def test_partial_iv_coverage_mixed_sources(self):
        closes, dates = _make_series()
        # IV recorded only for the first 5 bars of the hold window
        iv_map = {dates[50 + i]: 35.0 for i in range(5)}
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=10,
                              iv_by_date=iv_map)
        sources = [b["sigma_source"] for b in result.bars]
        assert sources[:5] == ["iv_snapshot"] * 5
        assert all(s == "hv30" for s in sources[5:])
        assert "5/11" in result.assumptions["sigma_source"]

    def test_no_iv_falls_back_to_hv(self):
        closes, dates = _make_series()
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=10)
        assert all(b["sigma_source"] == "hv30" for b in result.bars)
        assert "realized volatility" in result.assumptions["sigma_source"]

    def test_higher_iv_means_higher_premium(self):
        closes, dates = _make_series()
        low = run_backtest("TEST", "long_call", closes, dates,
                           entry_date=dates[50], dte_days=30, hold_days=5,
                           iv_by_date={d: 20.0 for d in dates})
        high = run_backtest("TEST", "long_call", closes, dates,
                            entry_date=dates[50], dte_days=30, hold_days=5,
                            iv_by_date={d: 60.0 for d in dates})
        assert high.initial_price_per_share > low.initial_price_per_share

    def test_zero_or_negative_iv_ignored(self):
        closes, dates = _make_series()
        iv_map = {d: 0.0 for d in dates}                 # invalid values
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=5,
                              iv_by_date=iv_map)
        assert all(b["sigma_source"] == "hv30" for b in result.bars)


# ------------------------------------------------------------------
# Early exit: take-profit / stop-loss
# ------------------------------------------------------------------

class TestEarlyExit:
    def test_take_profit_triggers_on_uptrend_call(self):
        closes, dates = _make_series(drift=0.02)         # strong rally
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=30,
                              take_profit_pct=50.0)
        assert result.exit_reason == "take_profit"
        assert result.final_pnl_pct >= 50.0
        assert len(result.bars) < 31                     # exited early

    def test_stop_loss_triggers_on_uptrend_put(self):
        closes, dates = _make_series(drift=0.02)
        result = run_backtest("TEST", "long_put", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=30,
                              stop_loss_pct=50.0)
        assert result.exit_reason == "stop_loss"
        assert result.final_pnl_pct <= -50.0

    def test_no_rules_holds_to_end(self):
        closes, dates = _make_series(drift=0.02)
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=25)
        assert result.exit_reason == "hold_end"
        assert len(result.bars) == 26

    def test_entry_bar_never_triggers_exit(self):
        # Even with a 0% threshold the entry bar (pnl=0) must not exit.
        closes, dates = _make_series(drift=0.0)
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=10,
                              take_profit_pct=0.0)
        assert len(result.bars) >= 2

    def test_rules_recorded_in_assumptions(self):
        closes, dates = _make_series()
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=5,
                              take_profit_pct=50, stop_loss_pct=30)
        rules = result.assumptions["early_exit_rules"]
        assert rules == {"take_profit_pct": 50, "stop_loss_pct": 30}

    def test_exit_date_matches_last_bar(self):
        closes, dates = _make_series(drift=0.02)
        result = run_backtest("TEST", "long_call", closes, dates,
                              entry_date=dates[50], dte_days=30, hold_days=30,
                              take_profit_pct=30.0)
        assert result.exit_date == result.bars[-1]["date"]
        assert result.exit_spot == result.bars[-1]["spot"]


# ------------------------------------------------------------------
# iv_snapshot_store.get_iv_by_date
# ------------------------------------------------------------------

class TestIvByDateStore:
    def test_roundtrip(self, tmp_path, monkeypatch):
        from backend.services import iv_snapshot_store as store

        monkeypatch.setattr(store, "_DB_PATH", tmp_path / "iv.db")
        store.record_snapshot("AAPL", iv_atm=32.5, hv_30=28.0)
        result = store.get_iv_by_date("AAPL")
        assert len(result) == 1
        (snap_date, iv), = result.items()
        assert iv == 32.5
        assert len(snap_date) == 10                      # ISO YYYY-MM-DD

    def test_empty_for_unknown_ticker(self, tmp_path, monkeypatch):
        from backend.services import iv_snapshot_store as store

        monkeypatch.setattr(store, "_DB_PATH", tmp_path / "iv.db")
        assert store.get_iv_by_date("ZZZZ") == {}
