"""
Professional Trader Agent — multi-perspective debate pipeline.

Nine specialist researchers each produce an independent perspective on the
target ticker, then a portfolio manager synthesises a final recommendation.

The pipeline is structured rather than waterfall:
  1. Research Phase (parallel): Bull, Bear, Technical, Fundamental,
     Market, Industry, Financial, News, Options researchers
  2. Decision Phase: Portfolio Manager produces final call with
     per-researcher synthesis showing exactly how each voice was weighted

Output is a strict JSON object so the frontend can render each section
independently in a grid layout (not a single waterfall).
"""
from __future__ import annotations

import json
import asyncio
from typing import AsyncGenerator, Literal, Optional

from backend.services.data_fetcher import DataFetcher


AnalysisMode = Literal["stock", "options"]


# ============================================================
# Researcher specifications (system prompts)
# ============================================================

RESEARCHER_SPECS = {
    "bull": {
        "name_en": "Bull Researcher",
        "name_zh": "看多研究员",
        "icon": "📈",
        "color": "green",
        "role_en": (
            "You are a bull-case research analyst. Your job is to argue the strongest "
            "possible case for buying this stock. Find every reason the price could go "
            "higher: catalysts, margin expansion, market share gains, valuation re-rating, "
            "macro tailwinds. Be specific and cite the data given. Do NOT hedge — your job "
            "is to be the loudest bull voice in the room."
        ),
        "role_zh": (
            "你是看多研究员。你的工作是为该股票构建最强的看多论据。"
            "找出每一个股价可能上涨的理由：催化剂、利润率扩张、市占率增长、估值重估、宏观顺风。"
            "请具体并引用提供的数据。不要含糊——你的角色就是房间里最响亮的多头声音。"
        ),
    },
    "bear": {
        "name_en": "Bear Researcher",
        "name_zh": "看空研究员",
        "icon": "📉",
        "color": "red",
        "role_en": (
            "You are a bear-case research analyst. Your job is to argue the strongest "
            "possible case against this stock. Find every reason the price could fall: "
            "competitive pressure, margin compression, valuation overshoot, regulatory risk, "
            "deteriorating fundamentals. Be specific. Do NOT hedge — your job is to be the "
            "loudest bear voice in the room."
        ),
        "role_zh": (
            "你是看空研究员。你的工作是为该股票构建最强的看空论据。"
            "找出每一个股价可能下跌的理由：竞争压力、利润率压缩、估值过高、监管风险、基本面恶化。"
            "请具体。不要含糊——你的角色就是房间里最响亮的空头声音。"
        ),
    },
    "technical": {
        "name_en": "Technical Researcher",
        "name_zh": "技术面研究员",
        "icon": "📊",
        "color": "blue",
        "role_en": (
            "You are a technical analyst. Analyse the price action: trend direction, "
            "moving averages, support and resistance levels, volume confirmation, momentum. "
            "Identify the key levels to watch and any chart patterns visible in the data. "
            "Conclude with a directional bias from a pure technical standpoint."
        ),
        "role_zh": (
            "你是技术面分析师。请分析价格走势：趋势方向、均线、支撑与阻力位、量价配合、动量。"
            "识别需要关注的关键价位和数据中可见的图表形态。最后给出纯技术面的方向性判断。"
        ),
    },
    "fundamental": {
        "name_en": "Fundamental Researcher",
        "name_zh": "基本面研究员",
        "icon": "💼",
        "color": "purple",
        "role_en": (
            "You are a fundamental analyst. Examine the underlying business: revenue growth "
            "trajectory, profitability, valuation multiples vs peers, balance-sheet strength, "
            "free cash flow generation. Assess whether the current price reflects fair intrinsic "
            "value. Conclude with a fundamental rating: undervalued, fairly valued, or overvalued."
        ),
        "role_zh": (
            "你是基本面分析师。请审视底层业务：收入增长轨迹、盈利能力、相对同行的估值倍数、"
            "资产负债表强度、自由现金流生成能力。评估当前股价是否反映合理内在价值。"
            "最后给出基本面评级：低估、合理估值、高估。"
        ),
    },
    "market": {
        "name_en": "Market Researcher",
        "name_zh": "市场研究员",
        "icon": "🌐",
        "color": "cyan",
        "role_en": (
            "You are a macro/market researcher. Place this stock in the broader market context: "
            "sector rotation, market breadth, risk-on vs risk-off regime, interest-rate environment, "
            "VIX level, USD direction. Determine whether macro is a tailwind or headwind for this name."
        ),
        "role_zh": (
            "你是宏观市场研究员。请把该股票放在更广阔的市场背景下：行业轮动、市场广度、"
            "风险偏好状态（risk-on/risk-off）、利率环境、VIX 水平、美元走向。"
            "判断宏观对这只股票是顺风还是逆风。"
        ),
    },
    "industry": {
        "name_en": "Industry Researcher",
        "name_zh": "行业研究员",
        "icon": "🏭",
        "color": "amber",
        "role_en": (
            "You are an industry analyst. Analyse the company's industry: TAM growth, "
            "competitive landscape, key players, technological disruption, regulatory backdrop. "
            "Determine whether this company is a leader, challenger, or laggard within its industry, "
            "and whether the industry itself is in a favourable phase."
        ),
        "role_zh": (
            "你是行业研究员。请分析公司所处行业：市场总量增长、竞争格局、主要玩家、"
            "技术颠覆、监管背景。判断该公司在行业内是领导者、挑战者还是落后者，"
            "以及行业自身是否处于有利阶段。"
        ),
    },
    "financial": {
        "name_en": "Financial Researcher",
        "name_zh": "财务研究员",
        "icon": "🧮",
        "color": "indigo",
        "role_en": (
            "You are a financial researcher. Focus on the quality and durability of earnings: "
            "gross margin trend, operating leverage, capex intensity, ROIC, debt levels, share-count "
            "trajectory, working-capital efficiency. Flag any accounting red flags or non-GAAP-vs-GAAP "
            "divergences. Conclude with a financial-quality grade A through F."
        ),
        "role_zh": (
            "你是财务研究员。请聚焦盈利质量与可持续性：毛利率趋势、经营杠杆、资本开支强度、"
            "ROIC、债务水平、股本变化、营运资本效率。标记任何会计警讯或 GAAP 与 non-GAAP 的差异。"
            "最后给出财务质量等级（A 到 F）。"
        ),
    },
    "news": {
        "name_en": "News & Events Researcher",
        "name_zh": "新闻事件研究员",
        "icon": "📰",
        "color": "rose",
        "role_en": (
            "You are a news and corporate-events researcher. Review the recent news headlines and "
            "upcoming events (earnings, product launches, regulatory deadlines, insider transactions). "
            "Identify the single most important catalyst in the next 30 days and assess whether it "
            "skews bullish, bearish, or neutral."
        ),
        "role_zh": (
            "你是新闻与公司事件研究员。请审视近期新闻头条与即将发生的事件（财报、产品发布、监管节点、"
            "内部人交易）。识别未来 30 天内最重要的单一催化剂，并评估其偏多、偏空还是中性。"
        ),
    },
    "options": {
        "name_en": "Options Researcher",
        "name_zh": "期权研究员",
        "icon": "🎯",
        "color": "teal",
        "role_en": (
            "You are an options-flow and volatility researcher. Use the Implied Volatility level, "
            "IV Rank, IV Percentile, ATM Greeks (Delta/Gamma/Theta/Vega), and the Gamma Exposure (GEX) "
            "regime if provided. Determine: (1) is IV rich or cheap relative to history; "
            "(2) is the dealer-positioning regime amplifying or compressing moves; "
            "(3) what does the ATM term structure imply about expected near-term move size; "
            "(4) which side of the chain is showing flow conviction. "
            "Conclude with a directional or volatility-regime read that informs strategy selection."
        ),
        "role_zh": (
            "你是期权资金流与波动率研究员。请利用隐含波动率（IV）、IV Rank、IV Percentile、"
            "平值希腊字母（Delta/Gamma/Theta/Vega）以及 Gamma 敞口（GEX）机制（若提供）。判断："
            "(1) IV 相对历史是偏贵还是偏便宜；"
            "(2) 经销商持仓机制是放大还是压制波动；"
            "(3) ATM 期限结构暗示的近期预期波动幅度；"
            "(4) 期权链哪一侧显示了资金信念。"
            "最后给出方向性或波动率机制判断，用于策略选择。"
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

Return ONLY a valid JSON object — no preamble, no closing remarks, no markdown fences.

Schema:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <integer 1-10>,
  "headline": "<one-line summary, <=80 chars, ENGLISH>",
  "key_points": ["<point 1, ENGLISH>", "<point 2, ENGLISH>", "<point 3, ENGLISH>"],
  "evidence": "<2-3 sentences citing specific numbers from the data, ENGLISH>",
  "risks": "<1-2 sentences on what could invalidate this view, ENGLISH>"
}

Use only data provided in the research context. Do not invent prices or facts.
"""

RESEARCHER_OUTPUT_INSTRUCTION_ZH = """
## 输出格式（严格）

语言要求：所有字符串字段的值必须**全部使用简体中文**。绝对不能混合使用英文和中文。
即使 JSON 键名是英文（headline、key_points、evidence、risks），但**值必须全部是中文**。
不要在同一段话里混合英文短语。专业术语首次出现时可在中文后用括号标注英文，但主体必须是中文。

只返回一个有效的 JSON 对象——不要前言、不要总结、不要 markdown 代码块。

Schema:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <1 到 10 的整数>,
  "headline": "<一句话总结，不超过 40 字，中文>",
  "key_points": ["<要点 1，中文>", "<要点 2，中文>", "<要点 3，中文>"],
  "evidence": "<2-3 句话，引用数据中的具体数字，中文>",
  "risks": "<1-2 句话说明什么会推翻此观点，中文>"
}

只能使用上下文中提供的数据。不要捏造价格或事实。
"""

MANAGER_OUTPUT_INSTRUCTION_EN = """
## Output Format (STRICT)

LANGUAGE: Write ALL string values in ENGLISH ONLY. No mixed-language output.
Return ONLY a valid JSON object — no preamble, no markdown fences.

You MUST include `synthesis` — a per-researcher reasoning chain showing how each
voice influenced your final call. Include all 9 researcher IDs:
bull, bear, technical, fundamental, market, industry, financial, news, options.

Schema for STOCK mode:
{
  "decision": "buy" | "hold" | "sell",
  "conviction": <integer 1-10>,
  "time_horizon": "<e.g. '1-3 months', ENGLISH>",
  "thesis": "<5-7 sentences. Open with the dominant signal, then explain how you weighted the bull vs bear case, what the technical/fundamental setup adds, and what the options market is pricing in. Final sentence: the trigger that confirms or invalidates the call.>",
  "entry_zone": "<price range, e.g. '$175-180'>",
  "target_price": "<single price>",
  "stop_loss": "<single price>",
  "position_sizing": "<e.g. '2-3% of portfolio'>",
  "key_catalysts": ["<catalyst 1>", "<catalyst 2>", "<catalyst 3>"],
  "main_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "synthesis": {
    "bull":        "<1-2 sentences: how this researcher's view affected the decision>",
    "bear":        "<1-2 sentences>",
    "technical":   "<1-2 sentences>",
    "fundamental": "<1-2 sentences>",
    "market":      "<1-2 sentences>",
    "industry":    "<1-2 sentences>",
    "financial":   "<1-2 sentences>",
    "news":        "<1-2 sentences>",
    "options":     "<1-2 sentences>"
  },
  "consensus_score": "<e.g. '6 of 9 leaning bullish, 2 bearish, 1 neutral' — count from the briefings>",
  "debate_summary": "<3-4 sentences walking through the strongest bull argument, the strongest bear argument, and why the bull/bear ultimately won (or why you held).>",
  "actionable_steps": ["<step 1: e.g. 'Wait for a pullback to 175 before entering'>", "<step 2>", "<step 3>"]
}

