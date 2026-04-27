"""
OptionsAI - AI 价格预测 API 路由
POST /api/forecast/{ticker} — 多时间框架价格预测
POST /api/top-pick — 最佳策略 + AI 分析理由
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from backend.services.data_fetcher import DataFetcher
from backend.services.ai_assistant import client, MODEL, build_system_prompt
from backend.services.ticker_validator import validate_us_ticker
from backend.models.schemas import (
    ChatContext, MarketData, Strategy, StrategyRequest, StrategyResponse,
)


def _ensure_us_ticker(ticker: str) -> str:
    """Validate ticker is US format. Raises HTTP 422 if not."""
    t = ticker.upper().strip()
    result = validate_us_ticker(t)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_TICKER",
                "message_en": result.reason_en,
                "message_zh": result.reason_zh,
            },
        )
    return t

router = APIRouter(tags=["Forecast & Analysis"])

_fetcher = DataFetcher()


# ============================================================
# 市场情报 (Real Data)
# ============================================================

class MarketIntelRequest(BaseModel):
    locale: str = Field(default="zh", description="语言: zh 或 en")


@router.post("/market-intel/{ticker}")
async def get_market_intel(ticker: str, req: MarketIntelRequest = None):
    """
    市场情报：真实新闻 (Polygon.io) + 分析师数据 (Yahoo Finance)
    """
    if req is None:
        req = MarketIntelRequest()

    ticker = _ensure_us_ticker(ticker)
    lang = "Chinese" if req.locale == "zh" else "English"

    try:
        # 1. 获取真实新闻 (Polygon.io)
        raw_news = await _fetcher.get_news(ticker, limit=50)

        # 2. 获取分析师数据 (Yahoo Finance)
        analyst_data = await _fetcher.get_analyst_data(ticker)

        # 3. 获取财报日期
        earnings_date = await _fetcher.get_earnings_date(ticker)

        # 4. 获取现价
        spot_data = await _fetcher.get_spot_price(ticker)
        spot = spot_data["spot_price"]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    # --- 处理新闻 ---
    news_items = []
    if raw_news:
        # 如果是中文，用AI翻译新闻标题和摘要
        if req.locale == "zh" and raw_news:
            try:
                import json
                news_text = json.dumps(raw_news[:8], ensure_ascii=False)
                translate_prompt = f"""Translate these English financial news items to Chinese. Keep the same JSON structure.
