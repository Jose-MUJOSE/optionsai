"""
OptionsAI - 设置 API 路由
GET /api/settings — 获取当前配置（API key 遮蔽）
POST /api/settings — 更新配置
"""
from fastapi import APIRouter
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

    config = update_config(updates)

    # Reinitialize AI client with new config
    try:
        from backend.services.ai_assistant import reconfigure_client
        reconfigure_client(
            api_key=config.get("llm_api_key", ""),
            base_url=config.get("llm_base_url", ""),
            model=config.get("llm_model", ""),
        )
    except Exception:
        pass

    return {"status": "ok", "config": get_masked_config()}
