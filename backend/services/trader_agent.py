"""
Professional Trader Agent — multi-perspective debate pipeline.

Eight specialist researchers each produce an independent perspective on the
target ticker, then a portfolio manager synthesises a final recommendation.

The pipeline is structured rather than waterfall:
  1. Research Phase (parallel): Bull, Bear, Technical, Fundamental,
     Market, Industry, Financial, News researchers
  2. Debate Phase (sequential): bulls and bears critique each other
  3. Decision Phase: Portfolio Manager produces final call

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
}


# ============================================================
# Output schema enforced via JSON
# ============================================================

# Strict instruction injected into every researcher prompt.
RESEARCHER_OUTPUT_INSTRUCTION_EN = """
## Output Format (STRICT)

Return ONLY a valid JSON object — no preamble, no closing remarks, no markdown fences.

Schema:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <integer 1-10>,
  "headline": "<one-line summary, <=80 chars>",
  "key_points": ["<point 1>", "<point 2>", "<point 3>"],
  "evidence": "<2-3 sentences citing specific numbers from the data>",
  "risks": "<1-2 sentences on what could invalidate this view>"
}

Use only data provided in the research context. Do not invent prices or facts.
"""

RESEARCHER_OUTPUT_INSTRUCTION_ZH = """
## 输出格式（严格）

只返回一个有效的 JSON 对象——不要前言、不要总结、不要 markdown 代码块。

Schema:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <1 到 10 的整数>,
  "headline": "<一句话总结，不超过 80 字>",
  "key_points": ["<要点 1>", "<要点 2>", "<要点 3>"],
  "evidence": "<2-3 句话，引用数据中的具体数字>",
  "risks": "<1-2 句话说明什么会推翻此观点>"
}

只能使用上下文中提供的数据。不要捏造价格或事实。
"""

MANAGER_OUTPUT_INSTRUCTION_EN = """
## Output Format (STRICT)

Return ONLY a valid JSON object — no preamble, no markdown fences.

Schema for STOCK mode:
{
  "decision": "buy" | "hold" | "sell",
  "conviction": <integer 1-10>,
  "time_horizon": "<e.g. '1-3 months'>",
  "thesis": "<3-4 sentences explaining the call>",
  "entry_zone": "<price range, e.g. '$175-180'>",
  "target_price": "<single price, e.g. '$210'>",
  "stop_loss": "<single price>",
  "position_sizing": "<e.g. '2-3% of portfolio'>",
  "key_catalysts": ["<catalyst 1>", "<catalyst 2>"],
  "main_risks": ["<risk 1>", "<risk 2>"],
  "debate_summary": "<2 sentences summarising how bull and bear cases were weighed>"
}

Schema for OPTIONS mode:
{
  "decision": "<strategy name, e.g. 'Bull Call Spread'>",
  "conviction": <integer 1-10>,
  "direction": "bullish" | "bearish" | "neutral",
  "thesis": "<3-4 sentences>",
  "structure": "<exact legs, e.g. 'Buy 1 AAPL May 175C, Sell 1 AAPL May 185C'>",
  "expiration": "<target DTE range>",
  "max_loss": "<absolute dollar or % of underlying>",
  "max_profit": "<absolute dollar or % of underlying>",
  "breakeven": "<single price>",
  "win_probability": "<percentage>",
  "key_catalysts": ["<catalyst 1>", "<catalyst 2>"],
  "main_risks": ["<risk 1>", "<risk 2>"],
  "debate_summary": "<2 sentences>"
}
"""

MANAGER_OUTPUT_INSTRUCTION_ZH = """
## 输出格式（严格）

只返回一个有效的 JSON 对象——不要前言、不要 markdown 代码块。