Return ONLY valid JSON array, no extra text:
{news_text}"""
                resp = await client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": "You are a translator. Return only valid JSON."},
                        {"role": "user", "content": translate_prompt},
                    ],
                    temperature=0.3,
                    max_tokens=3000,
                )
                content = resp.choices[0].message.content.strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[1] if "\n" in content else content[3:]
                    if content.endswith("```"):
                        content = content[:-3].strip()
                translated = json.loads(content)
                # Append remaining untranslated items beyond the 8 translated
                news_items = translated + raw_news[len(translated):]
            except Exception:
                news_items = raw_news
        else:
            news_items = raw_news

    # --- 处理事件 ---
    events = []
    if earnings_date:
        events.append({
            "date": earnings_date,
            "type": "earnings",
            "description": f"{'财报发布日（预期）' if req.locale == 'zh' else 'Earnings Report (Expected)'}",
        })

    # --- 处理分析师目标价 ---
    analyst_targets = []
    timeframe_label = "12个月" if req.locale == "zh" else "12 months"

    # 添加共识数据
    if analyst_data.get("target_mean"):
        consensus_label = "华尔街共识" if req.locale == "zh" else "Wall Street Consensus"
        rating_map = {
            "strongBuy": "强力买入" if req.locale == "zh" else "Strong Buy",
            "buy": "买入" if req.locale == "zh" else "Buy",
            "hold": "持有" if req.locale == "zh" else "Hold",
            "sell": "卖出" if req.locale == "zh" else "Sell",
            "strongSell": "强力卖出" if req.locale == "zh" else "Strong Sell",
            "strong_buy": "强力买入" if req.locale == "zh" else "Strong Buy",
        }
        rec = analyst_data.get("recommendation", "")
        rating_display = rating_map.get(rec, rec.capitalize() if rec else "N/A")

        analyst_targets.append({
            "institution": consensus_label,
            "target_price": round(analyst_data["target_mean"], 2),
            "target_high": round(analyst_data["target_high"], 2) if analyst_data.get("target_high") else None,
            "target_low": round(analyst_data["target_low"], 2) if analyst_data.get("target_low") else None,
            "rating": rating_display,
            "num_analysts": analyst_data.get("num_analysts", 0),
            "date": "",
            "timeframe": timeframe_label,
        })

    # 优先使用 Finviz 个别机构目标价（包含价格）
    individual_targets = analyst_data.get("individual_targets", [])

    if individual_targets:
        # Finviz 数据包含目标价格
        seen_institutions = set()
        action_map_zh = {
            "Reiterated": "重申", "Upgrade": "上调", "Downgrade": "下调",
            "Initiated": "首次覆盖", "Maintained": "维持", "Resumed": "恢复覆盖",
        }
        for item in individual_targets:
            inst = item.get("institution", "")
            if not inst or inst in seen_institutions:
                continue
            seen_institutions.add(inst)
            if len(analyst_targets) >= 8:
                break

            action = item.get("action", "")
            # Finviz rating may contain "Sell → Neutral" or just "Buy"
            raw_rating = item.get("rating", "")
            # Split by arrow to get target rating
            if "→" in raw_rating:
                parts = raw_rating.split("→")
                target_rating = parts[-1].strip()
            else:
                target_rating = raw_rating

            if req.locale == "zh":
                action_zh = action_map_zh.get(action, action)
                rating_display = f"{action_zh} → {target_rating}" if action_zh else target_rating
            else:
                rating_display = f"{action} → {target_rating}" if action else target_rating

            analyst_targets.append({
                "institution": inst,
                "target_price": item.get("target_price"),
                "rating": rating_display,
                "date": item.get("date", ""),
                "timeframe": timeframe_label,
            })
    else:
        # 回退：使用 Yahoo upgradeDowngradeHistory（无个别目标价）
        seen_institutions = set()
        for change in analyst_data.get("recent_changes", []):
            if not change.get("institution"):
                continue
            inst = change["institution"]
            if inst in seen_institutions:
                continue
            seen_institutions.add(inst)
            if len(analyst_targets) >= 8:
                break
            grade = change.get("to_grade", "")
            action = change.get("action", "")
            if req.locale == "zh":
                action_map = {"init": "首次覆盖", "upgrade": "上调", "downgrade": "下调", "main": "维持", "maintain": "维持", "reiterated": "重申", "reit": "重申"}
                action_zh = action_map.get(action, action.capitalize() if action else "")
                rating_display = f"{action_zh} → {grade}" if action_zh else grade
            else:
                rating_display = f"{action.capitalize()} → {grade}" if action else grade

            analyst_targets.append({
                "institution": change.get("institution", ""),
                "target_price": None,
                "rating": rating_display,
                "date": change.get("date", ""),
                "timeframe": timeframe_label,
            })

    return {
        "ticker": ticker,
        "spot_price": spot,
        "news": news_items,
        "events": events,
        "analyst_targets": analyst_targets,
    }


# ============================================================
# 价格预测
# ============================================================

class ForecastRequest(BaseModel):
    locale: str = Field(default="zh", description="语言: zh 或 en")


@router.post("/forecast/{ticker}")
async def get_forecast(ticker: str, req: ForecastRequest = None):
    """
    AI 驱动的多时间框架价格预测
    返回 SSE 流式响应
    """
    if req is None:
        req = ForecastRequest()

    ticker = _ensure_us_ticker(ticker)

    try:
        spot_data = await _fetcher.get_spot_price(ticker)
        spot = spot_data["spot_price"]
        change_pct = spot_data.get("change_pct", 0)

        iv_data = await _fetcher.get_iv_metrics(ticker)
        iv_current = iv_data["iv_current"]
        iv_rank = iv_data["iv_rank"]
        hv_30 = iv_data.get("hv_30", 0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    lang = "Chinese" if req.locale == "zh" else "English"

    prompt = f"""You are a senior financial analyst. Based on the following market data, provide price forecasts for {ticker}.

## Current Market Data
- Current Price: ${spot:.2f} ({change_pct:+.2f}% today)
- 30-Day Implied Volatility: {iv_current:.1f}%
- IV Rank: {iv_rank:.0f}/100
- 30-Day Historical Volatility: {hv_30:.1f}%
- Date: {datetime.now().strftime('%Y-%m-%d')}

