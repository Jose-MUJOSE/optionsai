"""
OptionsAI - 运行时配置管理
读写 backend/config.json，支持动态切换数据源和 LLM 提供商
"""
import json
import os
from pathlib import Path
from typing import Optional

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"

_DEFAULT_CONFIG = {
    "data_provider": "yahoo",  # yahoo / polygon
    "polygon_api_key": "",
    "tradier_api_key": "",
    "llm_provider": "deepseek",  # deepseek / openai / anthropic / custom
    "llm_api_key": "",
    "llm_base_url": "",
    "llm_model": "",
}

# Provider presets
LLM_PRESETS = {
    "deepseek": {"base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o"},
    "anthropic": {"base_url": "https://api.anthropic.com/v1", "model": "claude-sonnet-4-20250514"},
    "custom": {"base_url": "", "model": ""},
}


def _load_config() -> dict:
    """Load config from JSON file, merge with defaults"""
    config = dict(_DEFAULT_CONFIG)
    if _CONFIG_PATH.exists():
        try:
            with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                config.update(saved)
        except Exception:
            pass

    # Also check env vars as fallback
    if not config["polygon_api_key"]:
        config["polygon_api_key"] = os.getenv("POLYGON_API_KEY", "")
    if not config["llm_api_key"]:
        config["llm_api_key"] = os.getenv("DEEPSEEK_API_KEY", "")
    if not config["llm_base_url"]:
        preset = LLM_PRESETS.get(config["llm_provider"], {})
        config["llm_base_url"] = os.getenv("DEEPSEEK_BASE_URL", preset.get("base_url", ""))
    if not config["llm_model"]:
        preset = LLM_PRESETS.get(config["llm_provider"], {})
        config["llm_model"] = preset.get("model", "deepseek-chat")

    return config


def _save_config(config: dict):
    """Save config to JSON file"""
    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


# Singleton config
_config: Optional[dict] = None


def get_config() -> dict:
    global _config
    if _config is None:
        _config = _load_config()
    return _config


def update_config(updates: dict) -> dict:
    global _config
    config = get_config()
    config.update(updates)

    # Apply provider preset if provider changed
    provider = config.get("llm_provider", "")
    if provider in LLM_PRESETS:
        preset = LLM_PRESETS[provider]
        if not config.get("llm_base_url"):
            config["llm_base_url"] = preset["base_url"]
        if not config.get("llm_model"):
            config["llm_model"] = preset["model"]

    _save_config(config)
    _config = config
    return config


def get_masked_config() -> dict:
    """Return config with API keys masked for frontend display"""
    config = get_config()
    masked = dict(config)
    for key in ["polygon_api_key", "llm_api_key", "tradier_api_key"]:
        val = masked.get(key, "")
        if val and len(val) > 8:
            masked[key] = val[:4] + "****" + val[-4:]
        elif val:
            masked[key] = "****"
    return masked
