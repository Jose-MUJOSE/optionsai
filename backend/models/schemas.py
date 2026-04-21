"""
OptionsAI - Pydantic 数据模型
定义所有 API 请求/响应的数据结构
"""
from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ============================================================
# 枚举类型
# ============================================================

class TrendExpectation(str, Enum):
    """用户趋势预期 - 对应前端 10 个趋势按钮"""
    SLIGHT_UP = "slight_up"           # 轻微上涨
    UP = "up"                         # 上涨
    STRONG_UP = "strong_up"           # 强烈上涨
    VOLATILE_UP = "volatile_up"       # 震荡上涨
    NEUTRAL = "neutral"               # 中性
    HIGH_VOLATILE = "high_volatile"   # 剧烈震荡
    SLIGHT_DOWN = "slight_down"       # 轻微下跌
    DOWN = "down"                     # 下跌
    STRONG_DOWN = "strong_down"       # 强烈下跌
    VOLATILE_DOWN = "volatile_down"   # 震荡下跌


class OptionType(str, Enum):
    CALL = "CALL"
    PUT = "PUT"


class ActionType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class StrategyType(str, Enum):
    """支持的 20 种期权策略"""
    # 单腿策略
    LONG_CALL = "long_call"
    LONG_PUT = "long_put"
    SHORT_CALL = "short_call"
    SHORT_PUT = "short_put"
    # 垂直价差
    BULL_CALL_SPREAD = "bull_call_spread"
    BEAR_CALL_SPREAD = "bear_call_spread"
    BULL_PUT_SPREAD = "bull_put_spread"
    BEAR_PUT_SPREAD = "bear_put_spread"
    # 跨式/宽跨式
    LONG_STRADDLE = "long_straddle"
    SHORT_STRADDLE = "short_straddle"
    LONG_STRANGLE = "long_strangle"
    SHORT_STRANGLE = "short_strangle"
    # 铁鹰/蝶式
    IRON_CONDOR = "iron_condor"
    IRON_BUTTERFLY = "iron_butterfly"
    LONG_CALL_BUTTERFLY = "long_call_butterfly"
    LONG_PUT_BUTTERFLY = "long_put_butterfly"
    # 日历/对角
    CALENDAR_SPREAD = "calendar_spread"
    DIAGONAL_SPREAD = "diagonal_spread"
    # 比率价差
    CALL_RATIO_SPREAD = "call_ratio_spread"
    PUT_RATIO_SPREAD = "put_ratio_spread"


# ============================================================
# 市场数据模型
# ============================================================

class MarketData(BaseModel):
    """市场行情 + 环境感知数据"""
    ticker: str
    spot_price: float = Field(description="当前股价")
    change_pct: float = Field(description="当日涨跌幅 %")
    iv_current: float = Field(description="当前 ATM 隐含波动率 % (来自实时期权链)")
    iv_rank: float = Field(description="IV Rank (0-100). 真实来源由 iv_rank_source 声明")
    iv_percentile: float = Field(description="IV Percentile (0-100). 真实来源由 iv_rank_source 声明")
    hv_30: float = Field(description="30 天已实现历史波动率 % (来自真实价格)")
    hv_rank: float = Field(
        default=50.0,
        description="HV Rank (0-100). 100% 真实: 当前 HV(30) 在过去 1 年滚动 HV 序列中的位置",
    )
    hv_percentile: float = Field(
        default=50.0,
        description="HV Percentile (0-100). 100% 真实: 过去 1 年中低于当前 HV(30) 的交易日占比",
    )
    iv_rank_source: str = Field(
        default="insufficient_data",
        description=(
            "IV Rank 数据来源: "
            "'historical_iv' = 基于 \u2265 30 天真实存储的 IV 快照; "
            "'hv_proxy' = 使用 HV Rank 作为代理 (IV 历史积累中); "
            "'insufficient_data' = 数据暂不可用"
        ),
    )
    iv_history_days: int = Field(
        default=0,
        description="本地已缓存的该 ticker 每日 IV 快照天数",
    )
    next_earnings_date: Optional[str] = Field(None, description="下一次财报日期")
    expirations: list[str] = Field(description="所有可用到期日列表 (YYYY-MM-DD)")
    as_of: Optional[str] = Field(
        default=None,
        description="数据抓取时间戳 (ISO 8601, UTC)",
    )


