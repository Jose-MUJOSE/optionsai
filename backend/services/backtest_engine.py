"""
OptionsAI - 策略回测引擎

核心原则（数据诚实性）:
  - 股价回放: 100% 真实 Yahoo Finance OHLCV
  - 期权定价: Black-Scholes 理论价 (BSM), 明确标注"理论价"而非历史成交价
  - 波动率 σ: 使用回放日期前 30 天实际 HV (滚动计算) 作为 BSM 输入
  - 无风险利率 r: 固定 4.5% (T-bill 近似), 作为假设明确标注
  - 绝不声称这是"历史期权成交价"

支持的策略（单腿 + 两腿）:
  - long_call / long_put
  - short_call / short_put
  - bull_call_spread / bear_put_spread
  - 更复杂策略(iron condor 等)需两腿之外数据, 暂不支持, 明确返回错误
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from scipy.stats import norm


# -------- BSM 定价（理论价）--------

def _bsm_price(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
    """
    Black-Scholes 理论期权价格.
    S: spot, K: strike, T: 到期年化时间, r: 无风险利率, sigma: 年化波动率
    opt_type: 'call' or 'put'
    """
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        # 到期日或之前 → 内在价值
        if opt_type == "call":
            return max(S - K, 0.0)
        return max(K - S, 0.0)

    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if opt_type == "call":
        price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    else:  # put
        price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)

    return max(price, 0.0)


# -------- 滚动 HV 序列 --------

def _rolling_hv(closes: pd.Series, window: int = 30) -> pd.Series:
    """
    计算滚动 window-day 的年化历史波动率 (100% 真实, 仅依赖收盘价).
    返回: 与 closes 同长度的 Series, 前 window 个值为 NaN.
    """
    log_ret = np.log(closes / closes.shift(1))
    rolling_std = log_ret.rolling(window=window).std()
    return rolling_std * math.sqrt(252)  # annualize


# -------- 策略定义 --------

RISK_FREE_RATE = 0.045  # T-bill approximation; marked as assumption
TRADING_DAYS_PER_YEAR = 252.0


@dataclass
class StrategyLeg:
    """单条腿定义"""
    action: str        # 'buy' or 'sell'
    opt_type: str      # 'call' or 'put'
    strike: float
    quantity: int = 1  # contracts (1 contract = 100 shares)


# 策略类型 → 构造腿列表
def build_legs(strategy_type: str, spot: float, width_pct: float = 5.0) -> list[StrategyLeg]:
    """
    根据策略类型, 在给定 spot 下构造腿.
    Strike 选择规则(真实做市惯例):
      - long/short single leg → ATM (最接近 spot)
      - spreads → ATM + 一档 (width_pct 相对 spot)
    返回值会在回测入口点 round 到最近整数 strike.
    """
    atm = round(spot)
    width_abs = max(1.0, round(spot * width_pct / 100.0))

    if strategy_type == "long_call":
        return [StrategyLeg("buy", "call", atm)]
    if strategy_type == "long_put":
        return [StrategyLeg("buy", "put", atm)]
    if strategy_type == "short_call":
        return [StrategyLeg("sell", "call", atm)]
    if strategy_type == "short_put":
        return [StrategyLeg("sell", "put", atm)]
    if strategy_type == "bull_call_spread":
        return [
            StrategyLeg("buy", "call", atm),
            StrategyLeg("sell", "call", atm + width_abs),
        ]
    if strategy_type == "bear_put_spread":
        return [
            StrategyLeg("buy", "put", atm),
            StrategyLeg("sell", "put", atm - width_abs),
        ]
    if strategy_type == "long_straddle":
        return [
            StrategyLeg("buy", "call", atm),
            StrategyLeg("buy", "put", atm),
        ]
    if strategy_type == "short_strangle":
        return [
            StrategyLeg("sell", "call", atm + width_abs),
            StrategyLeg("sell", "put", atm - width_abs),
        ]
    raise ValueError(f"Unsupported strategy_type: {strategy_type}")


def _portfolio_price(
    legs: list[StrategyLeg],
    spot: float,
    T: float,
    r: float,
    sigma: float,
) -> float:
    """
    计算整个策略组合的净理论价 (每股基础, 1 合约 = 100 股).
    买入腿 +price, 卖出腿 -price.
    """
    total = 0.0
    for leg in legs:
        price = _bsm_price(spot, leg.strike, T, r, sigma, leg.opt_type)
        if leg.action == "buy":
            total += price * leg.quantity
        else:
            total -= price * leg.quantity
    return total


# -------- 回测主函数 --------

@dataclass
class BacktestBar:
    date: str
    spot: float
    theoretical_price: float  # 整个策略组合的理论价 (每股)
    pnl_per_contract: float   # 相对进场时刻, 每张合约的 P&L (× 100 shares)
    pnl_pct: float            # 相对初始权利金的百分比收益
    days_to_expiry: int
    sigma: float              # 该日使用的 σ (30D HV)


@dataclass
class BacktestResult:
    ticker: str
    strategy_type: str
    entry_date: str
    exit_date: str
    initial_spot: float
    exit_spot: float
    dte_at_entry: int
    legs: list[dict]
    initial_price_per_share: float       # 进场理论价 (正值=净借记, 负值=净贷记)
    exit_price_per_share: float
    max_pnl_per_contract: float
    min_pnl_per_contract: float
    final_pnl_per_contract: float
    final_pnl_pct: float
    bars: list[dict]
    assumptions: dict                    # 明确声明所有假设
    data_sources: dict                   # 明确声明数据来源


def run_backtest(
    ticker: str,
    strategy_type: str,
    closes: pd.Series,           # 日期索引的收盘价 (真实 Yahoo)
    dates: list[str],            # 与 closes 对齐的 ISO 日期字符串
    entry_date: str,
    dte_days: int = 30,          # 进场时期权剩余天数
    hold_days: Optional[int] = None,  # 持仓天数; 默认 min(dte_days, len(available))
) -> BacktestResult:
    """
    对给定 ticker 从 entry_date 进场, 持有 hold_days 或到期, 回放真实价格轨迹.
    所有期权价格使用 BSM 理论价 (明确标注).

    参数:
      closes      : Yahoo 收盘价 Series (数值索引 0..N-1)
      dates       : 与 closes 对齐的 ISO 日期 (YYYY-MM-DD) 列表

    返回: BacktestResult (含 bars 数组 + 摘要统计)
    """
    if strategy_type not in {
        "long_call", "long_put", "short_call", "short_put",
        "bull_call_spread", "bear_put_spread",
        "long_straddle", "short_strangle",
    }:
        raise ValueError(f"Unsupported strategy: {strategy_type}")

    if len(closes) != len(dates):
        raise ValueError("closes and dates must be same length")

    # 1) 找到 entry_date 对应的索引
    try:
        entry_idx = dates.index(entry_date)
    except ValueError:
        # 找到第一个 >= entry_date 的日期 (fallback)
        for i, d in enumerate(dates):
            if d >= entry_date:
                entry_idx = i
                break
        else:
            raise ValueError(f"entry_date {entry_date} not in price history")

    # 2) 必须有至少 30 天的历史数据在 entry 之前来计算 σ
    if entry_idx < 30:
        raise ValueError("Need >=30 days of price history before entry for HV calc")

    # 3) 计算滚动 30D HV 作为 σ
    hv_series = _rolling_hv(closes, window=30)

    # 4) 确定持仓结束索引
    if hold_days is None:
        hold_days = dte_days  # 默认持有到到期
    exit_idx = min(entry_idx + hold_days, len(closes) - 1)

    # 5) 进场: 使用 entry_idx 的 spot, dte_days 剩余时间, entry_idx 的 σ
    entry_spot = float(closes.iloc[entry_idx])
    legs = build_legs(strategy_type, entry_spot)
    entry_sigma = float(hv_series.iloc[entry_idx])
    if math.isnan(entry_sigma) or entry_sigma <= 0:
        raise ValueError("Invalid HV at entry date (insufficient history)")

    T_entry = dte_days / TRADING_DAYS_PER_YEAR
    initial_price = _portfolio_price(legs, entry_spot, T_entry, RISK_FREE_RATE, entry_sigma)

    # 6) 回放: 每个交易日重算组合理论价
    bars: list[BacktestBar] = []
    max_pnl = -math.inf
    min_pnl = math.inf

    for i in range(entry_idx, exit_idx + 1):
        days_elapsed = i - entry_idx
        dte_remain = max(dte_days - days_elapsed, 0)
        T = dte_remain / TRADING_DAYS_PER_YEAR
        spot = float(closes.iloc[i])
        sigma_i = float(hv_series.iloc[i]) if not math.isnan(hv_series.iloc[i]) else entry_sigma
        if sigma_i <= 0:
            sigma_i = entry_sigma

        price = _portfolio_price(legs, spot, T, RISK_FREE_RATE, sigma_i)
        # P&L per contract (1 contract = 100 shares).
        # 买入策略: 用初始借记 - 当前价值 ... 不对, 正负号要看方向:
        # initial_price > 0 (净借记) → pnl = (current_value - initial_price) * 100
        # initial_price < 0 (净贷记) → pnl = (initial_price - current_value) * 100 实际上:
        # 对于一个"长仓位", 持有价值变化 = current - entry
        # 统一为: pnl_per_contract = (current_value - entry_value) * 100, entry_value = initial_price
        # 但"买入"的初始流水是 -initial_price (付钱), 后续平仓流水是 +current_price
        # 净 P&L = current_price - initial_price (同号处理净借记/净贷记)
        pnl_per_contract = (price - initial_price) * 100.0
        pnl_pct = 0.0
        if abs(initial_price) > 1e-9:
            pnl_pct = (price - initial_price) / abs(initial_price) * 100.0

        max_pnl = max(max_pnl, pnl_per_contract)
        min_pnl = min(min_pnl, pnl_per_contract)

        bars.append(BacktestBar(
            date=dates[i],
            spot=round(spot, 4),
            theoretical_price=round(price, 4),
            pnl_per_contract=round(pnl_per_contract, 2),
            pnl_pct=round(pnl_pct, 2),
            days_to_expiry=dte_remain,
            sigma=round(sigma_i, 4),
        ))

    final_bar = bars[-1]
    return BacktestResult(
        ticker=ticker,
        strategy_type=strategy_type,
        entry_date=dates[entry_idx],
        exit_date=dates[exit_idx],
        initial_spot=round(entry_spot, 4),
        exit_spot=round(float(closes.iloc[exit_idx]), 4),
        dte_at_entry=dte_days,
        legs=[asdict(l) for l in legs],
        initial_price_per_share=round(initial_price, 4),
        exit_price_per_share=round(final_bar.theoretical_price, 4),
        max_pnl_per_contract=round(max_pnl, 2),
        min_pnl_per_contract=round(min_pnl, 2),
        final_pnl_per_contract=round(final_bar.pnl_per_contract, 2),
        final_pnl_pct=round(final_bar.pnl_pct, 2),
        bars=[asdict(b) for b in bars],
        assumptions={
            "pricing_model": "Black-Scholes (theoretical)",
            "risk_free_rate": RISK_FREE_RATE,
            "sigma_source": "rolling 30-day realized volatility (annualized)",
            "strike_selection": "ATM for single-leg; ATM + 5%-wide for spreads",
            "contract_multiplier": 100,
        },
        data_sources={
            "spot_price_history": "Yahoo Finance 1D OHLCV (100% real)",
            "option_prices": "BSM theoretical (NOT historical transaction prices)",
            "volatility": "Computed from real closes",
            "disclaimer": "回放的期权价格为 BSM 理论价, 非实际历史成交价。实际交易价格会受到买卖价差、流动性和波动率微笑的影响。",
        },
    )
