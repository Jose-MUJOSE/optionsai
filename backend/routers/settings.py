"""
OptionsAI - 设置 API 路由
GET /api/settings — 获取当前配置（API key 遮蔽）
POST /api/settings — 更新配置
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.services.config_store import get_masked_config, update_config, get_config, LLM_PRESETS

router = APIRouter(tags=["Settings"])


class SettingsUpdate(BaseModel):
    data_provider: Optional[str] = None
    polygon_api_key: Optional[str] = None
    tradier_api_key: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_reasoning_effort: Optional[str] = None


@router.get("/settings")
async def get_settings():
    """获取当前配置（API key 已遮蔽）"""
    config = get_masked_config()
    config["llm_presets"] = LLM_PRESETS
    return config


@router.post("/settings")
async def update_settings(req: SettingsUpdate):
    """更新配置并重新初始化相关服务"""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}

    # Don't overwrite keys with masked values
    for key in ["polygon_api_key", "llm_api_key", "tradier_api_key"]:
        if key in updates and "****" in updates[key]:
            del updates[key]

    try:
        config = update_config(updates)
        if any(key in updates for key in ("data_provider", "polygon_api_key", "tradier_api_key")):
            from backend.services.ttl_cache import shared_cache
            shared_cache.clear()
        from backend.services.ai_assistant import reconfigure_client
        reconfigure_client(
            api_key=config.get("llm_api_key", ""),
            base_url=config.get("llm_base_url", ""),
            model=config.get("llm_model", ""),
            provider=config["llm_provider"],
            reasoning_effort=config["llm_reasoning_effort"],
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None

    return {"status": "ok", "config": get_masked_config()}


@router.post("/settings/test")
async def test_connection():
    """One small, user-initiated generation using the saved model and key."""
    from backend.services import ai_assistant
    from backend.services.llm_client import LLMConfigurationError, LLMRequestError
    try:
        response = await ai_assistant.client.chat.completions.create(
            model=ai_assistant.MODEL,
            messages=[{"role": "user", "content": "Reply with only OK."}],
            max_tokens=32,
        )
        return {"status": "ok", "model": ai_assistant.MODEL,
                "reasoning_effort": ai_assistant.client.reasoning_effort,
                "reply": response.choices[0].message.content}
    except LLMConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    except LLMRequestError as error:
        raise HTTPException(status_code=502, detail=str(error)) from None
    except Exception:
        raise HTTPException(status_code=502, detail="连接测试失败，请检查 API Key、模型和网络 / Connection test failed.") from None
