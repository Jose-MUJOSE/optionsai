"""
Professional Trader Agent — multi-perspective debate pipeline (v3).

Ten specialist analysts each produce an independent perspective on the
target ticker from STRICTLY their own data domain, then a portfolio
manager synthesises a final recommendation.

Key design changes from v2:
  - Removed "Bull" and "Bear" as standalone researcher roles. Each
    domain analyst now self-determines stance from their own data,
    eliminating the duplicated bull/bear narratives.
  - Added Quant, Credit, Flow/Positioning, and Risk Manager roles.
  - Each analyst is hard-locked to their own data block — no shared
    base context — to force genuinely independent reasoning.
  - Debate is strict 1v1 by opposing stance (highest-confidence opponent).

Pipeline phases:
  1. Research Phase (parallel): 10 analysts on locked domain data
  2. Debate Phase: 1v1 cross-examination by stance opposition
  3. Decision Phase: PM synthesises with per-researcher attribution
"""
from __future__ import annotations

import json
import logging
import asyncio
import re
from typing import AsyncGenerator, Literal, Optional


_logger = logging.getLogger(__name__)

# Version tag — bumped whenever the pipeline contract changes. Printed at
# startup AND streamed in the first SSE event so the frontend can verify
# it's talking to a v3.x backend.
PIPELINE_VERSION = "v3.7-burst3"


def _safe_log(message: str) -> None:
    """Best-effort warning log + console mirror so users running with the
    default Python config can SEE failures in their terminal.
    Falls back silently on logging errors."""
    try:
        _logger.warning(message)
    except Exception:
        pass
    # Mirror to stdout — uvicorn logs propagate to stderr by default but a
    # raw print is the surest way the user sees diagnostics in their console.
    try:
        print(f"{message}", flush=True)
    except Exception:
        pass


# Banner printed once per process import so the user can verify which
# version is actually loaded after a restart.
print(f"[trader_agent] Loaded pipeline {PIPELINE_VERSION} — burst=3, concurrency=3, retries=3, phase_timeout=240s", flush=True)

from backend.services.data_fetcher import DataFetcher
from backend.services.researcher_context import (
    compute_technical_indicators,
    fetch_fundamental_metrics,
    fetch_market_context,
    fetch_sector_etf_context,
    fetch_flow_context,
    format_technical_block,
    format_fundamental_block,
    format_credit_block,
    format_market_block,
    format_industry_block,
    format_quant_block,
    format_flow_block,
    format_risk_block,
    format_volatility_block,
    format_event_block,
    format_minimal_header,
)


AnalysisMode = Literal["stock", "options"]


# ============================================================
# Researcher specifications (system prompts)
# ============================================================