Schema for OPTIONS mode:
{
  "decision": "<strategy name, e.g. 'Bull Call Spread'>",
  "conviction": <integer 1-10>,
  "direction": "bullish" | "bearish" | "neutral",
  "thesis": "<5-7 sentences. Open with the IV regime, then the directional read, then why this specific structure dominates alternatives.>",
  "structure": "<exact legs, e.g. 'Buy 1 AAPL Jun 175C @ ~$8.50, Sell 1 AAPL Jun 185C @ ~$3.20, net debit ~$5.30'>",
  "expiration": "<target DTE range>",
  "max_loss": "<absolute dollar>",
  "max_profit": "<absolute dollar>",
  "breakeven": "<single price>",
  "win_probability": "<percentage>",
  "key_catalysts": ["<catalyst 1>", "<catalyst 2>", "<catalyst 3>"],
  "main_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "synthesis": {
    "bull":        "<1-2 sentences>",
    "bear":        "<1-2 sentences>",
    "technical":   "<1-2 sentences>",
    "fundamental": "<1-2 sentences>",
    "market":      "<1-2 sentences>",
    "industry":    "<1-2 sentences>",
    "financial":   "<1-2 sentences>",
    "news":        "<1-2 sentences>",
    "options":     "<1-2 sentences — most important for options mode>"
  },
  "consensus_score": "<e.g. '6 of 9 leaning bullish'>",
  "debate_summary": "<3-4 sentences>",
  "actionable_steps": ["<step 1>", "<step 2>", "<step 3>"]
}
"""

MANAGER_OUTPUT_INSTRUCTION_ZH = """
## 输出格式（严格）

