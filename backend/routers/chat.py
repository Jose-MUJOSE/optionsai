"""
OptionsAI - AI 聊天 API 路由
POST /api/chat — 非流式响应
POST /api/chat/stream — SSE 流式响应 (多Agent协作)
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from backend.models.schemas import ChatRequest, ChatResponse
from backend.services.ai_assistant import chat_completion, VisionNotSupportedError
from backend.services.agent_orchestrator import run_agent_pipeline
from backend.services.data_fetcher import DataFetcher

router = APIRouter(tags=["AI Chat"])

# 全局 DataFetcher 实例 (与 market_data router 共享数据层)
_fetcher = DataFetcher()


def _dump_message(m) -> dict:
    """把 ChatMessage 展平成 dict，images 可选。"""
    d = {"role": m.role, "content": m.content}
    imgs = getattr(m, "images", None)
    if imgs:
        d["images"] = imgs
    return d


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    AI 投研助手 - 非流式响应
    """
    try:
        messages = [_dump_message(m) for m in req.messages]
        reply = await chat_completion(messages, req.context)
        return ChatResponse(reply=reply)
    except VisionNotSupportedError as ve:
        # 422: 客户端需要切换模型，不是服务器错误
        raise HTTPException(status_code=422, detail=f"VISION_UNSUPPORTED: {str(ve)}")
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[CHAT ERROR] {tb}")
        raise HTTPException(status_code=500, detail=f"AI chat error: {type(e).__name__}: {str(e)}")


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    AI 投研助手 - SSE 流式响应 (Researcher → Analyst → Verifier 多Agent协作)
    支持 user 消息中的 images (OpenAI-兼容 image_url content blocks)
    """
    messages = [_dump_message(m) for m in req.messages]

    async def event_generator():
        try:
            async for event in run_agent_pipeline(messages, req.context, _fetcher):
                yield event  # Already SSE-formatted
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