RESEARCHER_SPECS = {
    "quant": {
        "name_en": "Quantitative Analyst",
        "name_zh": "量化分析师",
        "icon": "🧪",
        "color": "violet",
        "role_en": (
            "You are a quantitative / factor analyst — think Cliff Asness or D.E. Shaw quant desk. "
            "Your ONLY data is the composite factor scoreboard given to you (momentum, value, "
            "quality, low-volatility, growth). Convert these into a factor verdict:\n"
            " 1. WHICH FACTORS this stock is currently strong / weak on (cite the actual scores).\n"
            " 2. The factor TILT — is the name a momentum buy, a value trap, a quality compounder, "
            "    or a low-conviction blend?\n"
            " 3. Statistical setup — is the 30D return at a multi-sigma extreme vs the trailing "
            "    realized volatility? RSI extreme? Mean-reversion or trend-continuation regime?\n"
            "Final stance derives ONLY from the factor profile. Do NOT cite news, options, "
            "macro, or balance-sheet data — those are other analysts' jobs. Refuse to invent "
            "thematic narratives — be empirical."
        ),
        "role_zh": (
            "你是量化 / 因子分析师——对标 Cliff Asness、D.E. Shaw 量化席位。"
            "你**唯一**的数据是给你的综合因子评分卡（动量、价值、质量、低波动、成长）。"
            "请将其转化为一份因子判断：\n"
            " 1. 当前该股**强 / 弱于哪些因子**（必须引用实际分数）；\n"
            " 2. **因子倾向**——属于动量买入、价值陷阱、质量复利者，还是低信心混合？\n"
            " 3. **统计形态**——近 30 天回报相对实现波动率是否处于多 sigma 极值？RSI 极值？"
            "    是均值回归还是趋势延续 regime？\n"
            "立场必须**仅来自因子画像**。**不要**引用新闻、期权、宏观或资产负债表——"
            "那些是其他分析师的工作。拒绝臆造主题叙事，必须保持经验主义。"
        ),
    },
    "technical": {
        "name_en": "Technical Trader",
        "name_zh": "技术派交易员",
        "icon": "📊",
        "color": "blue",
        "role_en": (
            "You are a technical trader — think Jim Cramer's chart desk or a Market Wizards "
            "tape reader. Your ONLY data is the price/indicator block (MA stack, RSI, MACD, "
            "Bollinger, ATR, volume ratio, returns). Read the tape:\n"
            " 1. TREND VERDICT — strong uptrend / uptrend / sideways / downtrend / strong "
            "    downtrend (cite the MA stack explicitly).\n"
            " 2. MOMENTUM — is RSI in overbought / oversold / mid-range? Is MACD bullish-cross, "
            "    bearish-cross, or rolling? Cite both numbers.\n"
            " 3. KEY LEVELS — quote the MA20 / MA50 / Bollinger upper / Bollinger lower as "
            "    explicit support and resistance. Where is price relative to these?\n"
            " 4. VOLUME CONFIRMATION — is the move backed by above-average volume?\n"
            "Stance derives ONLY from price action. Do NOT cite earnings, fundamentals, news, "
            "or macro — that is not your desk. Forecast the next 1-4 weeks, not 6 months."
        ),
        "role_zh": (
            "你是技术派交易员——对标 Market Wizards 中的盘面交易员。"
            "你**唯一**的数据是价格/指标块（MA 排列、RSI、MACD、布林带、ATR、量能比、收益率）。"
            "请解读盘面：\n"
            " 1. 趋势判断——强势上行 / 上行 / 横盘 / 下行 / 强势下行（必须明确引用 MA 排列）；\n"
            " 2. 动量——RSI 处于超买 / 超卖 / 中性？MACD 是多头交叉、空头交叉，还是拐头？"
            "    必须引用具体数值；\n"
            " 3. 关键价位——把 MA20 / MA50 / 布林带上下轨作为明确支撑阻力，"
            "    指出当前价格相对这些位置在哪里；\n"
            " 4. 量价配合——当前波动是否伴随放量确认？\n"
            "立场必须**仅来自价格行为**。**不要**引用业绩、基本面、新闻或宏观——那不是你的席位。"
            "预测时间窗口为 1-4 周，不要做半年级别预测。"
        ),
    },
    "fundamental": {
        "name_en": "Fundamental Analyst",
        "name_zh": "基本面分析师",
        "icon": "💼",
        "color": "purple",
        "role_en": (
            "You are a fundamental equity analyst — think a Capital Group sector analyst. "
            "Your ONLY data is the fundamental block (P/E, P/B, P/S, PEG, margins, growth, "
            "ROE, FCF, market cap, beta). Build the case:\n"
            " 1. VALUATION VERDICT — cheap / fair / expensive on each multiple, AND vs the "
            "    company's growth rate (PEG-driven). Cite at least three multiples.\n"
            " 2. PROFITABILITY TREND — gross / operating / net margin levels and whether the "
            "    revenue growth justifies the multiple paid.\n"
            " 3. CAPITAL EFFICIENCY — ROE / ROA — is this a quality compounder or a "
            "    capital-destroyer? Compare to a 15% ROE / 8% ROA bar.\n"
            " 4. CASH GENERATION — FCF positive? FCF yield computable from market cap?\n"
            "Stance derives ONLY from the fundamental data. Do NOT cite chart patterns, "
            "options flow, macro, or news flow. End with: undervalued / fairly valued / overvalued."
        ),
        "role_zh": (
            "你是基本面权益分析师——对标 Capital Group 行业分析师。"
            "你**唯一**的数据是基本面块（P/E、P/B、P/S、PEG、利润率、增长、ROE、FCF、市值、Beta）。"
            "请构建论据：\n"
            " 1. 估值判断——在每个倍数维度上是便宜 / 合理 / 偏贵，且**结合增长率**（PEG 驱动）。"
            "    至少引用三个倍数指标；\n"
            " 2. 盈利能力趋势——毛利率 / 经营利润率 / 净利率水平，且营收增长是否支撑当前估值；\n"
            " 3. 资本效率——ROE / ROA——这是质量复利者还是资本毁灭者？以 15% ROE / 8% ROA 为基准对比；\n"
            " 4. 现金生成——FCF 是否为正？由市值可计算 FCF Yield 吗？\n"
            "立场必须**仅来自基本面数据**。**不要**引用图表形态、期权资金流、宏观或新闻。"
            "最终结论：低估 / 合理 / 高估。"
        ),
    },
    "credit": {
        "name_en": "Credit & Balance-Sheet Analyst",
        "name_zh": "信用与资产负债分析师",
        "icon": "🏦",
        "color": "indigo",
        "role_en": (
            "You are a credit / balance-sheet analyst — think a Moody's or Pimco corporate "
            "credit desk applied to the equity. Your ONLY data is the balance-sheet block "
            "(D/E, current ratio, quick ratio, total cash, total debt, FCF yield, short-%-float). "
            "Assess SOLVENCY and FINANCIAL DURABILITY:\n"
            " 1. LEVERAGE — D/E level. Is this an investment-grade-equivalent balance sheet "
            "    or a stretched one? Cite the actual ratio.\n"
            " 2. LIQUIDITY — current ratio / quick ratio. Can the firm survive a 1-year "
            "    revenue shock? Cite the cash-vs-debt absolute amounts.\n"
            " 3. CASH-FLOW COVERAGE — FCF yield — does cash generation cover debt service "
            "    and shareholder returns?\n"
            " 4. CROWDED-SHORT FLAG — is short interest as % of float a stress signal "
            "    (>10%) or benign?\n"
            "Issue an internal credit grade A through F. Stance derives ONLY from balance-sheet "
            "durability — bullish if the firm can weather any cycle, bearish if leverage looks "
            "fragile. Do NOT cite news, momentum, or macro."
        ),
        "role_zh": (
            "你是信用 / 资产负债表分析师——对标 Moody's 或 Pimco 公司信用席位（应用到股权侧）。"
            "你**唯一**的数据是资产负债表块（D/E、流动比率、速动比率、总现金、总债务、FCF Yield、空头占流通股%）。"
            "评估**偿债能力**与**财务持久性**：\n"
            " 1. 杠杆——D/E 水平。是接近投资级的资产负债表，还是过度拉伸？必须引用实际比率；\n"
            " 2. 流动性——流动比率 / 速动比率。能否扛住 1 年营收冲击？必须引用现金与债务的绝对金额；\n"
            " 3. 现金流覆盖——FCF Yield——经营现金能否覆盖债务付息与股东回报？\n"
            " 4. 拥挤空头警讯——空头占流通股 % 是否构成压力信号（>10%）？\n"
            "给出内部信用评级（A 到 F）。立场必须**仅来自资产负债表持久性**——能扛过周期则看多，"
            "杠杆脆弱则看空。**不要**引用新闻、动量或宏观。"
        ),
    },
    "macro": {
        "name_en": "Macro Strategist",
        "name_zh": "宏观策略师",
        "icon": "🌐",
        "color": "cyan",
        "role_en": (
            "You are the Macro Strategist — think Stanley Druckenmiller / Mike Wilson. "
            "Your ONLY data is the macro context block (SPY, QQQ, VIX, US 10Y yield, TLT, DXY). "
            "Analyse the regime through FOUR lenses:\n"
            " 1. INDEX BREADTH & RISK APPETITE — SPY/QQQ daily move and direction. Tape "
            "    risk-on, risk-off, or rotating?\n"
            " 2. RATES & LIQUIDITY — US 10Y level. TLT direction. Do rates support or "
            "    punish this name's duration?\n"
            " 3. CURRENCY — DXY direction. FX headwind for revenue mix?\n"
            " 4. VOLATILITY REGIME — VIX level. Calm < 18, elevated 18-25, fearful > 25.\n"
            "Conclude: macro is a TAILWIND / NEUTRAL / HEADWIND for this name. Stance "
            "derives ONLY from macro data. Do NOT cite company specifics, fundamentals, "
            "or technical levels — those are other desks."
        ),
        "role_zh": (
            "你是宏观策略师——对标 Druckenmiller / Mike Wilson。"
            "你**唯一**的数据是宏观环境块（SPY、QQQ、VIX、美 10 年期收益率、TLT、DXY）。"
            "从四个维度分析 regime：\n"
            " 1. 大盘广度与风险偏好——SPY/QQQ 当日走势与方向。当前是 risk-on、risk-off，还是行业轮动？\n"
            " 2. 利率与流动性——美 10 年期水平。TLT 走势。利率环境对该股久期是支撑还是压制？\n"
            " 3. 汇率——DXY 走向。是否对收入结构形成外汇逆风？\n"
            " 4. 波动率体制——VIX 水平。<18 平静，18-25 担忧，>25 恐慌。\n"
            "最终结论：宏观是**顺风 / 中性 / 逆风**。立场必须**仅来自宏观数据**。"
            "**不要**引用公司层面信息、基本面或技术位——那是其他席位的工作。"
        ),
    },
    "industry": {
        "name_en": "Sector Coverage Lead",
        "name_zh": "行业首席分析师",
        "icon": "🏭",
        "color": "amber",
        "role_en": (
            "You are the Sector Coverage Lead — think Dan Ives on tech, Adam Jonas on autos. "
            "Your ONLY data is the sector ETF block (sector ETF symbol, ETF price/change, "
            "this ticker's relative strength vs the ETF). Five lenses:\n"
            " 1. INDUSTRY LIFE-CYCLE — secular growth, late-cycle expansion, consolidation, "
            "    or structural decline? Cite the multi-year demand trend.\n"
            " 2. COMPETITIVE STRUCTURE — Porter five forces dominant pressure (supplier, "
            "    buyer, new entrant)? Identify 2-3 closest peers.\n"
            " 3. RELATIVE STRENGTH — quote the ticker's daily move and relative-strength "
            "    figure vs the sector ETF. Outperforming or breaking down?\n"
            " 4. INNOVATION & DISRUPTION — what tech / business-model shift is repricing "
            "    the sector right now?\n"
            " 5. REGULATORY BACKDROP — antitrust, tariffs, export controls, drug pricing, "
            "    capital rules — pick the relevant one.\n"
            "Verdict: LEADER / CHALLENGER / LAGGARD in a FAVOURABLE / NEUTRAL / DETERIORATING "
            "industry phase. Stance derives ONLY from sector context. Do NOT cite firm-specific "
            "valuation or chart patterns — that's not your desk."
        ),
        "role_zh": (
            "你是行业首席分析师——对标 Dan Ives（科技）/ Adam Jonas（汽车）。"
            "你**唯一**的数据是板块 ETF 块（板块 ETF 代码、ETF 价格/涨跌、本股相对板块强度）。"
            "五个维度：\n"
            " 1. 行业生命周期——长期增长 / 成熟扩张 / 整合期 / 结构性衰退？必须引用多年需求趋势；\n"
            " 2. 竞争结构——波特五力的主导压力（供应商、客户、新进入者）？指出 2-3 家最直接可比公司；\n"
            " 3. 相对板块强弱——必须引用该股当日涨跌与相对板块 ETF 的差值。跑赢板块还是跌破？\n"
            " 4. 创新与颠覆——当前是哪种技术或商业模式变革在重定价整个行业？\n"
            " 5. 监管背景——反垄断、关税、出口管制、药价、资本要求——挑相关的讲。\n"
            "结论：在**有利 / 中性 / 恶化**的行业阶段中处于**领导者 / 挑战者 / 落后者**位置。"
            "立场必须**仅来自板块数据**。**不要**引用公司估值或图表形态——那不是你的席位。"
        ),
    },
    "volatility": {
        "name_en": "Volatility & Options Strategist",
        "name_zh": "波动率与期权策略师",
        "icon": "🎯",
        "color": "teal",
        "role_en": (
            "You are a volatility / options strategist — think a Susquehanna or CitSec vol "
            "desk. Your ONLY data is the options/IV block (current IV, IV Rank, IV Percentile, "
            "30D HV, ATM Greeks, Net GEX, Gamma Flip Strike). Verdicts required:\n"
            " 1. IV REGIME — IV cheap / fair / rich vs history. Cite IV Rank explicitly. "
            "    Compare current IV to 30D HV — is the market overpaying or underpaying for risk?\n"
            " 2. DEALER POSITIONING — Net GEX positive (vol-compressing) or negative "
            "    (vol-amplifying)? Where is the gamma flip strike vs spot?\n"
            " 3. SKEW & DIRECTIONAL READ — what do ATM call vs put Greeks suggest about "
            "    near-term skew?\n"
            " 4. STRATEGY-SELECTION HINT — does this regime favour buying options (low IV "
            "    + dealer-amplified moves) or selling options (high IV + dealer-compressed)?\n"
            "Stance translates to a directional read AND a vol-regime read. Do NOT cite "
            "fundamentals, news, or chart MAs — that's not your desk."
        ),
        "role_zh": (
            "你是波动率 / 期权策略师——对标 Susquehanna 或 CitSec 波动率席位。"
            "你**唯一**的数据是期权/IV 块（当前 IV、IV Rank、IV Percentile、30 日 HV、ATM 希腊字母、"
            "净 GEX、Gamma Flip 行权价）。必须给出：\n"
            " 1. IV 体制——相对历史是便宜 / 合理 / 偏贵。必须明确引用 IV Rank。"
            "    把当前 IV 与 30D HV 对比——市场对风险定价过高还是过低？\n"
            " 2. 经销商持仓——净 GEX 为正（压缩波动）还是为负（放大波动）？Gamma Flip 价相对现货在哪？\n"
            " 3. 偏度与方向——ATM 看涨与看跌希腊字母如何提示近期偏度？\n"
            " 4. 策略选择提示——当前 regime 偏好买方（低 IV + 经销商放大波动）还是卖方"
            "    （高 IV + 经销商压缩波动）？\n"
            "立场需同时给出**方向判断**和**波动率体制判断**。**不要**引用基本面、新闻或图表均线——那不是你的席位。"
        ),
    },
    "event": {
        "name_en": "Event-Driven Analyst",
        "name_zh": "事件驱动分析师",
        "icon": "📰",
        "color": "rose",
        "role_en": (
            "You are an event-driven analyst — think a Paulson & Co or Elliott catalyst desk. "
            "Your ONLY data is the event block (recent news headlines, next earnings date, "
            "analyst-target consensus, recent rating changes). Catalyst-focused output:\n"
            " 1. NEAREST CATALYST — the single most important event in the next 30 days "
            "    (earnings, FDA, court date, contract). Cite the date if known.\n"
            " 2. NEWS DRIFT — synthesize the recent headline tone in 1 sentence (not a "
            "    bullet list of headlines). Net positive, negative, or noisy?\n"
            " 3. ANALYST CONSENSUS — mean target vs spot, and the implied % move. Recent "
            "    upgrade / downgrade pattern.\n"
            " 4. CATALYST RISK/REWARD — does the market positioning into the catalyst look "
            "    crowded long, crowded short, or uncrowded?\n"
            "Stance derives ONLY from catalysts and consensus. Do NOT cite chart MAs, "
            "fundamentals, or macro — those are other analysts."
        ),
        "role_zh": (
            "你是事件驱动分析师——对标 Paulson & Co 或 Elliott 催化剂席位。"
            "你**唯一**的数据是事件块（近期新闻、下次财报日期、分析师共识目标价、近期评级变动）。"
            "聚焦催化剂：\n"
            " 1. 最近催化剂——未来 30 天内最重要的单一事件（财报、FDA、法庭、合同）。如有日期必须引用；\n"
            " 2. 新闻倾向——用一句话总结近期头条基调（**不要**罗列标题列表）。净偏多、偏空，还是嘈杂？\n"
            " 3. 分析师共识——平均目标价相对现价的隐含 % 涨跌。近期上调 / 下调评级的模式；\n"
            " 4. 催化剂风险回报——市场在事件前的定位是**多头拥挤、空头拥挤、还是不拥挤**？\n"
            "立场**仅来自催化剂与共识**。**不要**引用图表均线、基本面或宏观——那是其他分析师。"
        ),
    },
    "flow": {
        "name_en": "Flow & Positioning Analyst",
        "name_zh": "资金流与持仓分析师",
        "icon": "💸",
        "color": "emerald",
        "role_en": (
            "You are a flow & positioning analyst — think a Goldman Prime Brokerage flow "
            "desk. Your ONLY data is the positioning block (short interest, short % float, "
            "days-to-cover, institutional ownership, recent insider transactions, P/C ratio). "
            "Read the smart-money tape:\n"
            " 1. SHORT POSITIONING — short % float level. Crowded short (>10%) sets up a "
            "    squeeze; sub-3% suggests no skeptic conviction. Days-to-cover sharpens this.\n"
            " 2. INSTITUTIONAL FLOW — net institutional buyers vs sellers. Are 13F holders "
            "    accumulating or distributing?\n"
            " 3. INSIDER ACTIVITY — recent open-market insider buys (bullish signal) or "
            "    sales (mixed signal). Quote the count if given.\n"
            " 4. OPTIONS POSITIONING — Put/Call ratio direction. Skewed bullish or bearish?\n"
            "Stance derives ONLY from positioning data. Smart money accumulating + insiders "
            "buying + heavy short squeeze setup = bullish. Insiders selling + institutions "
            "trimming + crowded long = bearish. Do NOT cite fundamentals or technicals."
        ),
        "role_zh": (
            "你是资金流与持仓分析师——对标 Goldman 主经纪商资金流席位。"
            "你**唯一**的数据是持仓块（空头持仓、空头占流通股 %、Days-to-Cover、机构持仓、近期内部人交易、P/C 比）。"
            "解读 smart money 盘面：\n"
            " 1. 空头持仓——空头占流通股 % 水平。>10% 拥挤空头（潜在轧空）；<3% 说明无空方信念。"
            "    用 Days-to-Cover 锐化判断；\n"
            " 2. 机构资金流——净机构买入还是卖出？13F 持有人在加仓还是减仓？\n"
            " 3. 内部人活动——近期内部人公开市场买入（看多信号）或卖出（混合信号）。如有计数必须引用；\n"
            " 4. 期权持仓——Put/Call 比方向。偏多还是偏空？\n"
            "立场必须**仅来自持仓数据**。Smart money 加仓 + 内部人买入 + 重度空头轧空配置 = 看多；"
            "内部人卖出 + 机构减持 + 多头拥挤 = 看空。**不要**引用基本面或技术面。"
        ),
    },
    "risk": {
        "name_en": "Risk Manager",
        "name_zh": "风险管理师",
        "icon": "🛡️",
        "color": "slate",
        "role_en": (
            "You are the Risk Manager — think a Bridgewater risk parity desk. Your ONLY "
            "data is the risk block (Beta, ATR, 30D realized vol, 1-year max drawdown, "
            "1Y return, correlation with SPY proxied by Beta). Your job is to assess "
            "POSITION-LEVEL RISK, not direction:\n"
            " 1. VOLATILITY GRADE — daily ATR as % of price. >5% = high-vol; 2-5% = normal; "
            "    <2% = low-vol. State the absolute ATR figure.\n"
            " 2. DRAWDOWN PROFILE — 1Y max drawdown depth. Has the name historically "
            "    delivered shareholder pain?\n"
            " 3. CORRELATION RISK — Beta to market. >1.5 = leverage on systematic risk; "
            "    <0.7 = defensive.\n"
            " 4. STOP-LOSS LEVEL — quote a 1.5x-ATR or 2x-ATR stop in dollars from current "
            "    spot. State an explicit stop price.\n"
            "Stance: bullish only if asymmetric upside is preserved AFTER setting a "
            "disciplined stop; otherwise neutral or bearish on a risk-adjusted basis. Do NOT "
            "cite fundamentals, news, or technical patterns — your desk is risk-only."
        ),
        "role_zh": (
            "你是风险管理师——对标 Bridgewater 风险平价席位。"
            "你**唯一**的数据是风险块（Beta、ATR、30D 已实现波动率、1Y 最大回撤、1Y 收益率、对 SPY 的相关性以 Beta 代理）。"
            "你的任务是评估**仓位级风险**，**不是方向判断**：\n"
            " 1. 波动率评级——日均 ATR 占价格比。>5% 高波；2-5% 正常；<2% 低波。必须引用 ATR 绝对值；\n"
            " 2. 回撤画像——1Y 最大回撤深度。历史上是否给股东带来过痛感？\n"
            " 3. 相关性风险——对市场的 Beta。>1.5 系统性风险放大；<0.7 防御型；\n"
            " 4. 止损位——基于 1.5x ATR 或 2x ATR 给出**明确的美元止损价**（从现货价向下计算）。\n"
            "立场：仅当**设了纪律性止损后**仍有非对称上行空间时看多；否则按**风险调整后口径**给中性或看空。"
            "**不要**引用基本面、新闻或技术形态——你的席位只关注风险。"
        ),
    },
}


