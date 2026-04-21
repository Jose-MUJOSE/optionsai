"""
OptionsAI - 多Agent协作架构
Researcher → Analyst → Verifier 三阶段协作
"""
from __future__ import annotations

import json
import asyncio
from typing import Optional, AsyncGenerator

from backend.models.schemas import ChatContext
from backend.services.data_fetcher import DataFetcher


class ResearcherAgent:
    """纯数据收集 Agent，无 LLM 调用，并发获取市场数据"""

    async def gather(self, context: Optional[ChatContext], fetcher: DataFetcher) -> dict:
        """并发收集所有相关市场数据"""
        if not context or not context.ticker:
            return {}

        ticker = context.ticker

        # 并发获取数据
        results = await asyncio.gather(
            fetcher.get_spot_price(ticker),
            fetcher.get_historical_volatility(ticker),
            fetcher.get_news(ticker, limit=3),
            fetcher.get_analyst_data(ticker),
            return_exceptions=True
        )

        spot_data = results[0] if not isinstance(results[0], Exception) else {}
        hv_data = results[1] if not isinstance(results[1], Exception) else {}
        news = results[2] if not isinstance(results[2], Exception) else []
        analyst_data = results[3] if not isinstance(results[3], Exception) else {}

        return {
            "ticker": ticker,
            "spot_price": spot_data.get("spot_price", 0),
            "change_pct": spot_data.get("change_pct", 0),
            "hv_30": hv_data.get("hv_30", 0),
            "hv_60": hv_data.get("hv_60", 0),
            "recent_news_titles": [n.get("title", "") for n in (news or [])[:3]],
            "analyst_target_mean": analyst_data.get("target_mean"),
            "analyst_recommendation": analyst_data.get("recommendation", ""),
            "num_analysts": analyst_data.get("num_analysts", 0),
        }


class AnalystAgent:
    """LLM 分析 Agent，支持流式输出和 retry_feedback 注入"""

    def build_enriched_prompt(
        self,
        research: dict,
        context: Optional[ChatContext],
        retry_feedback: str = ""
    ) -> str:
        """构建包含 ResearcherAgent 数据的增强系统提示"""
        from backend.services.ai_assistant import build_system_prompt
        base_prompt = build_system_prompt(context)

        # 附加 researcher 收集的额外数据
        extra = []
        if research.get("hv_30"):
            extra.append(f"- Historical Volatility (30D): {research['hv_30']:.1f}%")
        if research.get("hv_60"):
            extra.append(f"- Historical Volatility (60D): {research['hv_60']:.1f}%")
        if research.get("analyst_target_mean"):
            extra.append(f"- Analyst Consensus Target: ${research['analyst_target_mean']:.2f} ({research.get('num_analysts', 0)} analysts)")
        if research.get("analyst_recommendation"):
            extra.append(f"- Analyst Recommendation: {research['analyst_recommendation']}")
        if research.get("recent_news_titles"):
            titles = "; ".join(research["recent_news_titles"][:2])
            extra.append(f"- Recent News: {titles}")

        if extra:
            base_prompt += "\n\n## Additional Research Data\n" + "\n".join(extra)

        # 若有 retry feedback，追加修正指示
        if retry_feedback:
            base_prompt += f"\n\n## IMPORTANT: Correction Required\nThe previous analysis had issues. Please address these: {retry_feedback}\nProvide a corrected, accurate analysis."

        return base_prompt

    async def analyze_stream(
        self,
        messages: list[dict],
        research: dict,
        context: Optional[ChatContext],
        retry_feedback: str = ""
    ) -> AsyncGenerator[str, None]:
        """流式 LLM 分析（支持 user 消息中的 images）"""
        from backend.services.ai_assistant import (
            client,
            MODEL,
            _build_api_messages,
            message_has_images,
            _looks_like_vision_error,
            VisionNotSupportedError,
        )

        # 先通过 ai_assistant 的 multimodal 构建器获得标准 OpenAI messages
        # (包含 system_prompt + user/assistant + image content blocks)
        full_messages = _build_api_messages(messages, context)

        # 覆写 system prompt 为包含 researcher 数据的增强版
        enriched = self.build_enriched_prompt(research, context, retry_feedback)
        if full_messages and full_messages[0].get("role") == "system":
            full_messages[0] = {"role": "system", "content": enriched}
        else:
            full_messages.insert(0, {"role": "system", "content": enriched})

        try:
            response = await client.chat.completions.create(
                model=MODEL,
                messages=full_messages,
                stream=True,
                temperature=0.7,
                max_tokens=2000,
            )
        except Exception as err:
            if message_has_images(messages) and _looks_like_vision_error(err):
                raise VisionNotSupportedError(
                    f"配置的模型 {MODEL!r} 不支持图像输入。请在设置中切换到视觉模型后重试。"
                ) from err
            raise

        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                yield delta.content


