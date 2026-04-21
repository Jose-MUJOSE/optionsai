"""
OptionsAI - 策略智能筛选器
根据【趋势预期】+【IV 环境】+【偏好天平】动态推荐 3-4 个最优策略

策略推荐逻辑：
  - 方向性策略 (Long Call/Put, Spreads) → 匹配趋势方向
  - 波动率策略 (Straddle, Strangle) → 匹配波动率预期
  - 收租策略 (Iron Condor, Credit Spreads) → 匹配高IV环境
  - 日历/对角策略 → 仅在低波动 + 方向性温和预期时推荐
"""
from __future__ import annotations

from typing import Optional

import pandas as pd

from backend.models.schemas import (
    TrendExpectation,
    StrategyType,
    OptionLeg,
    PayoffPoint,
    Strategy,
    ActionType,
    OptionType,
)
from backend.services.strategy_engine import (
    StrategyBuilder,
    PayoffEngine,
    Leg,
    format_leg_description,
)


# ============================================================
# 策略元数据：名称、标签映射
# ============================================================

STRATEGY_META = {
    StrategyType.LONG_CALL: {
        "name": "买入看涨期权", "name_en": "Long Call", "tag": "高杠杆",
    },
    StrategyType.LONG_PUT: {
        "name": "买入看跌期权", "name_en": "Long Put", "tag": "高杠杆",
    },
    StrategyType.SHORT_CALL: {
        "name": "卖出看涨期权", "name_en": "Short Call", "tag": "收租型",
    },
    StrategyType.SHORT_PUT: {
        "name": "卖出看跌期权", "name_en": "Short Put", "tag": "收租型",
    },
    StrategyType.BULL_CALL_SPREAD: {
        "name": "牛市看涨价差", "name_en": "Bull Call Spread", "tag": "平衡型",
    },
    StrategyType.BEAR_CALL_SPREAD: {
        "name": "熊市看涨价差", "name_en": "Bear Call Spread", "tag": "高胜率",
    },
    StrategyType.BULL_PUT_SPREAD: {
        "name": "牛市看跌价差", "name_en": "Bull Put Spread", "tag": "高胜率",
    },
    StrategyType.BEAR_PUT_SPREAD: {
        "name": "熊市看跌价差", "name_en": "Bear Put Spread", "tag": "平衡型",
    },
    StrategyType.LONG_STRADDLE: {
        "name": "买入跨式", "name_en": "Long Straddle", "tag": "高杠杆",
    },
    StrategyType.SHORT_STRADDLE: {
        "name": "卖出跨式", "name_en": "Short Straddle", "tag": "收租型",
    },
    StrategyType.LONG_STRANGLE: {
        "name": "买入宽跨式", "name_en": "Long Strangle", "tag": "高杠杆",
    },
    StrategyType.SHORT_STRANGLE: {
        "name": "卖出宽跨式", "name_en": "Short Strangle", "tag": "收租型",
    },
    StrategyType.IRON_CONDOR: {
        "name": "铁鹰策略", "name_en": "Iron Condor", "tag": "高胜率",
    },
    StrategyType.IRON_BUTTERFLY: {
        "name": "铁蝶策略", "name_en": "Iron Butterfly", "tag": "高胜率",
    },
    StrategyType.LONG_CALL_BUTTERFLY: {
        "name": "买入看涨蝶式", "name_en": "Long Call Butterfly", "tag": "平衡型",
    },
    StrategyType.LONG_PUT_BUTTERFLY: {
        "name": "买入看跌蝶式", "name_en": "Long Put Butterfly", "tag": "平衡型",
    },
    StrategyType.CALENDAR_SPREAD: {
        "name": "日历价差", "name_en": "Calendar Spread", "tag": "进阶型",
    },
    StrategyType.DIAGONAL_SPREAD: {
        "name": "对角价差", "name_en": "Diagonal Spread", "tag": "进阶型",
    },
    StrategyType.CALL_RATIO_SPREAD: {
        "name": "看涨比率价差", "name_en": "Call Ratio Spread", "tag": "进阶型",
    },
    StrategyType.PUT_RATIO_SPREAD: {
        "name": "看跌比率价差", "name_en": "Put Ratio Spread", "tag": "进阶型",
    },
}