# ============================================================
# Output schema enforced via JSON
# ============================================================

# Strict instruction injected into every researcher prompt.
# IMPORTANT: language enforcement is the first thing the model sees so all
# fields — including "headline", "key_points", "evidence", "risks" — come
# back in the same language. The previous version often mixed languages
# because the schema field names were English.
RESEARCHER_OUTPUT_INSTRUCTION_EN = """
## Output Format (STRICT)

LANGUAGE: Write ALL string values in ENGLISH ONLY. Do not mix in any other language.
Even though the JSON keys are in English, the VALUES (headline, key_points items,
evidence, risks) must all be in English prose. No Chinese characters. No mixed-language
sentences.

WRITING STANDARD: Institutional sell-side voice. Be specific, decisive, numeric.
Cite at least two concrete data points (price, multiple, %, ratio) in `evidence`.
Avoid filler such as "could potentially", "might be", "in some cases" — make the
call sharp. No retail clichés ("to the moon", "yolo", "bagholder").

DIFFERENTIATION (CRITICAL): Stay strictly inside YOUR specialty. Do NOT borrow
generic catalysts like "earnings beat", "AI tailwind", or "valuation re-rating"
that any other researcher could have written. Your evidence MUST be uniquely
sourced from the data block tagged "your specialty" (technical / fundamental /
macro / industry / financial / etc.) — that is what makes your contribution
non-redundant.

Return ONLY a valid JSON object — no preamble, no closing remarks, no markdown fences.

Schema:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <integer 1-10>,
  "headline": "<one-line summary, <=80 chars, ENGLISH>",
  "key_points": ["<point 1, ENGLISH>", "<point 2, ENGLISH>", "<point 3, ENGLISH>"],
  "evidence": "<2-3 sentences citing at least two specific numbers from the data, ENGLISH>",
  "risks": "<1-2 sentences on what could invalidate this view, ENGLISH>"
}

Use only data provided in the research context. Do not invent prices or facts.
"""

RESEARCHER_OUTPUT_INSTRUCTION_ZH = """
## 输出格式（严格）

语言要求：所有字符串字段的值必须**全部使用简体中文**。绝对不能混合使用英文和中文。
即使 JSON 键名是英文（headline、key_points、evidence、risks），但**值必须全部是中文**。
不要在同一段话里混合英文短语。专业术语首次出现时可在中文后用括号标注英文，但主体必须是中文。

写作标准：机构卖方研究风格——专业、果断、引用数字。
`evidence` 字段中**至少引用两个具体数据点**（价格、估值倍数、百分比、比率）。
避免"或许"、"可能"、"在某些情况下"之类含糊措辞，态度必须明确。
禁止使用散户化口吻（"冲冲冲"、"满仓干"、"接飞刀"等）。

差异化要求（关键）：严格围绕**你自己的专业角色**输出。
**不要**写出"业绩超预期"、"AI 顺风"、"估值修复"这种**任何研究员都能写**的通用催化剂。
你的 `evidence` 必须**只引用标记为"你的专属数据"的数据块**（技术指标 / 基本面指标 /
宏观市场 / 行业板块 / 财务质量等）——这才能让你的输出与其他研究员**不重复**。

只返回一个有效的 JSON 对象——不要前言、不要总结、不要 markdown 代码块。

Schema:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <1 到 10 的整数>,
  "headline": "<一句话总结，不超过 40 字，中文>",
  "key_points": ["<要点 1，中文>", "<要点 2，中文>", "<要点 3，中文>"],
  "evidence": "<2-3 句话，至少引用两个数据中的具体数字，中文>",
  "risks": "<1-2 句话说明什么会推翻此观点，中文>"
}

只能使用上下文中提供的数据。不要捏造价格或事实。
"""

