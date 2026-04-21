"""
OptionsAI - AI 投研助手
支持 DeepSeek / OpenAI / Anthropic 等 OpenAI 兼容接口
"""
from __future__ import annotations

import os
import json
from typing import Optional, AsyncGenerator

from openai import AsyncOpenAI
from dotenv import load_dotenv

from backend.models.schemas import ChatContext, Strategy, MarketData

from pathlib import Path
_env_path = Path(__file__).resolve().parent.parent / ".env"  # backend/.env
load_dotenv(_env_path, override=True)

# 从配置加载 LLM 设置
try:
    from backend.services.config_store import get_config
    _cfg = get_config()
    _api_key = _cfg.get("llm_api_key", "") or os.getenv("DEEPSEEK_API_KEY", "")
    _base_url = _cfg.get("llm_base_url", "") or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    MODEL = _cfg.get("llm_model", "") or "deepseek-chat"
except Exception:
    _api_key = os.getenv("DEEPSEEK_API_KEY", "")
    _base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    MODEL = "deepseek-chat"

print(f"[AI Assistant] base_url={_base_url}, key={_api_key[:8]}...")

client = AsyncOpenAI(
    api_key=_api_key,
    base_url=_base_url,
)


def reconfigure_client(api_key: str, base_url: str, model: str):
    """运行时重新配置 LLM 客户端"""
    global client, MODEL
    if api_key:
        client = AsyncOpenAI(api_key=api_key, base_url=base_url or "https://api.deepseek.com/v1")
    if model:
        MODEL = model
    print(f"[AI Assistant] Reconfigured: base_url={base_url}, model={MODEL}")


# ============================================================
# System Prompt 模板 (参考 Jenova.ai 的 AAP 案例风格)
# ============================================================

SYSTEM_PROMPT_TEMPLATE = """You are OptionsAI's senior quantitative options strategist with 15+ years of Wall Street experience. You serve as the user's personal options investment research assistant.

## Your Identity
- Name: OptionsAI Strategist
- Expertise: Options pricing (Black-Scholes, Greeks), volatility trading, multi-leg strategy construction, risk management
- Communication style: Professional yet accessible, data-driven, always cite specific numbers

## Current Market Context (LIVE DATA - USE THIS)
{market_context}

## Currently Selected Strategy (if any)
{strategy_context}

## Response Guidelines

### For FIRST/comprehensive analysis, use structured format:

**1. Market Environment** (1-2 sentences)
- Price, IV level, key events

**2. Strategy Analysis** (for each strategy)
- Execution details (strikes, premiums)
- Max profit/loss, breakeven
- IV Crush & Theta impact
- Pros vs cons

**3. Position Sizing** (brief table if relevant)

**4. Trading Tips** (2-3 bullet points)
- Order type, timing, stop loss

### For FOLLOW-UP questions:
- Be **concise and focused** — answer the specific question directly
- Use 3-8 sentences unless a detailed analysis is requested
- Skip sections that aren't relevant to the follow-up

## Formatting Rules
- Use `###` for section headers (not `####`)
- Use **bold** for key numbers and terms
- Use `|` tables for comparisons (keep them short)
- Use `-` bullet lists, keep items to 1-2 lines
- Add a blank line before and after tables
- Never use more than 3 levels of nesting
- Keep paragraphs short (2-3 sentences max)

## IMPORTANT RULES
1. ALWAYS use the provided market data — never make up numbers
2. ALWAYS provide specific strike prices and dollar amounts
3. ALWAYS analyze IV Crush risk when IV is elevated
4. ALWAYS mention earnings date risk if within the strategy's timeframe
5. Respond in the SAME LANGUAGE as the user's message
6. Be opinionated — rank strategies and give clear recommendations
7. Include a brief risk disclaimer at the end
"""


def build_system_prompt(context: Optional[ChatContext] = None) -> str:
    """
    动态构建 System Prompt，注入实时市场数据和策略上下文
    """
    from datetime import datetime
    date_str = datetime.now().strftime("%Y-%m-%d")

    # 默认值
    market_context = "No market data available. Ask the user for a ticker symbol."
    strategy_context = "No strategy currently selected."
    spot_price = "N/A"
    target_info = "Not specified"
    iv = "N/A"
    iv_level = "unknown"
    iv_percentile = "N/A"
    earnings_info = "Unknown"

    if context:
        # 注入市场数据
        if context.market_data:
            md = context.market_data
            spot_price = f"{md.spot_price:.2f}"
            iv = f"{md.iv_current:.1f}"
            iv_percentile = f"{md.iv_percentile:.0f}"

            # IV 水平判断
            if md.iv_rank < 30:
                iv_level = "LOW (options are relatively cheap)"
            elif md.iv_rank < 65:
                iv_level = "MODERATE"
            else:
                iv_level = "HIGH (options are expensive, favor selling strategies)"

            earnings_info = md.next_earnings_date or "No upcoming earnings in near term"

            market_context = f"""
Ticker: {md.ticker}
Current Price: ${md.spot_price:.2f} ({md.change_pct:+.2f}% today)
30-Day Implied Volatility: {md.iv_current:.1f}%
IV Rank: {md.iv_rank:.0f}/100
IV Percentile: {md.iv_percentile:.0f}%
30-Day Historical Volatility: {md.hv_30:.1f}%
Next Earnings Date: {md.next_earnings_date or 'N/A'}
Available Expirations: {', '.join(md.expirations[:5])}{'...' if len(md.expirations) > 5 else ''}
"""

        # 注入目标价
        if context.target_price:
            if context.market_data:
                pct = ((context.target_price - context.market_data.spot_price)
                       / context.market_data.spot_price * 100)
                target_info = f"${context.target_price:.2f} ({pct:+.1f}%)"
            else:
                target_info = f"${context.target_price:.2f}"

        # 注入策略上下文
        if context.selected_strategy:
            s = context.selected_strategy
            legs_desc = "\n".join(f"  - {leg.description}" for leg in s.legs)
            strategy_context = f"""
Strategy: {s.name} ({s.name_en})
Type Tag: {s.tag}
Legs:
{legs_desc}
Net Debit/Credit: ${s.net_debit_credit:.2f}
Max Profit: ${s.max_profit:.2f} ({s.max_profit_pct:.1f}%)
Max Loss: ${s.max_loss:.2f}
Breakeven(s): {', '.join(f'${b:.2f}' for b in s.breakevens)}
Win Probability: {s.win_probability:.1f}%
Required Capital: ${s.required_capital:.2f}
"""

        # 注入用户趋势
        if context.user_trend:
            market_context += f"\nUser's Trend Expectation: {context.user_trend}"

    return SYSTEM_PROMPT_TEMPLATE.format(
        market_context=market_context,
        strategy_context=strategy_context,
        date=date_str,
        spot_price=spot_price,
        target_info=target_info,
        iv=iv,
        iv_level=iv_level,
        iv_percentile=iv_percentile,
        earnings_info=earnings_info,
    )