# ============================================================
# 策略推荐矩阵：趋势 × IV 环境 → 候选策略池
# ============================================================
#
# 设计原则:
#   1. 方向匹配: 看涨趋势 → 看涨策略, 看跌趋势 → 看跌策略
#   2. IV 环境匹配:
#      - IV低 → 适合买入期权（便宜），Long策略优先
#      - IV高 → 适合卖出期权（贵），Credit策略/Short策略优先
#   3. 波动预期匹配:
#      - volatile_up/down → 预期大幅波动+方向性 → 方向性策略为主
#      - high_volatile → 预期大幅波动无方向 → Long Straddle/Strangle
#      - neutral → 预期不动 → Short vol策略, Iron Condor/Butterfly
#   4. Calendar/Diagonal → 仅在温和方向预期+低/中IV时推荐
#   5. 每个组合4个候选，bias标记：return=高回报, winrate=高胜率, balanced=平衡

def _iv_level(iv_rank: float) -> str:
    """IV 环境分级"""
    if iv_rank < 30:
        return "low"
    elif iv_rank < 65:
        return "mid"
    else:
        return "high"


RECOMMENDATION_MATRIX: dict[tuple[TrendExpectation, str], list[tuple[StrategyType, str]]] = {
    # =============================================================
    # 强烈看涨 (STRONG_UP): 预期大幅上涨
    # 每个组合6个候选(return/winrate/balanced各2)，slider选top4
    # NOTE: 已移除裸卖策略(SHORT_PUT/SHORT_CALL)和无保护比率价差
    #       以控制风险敞口，所有策略均为有限风险
    # =============================================================
    (TrendExpectation.STRONG_UP, "low"): [
        (StrategyType.LONG_CALL, "return"),            # IV低→买Call便宜，大幅上涨获利最大
        (StrategyType.BULL_CALL_SPREAD, "return"),     # 有限风险方向性策略
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),# 目标价附近收益最大
        (StrategyType.DIAGONAL_SPREAD, "balanced"),    # 低IV+看涨=对角价差适用
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # Credit看涨，有限风险
        (StrategyType.IRON_CONDOR, "winrate"),         # 范围偏多
    ],
    (TrendExpectation.STRONG_UP, "mid"): [
        (StrategyType.LONG_CALL, "return"),            # 直接做多
        (StrategyType.BULL_CALL_SPREAD, "return"),     # 控制成本的看涨
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # Credit看涨，高胜率
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.STRONG_UP, "high"): [
        (StrategyType.BULL_CALL_SPREAD, "return"),     # IV高→限制买方成本
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # IV高→卖Put收取高权利金
        (StrategyType.IRON_CONDOR, "winrate"),
    ],

    # =============================================================
    # 看涨 (UP): 预期温和上涨
    # =============================================================
    (TrendExpectation.UP, "low"): [
        (StrategyType.LONG_CALL, "return"),            # IV低→便宜买Call
        (StrategyType.BULL_CALL_SPREAD, "return"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),    # 低IV+温和看涨=对角价差适用
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),
        (StrategyType.CALENDAR_SPREAD, "winrate"),
    ],
    (TrendExpectation.UP, "mid"): [
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.BULL_CALL_SPREAD, "return"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),    # 中IV+温和看涨
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.UP, "high"): [
        (StrategyType.BULL_CALL_SPREAD, "return"),     # IV高→价差控制成本
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # IV高→卖方策略优先
        (StrategyType.IRON_CONDOR, "winrate"),
    ],

    # =============================================================
    # 微涨 (SLIGHT_UP): 预期小幅上涨，需要高胜率
    # =============================================================
    (TrendExpectation.SLIGHT_UP, "low"): [
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.LONG_CALL_BUTTERFLY, "return"),
        (StrategyType.BULL_CALL_SPREAD, "balanced"),
        (StrategyType.CALENDAR_SPREAD, "balanced"),    # 低IV+小幅→日历价差适用
        (StrategyType.BULL_PUT_SPREAD, "winrate"),
        (StrategyType.DIAGONAL_SPREAD, "winrate"),     # 低IV+小幅→对角价差适用
    ],
    (TrendExpectation.SLIGHT_UP, "mid"): [
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.LONG_CALL_BUTTERFLY, "return"),
        (StrategyType.BULL_CALL_SPREAD, "balanced"),
        (StrategyType.CALENDAR_SPREAD, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # Credit策略，小涨即盈利
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.SLIGHT_UP, "high"): [
        (StrategyType.BULL_CALL_SPREAD, "return"),
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.IRON_CONDOR, "balanced"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # 高IV→卖方为王
        (StrategyType.LONG_CALL_BUTTERFLY, "winrate"),
    ],

    # =============================================================
    # 震荡上涨 (VOLATILE_UP): 预期上涨但波动剧烈
    # 绝对不用: Calendar, Diagonal (这些是低波动策略!)
    # =============================================================
    (TrendExpectation.VOLATILE_UP, "low"): [
        (StrategyType.LONG_CALL, "return"),            # 方向性+受益于波动率上升
        (StrategyType.LONG_STRADDLE, "return"),        # 做多波动率+偏多
        (StrategyType.BULL_CALL_SPREAD, "balanced"),   # 方向性
        (StrategyType.LONG_STRANGLE, "balanced"),      # 做多波动率
        (StrategyType.BULL_PUT_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.VOLATILE_UP, "mid"): [
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.LONG_STRADDLE, "return"),
        (StrategyType.BULL_CALL_SPREAD, "balanced"),
        (StrategyType.LONG_STRANGLE, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.VOLATILE_UP, "high"): [
        (StrategyType.LONG_CALL, "return"),
        (StrategyType.LONG_STRADDLE, "return"),
        (StrategyType.BULL_CALL_SPREAD, "balanced"),   # IV高→限制成本
        (StrategyType.LONG_STRANGLE, "balanced"),
        (StrategyType.BULL_PUT_SPREAD, "winrate"),     # 利用高IV卖Put
        (StrategyType.IRON_CONDOR, "winrate"),
    ],

    # =============================================================
    # 中性 (NEUTRAL): 预期价格不动/窄幅震荡
    # 绝对不用: Long Straddle/Strangle
    # =============================================================
    (TrendExpectation.NEUTRAL, "low"): [
        (StrategyType.LONG_CALL_BUTTERFLY, "return"),  # 精确价位高回报
        (StrategyType.CALENDAR_SPREAD, "return"),      # 低IV+不动→时间衰减获利
        (StrategyType.IRON_BUTTERFLY, "balanced"),     # 精确不动
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_CONDOR, "winrate"),         # 范围内盈利
        (StrategyType.DIAGONAL_SPREAD, "winrate"),
    ],
    (TrendExpectation.NEUTRAL, "mid"): [
        (StrategyType.LONG_CALL_BUTTERFLY, "return"),
        (StrategyType.CALENDAR_SPREAD, "return"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_CONDOR, "winrate"),
        (StrategyType.DIAGONAL_SPREAD, "winrate"),
    ],
    (TrendExpectation.NEUTRAL, "high"): [
        (StrategyType.LONG_CALL_BUTTERFLY, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "return"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.IRON_CONDOR, "balanced"),
        (StrategyType.CALENDAR_SPREAD, "winrate"),     # 高IV→定义风险策略最佳
        (StrategyType.DIAGONAL_SPREAD, "winrate"),
    ],

    # =============================================================
    # 高波动 (HIGH_VOLATILE): 预期大幅波动，方向不确定
    # =============================================================
    (TrendExpectation.HIGH_VOLATILE, "low"): [
        (StrategyType.LONG_STRADDLE, "return"),        # 低IV买跨式=便宜
        (StrategyType.LONG_STRANGLE, "return"),        # 更便宜的做多波动率
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_CONDOR, "winrate"),
        (StrategyType.IRON_BUTTERFLY, "winrate"),
    ],
    (TrendExpectation.HIGH_VOLATILE, "mid"): [
        (StrategyType.LONG_STRADDLE, "return"),
        (StrategyType.LONG_STRANGLE, "return"),
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_CONDOR, "winrate"),
        (StrategyType.IRON_BUTTERFLY, "winrate"),
    ],
    (TrendExpectation.HIGH_VOLATILE, "high"): [
        (StrategyType.LONG_STRANGLE, "return"),        # 高IV但仍需做多vol
        (StrategyType.LONG_STRADDLE, "return"),
        (StrategyType.LONG_CALL_BUTTERFLY, "balanced"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_CONDOR, "winrate"),         # 对冲：如果vol不如预期
        (StrategyType.IRON_BUTTERFLY, "winrate"),
    ],

    # =============================================================
    # 强烈看跌 (STRONG_DOWN): 预期大幅下跌
    # =============================================================
    (TrendExpectation.STRONG_DOWN, "low"): [
        (StrategyType.LONG_PUT, "return"),             # IV低→买Put便宜
        (StrategyType.BEAR_PUT_SPREAD, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.STRONG_DOWN, "mid"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.STRONG_DOWN, "high"): [
        (StrategyType.BEAR_PUT_SPREAD, "return"),      # IV高→价差控制成本
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),    # 高IV→卖方策略
        (StrategyType.IRON_CONDOR, "winrate"),
    ],

    # =============================================================
    # 看跌 (DOWN): 预期温和下跌
    # =============================================================
    (TrendExpectation.DOWN, "low"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.DOWN, "mid"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.DIAGONAL_SPREAD, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.DOWN, "high"): [
        (StrategyType.BEAR_PUT_SPREAD, "return"),
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "balanced"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],

    # =============================================================
    # 微跌 (SLIGHT_DOWN): 预期小幅下跌
    # =============================================================
    (TrendExpectation.SLIGHT_DOWN, "low"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "balanced"),
        (StrategyType.CALENDAR_SPREAD, "balanced"),    # 低IV+小幅→日历适用
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.SLIGHT_DOWN, "mid"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.LONG_PUT_BUTTERFLY, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "balanced"),
        (StrategyType.IRON_CONDOR, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_BUTTERFLY, "winrate"),
    ],
    (TrendExpectation.SLIGHT_DOWN, "high"): [
        (StrategyType.BEAR_PUT_SPREAD, "return"),
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.IRON_CONDOR, "balanced"),
        (StrategyType.IRON_BUTTERFLY, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.LONG_PUT_BUTTERFLY, "winrate"),
    ],

    # =============================================================
    # 震荡下跌 (VOLATILE_DOWN): 预期下跌但波动剧烈
    # 绝对不用: Calendar, Diagonal
    # =============================================================
    (TrendExpectation.VOLATILE_DOWN, "low"): [
        (StrategyType.LONG_PUT, "return"),             # 方向性+受益于vol上升
        (StrategyType.LONG_STRADDLE, "return"),        # 做多波动率+偏空
        (StrategyType.BEAR_PUT_SPREAD, "balanced"),
        (StrategyType.LONG_STRANGLE, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.VOLATILE_DOWN, "mid"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.LONG_STRADDLE, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "balanced"),
        (StrategyType.LONG_STRANGLE, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
    (TrendExpectation.VOLATILE_DOWN, "high"): [
        (StrategyType.LONG_PUT, "return"),
        (StrategyType.LONG_STRADDLE, "return"),
        (StrategyType.BEAR_PUT_SPREAD, "balanced"),
        (StrategyType.LONG_STRANGLE, "balanced"),
        (StrategyType.BEAR_CALL_SPREAD, "winrate"),    # 高IV→卖方获利
        (StrategyType.IRON_CONDOR, "winrate"),
    ],
}


# ============================================================
# 策略选择器主类
# ============================================================

class StrategySelector:
    """
    根据用户输入 + 市场环境，智能推荐 3-4 个最优策略
    """

    def __init__(
        self,
        calls_df: pd.DataFrame,
        puts_df: pd.DataFrame,
        spot: float,
        iv_current: float,
        iv_rank: float,
        dte: int,
        expiration: str,
        far_calls_df: Optional[pd.DataFrame] = None,
        far_puts_df: Optional[pd.DataFrame] = None,
    ):
        self.calls = calls_df
        self.puts = puts_df
        self.spot = spot
        self.iv_current = iv_current
        self.iv_rank = iv_rank
        self.dte = dte
        self.expiration = expiration
        self.far_calls = far_calls_df
        self.far_puts = far_puts_df
        self.builder = StrategyBuilder()

    def recommend(
        self,
        trend: TrendExpectation,
        preference_weight: float = 0.5,
        target_price: Optional[float] = None,
        max_strategies: int = 4,
        target_price_upper: Optional[float] = None,
        target_price_lower: Optional[float] = None,
    ) -> list[Strategy]:
        """
        推荐策略

        参数:
            trend: 趋势预期
            preference_weight: 0=最大化回报, 1=最大化胜率
            target_price: 用户目标价
            max_strategies: 最多返回几个策略
            target_price_upper: 区间上限价格 (区间模式)
            target_price_lower: 区间下限价格 (区间模式)

        返回: Strategy 对象列表
        """
        iv_env = _iv_level(self.iv_rank)

        # 区间模式：根据区间宽度选择候选策略
        is_range_mode = target_price_upper is not None and target_price_lower is not None
        if is_range_mode:
            range_pct = (target_price_upper - target_price_lower) / self.spot
            if range_pct < 0.10:
                # 窄区间 → 使用 NEUTRAL 候选
                override_trend = TrendExpectation.NEUTRAL
            else:
                # 宽区间 → 使用 HIGH_VOLATILE 候选
                override_trend = TrendExpectation.HIGH_VOLATILE
            # 目标价使用区间中点
            target_price = (target_price_upper + target_price_lower) / 2
            key = (override_trend, iv_env)
        else:
            # 1. 从推荐矩阵中获取候选策略池
            key = (trend, iv_env)

        candidates = RECOMMENDATION_MATRIX.get(key)
        if not candidates:
            # Fallback: 尝试 "mid" IV
            key = (key[0], "mid")
            candidates = RECOMMENDATION_MATRIX.get(key, [])

        if not candidates:
            return []

        # 2. 根据偏好权重调整优先级
        scored = []
        for strategy_type, bias in candidates:
            score = self._preference_score(bias, preference_weight)
            scored.append((strategy_type, score))

        # 排序：分数高的优先
        scored.sort(key=lambda x: x[1], reverse=True)

        # 3. 构建每个策略，过滤掉构建失败的 + 风险管理过滤
        # 风险控制：最大亏损不超过 spot × 100 的 50% (即半手股票价值)
        max_acceptable_loss = -self.spot * PayoffEngine.CONTRACT_MULTIPLIER * 0.5

        results = []
        for strategy_type, _ in scored:
            strategy = self._build_strategy(
                strategy_type, target_price, trend,
                target_price_upper=target_price_upper if is_range_mode else None,
                target_price_lower=target_price_lower if is_range_mode else None,
            )
            if strategy:
                # 风险管理过滤：拒绝亏损过大的策略
                if strategy.max_loss < max_acceptable_loss:
                    continue  # 跳过风险过大的策略
                results.append(strategy)
            if len(results) >= max_strategies:
                break

        return results

    @staticmethod
    def _preference_score(bias: str, weight: float) -> float:
        """
        根据策略偏向和用户偏好权重计算优先级分数
        weight: 0=高回报, 1=高胜率
        """
        if bias == "return":
            return 10 * (1 - weight)  # 偏好高回报时分数高
        elif bias == "winrate":
            return 10 * weight  # 偏好高胜率时分数高
        else:  # balanced
            return 5  # 平衡型始终中等分数

    def _build_strategy(
        self,
        strategy_type: StrategyType,
        target_price: Optional[float] = None,
        trend: Optional[TrendExpectation] = None,
        target_price_upper: Optional[float] = None,
        target_price_lower: Optional[float] = None,
    ) -> Optional[Strategy]:
        """
        构建一个完整的 Strategy 对象
        """
        legs = self._build_legs(
            strategy_type, target_price, trend,
            target_price_upper=target_price_upper,
            target_price_lower=target_price_lower,
        )
        if not legs:
            return None

        # 计算盈亏数据
        engine = PayoffEngine
        payoff_df = engine.calc_strategy_payoff(self.spot, legs)
        max_profit = engine.calc_max_profit(legs, self.spot)
        max_loss = engine.calc_max_loss(legs, self.spot)
        breakevens = engine.calc_breakevens(legs, self.spot)
        net_dc = engine.calc_net_debit_credit(legs)
        required_cap = engine.calc_required_capital(legs, self.spot)
        win_prob = engine.estimate_win_probability(legs, self.spot, self.iv_current, self.dte)

        # 最大收益率
        max_profit_pct = (max_profit / required_cap * 100) if required_cap > 0 else 0

        # 转换 Leg 为 Pydantic 模型
        meta = STRATEGY_META.get(strategy_type, {})
        option_legs = []
        for leg in legs:
            option_legs.append(OptionLeg(
                action=ActionType(leg.action),
                option_type=OptionType(leg.option_type),
                strike=leg.strike,
                expiration=self.expiration,
                premium=leg.premium,
                quantity=leg.quantity,
                description=format_leg_description(leg, self.expiration),
            ))

        # 转换 Payoff 数据
        payoff_data = [
            PayoffPoint(price=row["price"], pnl=row["pnl"])
            for _, row in payoff_df.iterrows()
        ]

        return Strategy(
            strategy_type=strategy_type,
            name=meta.get("name", strategy_type.value),
            name_en=meta.get("name_en", strategy_type.value),
            tag=meta.get("tag", "平衡型"),
            legs=option_legs,
            net_debit_credit=net_dc,
            max_profit=round(max_profit, 2),
            max_profit_pct=round(max_profit_pct, 1),
            max_loss=round(max_loss, 2),
            breakevens=breakevens,
            win_probability=win_prob,
            required_capital=round(required_cap, 2),
            payoff_data=payoff_data,
        )

    def _build_legs(
        self,
        strategy_type: StrategyType,
        target_price: Optional[float] = None,
        trend: Optional[TrendExpectation] = None,
        target_price_upper: Optional[float] = None,
        target_price_lower: Optional[float] = None,
    ) -> list[Leg]:
        """根据策略类型调用对应的构建器"""
        b = self.builder
        calls = self.calls
        puts = self.puts
        spot = self.spot

        # 价差宽度根据 DTE 和 IV 动态调整 (收窄以控制风险)
        base_width = 0.06 if self.dte > 30 else 0.04

        try:
            match strategy_type:
                # 单腿
                case StrategyType.LONG_CALL:
                    return b.build_long_call(calls, spot, target_price)
                case StrategyType.LONG_PUT:
                    return b.build_long_put(puts, spot, target_price)
                case StrategyType.SHORT_CALL:
                    return b.build_short_call(calls, spot)
                case StrategyType.SHORT_PUT:
                    return b.build_short_put(puts, spot)

                # 垂直价差
                case StrategyType.BULL_CALL_SPREAD:
                    return b.build_bull_call_spread(calls, spot, target_price, base_width)
                case StrategyType.BEAR_CALL_SPREAD:
                    return b.build_bear_call_spread(calls, spot, base_width)
                case StrategyType.BULL_PUT_SPREAD:
                    return b.build_bull_put_spread(puts, spot, base_width)
                case StrategyType.BEAR_PUT_SPREAD:
                    return b.build_bear_put_spread(puts, spot, target_price, base_width)

                # 跨式/宽跨式
                case StrategyType.LONG_STRADDLE:
                    return b.build_long_straddle(calls, puts, spot)
                case StrategyType.SHORT_STRADDLE:
                    return b.build_short_straddle(calls, puts, spot)
                case StrategyType.LONG_STRANGLE:
                    return b.build_long_strangle(calls, puts, spot, base_width)
                case StrategyType.SHORT_STRANGLE:
                    return b.build_short_strangle(calls, puts, spot, base_width)

                # 铁鹰/蝶式
                case StrategyType.IRON_CONDOR:
                    if target_price_lower and target_price_upper:
                        # Range mode: place short strikes at range boundaries
                        range_width = (target_price_upper - target_price_lower) / spot
                        return b.build_iron_condor(calls, puts, spot, range_width / 2)
                    return b.build_iron_condor(calls, puts, spot, base_width)
                case StrategyType.IRON_BUTTERFLY:
                    if target_price_lower and target_price_upper:
                        # Range mode: use midpoint as center
                        midpoint = (target_price_upper + target_price_lower) / 2
                        mid_width = (target_price_upper - target_price_lower) / spot / 2
                        return b.build_iron_butterfly(calls, puts, midpoint, mid_width)
                    return b.build_iron_butterfly(calls, puts, spot, base_width)
                case StrategyType.LONG_CALL_BUTTERFLY:
                    if target_price_lower and target_price_upper:
                        midpoint = (target_price_upper + target_price_lower) / 2
                        mid_width = (target_price_upper - target_price_lower) / spot / 2
                        return b.build_long_call_butterfly(calls, midpoint, midpoint, mid_width)
                    return b.build_long_call_butterfly(calls, spot, target_price, base_width)
                case StrategyType.LONG_PUT_BUTTERFLY:
                    if target_price_lower and target_price_upper:
                        midpoint = (target_price_upper + target_price_lower) / 2
                        mid_width = (target_price_upper - target_price_lower) / spot / 2
                        return b.build_long_put_butterfly(puts, midpoint, midpoint, mid_width)
                    return b.build_long_put_butterfly(puts, spot, target_price, base_width)

                # 日历/对角 (需要远月数据)
                case StrategyType.CALENDAR_SPREAD:
                    if self.far_calls is not None and not self.far_calls.empty:
                        return b.build_calendar_spread(calls, self.far_calls, spot)
                    return []
                case StrategyType.DIAGONAL_SPREAD:
                    if self.far_calls is not None and not self.far_calls.empty:
                        # 根据用户趋势判断对角价差方向
                        direction = self._infer_direction(trend)
                        return b.build_diagonal_spread(calls, self.far_calls, spot, direction)
                    return []

                # 比率价差
                case StrategyType.CALL_RATIO_SPREAD:
                    return b.build_call_ratio_spread(calls, spot)
                case StrategyType.PUT_RATIO_SPREAD:
                    return b.build_put_ratio_spread(puts, spot)

                case _:
                    return []
        except Exception:
            return []

    @staticmethod
    def _infer_direction(trend: Optional[TrendExpectation]) -> str:
        """从趋势预期推断方向"""
        if trend is None:
            return "bullish"
        bullish_trends = {
            TrendExpectation.STRONG_UP,
            TrendExpectation.UP,
            TrendExpectation.SLIGHT_UP,
            TrendExpectation.VOLATILE_UP,
        }
        bearish_trends = {
            TrendExpectation.STRONG_DOWN,
            TrendExpectation.DOWN,
            TrendExpectation.SLIGHT_DOWN,
            TrendExpectation.VOLATILE_DOWN,
        }
        if trend in bullish_trends:
            return "bullish"
        elif trend in bearish_trends:
            return "bearish"
        return "neutral"  # neutral/high_volatile → no directional bias