MANAGER_OUTPUT_INSTRUCTION_EN = """
## Output Format (STRICT)

LANGUAGE: Write ALL string values in ENGLISH ONLY. No mixed-language output.
Return ONLY a valid JSON object — no preamble, no markdown fences.

You MUST include `synthesis` — a per-analyst reasoning chain showing how each
desk's view influenced your final call. Include all 10 analyst IDs:
quant, technical, fundamental, credit, macro, industry, volatility, event, flow, risk.

For OPTIONS mode you MUST also fill `option_legs` so the frontend can render a
live payoff diagram. Each leg is one option contract with explicit
{type, side, strike, premium, quantity, expiration} fields.

Schema for STOCK mode:
{
  "decision": "buy" | "hold" | "sell",
  "conviction": <integer 1-10>,
  "time_horizon": "<e.g. '1-3 months', ENGLISH>",
  "thesis": "<5-7 sentences. Open with the dominant signal, then explain how you weighted the analysts, and finish with the trigger that confirms or invalidates the call.>",
  "entry_zone": "<price range, e.g. '$175-180'>",
  "target_price": "<single price>",
  "stop_loss": "<single price>",
  "position_sizing": "<e.g. '2-3% of portfolio'>",
  "key_catalysts": ["<catalyst 1>", "<catalyst 2>", "<catalyst 3>"],
  "main_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "synthesis": {
    "quant":        "<1-2 sentences: how the quant factor read affected the call>",
    "technical":    "<1-2 sentences>",
    "fundamental":  "<1-2 sentences>",
    "credit":       "<1-2 sentences>",
    "macro":        "<1-2 sentences>",
    "industry":     "<1-2 sentences>",
    "volatility":   "<1-2 sentences>",
    "event":        "<1-2 sentences>",
    "flow":         "<1-2 sentences>",
    "risk":         "<1-2 sentences — quote the stop-loss level>"
  },
  "consensus_score": "<e.g. '6 of 10 leaning bullish, 3 bearish, 1 neutral' — count from the briefings>",
  "debate_summary": "<3-4 sentences walking through the sharpest 1v1 rebuttal that landed, the most credible concession, and which desks ended up on which side after debate.>",
  "actionable_steps": ["<step 1: e.g. 'Wait for a pullback to 175 before entering'>", "<step 2>", "<step 3>"]
}

Schema for OPTIONS mode:
{
  "decision": "<strategy name, e.g. 'Bull Call Spread'>",
  "conviction": <integer 1-10>,
  "direction": "bullish" | "bearish" | "neutral",
  "thesis": "<5-7 sentences. Open with the IV regime, then directional read, then why this structure dominates alternatives.>",
  "structure": "<exact legs in prose, e.g. 'Buy 1 AAPL Jun 175C @ ~$8.50, Sell 1 AAPL Jun 185C @ ~$3.20, net debit ~$5.30'>",
  "option_legs": [
    {"type": "call" | "put", "side": "buy" | "sell", "strike": <number>, "premium": <number>, "quantity": <integer>, "expiration": "<YYYY-MM-DD>"},
    ...
  ],
  "underlying_price": <number — current spot, taken from the data>,
  "expiration": "<target DTE range, e.g. '30-45 days'>",
  "max_loss": "<absolute dollar>",
  "max_profit": "<absolute dollar>",
  "breakeven": "<single price>",
  "win_probability": "<percentage>",
  "key_catalysts": ["<catalyst 1>", "<catalyst 2>", "<catalyst 3>"],
  "main_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "synthesis": {
    "quant":        "<1-2 sentences>",
    "technical":    "<1-2 sentences>",
    "fundamental":  "<1-2 sentences>",
    "credit":       "<1-2 sentences>",
    "macro":        "<1-2 sentences>",
    "industry":     "<1-2 sentences>",
    "volatility":   "<1-2 sentences — most important for options mode>",
    "event":        "<1-2 sentences>",
    "flow":         "<1-2 sentences>",
    "risk":         "<1-2 sentences — quote the max-loss tolerance>"
  },
  "consensus_score": "<e.g. '6 of 10 leaning bullish'>",
  "debate_summary": "<3-4 sentences>",
  "actionable_steps": ["<step 1>", "<step 2>", "<step 3>"]
}
"""

MANAGER_OUTPUT_INSTRUCTION_ZH = """
## 输出格式（严格）

语言要求：所有字符串字段的值必须**全部使用简体中文**，不能混合使用英文。
JSON 键名是英文，但所有值必须是中文。

只返回一个有效的 JSON 对象——不要前言、不要 markdown 代码块。

你**必须**包含 `synthesis` 字段——逐个分析师的推理链，说明每个席位的观点如何影响你的最终决策。
必须包含全部 10 位分析师的 ID：quant、technical、fundamental、credit、macro、industry、volatility、event、flow、risk。

期权模式下你**必须**填写 `option_legs` 数组，前端用它来渲染实时盈亏图与 What-If 滑块。
每条腿包含 {type, side, strike, premium, quantity, expiration} 字段。

股票模式 Schema:
{
  "decision": "buy" | "hold" | "sell",
  "conviction": <1 到 10 的整数>,
  "time_horizon": "<例如 '1-3 个月'，中文>",
  "thesis": "<5-7 句话。开头点明主导信号，然后说明如何权衡 10 位分析师的观点，最后一句给出确认或推翻决策的触发条件。中文。>",
  "entry_zone": "<价格区间，例如 '$175-180'>",
  "target_price": "<目标价>",
  "stop_loss": "<止损价>",
  "position_sizing": "<例如 '组合的 2-3%'>",
  "key_catalysts": ["<催化剂 1，中文>", "<催化剂 2，中文>", "<催化剂 3，中文>"],
  "main_risks": ["<风险 1，中文>", "<风险 2，中文>", "<风险 3，中文>"],
  "synthesis": {
    "quant":        "<1-2 句话：量化因子席位的观点如何影响决策。中文。>",
    "technical":    "<1-2 句话，中文>",
    "fundamental":  "<1-2 句话，中文>",
    "credit":       "<1-2 句话，中文>",
    "macro":        "<1-2 句话，中文>",
    "industry":     "<1-2 句话，中文>",
    "volatility":   "<1-2 句话，中文>",
    "event":        "<1-2 句话，中文>",
    "flow":         "<1-2 句话，中文>",
    "risk":         "<1-2 句话——必须引用止损价位。中文。>"
  },
  "consensus_score": "<例如 '10 位分析师中 6 位看多、3 位看空、1 位中性'——根据简报数清楚。中文。>",
  "debate_summary": "<3-4 句话，复盘 1v1 交叉质询中最致命的反驳、最有说服力的让步、辩论结束后各席位最终的归属。中文。>",
  "actionable_steps": ["<步骤 1：例如 '等待回踩 175 美元再入场'，中文>", "<步骤 2，中文>", "<步骤 3，中文>"]
}

期权模式 Schema:
{
  "decision": "<策略名，例如 '牛市看涨价差 (Bull Call Spread)'>",
  "conviction": <1 到 10 的整数>,
  "direction": "bullish" | "bearish" | "neutral",
  "thesis": "<5-7 句话。开头点明 IV 机制，再写方向判断，最后解释为何此结构优于其他备选。中文。>",
  "structure": "<完整腿（中文表述），例如 '买入 1 张 AAPL 6 月 175C @ 约 $8.50，卖出 1 张 AAPL 6 月 185C @ 约 $3.20，净支出约 $5.30'>",
  "option_legs": [
    {"type": "call" | "put", "side": "buy" | "sell", "strike": <数字>, "premium": <数字>, "quantity": <整数>, "expiration": "<YYYY-MM-DD>"},
    ...
  ],
  "underlying_price": <数字——当前现货价，从数据中取>,
  "expiration": "<目标到期日范围，例如 '30-45 天'，中文>",
  "max_loss": "<绝对美元数额>",
  "max_profit": "<绝对美元数额>",
  "breakeven": "<盈亏平衡价>",
  "win_probability": "<百分比>",
  "key_catalysts": ["<催化剂 1，中文>", "<催化剂 2，中文>", "<催化剂 3，中文>"],
  "main_risks": ["<风险 1，中文>", "<风险 2，中文>", "<风险 3，中文>"],
  "synthesis": {
    "quant":        "<1-2 句话，中文>",
    "technical":    "<1-2 句话，中文>",
    "fundamental":  "<1-2 句话，中文>",
    "credit":       "<1-2 句话，中文>",
    "macro":        "<1-2 句话，中文>",
    "industry":     "<1-2 句话，中文>",
    "volatility":   "<1-2 句话——期权模式下此项最重要。中文。>",
    "event":        "<1-2 句话，中文>",
    "flow":         "<1-2 句话，中文>",
    "risk":         "<1-2 句话——必须引用最大亏损上限。中文。>"
  },
  "consensus_score": "<例如 '10 位分析师中 6 位看多'，中文>",
  "debate_summary": "<3-4 句话，中文>",
  "actionable_steps": ["<步骤 1，中文>", "<步骤 2，中文>", "<步骤 3，中文>"]
}
"""


# ============================================================
# Research-context aggregator
# ============================================================

async def gather_research_context(ticker: str, fetcher: DataFetcher) -> dict:
    """
    Gather all data needed by every researcher in parallel.

    Beyond the original base context (market data, HV, news, analyst,
    options snapshot, GEX), this now also fetches:
      - Full OHLCV (1Y) so we can compute technical indicators
      - Fundamental metrics from Yahoo quoteSummary
      - Macro context (SPY/QQQ/VIX/TNX/TLT)
      - Sector ETF context for Industry researcher

    Each researcher gets a SPECIALIZED slice via format_researcher_context().
    """
    # First, fetch the core market data — we need its expiration list to
    # decide which options snapshot to fetch.
    try:
        market = await fetcher.get_full_market_data(ticker)
    except Exception:
        market = {}

    # Pick the first expiration ≈ 30 DTE (same heuristic as the dashboard)
    expirations = market.get("expirations") or []
    target_exp: Optional[str] = None
    if expirations:
        from datetime import datetime
        now = datetime.utcnow()
        scored = []
        for exp in expirations:
            try:
                dte = (datetime.strptime(exp, "%Y-%m-%d") - now).days
                scored.append((abs(dte - 30), exp))
            except Exception:
                continue
        if scored:
            scored.sort()
            target_exp = scored[0][1]
        else:
            target_exp = expirations[0]

    # Build the parallel-fetch task list. None entries are skipped.
    options_snapshot_task = (
        fetcher.get_options_snapshot(ticker, target_exp) if target_exp else None
    )
    gex_task = (
        fetcher.get_gamma_exposure(ticker, target_exp) if target_exp and hasattr(fetcher, "get_gamma_exposure") else None
    )

    tasks: list = [
        fetcher.get_historical_volatility(ticker),
        fetcher.get_news(ticker, limit=8),
        fetcher.get_analyst_data(ticker),
        fetcher.get_ohlcv(ticker, "1y", "1d"),    # for technical indicators + risk metrics
        fetch_fundamental_metrics(fetcher, ticker),
        fetch_market_context(fetcher),
        fetch_sector_etf_context(fetcher, ticker),
        fetch_flow_context(fetcher, ticker),       # new: short interest + smart money
    ]
    if options_snapshot_task is not None:
        tasks.append(options_snapshot_task)
    if gex_task is not None:
        tasks.append(gex_task)

    results = await asyncio.gather(*tasks, return_exceptions=True)

    def _safe(idx: int, default):
        v = results[idx]
        return v if not isinstance(v, Exception) else default

    hv = _safe(0, {}) or {}
    news = _safe(1, []) or []
    analyst = _safe(2, {}) or {}
    ohlcv = _safe(3, {}) or {}
    fundamental = _safe(4, {}) or {}
    market_ctx = _safe(5, {}) or {}
    sector_ctx = _safe(6, {}) or {}
    flow_ctx = _safe(7, {}) or {}
    idx = 8
    options_snapshot: dict = {}
    gex_data: dict = {}
    if options_snapshot_task is not None:
        options_snapshot = _safe(idx, {}) or {}
        idx += 1
    if gex_task is not None:
        gex_data = _safe(idx, {}) or {}

    # Compute technical indicators from OHLCV bars
    bars = ohlcv.get("bars") if isinstance(ohlcv, dict) else None
    technicals = compute_technical_indicators(bars or [])

    return {
        "ticker": ticker,
        "market": market,
        "hv": hv,
        "news": news,
        "analyst": analyst,
        "options_snapshot": options_snapshot,
        "gex": gex_data,
        "target_expiration": target_exp,
        "ohlcv_bars": bars or [],
        # Specialty data per researcher
        "technicals": technicals,
        "fundamental": fundamental,
        "market_ctx": market_ctx,
        "sector_ctx": sector_ctx,
        "flow_ctx": flow_ctx,
    }


