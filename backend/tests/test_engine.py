"""
快速测试：策略引擎的盈亏计算是否正确
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.strategy_engine import PayoffEngine, Leg


def test_long_call():
    """测试买入 Call 的盈亏计算"""
    leg = Leg("BUY", "CALL", strike=150, premium=5.0, quantity=1)
    df = PayoffEngine.calc_strategy_payoff(spot=150, legs=[leg], steps=100)

    # 在 strike=150 处，P&L = max(150-150,0) - 5 = -5，乘以100 = -500
    at_strike = df.iloc[(df["price"] - 150).abs().argsort().iloc[0]]
    assert abs(at_strike["pnl"] - (-500)) < 50, f"At strike: expected ~-500, got {at_strike['pnl']}"

    # 在 price=160 处，P&L = max(160-150,0) - 5 = 5，乘以100 = 500
    at_160 = df.iloc[(df["price"] - 160).abs().argsort().iloc[0]]
    assert at_160["pnl"] > 0, f"At 160: expected positive, got {at_160['pnl']}"

    print("[PASS] Long Call P&L correct")


def test_bull_call_spread():
    """测试牛市看涨价差"""
    legs = [
        Leg("BUY", "CALL", strike=150, premium=5.0, quantity=1),
        Leg("SELL", "CALL", strike=160, premium=2.0, quantity=1),
    ]
    df = PayoffEngine.calc_strategy_payoff(spot=155, legs=legs, steps=200)

    # 最大亏损 = 净支出 = (5-2) × 100 = 300
    max_loss = PayoffEngine.calc_max_loss(legs, 155)
    assert abs(max_loss - (-300)) < 50, f"Max loss: expected ~-300, got {max_loss}"

    # 最大收益 = (160-150-3) × 100 = 700
    max_profit = PayoffEngine.calc_max_profit(legs, 155)
    assert abs(max_profit - 700) < 50, f"Max profit: expected ~700, got {max_profit}"

    # 盈亏平衡点 = 150 + 3 = 153
    breakevens = PayoffEngine.calc_breakevens(legs, 155)
    assert len(breakevens) == 1, f"Expected 1 breakeven, got {len(breakevens)}"
    assert abs(breakevens[0] - 153) < 1, f"Breakeven: expected ~153, got {breakevens[0]}"

    print("[PASS] Bull Call Spread P&L correct")


def test_iron_condor():
    """测试铁鹰策略"""
    legs = [
        Leg("SELL", "PUT", strike=145, premium=2.0, quantity=1),
        Leg("BUY", "PUT", strike=140, premium=0.8, quantity=1),
        Leg("SELL", "CALL", strike=155, premium=2.0, quantity=1),
        Leg("BUY", "CALL", strike=160, premium=0.8, quantity=1),
    ]
    df = PayoffEngine.calc_strategy_payoff(spot=150, legs=legs, steps=200)

    # 净收入 = (2+2-0.8-0.8) × 100 = 240
    net = PayoffEngine.calc_net_debit_credit(legs)
    assert abs(net - (-240)) < 10, f"Net credit: expected ~-240, got {net}"

    # 最大收益 = 净收入 = 240
    max_profit = PayoffEngine.calc_max_profit(legs, 150)
    assert abs(max_profit - 240) < 50, f"Max profit: expected ~240, got {max_profit}"

    # 应该有 2 个盈亏平衡点
    breakevens = PayoffEngine.calc_breakevens(legs, 150)
    assert len(breakevens) == 2, f"Expected 2 breakevens, got {len(breakevens)}: {breakevens}"

    print("[PASS] Iron Condor P&L correct")


def test_net_debit_credit():
    """测试净支出/收入计算"""
    # Debit Spread
    legs = [
        Leg("BUY", "CALL", strike=150, premium=5.0),
        Leg("SELL", "CALL", strike=160, premium=2.0),
    ]
    net = PayoffEngine.calc_net_debit_credit(legs)
    assert net == 300, f"Expected 300 (debit), got {net}"

    # Credit Spread
    legs = [
        Leg("SELL", "PUT", strike=150, premium=4.0),
        Leg("BUY", "PUT", strike=140, premium=1.5),
    ]
    net = PayoffEngine.calc_net_debit_credit(legs)
    assert net == -250, f"Expected -250 (credit), got {net}"

    print("[PASS] Net Debit/Credit correct")


if __name__ == "__main__":
    test_long_call()
    test_bull_call_spread()
    test_iron_condor()
    test_net_debit_credit()
    print("\nAll tests passed! Strategy engine core calculations are correct.")