## TASK
Provide price predictions for EXACTLY these 4 timeframes. For each, give:
1. Direction (up/down/neutral)
2. Target price range (low - high)
3. Confidence level (high/medium/low)
4. One-sentence reasoning

## FORMAT (respond in {lang})
You MUST respond in EXACTLY this JSON format, no extra text:
{{
  "forecasts": [
    {{
      "timeframe": "few_days",
      "timeframe_label": "{"未来几天" if req.locale == "zh" else "Next Few Days"}",
      "direction": "up|down|neutral",
      "price_low": <number>,
      "price_high": <number>,
      "confidence": "high|medium|low",
      "reasoning": "<one sentence>"
    }},
    {{
      "timeframe": "one_week",
      "timeframe_label": "{"一周" if req.locale == "zh" else "1 Week"}",
      "direction": "up|down|neutral",
      "price_low": <number>,
      "price_high": <number>,
      "confidence": "high|medium|low",
      "reasoning": "<one sentence>"
    }},
    {{
      "timeframe": "one_month",
      "timeframe_label": "{"一个月" if req.locale == "zh" else "1 Month"}",
      "direction": "up|down|neutral",
      "price_low": <number>,
      "price_high": <number>,
      "confidence": "high|medium|low",
      "reasoning": "<one sentence>"
    }},
    {{
      "timeframe": "half_year",
      "timeframe_label": "{"半年" if req.locale == "zh" else "6 Months"}",
      "direction": "up|down|neutral",
      "price_low": <number>,
      "price_high": <number>,
      "confidence": "high|medium|low",
      "reasoning": "<one sentence>"
    }}
  ]
}}

Be realistic and data-driven. Use IV and HV to gauge expected price movement ranges.
Respond ONLY with valid JSON, no markdown code fences."""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a financial analyst. Respond only in valid JSON format."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.6,
            max_tokens=1024,
        )
        content = response.choices[0].message.content.strip()
        # Try to parse JSON, clean markdown fences if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3].strip()

        import json
        data = json.loads(content)
        return {
            "ticker": ticker,
            "spot_price": spot,
            "forecasts": data.get("forecasts", []),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecast error: {str(e)}")


# ============================================================
# 最佳策略 + AI 分析理由
# ============================================================

class TopPickRequest(BaseModel):
    ticker: str
    spot_price: float
    iv_current: float
    iv_rank: float
    strategy_name: str
    strategy_name_en: str
    strategy_tag: str
    legs_description: str
    max_profit: float
    max_profit_pct: float
    max_loss: float
    breakevens: str
    win_probability: float
    required_capital: float
    trend: str
    target_price: Optional[float] = None
    locale: str = Field(default="zh")


@router.post("/top-pick")
async def get_top_pick_analysis(req: TopPickRequest):
    """
    AI 分析最佳策略的推荐理由
    返回 SSE 流式响应
    """
    lang = "Chinese" if req.locale == "zh" else "English"

    prompt = f"""You are OptionsAI's senior strategist. Analyze why this is the TOP recommended strategy.

## Market Context
- Ticker: {req.ticker}
- Current Price: ${req.spot_price:.2f}
- IV: {req.iv_current:.1f}% (Rank: {req.iv_rank:.0f}/100)
- User Trend: {req.trend}
- Target Price: {"$" + f"{req.target_price:.2f}" if req.target_price else "Not set"}

## Recommended Strategy: {req.strategy_name} ({req.strategy_name_en})
- Tag: {req.strategy_tag}
- Legs: {req.legs_description}
- Max Profit: ${req.max_profit:.2f} (+{req.max_profit_pct:.1f}%)
- Max Loss: ${req.max_loss:.2f}
- Breakeven(s): {req.breakevens}
- Win Probability: {req.win_probability:.1f}%
- Required Capital: ${req.required_capital:.2f}

## TASK
Write a CONCISE (3-5 sentences) analysis explaining:
1. WHY this strategy fits the current market environment (IV level, trend)
2. The KEY advantage of this strategy over alternatives
3. ONE practical tip for execution

Respond in {lang}. Be specific with numbers. No markdown headers, just flowing text."""

    async def event_generator():
        try:
            stream = await client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": f"You are a concise options strategist. Respond in {lang}."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=512,
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {chunk.choices[0].delta.content}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