股票模式 Schema:
{
  "decision": "buy" | "hold" | "sell",
  "conviction": <1 到 10 的整数>,
  "time_horizon": "<例如 '1-3 个月'>",
  "thesis": "<3-4 句话解释决策>",
  "entry_zone": "<价格区间，例如 '$175-180'>",
  "target_price": "<目标价，例如 '$210'>",
  "stop_loss": "<止损价>",
  "position_sizing": "<例如 '组合的 2-3%'>",
  "key_catalysts": ["<催化剂 1>", "<催化剂 2>"],
  "main_risks": ["<风险 1>", "<风险 2>"],
  "debate_summary": "<2 句话总结多空辩论的权衡>"
}

期权模式 Schema:
{
  "decision": "<策略名，例如 '牛市看涨价差'>",
  "conviction": <1 到 10 的整数>,
  "direction": "bullish" | "bearish" | "neutral",
  "thesis": "<3-4 句话>",
  "structure": "<完整腿，例如 '买入 1 张 AAPL 5 月 175C，卖出 1 张 AAPL 5 月 185C'>",
  "expiration": "<目标到期日范围>",
  "max_loss": "<绝对美元或标的占比>",
  "max_profit": "<绝对美元或标的占比>",
  "breakeven": "<盈亏平衡价>",
  "win_probability": "<百分比>",
  "key_catalysts": ["<催化剂 1>", "<催化剂 2>"],
  "main_risks": ["<风险 1>", "<风险 2>"],
  "debate_summary": "<2 句话>"
}
"""


# ============================================================
# Research-context aggregator
# ============================================================

async def gather_research_context(ticker: str, fetcher: DataFetcher) -> dict:
    """Gather all data needed by every researcher in parallel."""
    results = await asyncio.gather(
        fetcher.get_full_market_data(ticker),
        fetcher.get_historical_volatility(ticker),
        fetcher.get_news(ticker, limit=8),
        fetcher.get_analyst_data(ticker),
        return_exceptions=True,
    )

    market = results[0] if not isinstance(results[0], Exception) else {}
    hv = results[1] if not isinstance(results[1], Exception) else {}
    news = results[2] if not isinstance(results[2], Exception) else []
    analyst = results[3] if not isinstance(results[3], Exception) else {}

    return {
        "ticker": ticker,
        "market": market,
        "hv": hv,
        "news": news or [],
        "analyst": analyst or {},
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

        system_prompt = f"{role}\n\n{instruction}"
        user_prompt = context_block

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
        # Build a structured summary of every researcher's view
        digest_lines = []
        for r in researcher_results:
            name = r.get("name_zh") if locale == "zh" else r.get("name_en")
            stance = r.get("stance", "neutral")
            conf = r.get("confidence", 5)
            headline = r.get("headline", "")
            digest_lines.append(
                f"- {name} ({stance}, conviction {conf}/10): {headline}"
            )
        digest = "\n".join(digest_lines)

        if locale == "zh":
            mode_phrase = "期权交易建议" if mode == "options" else "股票交易建议"
            role_intro = (
                f"你是投资决策投资经理（PM）。你刚听取了 8 位研究员的简报，"
                f"现在必须做出最终决定，给出{mode_phrase}。"
                "权衡多空双方的论据，识别共识与分歧，做出果断决策。"
                "不要骑墙——给出明确的方向。"
            )
            instruction = MANAGER_OUTPUT_INSTRUCTION_ZH
        else:
            mode_phrase = "options trade recommendation" if mode == "options" else "stock trade recommendation"
            role_intro = (
                f"You are the Portfolio Manager. You just heard from 8 researchers and "
                f"must now make the final {mode_phrase}. Weigh the bull and bear arguments, "
                "identify consensus and disagreement, and make a decisive call. "
                "Do not sit on the fence — give a clear direction."
            )
            instruction = MANAGER_OUTPUT_INSTRUCTION_EN

        user_prompt = (
            f"{context_block}\n\n"
            f"## Researcher Briefings\n{digest}\n\n"
            "Now make your final decision."
        )
        system_prompt = f"{role_intro}\n\n{instruction}"

        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=1000,
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