# ============================================================
# Multimodal helpers — OpenAI-compatible vision content blocks
# ============================================================

class VisionNotSupportedError(RuntimeError):
    """
    当 LLM 在收到图像时拒绝请求（例如 DeepSeek-chat 等纯文本模型）时抛出。
    chat router 会捕获并返回友好错误，让前端提示用户切换到视觉模型。
    """


def _looks_like_vision_error(err: Exception) -> bool:
    """识别 OpenAI-兼容接口返回的"模型不支持图像"类错误。"""
    text = f"{type(err).__name__}: {err}".lower()
    vision_markers = (
        "image_url",
        "vision",
        "multimodal",
        "unsupported content",
        "invalid content type",
        "only text",
        "image input",
    )
    return any(marker in text for marker in vision_markers)


def _build_api_messages(
    messages: list[dict],
    context: Optional[ChatContext],
) -> list[dict]:
    """
    将 [{role, content, images?}] 转换为 OpenAI Chat Completions 格式。

    - 无图像：content 为字符串（保持与纯文本模型兼容）
    - 有图像：content 为 [{type:"text", text:...}, {type:"image_url", image_url:{url:...}}]
      仅 user 角色消息会接受 images，assistant 消息的 images 会被忽略。
    """
    system_prompt = build_system_prompt(context)
    api_messages: list[dict] = [{"role": "system", "content": system_prompt}]

    for msg in messages:
        role = msg.get("role", "user")
        text = msg.get("content", "") or ""
        images = msg.get("images") if role == "user" else None

        if images and isinstance(images, list):
            # 过滤：只保留 data: URL 或 http(s) URL
            valid = [
                img for img in images
                if isinstance(img, str)
                and (img.startswith("data:image/") or img.startswith("http://") or img.startswith("https://"))
            ]
            if valid:
                content_blocks: list[dict] = []
                if text.strip():
                    content_blocks.append({"type": "text", "text": text})
                for url in valid:
                    content_blocks.append({
                        "type": "image_url",
                        "image_url": {"url": url},
                    })
                api_messages.append({"role": role, "content": content_blocks})
                continue

        api_messages.append({"role": role, "content": text})

    return api_messages


def message_has_images(messages: list[dict]) -> bool:
    """判断消息列表中是否存在 user 消息携带了图像。"""
    for msg in messages:
        if msg.get("role") == "user":
            imgs = msg.get("images")
            if isinstance(imgs, list) and any(
                isinstance(i, str) and (i.startswith("data:image/") or i.startswith("http"))
                for i in imgs
            ):
                return True
    return False


# ============================================================
# DeepSeek API 调用
# ============================================================

async def chat_completion(
    messages: list[dict],
    context: Optional[ChatContext] = None,
) -> str:
    """
    非流式 Chat Completion
    返回完整回复文本
    """
    api_messages = _build_api_messages(messages, context)

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=api_messages,
            temperature=0.7,
            max_tokens=4096,
        )
    except Exception as err:
        if message_has_images(messages) and _looks_like_vision_error(err):
            raise VisionNotSupportedError(
                f"配置的模型 {MODEL!r} 不支持图像输入。请在设置中切换到视觉模型（如 gpt-4o、qwen-vl-max、claude-3.5-sonnet）后重试。"
            ) from err
        raise

    return response.choices[0].message.content


async def chat_completion_stream(
    messages: list[dict],
    context: Optional[ChatContext] = None,
) -> AsyncGenerator[str, None]:
    """
    流式 Chat Completion (SSE)
    逐块 yield 文本
    """
    api_messages = _build_api_messages(messages, context)

    try:
        stream = await client.chat.completions.create(
            model=MODEL,
            messages=api_messages,
            temperature=0.7,
            max_tokens=4096,
            stream=True,
        )
    except Exception as err:
        if message_has_images(messages) and _looks_like_vision_error(err):
            raise VisionNotSupportedError(
                f"配置的模型 {MODEL!r} 不支持图像输入。请在设置中切换到视觉模型后重试。"
            ) from err
        raise

    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
