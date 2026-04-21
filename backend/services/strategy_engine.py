"""
OptionsAI - 策略引擎
20 种期权策略的盈亏计算、最大盈亏、盈亏平衡点
全部使用 Pandas/NumPy 向量化计算，不用 for 循环
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd


# ============================================================
# 数据类：描述一条期权腿
# ============================================================

@dataclass
class Leg:
    """策略中的一条腿"""
    action: str       # "BUY" / "SELL"
    option_type: str  # "CALL" / "PUT"
    strike: float
    premium: float    # 每股权利金 (mid_price)
    quantity: int = 1
    expiration: str = ""

    @property
    def sign(self) -> int:
        """买入为 +1，卖出为 -1"""
        return 1 if self.action == "BUY" else -1


# ============================================================
# 核心：盈亏计算引擎
# ============================================================

class PayoffEngine:
    """
    期权到期盈亏计算引擎
    所有计算基于到期日价格 (S_T)，使用 NumPy 向量化
    """

    CONTRACT_MULTIPLIER = 100  # 每手 100 股

    @staticmethod
    def calc_leg_payoff(s_t: np.ndarray, leg: Leg) -> np.ndarray:
        """
        计算单条腿的到期 P&L (每股)

        买入 Call: P&L = max(S_T - K, 0) - Premium
        卖出 Call: P&L = Premium - max(S_T - K, 0)
        买入 Put:  P&L = max(K - S_T, 0) - Premium
        卖出 Put:  P&L = Premium - max(K - S_T, 0)
        """
        if leg.option_type == "CALL":
            intrinsic = np.maximum(s_t - leg.strike, 0)
        else:  # PUT
            intrinsic = np.maximum(leg.strike - s_t, 0)

        if leg.action == "BUY":
            pnl = intrinsic - leg.premium
        else:  # SELL
            pnl = leg.premium - intrinsic

        return pnl * leg.quantity

    @classmethod
    def calc_strategy_payoff(
        cls,
        spot: float,
        legs: list[Leg],
        price_range: tuple[float, float] = None,
        steps: int = 200,
    ) -> pd.DataFrame:
        """
        计算组合策略的到期 P&L 曲线

        参数:
            spot: 当前股价
            legs: 策略的所有腿
            price_range: (最低价, 最高价)，默认 0.5×spot ~ 1.5×spot
            steps: 价格点数量

        返回: DataFrame with columns ["price", "pnl"]
              pnl 为每组合约的实际美元盈亏 (×100 乘数)
        """
        if price_range is None:
            low = max(0.01, spot * 0.5)
            high = spot * 1.5
        else:
            low, high = price_range

        s_t = np.linspace(low, high, steps)

        # 向量化：计算每条腿的 P&L，然后求和
        total_pnl = np.zeros_like(s_t)
        for leg in legs:
            total_pnl += cls.calc_leg_payoff(s_t, leg)

        # 乘以合约乘数 (100股/手)
        total_pnl_dollar = total_pnl * cls.CONTRACT_MULTIPLIER

        return pd.DataFrame({
            "price": np.round(s_t, 2),
            "pnl": np.round(total_pnl_dollar, 2),
        })

    @classmethod
    def calc_max_profit(cls, legs: list[Leg], spot: float) -> float:
        """计算最大收益 (美元)"""
        df = cls.calc_strategy_payoff(spot, legs, steps=1000)
        return float(df["pnl"].max())

    @classmethod
    def calc_max_loss(cls, legs: list[Leg], spot: float) -> float:
        """计算最大亏损 (美元，负数)"""
        df = cls.calc_strategy_payoff(spot, legs, steps=1000)
        return float(df["pnl"].min())

    @classmethod
    def calc_breakevens(cls, legs: list[Leg], spot: float) -> list[float]:
        """
        计算盈亏平衡点：P&L 从负变正或从正变负的价格
        """
        df = cls.calc_strategy_payoff(spot, legs, steps=2000)
        pnl = df["pnl"].values
        prices = df["price"].values

        breakevens = []
        for i in range(1, len(pnl)):
            if pnl[i - 1] * pnl[i] < 0:  # 符号变化
                # 线性插值找精确交叉点
                p1, p2 = prices[i - 1], prices[i]
                v1, v2 = pnl[i - 1], pnl[i]
                if v2 == v1:
                    continue
                be = p1 + (0 - v1) * (p2 - p1) / (v2 - v1)
                breakevens.append(round(be, 2))

        return breakevens

    @classmethod
    def calc_net_debit_credit(cls, legs: list[Leg]) -> float:
        """
        计算净支出(正) / 净收入(负)
        正值=Debit（花钱），负值=Credit（收钱）
        """
        total = 0.0
        for leg in legs:
            if leg.action == "BUY":
                total += leg.premium * leg.quantity  # 买入支出
            else:
                total -= leg.premium * leg.quantity  # 卖出收入
        return round(total * cls.CONTRACT_MULTIPLIER, 2)

    @classmethod
    def calc_required_capital(cls, legs: list[Leg], spot: float) -> float:
        """
        计算所需资金
        - Debit 策略: 净支出即为所需资金
        - Credit 策略: 最大亏损的绝对值（保证金需求）
        """
        net = cls.calc_net_debit_credit(legs)
        if net > 0:
            # Debit 策略，所需资金 = 净支出
            return net
        else:
            # Credit 策略，所需资金 = |最大亏损|
            max_loss = cls.calc_max_loss(legs, spot)
            return abs(max_loss)

    @classmethod
    def estimate_win_probability(
        cls,
        legs: list[Leg],
        spot: float,
        iv: float,
        dte: int,
    ) -> float:
        """
        估算胜率：基于对数正态分布模型
        假设标的价格服从 GBM，计算到期时 P&L > 0 的概率

        参数:
            iv: 年化隐含波动率 (百分比，如 30 代表 30%)
            dte: 距到期天数
        """
        if dte <= 0 or iv <= 0:
            return 50.0

        breakevens = cls.calc_breakevens(legs, spot)
        if not breakevens:
            # 没有盈亏平衡点，检查是否全部盈利或亏损
            max_p = cls.calc_max_profit(legs, spot)
            return 95.0 if max_p > 0 else 5.0

        sigma = iv / 100  # 转小数
        t = dte / 365

        # 使用标准正态分布 CDF (scipy 在 import 时太重，用 numpy 近似)
        def norm_cdf(x):
            """标准正态分布 CDF 近似"""
            from math import erf
            return 0.5 * (1 + np.vectorize(erf)(x / np.sqrt(2)))

        # 对每个 breakeven 计算标的到达该价位的概率
        # ln(S_T/S_0) ~ N((r - σ²/2)t, σ²t)，假设 r=0 简化
        drift = -0.5 * sigma ** 2 * t
        vol = sigma * np.sqrt(t)

        # 判断策略在各区间是盈利还是亏损
        df = cls.calc_strategy_payoff(spot, legs, steps=500)

        # 计算 P&L > 0 的概率
        # 简化方法：计算 breakeven 处的概率区间
        if len(breakevens) == 1:
            be = breakevens[0]
            d = (np.log(be / spot) - drift) / vol
            prob_above = 1 - norm_cdf(d)
            # 检查策略在 breakeven 上方是盈利还是亏损
            pnl_above = df[df["price"] > be]["pnl"].mean()
            win_prob = prob_above if pnl_above > 0 else (1 - prob_above)

        elif len(breakevens) == 2:
            be_low, be_high = sorted(breakevens)
            d_low = (np.log(be_low / spot) - drift) / vol
            d_high = (np.log(be_high / spot) - drift) / vol
            prob_between = norm_cdf(d_high) - norm_cdf(d_low)
            # 检查策略在两个 breakeven 之间是盈利还是亏损
            mid_price = (be_low + be_high) / 2
            pnl_mid = df.iloc[(df["price"] - mid_price).abs().argsort().iloc[0]]["pnl"]
            win_prob = prob_between if pnl_mid > 0 else (1 - prob_between)

        else:
            # 多个 breakeven (复杂策略)，用 GBM 概率加权
            # 对每个价格点计算对数正态概率密度，加权统计 P&L>0 的概率
            prices = df["price"].values
            pnl_vals = df["pnl"].values
            log_prices = np.log(prices / spot)
            densities = np.exp(-0.5 * ((log_prices - drift) / vol) ** 2) / (vol * prices * np.sqrt(2 * np.pi))
            total_density = densities.sum()
            if total_density > 0:
                win_prob = densities[pnl_vals > 0].sum() / total_density
            else:
                win_prob = (pnl_vals > 0).mean()
            return round(float(win_prob) * 100, 1)

        return round(float(win_prob) * 100, 1)


# ============================================================
# 策略构建器：根据期权链数据组装 20 种策略
# ============================================================

class StrategyBuilder:
    """
    根据期权链和用户参数构建具体策略
    """

    @staticmethod
    def find_strike_by_delta(
        chain_df: pd.DataFrame,
        target_delta: float,
        spot: float,
    ) -> Optional[pd.Series]:
        """根据目标 Delta 找到最接近的合约"""
        if chain_df.empty:
            return None
        if "delta" in chain_df.columns and chain_df["delta"].notna().any():
            idx = (chain_df["delta"].fillna(0) - target_delta).abs().idxmin()
            return chain_df.loc[idx]
        # 若无 Delta 数据，用 moneyness 近似
        # ATM: strike ≈ spot → delta ≈ 0.50
        # OTM Call delta 0.30 → strike ≈ spot × 1.05
        target_strike = spot * (1 + (0.5 - abs(target_delta)) * 0.5)
        idx = (chain_df["strike"] - target_strike).abs().idxmin()
        return chain_df.loc[idx]

    @staticmethod
    def find_strike_nearest(chain_df: pd.DataFrame, target: float) -> Optional[pd.Series]:
        """找到最接近目标价的合约"""
        if chain_df.empty:
            return None
        idx = (chain_df["strike"] - target).abs().idxmin()
        return chain_df.loc[idx]

    @classmethod
    def build_long_call(cls, calls: pd.DataFrame, spot: float, target: float = None) -> list[Leg]:
        """Long Call: 买入 ATM 或稍虚值的 Call"""
        strike_target = target if target and target > spot else spot * 1.02
        c = cls.find_strike_nearest(calls, strike_target)
        if c is None:
            return []
        return [Leg("BUY", "CALL", c["strike"], c["mid_price"], 1)]

    @classmethod
    def build_long_put(cls, puts: pd.DataFrame, spot: float, target: float = None) -> list[Leg]:
        """Long Put: 买入 ATM 或稍虚值的 Put"""
        strike_target = target if target and target < spot else spot * 0.98
        p = cls.find_strike_nearest(puts, strike_target)
        if p is None:
            return []
        return [Leg("BUY", "PUT", p["strike"], p["mid_price"], 1)]

    @classmethod
    def build_short_call(cls, calls: pd.DataFrame, spot: float) -> list[Leg]:
        """Short Call: 卖出 OTM Call"""
        c = cls.find_strike_nearest(calls, spot * 1.05)
        if c is None:
            return []
        return [Leg("SELL", "CALL", c["strike"], c["mid_price"], 1)]

    @classmethod
    def build_short_put(cls, puts: pd.DataFrame, spot: float) -> list[Leg]:
        """Short Put (Cash-Secured): 卖出 ATM 或轻微 OTM Put"""
        p = cls.find_strike_nearest(puts, spot * 0.97)
        if p is None:
            return []
        return [Leg("SELL", "PUT", p["strike"], p["mid_price"], 1)]

    @classmethod
    def build_bull_call_spread(
        cls, calls: pd.DataFrame, spot: float, target: float = None, width_pct: float = 0.10
    ) -> list[Leg]:
        """Bull Call Spread: 买低K Call + 卖高K Call"""
        buy_strike = spot  # ATM
        sell_strike = target if target else spot * (1 + width_pct)
        buy_c = cls.find_strike_nearest(calls, buy_strike)
        sell_c = cls.find_strike_nearest(calls, sell_strike)
        if buy_c is None or sell_c is None:
            return []
        if buy_c["strike"] >= sell_c["strike"]:
            return []
        return [
            Leg("BUY", "CALL", buy_c["strike"], buy_c["mid_price"], 1),
            Leg("SELL", "CALL", sell_c["strike"], sell_c["mid_price"], 1),
        ]

    @classmethod
    def build_bear_call_spread(
        cls, calls: pd.DataFrame, spot: float, width_pct: float = 0.10
    ) -> list[Leg]:
        """Bear Call Spread (Credit): 卖低K Call + 买高K Call"""
        sell_strike = spot * 1.02
        buy_strike = spot * (1.02 + width_pct)
        sell_c = cls.find_strike_nearest(calls, sell_strike)
        buy_c = cls.find_strike_nearest(calls, buy_strike)
        if sell_c is None or buy_c is None:
            return []
        if sell_c["strike"] >= buy_c["strike"]:
            return []
        return [
            Leg("SELL", "CALL", sell_c["strike"], sell_c["mid_price"], 1),
            Leg("BUY", "CALL", buy_c["strike"], buy_c["mid_price"], 1),
        ]

    @classmethod
    def build_bull_put_spread(
        cls, puts: pd.DataFrame, spot: float, width_pct: float = 0.10
    ) -> list[Leg]:
        """Bull Put Spread (Credit): 卖高K Put + 买低K Put"""
        sell_strike = spot * 0.98
        buy_strike = spot * (0.98 - width_pct)
        sell_p = cls.find_strike_nearest(puts, sell_strike)
        buy_p = cls.find_strike_nearest(puts, buy_strike)
        if sell_p is None or buy_p is None:
            return []
        if buy_p["strike"] >= sell_p["strike"]:
            return []
        return [
            Leg("SELL", "PUT", sell_p["strike"], sell_p["mid_price"], 1),
            Leg("BUY", "PUT", buy_p["strike"], buy_p["mid_price"], 1),
        ]

    @classmethod
    def build_bear_put_spread(
        cls, puts: pd.DataFrame, spot: float, target: float = None, width_pct: float = 0.10
    ) -> list[Leg]:
        """Bear Put Spread (Debit): 买高K Put + 卖低K Put"""
        buy_strike = spot  # ATM
        sell_strike = target if target and target < spot else spot * (1 - width_pct)
        buy_p = cls.find_strike_nearest(puts, buy_strike)
        sell_p = cls.find_strike_nearest(puts, sell_strike)
        if buy_p is None or sell_p is None:
            return []
        if sell_p["strike"] >= buy_p["strike"]:
            return []
        return [
            Leg("BUY", "PUT", buy_p["strike"], buy_p["mid_price"], 1),
            Leg("SELL", "PUT", sell_p["strike"], sell_p["mid_price"], 1),
        ]

    @classmethod
    def build_long_straddle(cls, calls: pd.DataFrame, puts: pd.DataFrame, spot: float) -> list[Leg]:
        """Long Straddle: 同 Strike 买 Call + 买 Put"""
        c = cls.find_strike_nearest(calls, spot)
        p = cls.find_strike_nearest(puts, spot)
        if c is None or p is None:
            return []
        # 使用相同 strike
        strike = c["strike"]
        p_same = cls.find_strike_nearest(puts, strike)
        return [
            Leg("BUY", "CALL", c["strike"], c["mid_price"], 1),
            Leg("BUY", "PUT", p_same["strike"], p_same["mid_price"], 1),
        ]

    @classmethod
    def build_short_straddle(cls, calls: pd.DataFrame, puts: pd.DataFrame, spot: float) -> list[Leg]:
        """Short Straddle: 同 Strike 卖 Call + 卖 Put"""
        c = cls.find_strike_nearest(calls, spot)
        if c is None:
            return []
        p = cls.find_strike_nearest(puts, c["strike"])
        if p is None:
            return []
        return [
            Leg("SELL", "CALL", c["strike"], c["mid_price"], 1),
            Leg("SELL", "PUT", p["strike"], p["mid_price"], 1),
        ]

    @classmethod
    def build_long_strangle(
        cls, calls: pd.DataFrame, puts: pd.DataFrame, spot: float, width_pct: float = 0.05
    ) -> list[Leg]:
        """Long Strangle: 买 OTM Call + 买 OTM Put"""
        c = cls.find_strike_nearest(calls, spot * (1 + width_pct))
        p = cls.find_strike_nearest(puts, spot * (1 - width_pct))
        if c is None or p is None:
            return []
        return [
            Leg("BUY", "CALL", c["strike"], c["mid_price"], 1),
            Leg("BUY", "PUT", p["strike"], p["mid_price"], 1),
        ]

    @classmethod
    def build_short_strangle(
        cls, calls: pd.DataFrame, puts: pd.DataFrame, spot: float, width_pct: float = 0.05
    ) -> list[Leg]:
        """Short Strangle: 卖 OTM Call + 卖 OTM Put"""
        c = cls.find_strike_nearest(calls, spot * (1 + width_pct))
        p = cls.find_strike_nearest(puts, spot * (1 - width_pct))
        if c is None or p is None:
            return []
        return [
            Leg("SELL", "CALL", c["strike"], c["mid_price"], 1),
            Leg("SELL", "PUT", p["strike"], p["mid_price"], 1),
        ]

    @classmethod
    def build_iron_condor(
        cls, calls: pd.DataFrame, puts: pd.DataFrame, spot: float, width_pct: float = 0.05
    ) -> list[Leg]:
        """Iron Condor: Bull Put Spread + Bear Call Spread"""
        # Put 侧 (Bull Put Spread)
        sell_p = cls.find_strike_nearest(puts, spot * (1 - width_pct))
        buy_p = cls.find_strike_nearest(puts, spot * (1 - 2 * width_pct))
        # Call 侧 (Bear Call Spread)
        sell_c = cls.find_strike_nearest(calls, spot * (1 + width_pct))
        buy_c = cls.find_strike_nearest(calls, spot * (1 + 2 * width_pct))
        if any(x is None for x in [sell_p, buy_p, sell_c, buy_c]):
            return []
        return [
            Leg("SELL", "PUT", sell_p["strike"], sell_p["mid_price"], 1),
            Leg("BUY", "PUT", buy_p["strike"], buy_p["mid_price"], 1),
            Leg("SELL", "CALL", sell_c["strike"], sell_c["mid_price"], 1),
            Leg("BUY", "CALL", buy_c["strike"], buy_c["mid_price"], 1),
        ]

    @classmethod
    def build_iron_butterfly(
        cls, calls: pd.DataFrame, puts: pd.DataFrame, spot: float, wing_width_pct: float = 0.05
    ) -> list[Leg]:
        """Iron Butterfly: 卖 ATM Straddle + 买两翼保护"""
        atm_c = cls.find_strike_nearest(calls, spot)
        if atm_c is None:
            return []
        atm_p = cls.find_strike_nearest(puts, atm_c["strike"])
        wing_c = cls.find_strike_nearest(calls, spot * (1 + wing_width_pct))
        wing_p = cls.find_strike_nearest(puts, spot * (1 - wing_width_pct))
        if any(x is None for x in [atm_p, wing_c, wing_p]):
            return []
        return [
            Leg("SELL", "CALL", atm_c["strike"], atm_c["mid_price"], 1),
            Leg("SELL", "PUT", atm_p["strike"], atm_p["mid_price"], 1),
            Leg("BUY", "CALL", wing_c["strike"], wing_c["mid_price"], 1),
            Leg("BUY", "PUT", wing_p["strike"], wing_p["mid_price"], 1),
        ]

    @classmethod
    def build_long_call_butterfly(
        cls, calls: pd.DataFrame, spot: float, target: float = None, wing_width_pct: float = 0.05
    ) -> list[Leg]:
        """Long Call Butterfly: 买1低K + 卖2中K + 买1高K Call"""
        mid = target if target else spot
        mid_c = cls.find_strike_nearest(calls, mid)
        if mid_c is None:
            return []
        mid_strike = mid_c["strike"]
        low_c = cls.find_strike_nearest(calls, mid_strike * (1 - wing_width_pct))
        high_c = cls.find_strike_nearest(calls, mid_strike * (1 + wing_width_pct))
        if low_c is None or high_c is None:
            return []
        return [
            Leg("BUY", "CALL", low_c["strike"], low_c["mid_price"], 1),
            Leg("SELL", "CALL", mid_c["strike"], mid_c["mid_price"], 2),
            Leg("BUY", "CALL", high_c["strike"], high_c["mid_price"], 1),
        ]

    @classmethod
    def build_long_put_butterfly(
        cls, puts: pd.DataFrame, spot: float, target: float = None, wing_width_pct: float = 0.05
    ) -> list[Leg]:
        """Long Put Butterfly: 买1高K + 卖2中K + 买1低K Put"""
        mid = target if target else spot
        mid_p = cls.find_strike_nearest(puts, mid)
        if mid_p is None:
            return []
        mid_strike = mid_p["strike"]
        high_p = cls.find_strike_nearest(puts, mid_strike * (1 + wing_width_pct))
        low_p = cls.find_strike_nearest(puts, mid_strike * (1 - wing_width_pct))
        if high_p is None or low_p is None:
            return []
        return [
            Leg("BUY", "PUT", high_p["strike"], high_p["mid_price"], 1),
            Leg("SELL", "PUT", mid_p["strike"], mid_p["mid_price"], 2),
            Leg("BUY", "PUT", low_p["strike"], low_p["mid_price"], 1),
        ]

    @classmethod
    def build_calendar_spread(
        cls,
        near_calls: pd.DataFrame,
        far_calls: pd.DataFrame,
        spot: float,
    ) -> list[Leg]:
        """
        Calendar Spread: 卖近月 + 买远月 (同 Strike)
        注意：需要两个不同到期日的期权链
        """
        near_c = cls.find_strike_nearest(near_calls, spot)
        far_c = cls.find_strike_nearest(far_calls, near_c["strike"] if near_c is not None else spot)
        if near_c is None or far_c is None:
            return []
        return [
            Leg("SELL", "CALL", near_c["strike"], near_c["mid_price"], 1, expiration="near"),
            Leg("BUY", "CALL", far_c["strike"], far_c["mid_price"], 1, expiration="far"),
        ]

    @classmethod
    def build_diagonal_spread(
        cls,
        near_calls: pd.DataFrame,
        far_calls: pd.DataFrame,
        spot: float,
        direction: str = "bullish",
    ) -> list[Leg]:
        """
        Diagonal Spread: 卖近月OTM + 买远月ATM/ITM (不同 Strike + 不同到期日)
        """
        if direction == "bearish":
            far_c = cls.find_strike_nearest(far_calls, spot * 1.02)  # OTM far (higher strike)
            near_c = cls.find_strike_nearest(near_calls, spot * 0.95)  # ITM near (lower strike)
        else:  # bullish or neutral
            far_c = cls.find_strike_nearest(far_calls, spot * 0.98)  # ITM far
            near_c = cls.find_strike_nearest(near_calls, spot * 1.05)  # OTM near
        if near_c is None or far_c is None:
            return []
        return [
            Leg("BUY", "CALL", far_c["strike"], far_c["mid_price"], 1, expiration="far"),
            Leg("SELL", "CALL", near_c["strike"], near_c["mid_price"], 1, expiration="near"),
        ]

    @classmethod
    def build_call_ratio_spread(cls, calls: pd.DataFrame, spot: float) -> list[Leg]:
        """Call Ratio Spread: 买1 ITM Call + 卖2 OTM Call"""
        buy_c = cls.find_strike_nearest(calls, spot * 0.97)  # ITM
        sell_c = cls.find_strike_nearest(calls, spot * 1.05)  # OTM
        if buy_c is None or sell_c is None:
            return []
        return [
            Leg("BUY", "CALL", buy_c["strike"], buy_c["mid_price"], 1),
            Leg("SELL", "CALL", sell_c["strike"], sell_c["mid_price"], 2),
        ]

    @classmethod
    def build_put_ratio_spread(cls, puts: pd.DataFrame, spot: float) -> list[Leg]:
        """Put Ratio Spread: 买1 ITM Put + 卖2 OTM Put"""
        buy_p = cls.find_strike_nearest(puts, spot * 1.03)  # ITM
        sell_p = cls.find_strike_nearest(puts, spot * 0.95)  # OTM
        if buy_p is None or sell_p is None:
            return []
        return [
            Leg("BUY", "PUT", buy_p["strike"], buy_p["mid_price"], 1),
            Leg("SELL", "PUT", sell_p["strike"], sell_p["mid_price"], 2),
        ]


# ============================================================
# 辅助：生成腿的人类可读描述
# ============================================================

def format_leg_description(leg: Leg, expiration: str = "") -> str:
    """
    生成人类可读描述
    例如: "买入 1手 5月1日 $52.5 Call @ $3.80"
    """
    action_cn = "买入" if leg.action == "BUY" else "卖出"
    exp_str = expiration or leg.expiration
    return (
        f"{action_cn} {leg.quantity}手 {exp_str} "
        f"${leg.strike:.1f} {leg.option_type} @ ${leg.premium:.2f}"
    )