class OptionContract(BaseModel):
    """单个期权合约"""
    strike: float
    last_price: float
    bid: float
    ask: float
    mid_price: float = Field(description="(Bid+Ask)/2")
    implied_volatility: float = Field(description="隐含波动率")
    volume: int
    open_interest: int
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    option_type: OptionType
    win_probability: Optional[float] = None  # N(d2) for call, N(-d2) for put
    breakeven: Optional[float] = None  # strike + mid_price for call, strike - mid_price for put


class OptionsChain(BaseModel):
    """完整期权链"""
    ticker: str
    expiration: str
    dte: int = Field(description="距到期天数")
    calls: list[OptionContract]
    puts: list[OptionContract]


# ============================================================
# 策略模型
# ============================================================

class OptionLeg(BaseModel):
    """策略中的单条腿"""
    action: ActionType        # BUY / SELL
    option_type: OptionType   # CALL / PUT
    strike: float
    expiration: str
    premium: float = Field(description="权利金 (Mid Price)")
    quantity: int = Field(default=1)
    description: str = Field(description="人类可读描述，如 '买入 1手 5月1日 $52.5 Call @ $3.80'")


class PayoffPoint(BaseModel):
    """盈亏图上的一个点"""
    price: float = Field(description="标的到期价格 S_T")
    pnl: float = Field(description="该价位的盈亏金额 $")


class Strategy(BaseModel):
    """完整策略结果"""
    strategy_type: StrategyType
    name: str = Field(description="策略中文名称")
    name_en: str = Field(description="策略英文名称")
    tag: str = Field(description="风格标签: 高杠杆/平衡型/高胜率/收租型")
    legs: list[OptionLeg]
    net_debit_credit: float = Field(description="净支出(正)或净收入(负)")
    max_profit: float = Field(description="最大收益 $")
    max_profit_pct: float = Field(description="最大收益率 %")
    max_loss: float = Field(description="最大亏损 $ (负数)")
    breakevens: list[float] = Field(description="盈亏平衡点价格列表")
    win_probability: float = Field(description="估算胜率 0-100%")
    required_capital: float = Field(description="所需资金 $")
    payoff_data: list[PayoffPoint] = Field(description="P&L 图表坐标数组")


# ============================================================
# API 请求/响应模型
# ============================================================

class StrategyRequest(BaseModel):
    """POST /api/strategies 请求体"""
    ticker: str
    trend: TrendExpectation
    target_price: Optional[float] = Field(None, description="目标股价 $")
    target_pct: Optional[float] = Field(None, description="目标涨跌幅 %")
    expiration: str = Field(description="选定的到期日 YYYY-MM-DD")
    preference_weight: float = Field(
        default=0.5,
        ge=0.0, le=1.0,
        description="偏好权重: 0=最大化回报, 1=最大化胜率"
    )
    target_price_upper: Optional[float] = Field(None, description="区间上限价格")
    target_price_lower: Optional[float] = Field(None, description="区间下限价格")
    budget: Optional[float] = Field(None, description="交易预算 $")
    max_loss: Optional[float] = Field(None, description="最大可接受亏损")
    max_loss_type: Optional[str] = Field("dollar", description="dollar 或 percent")


class StrategyResponse(BaseModel):
    """POST /api/strategies 响应体"""
    ticker: str
    spot_price: float
    iv_current: float
    iv_rank: float
    expiration: str
    strategies: list[Strategy]


class ChatMessage(BaseModel):
    """单条聊天消息

    images: optional list of data-URL encoded images (e.g. "data:image/png;base64,...").
    当用户附带图片时，后端会构造 OpenAI-兼容的 multimodal content block 传给 LLM。
    若当前配置的 LLM 不支持视觉，后端会返回明确的错误提示，而不会伪造分析结果。
    """
    role: str = Field(description="user / assistant / system")
    content: str
    images: Optional[list[str]] = Field(
        default=None,
        description="可选的图片数据 URL 列表（base64 编码），仅最后一条 user 消息会被转发到视觉模型。"
    )


class ChatContext(BaseModel):
    """AI 聊天的上下文注入"""
    ticker: str
    market_data: Optional[MarketData] = None
    selected_strategy: Optional[Strategy] = None
    user_trend: Optional[str] = None
    target_price: Optional[float] = None


class ChatRequest(BaseModel):
    """POST /api/chat 请求体"""
    messages: list[ChatMessage]
    context: Optional[ChatContext] = None


class ChatResponse(BaseModel):
    """POST /api/chat 响应体 (非流式)"""
    reply: str
    usage: Optional[dict] = None
