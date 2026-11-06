"""Tests for backend.services.strategy_engine — payoff math for multi-leg strategies.

Complements the original test_engine.py with credit strategies, iron condor,
win-probability sanity bounds and capital requirements.
"""
import pytest

from backend.services.strategy_engine import Leg, PayoffEngine


def _iron_condor():
    """SELL PUT 95@2 / BUY PUT 90@1 / SELL CALL 105@2 / BUY CALL 110@1.

    Net credit 2.00/share -> max profit $200, max loss $300,
    breakevens at 93 and 107.
    """
    return [
        Leg("SELL", "PUT", strike=95, premium=2.0, quantity=1),
        Leg("BUY", "PUT", strike=90, premium=1.0, quantity=1),
        Leg("SELL", "CALL", strike=105, premium=2.0, quantity=1),
        Leg("BUY", "CALL", strike=110, premium=1.0, quantity=1),
    ]


class TestPayoffMath:
    def test_long_call_itm_payoff(self):
        legs = [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1)]
        df = PayoffEngine.calc_strategy_payoff(spot=100, legs=legs,
                                               price_range=(50, 150), steps=201)
        at_120 = df.loc[df["price"] == 120.0, "pnl"].iloc[0]
        assert at_120 == pytest.approx((20 - 5) * 100)
        at_100 = df.loc[df["price"] == 100.0, "pnl"].iloc[0]
        assert at_100 == pytest.approx(-500)

    def test_short_put_payoff(self):
        legs = [Leg("SELL", "PUT", strike=100, premium=4.0, quantity=1)]
        df = PayoffEngine.calc_strategy_payoff(spot=100, legs=legs,
                                               price_range=(50, 150), steps=201)
        at_120 = df.loc[df["price"] == 120.0, "pnl"].iloc[0]
        assert at_120 == pytest.approx(400)            # keeps full premium
        at_80 = df.loc[df["price"] == 80.0, "pnl"].iloc[0]
        assert at_80 == pytest.approx((4 - 20) * 100)  # -1600

    def test_long_call_breakeven(self):
        legs = [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1)]
        bes = PayoffEngine.calc_breakevens(legs, spot=100)
        assert len(bes) == 1
        assert bes[0] == pytest.approx(105, abs=0.5)

    def test_straddle_two_breakevens(self):
        legs = [
            Leg("BUY", "CALL", strike=100, premium=4.0, quantity=1),
            Leg("BUY", "PUT", strike=100, premium=3.0, quantity=1),
        ]
        bes = sorted(PayoffEngine.calc_breakevens(legs, spot=100))
        assert len(bes) == 2
        assert bes[0] == pytest.approx(93, abs=0.5)     # 100 - 7
        assert bes[1] == pytest.approx(107, abs=0.5)    # 100 + 7


class TestIronCondor:
    def test_max_profit_equals_net_credit(self):
        assert PayoffEngine.calc_max_profit(_iron_condor(), spot=100) == pytest.approx(200, abs=5)

    def test_max_loss(self):
        # Wing width 5 - credit 2 = 3/share -> -$300
        assert PayoffEngine.calc_max_loss(_iron_condor(), spot=100) == pytest.approx(-300, abs=5)

    def test_two_breakevens(self):
        bes = sorted(PayoffEngine.calc_breakevens(_iron_condor(), spot=100))
        assert len(bes) == 2
        assert bes[0] == pytest.approx(93, abs=0.5)
        assert bes[1] == pytest.approx(107, abs=0.5)

    def test_net_credit_sign(self):
        assert PayoffEngine.calc_net_debit_credit(_iron_condor()) == pytest.approx(-200)

    def test_required_capital_is_max_loss_for_credit(self):
        cap = PayoffEngine.calc_required_capital(_iron_condor(), spot=100)
        assert cap == pytest.approx(300, abs=5)


class TestCapitalAndQuantity:
    def test_debit_capital_is_net_debit(self):
        legs = [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1)]
        assert PayoffEngine.calc_required_capital(legs, spot=100) == pytest.approx(500)

    def test_quantity_scales_payoff(self):
        one = [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1)]
        two = [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=2)]
        p1 = PayoffEngine.calc_max_loss(one, spot=100)
        p2 = PayoffEngine.calc_max_loss(two, spot=100)
        assert p2 == pytest.approx(2 * p1)

    def test_ratio_spread_net(self):
        # BUY 1 @5, SELL 2 @2 -> net debit 1/share = $100
        legs = [
            Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1),
            Leg("SELL", "CALL", strike=110, premium=2.0, quantity=2),
        ]
        assert PayoffEngine.calc_net_debit_credit(legs) == pytest.approx(100)


class TestWinProbability:
    def test_bounds(self):
        cases = [
            [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1)],
            [Leg("SELL", "PUT", strike=95, premium=2.0, quantity=1)],
            _iron_condor(),
        ]
        for legs in cases:
            p = PayoffEngine.estimate_win_probability(legs, spot=100, iv=30, dte=30)
            assert 0.0 <= p <= 100.0

    def test_zero_dte_returns_neutral(self):
        legs = [Leg("BUY", "CALL", strike=100, premium=5.0, quantity=1)]
        assert PayoffEngine.estimate_win_probability(legs, spot=100, iv=30, dte=0) == 50.0

    def test_credit_strategy_higher_pop_than_long_otm(self):
        # Selling a far-OTM put should win more often than buying a far-OTM call.
        short_put = [Leg("SELL", "PUT", strike=85, premium=1.0, quantity=1)]
        long_otm_call = [Leg("BUY", "CALL", strike=115, premium=1.0, quantity=1)]
        p_short = PayoffEngine.estimate_win_probability(short_put, spot=100, iv=25, dte=30)
        p_long = PayoffEngine.estimate_win_probability(long_otm_call, spot=100, iv=25, dte=30)
        assert p_short > p_long