语言要求：所有字符串字段的值必须**全部使用简体中文**，不能混合使用英文。
JSON 键名是英文，但所有值必须是中文。

只返回一个有效的 JSON 对象——不要前言、不要 markdown 代码块。

你**必须**包含 `synthesis` 字段——逐个研究员的推理链，说明每位研究员的观点如何影响你的最终决策。
必须包含全部 9 位研究员的 ID：bull、bear、technical、fundamental、market、industry、financial、news、options。

股票模式 Schema:
{
  "decision": "buy" | "hold" | "sell",
  "conviction": <1 到 10 的整数>,
  "time_horizon": "<例如 '1-3 个月'，中文>",
  "thesis": "<5-7 句话。开头点明主导信号，然后说明如何权衡多空双方，技术面/基本面贡献了什么，期权市场在定价什么。最后一句：什么信号会确认或推翻决策。中文。>",
  "entry_zone": "<价格区间，例如 '$175-180'>",
  "target_price": "<目标价>",
  "stop_loss": "<止损价>",
  "position_sizing": "<例如 '组合的 2-3%'>",
  "key_catalysts": ["<催化剂 1，中文>", "<催化剂 2，中文>", "<催化剂 3，中文>"],
  "main_risks": ["<风险 1，中文>", "<风险 2，中文>", "<风险 3，中文>"],
  "synthesis": {
    "bull":        "<1-2 句话：看多研究员的观点如何影响决策。中文。>",
    "bear":        "<1-2 句话，中文>",
    "technical":   "<1-2 句话，中文>",
    "fundamental": "<1-2 句话，中文>",
    "market":      "<1-2 句话，中文>",
    "industry":    "<1-2 句话，中文>",
    "financial":   "<1-2 句话，中文>",
    "news":        "<1-2 句话，中文>",
    "options":     "<1-2 句话，中文>"
  },
  "consensus_score": "<例如 '9 位研究员中 6 位看多、2 位看空、1 位中性'——根据简报数清楚。中文。>",
  "debate_summary": "<3-4 句话，走一遍最强的多头论点、最强的空头论点，以及最终多/空胜出（或观望）的原因。中文。>",
  "actionable_steps": ["<步骤 1：例如 '等待回踩 175 美元再入场'，中文>", "<步骤 2，中文>", "<步骤 3，中文>"]
}