class VerifierAgent:
    """验证 Agent，检查分析的一致性和准确性"""

    VERIFY_SYSTEM = """You are a strict financial analysis verifier. Your job is to check if an options analysis is accurate and consistent.

Check these specific things:
1. If a strategy is recommended, does the max loss match the strategy type? (Long call max loss = premium paid, credit spread max loss = width - credit received, etc.)
2. Is the breakeven calculation correct? (Call: strike + premium paid, Put: strike - premium paid)
3. Is the directional view (bullish/bearish/neutral) consistent with the recommended strategy?
4. Are any numbers wildly inconsistent (e.g., claiming 500% return on a defined-risk spread)?

Respond ONLY with valid JSON in this exact format:
{"valid": true/false, "issues": ["issue1", "issue2"], "corrections": "brief description of what to fix"}

If valid, set "valid": true and "issues": [] and "corrections": "".
Be lenient - only flag clear mathematical errors or logical contradictions, not style preferences."""

    async def verify(
        self,
        analysis_text: str,
        context: Optional[ChatContext],
        research: dict
    ) -> dict:
        """验证分析内容，返回 {"valid": bool, "issues": list, "corrections": str}"""
        from backend.services.ai_assistant import client, MODEL

        # Build verification context
        ctx_info = ""
        if context and context.selected_strategy:
            s = context.selected_strategy
            ctx_info = f"Strategy being analyzed: {s.name_en}, Max Loss: ${s.max_loss:.2f}, Max Profit: ${s.max_profit:.2f}"
        if context and context.market_data:
            ctx_info += f"\nSpot Price: ${context.market_data.spot_price:.2f}"

        verify_prompt = f"""Context: {ctx_info}

Analysis to verify:
{analysis_text[:3000]}

Check for accuracy and respond with JSON only."""

        try:
            response = await client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": self.VERIFY_SYSTEM},
                    {"role": "user", "content": verify_prompt},
                ],
                stream=False,
                temperature=0,
                max_tokens=400,
            )
            content = response.choices[0].message.content.strip()
            # Extract JSON if wrapped in markdown
            if "```" in content:
                import re
                match = re.search(r"\{.*\}", content, re.DOTALL)
                content = match.group(0) if match else content
            result = json.loads(content)
            return {
                "valid": bool(result.get("valid", True)),
                "issues": result.get("issues", []),
                "corrections": result.get("corrections", ""),
            }
        except Exception:
            # If verification fails, assume valid to not block the user
            return {"valid": True, "issues": [], "corrections": ""}


async def run_agent_pipeline(
    messages: list[dict],
    context: Optional[ChatContext],
    fetcher: DataFetcher,
) -> AsyncGenerator[str, None]:
    """
    主 Agent 流程编排器
    Researcher → Analyst (stream) → Verifier → retry if needed
    使用 SSE 格式 yield 所有输出
    """
    # Step 1: Researcher
    yield "data: [AGENT:researcher]\n\n"
    try:
        researcher = ResearcherAgent()
        research = await researcher.gather(context, fetcher)
    except Exception:
        research = {}

    # Step 2-4: Analyst + Verifier loop (max 2 retries)
    analyst = AnalystAgent()
    verifier = VerifierAgent()
    retry_feedback = ""

    for attempt in range(3):
        if attempt > 0:
            yield f"data: [RETRY:{attempt}]\n\n"

        yield "data: [AGENT:analyst]\n\n"
        full_text = ""

        try:
            async for chunk in analyst.analyze_stream(messages, research, context, retry_feedback):
                if chunk:
                    full_text += chunk
                    # Escape newlines for SSE (SSE uses \n\n as message separator)
                    safe_chunk = chunk.replace("\n", "\\n")
                    yield f"data: {safe_chunk}\n\n"
        except Exception as e:
            # 明确标记"视觉不支持"这种可恢复的用户错误
            from backend.services.ai_assistant import VisionNotSupportedError
            if isinstance(e, VisionNotSupportedError):
                yield "data: [VISION_UNSUPPORTED]\n\n"
                # 把中文描述作为正文内容也 yield 出去，让聊天气泡显示出提示
                safe = str(e).replace("\n", "\\n")
                yield f"data: {safe}\n\n"
                yield "data: [DONE]\n\n"
                return
            yield f"data: [ERROR] Analysis failed: {str(e)}\n\n"
            yield "data: [DONE]\n\n"
            return

        yield "data: [AGENT:verifier]\n\n"

        try:
            result = await verifier.verify(full_text, context, research)
        except Exception:
            result = {"valid": True, "issues": [], "corrections": ""}

        if result["valid"]:
            yield "data: [VERIFIED]\n\n"
            break
        else:
            retry_feedback = result.get("corrections", "")
            if attempt == 2:
                # Max retries reached
                yield "data: [VERIFY_FAILED]\n\n"

    yield "data: [DONE]\n\n"