def format_context_for_researcher(ctx: dict, mode: AnalysisMode, locale: str) -> str:
    """Render the shared research context as a markdown block for prompts."""
    m = ctx.get("market", {})
    hv = ctx.get("hv", {})
    a = ctx.get("analyst", {})
    news_items = ctx.get("news", [])[:5]

    spot = m.get("spot_price")
    chg = m.get("change_pct")
    iv = m.get("iv_current")
    iv_rank = m.get("iv_rank")
    iv_pct = m.get("iv_percentile")
    hv_30 = hv.get("hv_30") or m.get("hv_30")
    earnings = m.get("next_earnings_date")

    lines = [
        f"## Research Context for {ctx['ticker']} ({'Options Analysis' if mode == 'options' else 'Stock Analysis'})",
        "",
        "### Market Snapshot",
        f"- Spot price: ${spot:.2f}" if spot else "- Spot price: n/a",
        f"- Change today: {chg:+.2f}%" if chg is not None else "",
        f"- Implied Volatility: {iv:.1f}%" if iv else "",
        f"- IV Rank: {iv_rank:.0f} | IV Percentile: {iv_pct:.0f}" if iv_rank is not None else "",
        f"- 30-day Historical Vol: {hv_30:.1f}%" if hv_30 else "",
        f"- Next earnings: {earnings}" if earnings else "",
        "",
        "### Analyst Consensus",
    ]
    if a:
        target = a.get("target_mean")
        rec = a.get("recommendation")
        n = a.get("num_analysts")
        if target:
            lines.append(f"- Mean target: ${target:.2f}")
        if rec:
            lines.append(f"- Recommendation: {rec}")
        if n:
            lines.append(f"- Number of analysts: {n}")
    else:
        lines.append("- No analyst data available")

    lines += ["", "### Recent News (last 5)"]
    if news_items:
        for n in news_items:
            title = (n.get("title") or "").strip()
            date = (n.get("date") or "").strip()
            if title:
                lines.append(f"- [{date}] {title}")
    else:
        lines.append("- No recent news")

    # ATM Greeks + IV context — primarily fuels the Options Researcher
    snap = ctx.get("options_snapshot") or {}
    target_exp = ctx.get("target_expiration")
    if snap and target_exp:
        lines += ["", f"### Options Snapshot (expiration: {target_exp})"]
        atm_call = (snap.get("atm_call") or {})
        atm_put = (snap.get("atm_put") or {})
        snap_iv = snap.get("atm_iv")
        if snap_iv:
            lines.append(f"- ATM IV: {snap_iv:.1f}%")
        if atm_call:
            d = atm_call.get("delta")
            g = atm_call.get("gamma")
            th = atm_call.get("theta")
            v = atm_call.get("vega")
            if any(x is not None for x in (d, g, th, v)):
                parts = []
                if d is not None: parts.append(f"Δ={d:+.3f}")
                if g is not None: parts.append(f"Γ={g:+.4f}")
                if th is not None: parts.append(f"Θ={th:+.3f}")
                if v is not None: parts.append(f"ν={v:+.3f}")
                lines.append(f"- ATM Call Greeks: {', '.join(parts)}")
        if atm_put:
            d = atm_put.get("delta")
            g = atm_put.get("gamma")
            th = atm_put.get("theta")
            v = atm_put.get("vega")
            if any(x is not None for x in (d, g, th, v)):
                parts = []
                if d is not None: parts.append(f"Δ={d:+.3f}")
                if g is not None: parts.append(f"Γ={g:+.4f}")
                if th is not None: parts.append(f"Θ={th:+.3f}")
                if v is not None: parts.append(f"ν={v:+.3f}")
                lines.append(f"- ATM Put Greeks: {', '.join(parts)}")

    # Dealer Gamma Exposure (GEX)
    gex = ctx.get("gex") or {}
    if gex:
        net = gex.get("net_gex_millions")
        call_gex = gex.get("call_gex_millions")
        put_gex = gex.get("put_gex_millions")
        flip = gex.get("gamma_flip_strike")
        lines += ["", "### Dealer Gamma Exposure (GEX)"]
        if net is not None:
            regime = "positive (vol-compressing)" if net >= 0 else "negative (vol-amplifying)"
            lines.append(f"- Net GEX: ${net:.2f}M per 1% move ({regime})")
        if call_gex is not None and put_gex is not None:
            lines.append(f"- Call GEX: ${call_gex:.2f}M | Put GEX: ${put_gex:.2f}M")
        if flip is not None:
            lines.append(f"- Gamma Flip Strike: ${flip:.2f}")

    lines += ["", "---", ""]
    return "\n".join(line for line in lines if line)


def format_researcher_specific_context(ctx: dict, researcher_id: str, mode: AnalysisMode, locale: str) -> str:
    """
    Build a domain-locked prompt block for one analyst.

    Each analyst receives:
      1. A minimal universal header (ticker + spot + change% only)
      2. ONLY their own specialty data block — nothing else

    This is a hard constraint: by withholding all other domains' data
    from the prompt, we make it physically impossible for one analyst
    to reuse another's evidence. Each output is therefore traceable
    to a unique data block.
    """
    header = format_minimal_header(ctx, mode, locale)

    technicals = ctx.get("technicals") or {}
    fundamental = ctx.get("fundamental") or {}
    market_ctx = ctx.get("market_ctx") or {}
    sector_ctx = ctx.get("sector_ctx") or {}
    flow_ctx = ctx.get("flow_ctx") or {}
    market = ctx.get("market") or {}
    options_snapshot = ctx.get("options_snapshot") or {}
    gex = ctx.get("gex") or {}
    news = ctx.get("news") or []
    analyst_data = ctx.get("analyst") or {}
    hv = ctx.get("hv") or {}
    ohlcv_bars = ctx.get("ohlcv_bars") or []

    block: str = ""
    if researcher_id == "quant":
        block = format_quant_block(technicals, fundamental, locale)
    elif researcher_id == "technical":
        block = format_technical_block(technicals, locale)
    elif researcher_id == "fundamental":
        block = format_fundamental_block(fundamental, locale)
    elif researcher_id == "credit":
        block = format_credit_block(fundamental, locale)
    elif researcher_id == "macro":
        block = format_market_block(market_ctx, locale)
    elif researcher_id == "industry":
        block = format_industry_block(sector_ctx, market.get("change_pct"), locale)
    elif researcher_id == "volatility":
        block = format_volatility_block(market, options_snapshot, gex, hv, locale)
    elif researcher_id == "event":
        block = format_event_block(news, market, analyst_data, locale)
    elif researcher_id == "flow":
        block = format_flow_block(flow_ctx, fundamental, options_snapshot, locale)
    elif researcher_id == "risk":
        block = format_risk_block(technicals, fundamental, ohlcv_bars, locale)

    return f"{header}\n\n{block}\n" if block else header


# ============================================================
# Pipeline
# ============================================================