期权模式 Schema:
{
  "decision": "<策略名，例如 '牛市看涨价差 (Bull Call Spread)'>",
  "conviction": <1 到 10 的整数>,
  "direction": "bullish" | "bearish" | "neutral",
  "thesis": "<5-7 句话。开头点明 IV 机制，再写方向判断，最后解释为何此结构优于其他备选。中文。>",
  "structure": "<完整腿，例如 '买入 1 张 AAPL 6 月 175C @ 约 $8.50，卖出 1 张 AAPL 6 月 185C @ 约 $3.20，净支出约 $5.30'>",
  "expiration": "<目标到期日范围，中文>",
  "max_loss": "<绝对美元数额>",
  "max_profit": "<绝对美元数额>",
  "breakeven": "<盈亏平衡价>",
  "win_probability": "<百分比>",
  "key_catalysts": ["<催化剂 1，中文>", "<催化剂 2，中文>", "<催化剂 3，中文>"],
  "main_risks": ["<风险 1，中文>", "<风险 2，中文>", "<风险 3，中文>"],
  "synthesis": {
    "bull":        "<1-2 句话，中文>",
    "bear":        "<1-2 句话，中文>",
    "technical":   "<1-2 句话，中文>",
    "fundamental": "<1-2 句话，中文>",
    "market":      "<1-2 句话，中文>",
    "industry":    "<1-2 句话，中文>",
    "financial":   "<1-2 句话，中文>",
    "news":        "<1-2 句话，中文>",
    "options":     "<1-2 句话——期权模式下此项最重要。中文。>"
  },
  "consensus_score": "<例如 '9 位研究员中 6 位看多'，中文>",
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

    Includes options-specific data (snapshot + GEX) for the Options Researcher
    when an expiration is resolvable. Failures on any single fetch are isolated
    via gather(..., return_exceptions=True) so the pipeline never tanks
    because one provider is rate-limited.
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

    # Now fetch everything else in parallel
    options_snapshot_task = (
        fetcher.get_options_snapshot(ticker, target_exp) if target_exp else None
    )
    gex_task = (
        fetcher.get_gamma_exposure(ticker, target_exp) if target_exp and hasattr(fetcher, "get_gamma_exposure") else None
    )

    tasks = [
        fetcher.get_historical_volatility(ticker),
        fetcher.get_news(ticker, limit=8),
        fetcher.get_analyst_data(ticker),
    ]
    if options_snapshot_task is not None:
        tasks.append(options_snapshot_task)
    if gex_task is not None:
        tasks.append(gex_task)

    results = await asyncio.gather(*tasks, return_exceptions=True)

    hv = results[0] if not isinstance(results[0], Exception) else {}
    news = results[1] if not isinstance(results[1], Exception) else []
    analyst = results[2] if not isinstance(results[2], Exception) else {}
    idx = 3
    options_snapshot = {}
    gex_data = {}
    if options_snapshot_task is not None:
        options_snapshot = results[idx] if not isinstance(results[idx], Exception) else {}
        idx += 1
    if gex_task is not None:
        gex_data = results[idx] if not isinstance(results[idx], Exception) else {}

    return {
        "ticker": ticker,
        "market": market,
        "hv": hv,
        "news": news or [],
        "analyst": analyst or {},
        "options_snapshot": options_snapshot or {},
        "gex": gex_data or {},
        "target_expiration": target_exp,
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


# ============================================================
# Pipeline
# ============================================================

class TraderAgentPipeline:
    """Orchestrates the 8-researcher + portfolio-manager debate."""

    def __init__(self, llm_client, model: str, fetcher: DataFetcher):
        self.client = llm_client
        self.model = model
        self.fetcher = fetcher

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

        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.4,
                max_tokens=600,
            )
            content = resp.choices[0].message.content or ""
            parsed = self._parse_json(content)
        except Exception as e:
            parsed = {
                "stance": "neutral",
                "confidence": 5,
                "headline": f"[{spec.get('name_en')}] analysis unavailable",
                "key_points": [f"Error: {type(e).__name__}"],
                "evidence": "",
                "risks": "",
            }

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
        # full key_points + evidence to write its synthesis section.
        digest_lines = []
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
        digest = "\n".join(digest_lines)

        if locale == "zh":
            mode_phrase = "期权交易建议" if mode == "options" else "股票交易建议"
            role_intro = (
                f"你是投资决策投资经理（Portfolio Manager / PM）。"
                f"你刚听取了 9 位研究员（看多、看空、技术面、基本面、市场、行业、财务、新闻事件、期权）的完整简报。"
                f"现在你必须做出最终决定，给出{mode_phrase}。\n\n"
                "决策要求：\n"
                "1. 权衡 9 位研究员的论据，识别共识与分歧；\n"
                "2. 必须填写 synthesis 字段，逐个解释每位研究员的观点如何影响最终决策；\n"
                "3. consensus_score 字段需要明确数清楚有多少位看多/看空/中性；\n"
                "4. thesis 必须 5-7 句话，写出完整的推理链条；\n"
                "5. debate_summary 必须详述最强多头与最强空头的论点，以及最终为何选边；\n"
                "6. actionable_steps 至少 3 步具体执行步骤；\n"
                "7. 不要骑墙——给出明确的方向和数字。\n"
                "8. 所有输出必须使用简体中文。"
            )
            instruction = MANAGER_OUTPUT_INSTRUCTION_ZH
            lang_directive = "重要：所有输出值必须全部使用简体中文。不要混合中英文。"
        else:
            mode_phrase = "options trade recommendation" if mode == "options" else "stock trade recommendation"
            role_intro = (
                f"You are the Portfolio Manager. You just heard from 9 researchers "
                f"(Bull, Bear, Technical, Fundamental, Market, Industry, Financial, News & Events, Options) "
                f"must now make the final {mode_phrase}. Weigh the bull and bear arguments, "
                "identify consensus and disagreement, and make a decisive call. "
                "Do not sit on the fence — give a clear direction."
            )
            role_intro += (
                "and must now make the final " + mode_phrase + ".\n\n"
                "Decision requirements:\n"
                "1. Weigh all 9 researchers' arguments; identify consensus and disagreement.\n"
                "2. You MUST fill the `synthesis` object: explain how each researcher's view influenced the call.\n"
                "3. `consensus_score` should explicitly count how many lean bullish / bearish / neutral.\n"
                "4. `thesis` must be 5-7 sentences with a complete reasoning chain.\n"
                "5. `debate_summary` must walk through the strongest bull and bear arguments and explain who won.\n"
                "6. `actionable_steps` must contain at least 3 concrete steps.\n"
                "7. Do not sit on the fence — give a clear direction and concrete numbers.\n"
                "8. All output values must be in English only."
            )
            instruction = MANAGER_OUTPUT_INSTRUCTION_EN
            lang_directive = "IMPORTANT: All output values must be in ENGLISH ONLY. Do not mix languages."

        user_prompt = (
            f"{context_block}\n\n"
            f"## Researcher Briefings (full)\n{digest}\n\n"
            f"{lang_directive}\n\n"
            "Now make your final decision. Remember: fill EVERY field of the schema, especially `synthesis` for all 9 researchers and `actionable_steps`."
        )
        system_prompt = f"{lang_directive}\n\n{role_intro}\n\n{instruction}"

        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=2200,  # raised: synthesis + actionable_steps + extended thesis
            )
            content = resp.choices[0].message.content or ""
            return self._parse_json(content)
        except Exception as e:
            return {
                "decision": "hold",
                "conviction": 5,
                "thesis": f"Manager analysis unavailable: {type(e).__name__}",
                "debate_summary": "Pipeline error",
                "key_catalysts": [],
                "main_risks": [],
                "synthesis": {},
                "actionable_steps": [],
                "consensus_score": "",
            }

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Best-effort JSON extraction from a model response."""
        text = text.strip()
        # Strip optional markdown code fence
        if text.startswith("```"):
            text = text.split("```", 2)[-1] if text.count("```") >= 2 else text
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        # Find first { and last }
        if "{" in text and "}" in text:
            start = text.find("{")
            end = text.rfind("}")
            text = text[start : end + 1]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {}

    async def run(
        self,
        ticker: str,
        mode: AnalysisMode,
        locale: str,
    ) -> AsyncGenerator[str, None]:
        """
        Run the full pipeline. Yields SSE-formatted strings.

        Events emitted:
          - data: {"type": "phase", "phase": "research_start"}
          - data: {"type": "researcher", "result": {...}}  (one per researcher)
          - data: {"type": "phase", "phase": "manager_start"}
          - data: {"type": "manager", "result": {...}}
          - data: {"type": "done"}
          - data: {"type": "error", "message": "..."}
        """
        try:
            # 1. Gather context
            yield self._sse({"type": "phase", "phase": "gathering_data"})
            ctx = await gather_research_context(ticker, self.fetcher)
            context_block = format_context_for_researcher(ctx, mode, locale)

            # 2. Research phase (all 8 in parallel)
            yield self._sse({"type": "phase", "phase": "research_start"})
            tasks = [
                self._call_researcher(key, spec, context_block, locale)
                for key, spec in RESEARCHER_SPECS.items()
            ]
            # Stream results as they complete
            researcher_results: list[dict] = []
            for coro in asyncio.as_completed(tasks):
                result = await coro
                researcher_results.append(result)
                yield self._sse({"type": "researcher", "result": result})

            # Restore canonical order so the frontend can render in
            # bull/bear/technical/... order even though they finished out of order.
            order = list(RESEARCHER_SPECS.keys())
            researcher_results.sort(key=lambda r: order.index(r["id"]) if r["id"] in order else 999)

            # 3. Manager phase
            yield self._sse({"type": "phase", "phase": "manager_start"})
            decision = await self._call_manager(researcher_results, context_block, mode, locale)
            yield self._sse({
                "type": "manager",
                "result": {
                    "mode": mode,
                    "ticker": ticker,
                    **decision,
                },
            })

            # 4. Done — also emit the consolidated researcher_results in canonical order
            yield self._sse({
                "type": "done",
                "researchers": researcher_results,
                "manager": decision,
            })

        except Exception as e:
            yield self._sse({"type": "error", "message": f"{type(e).__name__}: {str(e)}"})

    @staticmethod
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