class TraderAgentPipeline:
    """Orchestrates the 10-analyst debate + portfolio-manager decision.

    Concurrency=3 matches DeepSeek's token-bucket burst=3, so no call is
    rate-limited on the first attempt. Each call gets 3 retries with
    exponential backoff for transient failures.
    """

    # Concurrency tuned to DeepSeek's token-bucket (burst=3, 0.83 QPS refill).
    # 3 concurrent calls consume exactly the burst, and the ~15-25s each call
    # takes gives the bucket time to fully refill before the next batch starts.
    # 5 concurrent (v3.5) exceeded the burst → 429s on 2/5 calls every batch.
    MAX_CONCURRENT_LLM_CALLS = 3

    # Retry policy: 3 attempts with exponential backoff.
    MAX_RETRIES = 3
    INITIAL_BACKOFF_SECONDS = 2.0
    MAX_BACKOFF_SECONDS = 8.0

    # Per-call hard timeout. 20s is enough for DeepSeek on most tickers.
    LLM_CALL_TIMEOUT_SECONDS = 20.0

    # SSE heartbeat interval to keep the browser connection alive.
    HEARTBEAT_INTERVAL_SECONDS = 8.0

    # Hard cap on the entire research phase. 10 analysts in batches of 3
    # = 4 batches × ~30s worst case ≈ 120s. 240s gives 2× headroom.
    RESEARCH_PHASE_TIMEOUT_SECONDS = 240

    def __init__(self, llm_client, model: str, fetcher: DataFetcher):
        self.client = llm_client
        self.model = model
        self.fetcher = fetcher
        # Per-instance semaphore so concurrent runs of the pipeline (one per
        # request) each get their own quota. NOTE: must be created lazily
        # inside an async context — asyncio.Semaphore() at __init__ time can
        # bind to a different loop than the one running the request.
        self._llm_semaphore: Optional[asyncio.Semaphore] = None

    def _get_semaphore(self) -> asyncio.Semaphore:
        if self._llm_semaphore is None:
            self._llm_semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_LLM_CALLS)
        return self._llm_semaphore

    async def _llm_completion_with_retry(
        self,
        *,
        label: str,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Issue a chat completion under the concurrency semaphore with retry.

        Returns the raw assistant content string, or "" if every retry failed.
        Logs each attempt so failures are visible in server logs.
        """
        import random

        sem = self._get_semaphore()
        last_error: Optional[BaseException] = None
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                async with sem:
                    resp = await self.client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        timeout=self.LLM_CALL_TIMEOUT_SECONDS,
                    )
                content = resp.choices[0].message.content or ""
                if content.strip():
                    return content
                # Empty content shouldn't happen but treat as transient.
                last_error = RuntimeError("empty_completion")
                _safe_log(f"[trader_agent] {label}: empty completion (attempt {attempt}/{self.MAX_RETRIES})")
            except Exception as e:
                last_error = e
                _safe_log(
                    f"[trader_agent] {label}: API attempt {attempt}/{self.MAX_RETRIES} "
                    f"failed — {type(e).__name__}: {e}"
                )

            if attempt < self.MAX_RETRIES:
                # Exponential backoff with ±20% jitter to prevent retry storms
                backoff = min(
                    self.MAX_BACKOFF_SECONDS,
                    self.INITIAL_BACKOFF_SECONDS * (2 ** (attempt - 1)),
                )
                backoff *= 1.0 + (random.random() - 0.5) * 0.4
                await asyncio.sleep(backoff)

        _safe_log(
            f"[trader_agent] {label}: gave up after {self.MAX_RETRIES} attempts "
            f"(last error: {type(last_error).__name__ if last_error else 'unknown'})"
        )
        return ""

    async def _call_researcher(
        self,
        spec_key: str,
        spec: dict,
        context_block: str,
        locale: str,
    ) -> dict:
        """Run a single researcher and parse its JSON output."""
        role = spec["role_zh"] if locale == "zh" else spec["role_en"]
        instruction = (
            RESEARCHER_OUTPUT_INSTRUCTION_ZH if locale == "zh"
            else RESEARCHER_OUTPUT_INSTRUCTION_EN
        )

        # Triple-redundant language directive: prefix the system prompt, suffix
        # the user message. Models tend to drift if the directive only appears
        # once, especially when the research context contains English data.
        lang_directive = (
            "重要：所有输出值必须全部使用简体中文。不要混合中英文。"
            if locale == "zh"
            else "IMPORTANT: All output values must be in ENGLISH ONLY. Do not mix languages."
        )

        system_prompt = f"{lang_directive}\n\n{role}\n\n{instruction}"
        user_prompt = f"{context_block}\n\n{lang_directive}"

        parsed: dict = {}
        error_label: Optional[str] = None

        content = await self._llm_completion_with_retry(
            label=spec_key,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
            max_tokens=900,
        )
        if content:
            parsed = self._parse_json(content)
            if not parsed:
                error_label = "json_parse_failed"
                _safe_log(f"[trader_agent] {spec_key}: JSON parse failed. Raw: {content[:300]!r}")
        else:
            error_label = "all_retries_exhausted"

        # Guarantee every required field is populated so the frontend can never
        # crash on a missing `stance` etc. This is the critical fix: previously,
        # a silent JSON-parse failure returned a result dict missing `stance`,
        # which crashed React on `researcher.stance.charAt(0)`.
        defaults = {
            "stance": "neutral",
            "confidence": 5,
            "headline": (
                f"[{spec.get('name_zh') if locale == 'zh' else spec.get('name_en')}] "
                + ("analysis unavailable" if locale != "zh" else "本轮未生成有效分析")
            ),
            "key_points": [
                f"Error: {error_label}" if error_label else (
                    "LLM returned no parsable analysis." if locale != "zh" else "本轮模型未返回可解析的分析。"
                )
            ],
            "evidence": "",
            "risks": "",
        }
        # parsed wins over defaults when the field is present and non-empty.
        for k, v in defaults.items():
            if k not in parsed or parsed[k] in (None, "", []):
                parsed[k] = v
        # Coerce stance to a known value to keep the frontend invariants safe.
        if parsed.get("stance") not in ("bullish", "bearish", "neutral"):
            parsed["stance"] = "neutral"
        # Same for confidence — must be int 1-10.
        try:
            parsed["confidence"] = max(1, min(10, int(parsed.get("confidence", 5))))
        except (ValueError, TypeError):
            parsed["confidence"] = 5

        return {
            "id": spec_key,
            "name_en": spec["name_en"],
            "name_zh": spec["name_zh"],
            "icon": spec["icon"],
            "color": spec["color"],
            **parsed,
        }

    async def _call_manager(
        self,
        researcher_results: list[dict],
        context_block: str,
        mode: AnalysisMode,
        locale: str,
    ) -> dict:
        """Run the portfolio manager to synthesize a final decision."""
        # Build a richer per-researcher briefing — the manager now needs the
        # full key_points + evidence + (if present) the debate rebuttals
        # so it can write a credible synthesis section.
        digest_lines = []
        debate_lines: list[str] = []
        for r in researcher_results:
            name = r.get("name_zh") if locale == "zh" else r.get("name_en")
            rid = r.get("id", "?")
            stance = r.get("stance", "neutral")
            conf = r.get("confidence", 5)
            headline = r.get("headline", "")
            evidence = r.get("evidence", "")
            kps = r.get("key_points") or []
            digest_lines.append(
                f"\n#### [{rid}] {name} — stance: {stance} ({conf}/10)\n"
                f"Headline: {headline}\n"
                f"Evidence: {evidence}\n"
                f"Key points: " + " | ".join(kps[:3])
            )
            # If a rebuttal was attached during debate phase, add it to the dedicated
            # debate section so the PM can see how the bull/bear actually clashed.
            reb = r.get("rebuttal") or {}
            if reb:
                rebuttal_text = reb.get("rebuttal", "")
                reinforced = reb.get("reinforced_evidence", "")
                concession = reb.get("concession", "")
                opp_id = reb.get("opponent_id", "?")
                debate_lines.append(
                    f"\n[{rid}] {name} (rebutting {opp_id}):\n"
                    f"  Rebuttal: {rebuttal_text}\n"
                    f"  Reinforced evidence: {reinforced}\n"
                    f"  Concession: {concession}"
                )
        digest = "\n".join(digest_lines)
        debate_section = ""
        if debate_lines:
            debate_section = (
                ("\n\n## 全员辩论（每位研究员都对一位观点不同的同事进行交叉质询）\n"
                 if locale == "zh"
                 else "\n\n## Full-Team Debate (every researcher cross-examines a peer with a differing view)\n")
                + "\n".join(debate_lines)
            )

        if locale == "zh":
            mode_phrase = "期权交易建议" if mode == "options" else "股票交易建议"
            role_intro = (
                f"你是投资经理（Portfolio Manager / PM）。"
                f"你刚听取了 10 位专业分析师的完整简报：量化、技术、基本面、信用、宏观、行业、波动率、事件、资金流、风险。"
                f"每位分析师只看到自己专属的数据块，所以他们的证据是真正独立的。"
                f"现在你必须做出最终决定，给出{mode_phrase}。\n\n"
                "决策要求：\n"
                "1. 权衡 10 位分析师的论据，识别共识与分歧；\n"
                "2. 必须填写 synthesis 字段，逐个解释每位分析师的观点如何影响最终决策；\n"
                "3. consensus_score 字段需要明确数清楚有多少位看多/看空/中性；\n"
                "4. thesis 必须 5-7 句话，写出完整的推理链条；\n"
                "5. debate_summary 必须复盘**1v1 交叉辩论**——哪条反驳最致命、哪个让步最有说服力、辩论结束后各席位最终的归属；\n"
                "6. actionable_steps 至少 3 步具体执行步骤；\n"
                "7. 期权模式下你**必须**正确填写 option_legs 数组（type/side/strike/premium/quantity/expiration）和 underlying_price，前端用它渲染盈亏图；\n"
                "8. 风险席位的止损建议必须并入最终的 stop_loss 或 max_loss 字段；\n"
                "9. 不要骑墙——给出明确的方向和数字。\n"
                "10. 所有输出必须使用简体中文。"
            )
            instruction = MANAGER_OUTPUT_INSTRUCTION_ZH
            lang_directive = "重要：所有输出值必须全部使用简体中文。不要混合中英文。"
        else:
            mode_phrase = "options trade recommendation" if mode == "options" else "stock trade recommendation"
            role_intro = (
                f"You are the Portfolio Manager. You just heard from 10 specialist analysts "
                f"(Quant, Technical, Fundamental, Credit, Macro, Industry, Volatility, Event, Flow, Risk). "
                f"Each analyst saw ONLY their own specialty data block, so their evidence is genuinely independent.\n\n"
                "Decision requirements:\n"
                "1. Weigh all 10 analysts' arguments; identify consensus and disagreement.\n"
                "2. You MUST fill the `synthesis` object: one entry per analyst ID.\n"
                "3. `consensus_score` should explicitly count how many lean bullish / bearish / neutral.\n"
                "4. `thesis` must be 5-7 sentences with a complete reasoning chain.\n"
                "5. `debate_summary` must summarise the 1v1 cross-examination — the sharpest rebuttal that landed, the most credible concession, and which desks ended up on which side after debate.\n"
                "6. `actionable_steps` must contain at least 3 concrete steps.\n"
                "7. For OPTIONS mode you MUST correctly fill `option_legs` (type/side/strike/premium/quantity/expiration) and `underlying_price` — the frontend uses these to render the live payoff diagram.\n"
                "8. The Risk desk's stop-loss recommendation must be reflected in the final `stop_loss` or `max_loss` field.\n"
                "9. Do not sit on the fence — give a clear direction and concrete numbers.\n"
                "10. All output values must be in English only."
            )
            instruction = MANAGER_OUTPUT_INSTRUCTION_EN
            lang_directive = "IMPORTANT: All output values must be in ENGLISH ONLY. Do not mix languages."

        user_prompt = (
            f"{context_block}\n\n"
            f"## Researcher Briefings (full)\n{digest}"
            f"{debate_section}\n\n"
            f"{lang_directive}\n\n"
            "Now make your final decision. Remember: fill EVERY field of the schema, especially `synthesis` for all 9 researchers and `actionable_steps`. "
            "Use the debate rebuttals (if present) to inform your debate_summary — quote the strongest argument from each side."
        )
        system_prompt = f"{lang_directive}\n\n{role_intro}\n\n{instruction}"

        content = await self._llm_completion_with_retry(
            label="manager",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=2600,
        )
        if not content:
            return {
                "decision": "hold",
                "conviction": 5,
                "thesis": "Manager analysis unavailable: all retries exhausted",
                "debate_summary": "Pipeline error",
                "key_catalysts": [],
                "main_risks": [],
                "synthesis": {},
                "actionable_steps": [],
                "consensus_score": "",
            }

        parsed = self._parse_json(content)

        # Defensive fallback: if the model returned content but it couldn't be
        # parsed as JSON, OR the JSON was valid but missing the two fields the
        # frontend needs, substitute a safe shape so the UI shows a clear
        # message instead of the literal string "UNDEFINED".
        if not parsed or "decision" not in parsed or "conviction" not in parsed:
            _safe_log(
                f"[trader_agent] Manager JSON malformed or missing decision/conviction. "
                f"Raw preview: {content[:240]!r}"
            )
            return {
                "decision": "hold",
                "conviction": 5,
                "thesis": (
                    "The Portfolio Manager response could not be parsed as JSON. "
                    "Defaulting to HOLD. See backend logs for the raw response."
                ),
                "debate_summary": "",
                "key_catalysts": [],
                "main_risks": [],
                "synthesis": {},
                "actionable_steps": [],
                "consensus_score": "",
                "_parse_error": True,
                "_raw_preview": content[:500],
            }

        return parsed

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Best-effort JSON extraction from a model response.

        Handles three shapes the LLM may return:
          1. Bare JSON object              ->  {"...": ...}
          2. Fenced JSON                   ->  ```json\n{...}\n```
          3. JSON with preamble / suffix   ->  "Here is my answer: {...} hope this helps"
        Returns {} only if the result is genuinely unparsable — the caller is
        then responsible for substituting a safe default so the frontend never
        receives missing decision/conviction fields.
        """
        if not text:
            return {}
        text = text.strip()

        # Strip markdown code fences. The previous implementation used
        # `text.split("```", 2)[-1]` which returns the trailing empty string
        # whenever both an opening and closing fence are present — that's how
        # the frontend ended up rendering "UNDEFINED" for the PM decision.
        if "```" in text:
            text = re.sub(r"^```(?:json|JSON)?\s*\n?", "", text)
            text = re.sub(r"\n?\s*```\s*$", "", text)
            text = text.strip()

        # Trim any prose around the JSON object by clipping to the outermost braces.
        if "{" in text and "}" in text:
            start = text.find("{")
            end = text.rfind("}")
            text = text[start : end + 1]

        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            _safe_log(
                f"[trader_agent] _parse_json failed ({exc.msg} @ pos {exc.pos}) "
                f"| preview: {text[:160]!r}"
            )
            return {}

    async def _call_debate_rebuttal(
        self,
        own_id: str,
        own_view: dict,
        opponent_view: dict,
        ctx: dict,
        mode: AnalysisMode,
        locale: str,
    ) -> dict:
        """
        Run a single rebuttal turn. The researcher is shown its OWN initial
        view + the opponent's view, and asked to (a) acknowledge the strongest
        opposing point and (b) reinforce its own view with new evidence.

        Returns: {
          "rebuttal": str,  # 2-3 sentences acknowledging opponent + counter
          "reinforced_evidence": str,  # 1-2 sentences with sharper evidence
          "concession": str,  # 1 sentence on what the opponent got right (forces honest debate)
        }
        """
        spec = RESEARCHER_SPECS[own_id]
        is_zh = locale == "zh"
        lang = "重要：所有输出必须使用简体中文。" if is_zh else "IMPORTANT: All output must be in ENGLISH only."

        own_name = spec["name_zh"] if is_zh else spec["name_en"]
        opp_id = opponent_view.get("id", "?")
        opp_spec = RESEARCHER_SPECS.get(opp_id, {})
        opp_name = opp_spec.get("name_zh" if is_zh else "name_en", opp_id)

        if is_zh:
            role = (
                f"你是 {own_name}。你刚发表了你的第一轮观点，现在 {opp_name} 发表了一个相反立场的观点。"
                "你需要从**你自己专业角度**出发，给出一段简短的辩论回应：反驳对方最强的一点，"
                "但要诚实——必须承认对方至少一个合理之处。"
                "然后用**你专业领域内的新数据**强化你自己的论点。"
                "不要重复你第一轮已经说过的话，也不要侵入对方的专业领域（量化/技术/基本面/信用/宏观/行业/波动率/事件/资金流/风险）。"
            )
            instruction = (
                "只返回 JSON：\n"
                "{\n"
                '  "rebuttal": "<2-3 句话：直接反驳对方最强的论点，中文>",\n'
                '  "reinforced_evidence": "<1-2 句话：用你专业领域内的数据强化你的立场，中文>",\n'
                '  "concession": "<1 句话：诚实承认对方说对的地方，中文>"\n'
                "}"
            )
        else:
            role = (
                f"You are the {own_name}. You just published your first-round view; now the {opp_name} has published an OPPOSING view. "
                "Write a short debate response from YOUR specialty's perspective: rebut their strongest point, but be intellectually honest — "
                "you MUST concede at least one point they got right. Then reinforce your own thesis with NEW evidence drawn strictly from your "
                "domain (quant / technical / fundamental / credit / macro / industry / volatility / event / flow / risk). "
                "Do not repeat your first-round prose, and do not invade your opponent's domain to score points."
            )
            instruction = (
                "Return JSON only:\n"
                "{\n"
                '  "rebuttal": "<2-3 sentences directly rebutting their strongest argument, ENGLISH>",\n'
                '  "reinforced_evidence": "<1-2 sentences using YOUR domain data to strengthen your stance, ENGLISH>",\n'
                '  "concession": "<1 sentence honestly conceding what they got right, ENGLISH>"\n'
                "}"
            )

        own_summary = (
            f"Your initial view:\n"
            f"  Stance: {own_view.get('stance')} ({own_view.get('confidence')}/10)\n"
            f"  Headline: {own_view.get('headline')}\n"
            f"  Evidence: {own_view.get('evidence')}\n"
        )
        opp_summary = (
            f"\nOpponent's view ({opp_name}):\n"
            f"  Stance: {opponent_view.get('stance')} ({opponent_view.get('confidence')}/10)\n"
            f"  Headline: {opponent_view.get('headline')}\n"
            f"  Evidence: {opponent_view.get('evidence')}\n"
            f"  Key points: " + " | ".join((opponent_view.get('key_points') or [])[:3])
        )
        ticker = ctx.get("ticker", "")

        system_prompt = f"{lang}\n\n{role}\n\n{instruction}"
        user_prompt = f"Ticker: {ticker}\n\n{own_summary}{opp_summary}\n\n{lang}"

        content = await self._llm_completion_with_retry(
            label=f"debate_{own_id}",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
            max_tokens=400,
        )
        if not content:
            return {}
        return self._parse_json(content) or {}

    async def run(
        self,
        ticker: str,
        mode: AnalysisMode,
        locale: str,
        selected_researchers: Optional[list[str]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Run the full pipeline. Yields SSE-formatted strings.

        Args:
            selected_researchers: optional list of analyst IDs to run.
                If None or empty, all 10 run. Debate fires automatically
                between any two analysts with opposing stances; if all
                selected analysts share the same stance, debate is skipped.

        Phases:
          1. gathering_data — fetch all specialty data blocks in parallel
          2. research_start — N selected analysts run in parallel, each
             seeing ONLY their own domain block (hard differentiation)
          3. debate_start   — strict 1v1 cross-examination by opposing stance
          4. manager_start  — PM synthesises with per-analyst attribution

        Events emitted:
          - data: {"type": "phase", "phase": "<phase_name>"}
          - data: {"type": "selected", "ids": [...], "count": N}
          - data: {"type": "researcher", "result": {...}}
          - data: {"type": "rebuttal", "id": "<id>", "opponent_id": "<id>", "rebuttal": {...}}
          - data: {"type": "manager", "result": {...}}
          - data: {"type": "done", "researchers": [...], "manager": {...}}
          - data: {"type": "error", "message": "..."}
        """
        try:
            # Filter researchers — fall back to all 9 if invalid input given
            valid_ids = list(RESEARCHER_SPECS.keys())
            if selected_researchers:
                # Preserve the canonical order (RESEARCHER_SPECS) instead of
                # whatever order the client sent — keeps frontend rendering stable.
                selected_set = {s for s in selected_researchers if s in valid_ids}
                if not selected_set:
                    selected_set = set(valid_ids)
                active_ids = [k for k in valid_ids if k in selected_set]
            else:
                active_ids = valid_ids

            # 1. Gather context
            yield self._sse({"type": "phase", "phase": "gathering_data", "pipeline_version": PIPELINE_VERSION})
            print(
                f"[trader_agent] Run start: ticker={ticker} mode={mode} locale={locale} "
                f"active={len(active_ids)} version={PIPELINE_VERSION} "
                f"selected_in={selected_researchers!r}",
                flush=True,
            )
            ctx = await gather_research_context(ticker, self.fetcher)

            # Tell the frontend exactly which researchers will fire so progress bars
            # can scale properly (5/5 instead of 5/9).
            yield self._sse({"type": "selected", "ids": active_ids, "count": len(active_ids)})

            # 2. Research phase — each analyst gets a SPECIALIZED prompt.
            #
            # CRITICAL: every analyst MUST emit exactly one researcher SSE event.
            #
            # Design: we wrap each coroutine in an explicit asyncio.Task (via
            # ensure_future) keyed by analyst ID. That way, even if a task is
            # cancelled or raises BaseException (including CancelledError, which
            # is NOT caught by `except Exception` in Python 3.8+), we know
            # *which* analyst failed and can immediately emit a fallback event
            # rather than silently dropping it.
            #
            # Previous bug: safe_call used `except Exception`, which misses
            # asyncio.CancelledError (a BaseException subclass). If the httpx
            # transport raised CancelledError (e.g. on Windows, or under load),
            # it leaked out of safe_call → the as_completed `continue` skipped
            # both researcher_results.append AND yield SSE → analyst vanished.
            yield self._sse({"type": "phase", "phase": "research_start"})

            def _make_fallback(key: str, reason: str) -> dict:
                spec = RESEARCHER_SPECS[key]
                name = spec["name_zh"] if locale == "zh" else spec["name_en"]
                msg = reason if locale != "zh" else f"流程错误：{reason}"
                return {
                    "id": key,
                    "name_en": spec["name_en"],
                    "name_zh": spec["name_zh"],
                    "icon": spec["icon"],
                    "color": spec["color"],
                    "stance": "neutral",
                    "confidence": 5,
                    "headline": f"[{name}] {'analysis unavailable' if locale != 'zh' else '本轮未生成有效分析'}",
                    "key_points": [msg],
                    "evidence": "",
                    "risks": "",
                }

            async def safe_call(key: str) -> dict:
                spec = RESEARCHER_SPECS[key]
                try:
                    block = format_researcher_specific_context(ctx, key, mode, locale)
                    return await self._call_researcher(key, spec, block, locale)
                except BaseException as e:
                    # Catch ALL exceptions including asyncio.CancelledError
                    # (BaseException subclass, NOT caught by `except Exception`).
                    _safe_log(f"[trader_agent] {key} pipeline error: {type(e).__name__}: {e}")
                    return _make_fallback(key, type(e).__name__)

            # Create named Tasks so we can map each future back to its analyst
            # ID. CRITICAL: we use asyncio.wait() (not as_completed) because
            # as_completed yields wrapper coroutines, not the original tasks,
            # so dict lookup by future would always fail with KeyError.
            # asyncio.wait() returns the original Task objects in `done`.
            task_map: dict[asyncio.Future, str] = {
                asyncio.ensure_future(safe_call(key)): key
                for key in active_ids
            }

            researcher_results: list[dict] = []
            seen_ids: set[str] = set()
            pending: set[asyncio.Future] = set(task_map.keys())
            import time as _time
            research_deadline = _time.monotonic() + self.RESEARCH_PHASE_TIMEOUT_SECONDS
            while pending:
                # Use a short timeout so we can send SSE heartbeats to keep the
                # browser connection alive. Without heartbeats, the browser drops
                # the SSE stream after its own idle-connection timeout (~60s),
                # which is why only the first few (fastest) researchers appeared.
                time_left = research_deadline - _time.monotonic()
                if time_left <= 0:
                    # Hard deadline hit — cancel remaining tasks and fall through
                    # to the safety net below which emits fallback events for them.
                    _safe_log(
                        f"[trader_agent] research phase timeout: "
                        f"{len(pending)} tasks still pending, cancelling"
                    )
                    for fut in pending:
                        fut.cancel()
                    pending = set()
                    break

                done, pending = await asyncio.wait(
                    pending,
                    return_when=asyncio.FIRST_COMPLETED,
                    timeout=min(self.HEARTBEAT_INTERVAL_SECONDS, time_left),
                )
                if not done:
                    # Timeout expired — no task completed yet. Emit a heartbeat
                    # SSE comment so the browser doesn't close the connection.
                    yield ": heartbeat\n\n"
                    continue

                for future in done:
                    key = task_map[future]
                    try:
                        result = future.result()
                    except BaseException as e:
                        # An exception escaped safe_call — emit fallback immediately
                        # so this analyst is never silently dropped.
                        _safe_log(
                            f"[trader_agent] {key} task exception (escaped safe_call): "
                            f"{type(e).__name__}: {e}"
                        )
                        result = _make_fallback(key, type(e).__name__)
                    # Defensive: if safe_call somehow returned a malformed dict
                    # (no 'id'), patch it back to the analyst we sent.
                    if not isinstance(result, dict) or "id" not in result:
                        _safe_log(f"[trader_agent] {key} returned malformed result; using fallback")
                        result = _make_fallback(key, "malformed_result")
                    researcher_results.append(result)
                    seen_ids.add(result["id"])
                    _safe_log(
                        f"[trader_agent] researcher {len(researcher_results)}/{len(active_ids)} -> "
                        f"{result['id']} ({result.get('stance', '?')})"
                    )
                    yield self._sse({"type": "researcher", "result": result})

            # FINAL SAFETY NET: emit a fallback event for any analyst that
            # somehow didn't produce a result. This guarantees the frontend
            # always receives exactly len(active_ids) researcher events.
            for missing_id in active_ids:
                if missing_id in seen_ids:
                    continue
                spec = RESEARCHER_SPECS[missing_id]
                name = spec["name_zh"] if locale == "zh" else spec["name_en"]
                fallback = {
                    "id": missing_id,
                    "name_en": spec["name_en"],
                    "name_zh": spec["name_zh"],
                    "icon": spec["icon"],
                    "color": spec["color"],
                    "stance": "neutral",
                    "confidence": 5,
                    "headline": (
                        f"[{name}] {'analysis unavailable' if locale != 'zh' else '本轮未生成有效分析'}"
                    ),
                    "key_points": [
                        "Analyst skipped (task never completed)" if locale != "zh"
                        else "该席位本轮未完成"
                    ],
                    "evidence": "",
                    "risks": "",
                }
                researcher_results.append(fallback)
                _safe_log(f"[trader_agent] safety-net fallback for {missing_id}")
                yield self._sse({"type": "researcher", "result": fallback})

            # Restore canonical order so the frontend renders consistently
            order = list(RESEARCHER_SPECS.keys())
            researcher_results.sort(key=lambda r: order.index(r["id"]) if r["id"] in order else 999)

            # 3. Debate phase — strict 1v1 cross-examination by opposing stance.
            #
            # Pairing rules (in priority order):
            #   a) Pair with the highest-confidence opponent of OPPOSING stance.
            #   b) For neutrals: pair with the highest-confidence non-neutral peer.
            #   c) If no opposing voice exists at all (rare consensus case): skip
            #      this analyst's rebuttal — there is no real debate to be had.
            #
            # This prevents the v2 problem where every analyst was forced into a
            # rebuttal even when no genuine disagreement existed.
            yield self._sse({"type": "phase", "phase": "debate_start"})
            rebuttals: dict[str, dict] = {}
            results_by_id = {r["id"]: r for r in researcher_results}

            def _opposite_stance(s: str) -> str:
                return {"bullish": "bearish", "bearish": "bullish"}.get(s, "neutral")

            debate_pairs: list[tuple[str, str]] = []
            for r in researcher_results:
                rid = r["id"]
                own_stance = r.get("stance", "neutral")
                if own_stance in ("bullish", "bearish"):
                    target_stance = _opposite_stance(own_stance)
                    candidates = [
                        o for o in researcher_results
                        if o["id"] != rid and o.get("stance") == target_stance
                    ]
                else:  # neutral
                    candidates = [
                        o for o in researcher_results
                        if o["id"] != rid and o.get("stance") in ("bullish", "bearish")
                    ]
                if not candidates:
                    # No genuine opposing voice — skip rather than fabricate a debate.
                    continue
                opponent = max(candidates, key=lambda o: o.get("confidence", 0) or 0)
                debate_pairs.append((rid, opponent["id"]))

            if debate_pairs:
                tasks = [
                    self._call_debate_rebuttal(
                        own_id,
                        results_by_id[own_id],
                        results_by_id[opp_id],
                        ctx,
                        mode,
                        locale,
                    )
                    for own_id, opp_id in debate_pairs
                ]
                outcomes = await asyncio.gather(*tasks, return_exceptions=True)
                for (own_id, opp_id), outcome in zip(debate_pairs, outcomes):
                    if isinstance(outcome, Exception) or not outcome:
                        continue
                    outcome["opponent_id"] = opp_id
                    rebuttals[own_id] = outcome
                    yield self._sse({
                        "type": "rebuttal",
                        "id": own_id,
                        "opponent_id": opp_id,
                        "rebuttal": outcome,
                    })

            # Attach rebuttals onto the researcher records so PM and frontend can both see them
            for r in researcher_results:
                if r["id"] in rebuttals:
                    r["rebuttal"] = rebuttals[r["id"]]

            # 4. Manager phase — sees both initial views AND debate rebuttals.
            # Wrap in BaseException catch so a manager LLM failure (including
            # CancelledError) doesn't lose the researcher results we already have.
            yield self._sse({"type": "phase", "phase": "manager_start"})
            base_block = format_context_for_researcher(ctx, mode, locale)
            try:
                decision = await self._call_manager(researcher_results, base_block, mode, locale)
            except BaseException as e:
                _safe_log(f"[trader_agent] manager pipeline error: {type(e).__name__}: {e}")
                decision = {
                    "decision": "hold",
                    "conviction": 5,
                    "thesis": (
                        f"Manager analysis failed: {type(e).__name__}. "
                        "Researcher briefings are still available below."
                        if locale != "zh"
                        else f"投资经理分析失败：{type(e).__name__}。下方仍可查看各研究员的独立简报。"
                    ),
                    "debate_summary": "",
                    "key_catalysts": [],
                    "main_risks": [],
                    "synthesis": {},
                    "actionable_steps": [],
                    "consensus_score": "",
                }
            yield self._sse({
                "type": "manager",
                "result": {"mode": mode, "ticker": ticker, **decision},
            })

            # 5. Done — emit consolidated state for client persistence
            yield self._sse({
                "type": "done",
                "researchers": researcher_results,
                "manager": decision,
            })

        except BaseException as e:
            # Catch BaseException (incl. CancelledError) so the user sees an
            # explicit error event rather than a silent SSE stream drop.
            yield self._sse({"type": "error", "message": f"{type(e).__name__}: {str(e)}"})

    @staticmethod
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
