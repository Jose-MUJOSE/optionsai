"""Credential-free protocol and settings regression tests."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.services.llm_client import LLMClient, LLMRequestError, LLMConfigurationError
from backend.services import config_store, ai_assistant
from backend.main import app


def completed(text="OK"):
    return {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}


def test_responses_schema_and_vision():
    def respond(request):
        assert str(request.url) == "https://api.openai.com/v1/responses"
        data = json.loads(request.content)
        assert data["model"] == "gpt-6.1-terra"
        assert data["reasoning"] == {"effort": "high"}
        assert data["store"] is False
        assert data["max_output_tokens"] >= 16384
        assert "temperature" not in data and "max_tokens" not in data
        assert data["text"] == {"format": {"type": "json_object"}}
        assert data["input"][1]["content"][1] == {"type": "input_image", "image_url": "data:image/png;base64,abc", "detail": "auto"}
        return httpx.Response(200, json=completed('{"ok":true}'))
    client = LLMClient("test-only", "https://api.openai.com/v1", transport=httpx.MockTransport(respond))
    response = asyncio.run(client.create(model="gpt-6.1-terra", temperature=.7, max_tokens=400,
        messages=[{"role": "system", "content": "Return JSON"}, {"role": "user", "content": [
            {"type": "text", "text": "test"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}}]}],
        response_format={"type": "json_object"}))
    assert response.choices[0].message.content == '{"ok":true}'


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
def test_http_errors_do_not_echo_upstream_secrets(status):
    client = LLMClient("secret-test-only", "https://api.openai.com/v1", transport=httpx.MockTransport(
        lambda request: httpx.Response(status, json={"error": "secret-test-only"})))
    with pytest.raises(LLMRequestError) as error:
        asyncio.run(client.create(model="gpt-6.1-terra", messages=[]))
    assert str(status) in str(error.value)
    assert "secret-test-only" not in str(error.value)


@pytest.mark.parametrize("complete", [True, False])
def test_stream_requires_successful_completion(complete):
    events = [{"type": "response.output_text.delta", "delta": "你好"}]
    if complete:
        events.append({"type": "response.completed", "response": completed()})
    sse = "".join("data: " + json.dumps(event) + "\n\n" for event in events)
    client = LLMClient("test-only", "https://api.openai.com/v1", transport=httpx.MockTransport(
        lambda request: httpx.Response(200, text=sse)))
    async def run():
        stream = await client.create(model="gpt-6.1-terra", messages=[], stream=True)
        return "".join([chunk.choices[0].delta.content async for chunk in stream])
    if complete:
        assert asyncio.run(run()) == "你好"
    else:
        with pytest.raises(LLMRequestError, match="Stream ended"):
            asyncio.run(run())


def test_incomplete_json_is_not_accepted():
    client = LLMClient("test-only", "https://api.openai.com/v1", transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}})))
    with pytest.raises(LLMRequestError, match="max_output_tokens"):
        asyncio.run(client.create(model="gpt-6.1-terra", messages=[]))


def test_total_deadline_and_shared_request_limit():
    async def run():
        count = {"active": 0, "peak": 0}
        async def respond(request):
            count["active"] += 1
            count["peak"] = max(count["peak"], count["active"])
            try:
                await asyncio.sleep(.03)
                return httpx.Response(200, json=completed())
            finally:
                count["active"] -= 1
        client = LLMClient("test-only", "https://api.openai.com/v1", transport=httpx.MockTransport(respond))
        client.request_gate = asyncio.Semaphore(6)
        await asyncio.gather(*(client.create(model="gpt-6.1-terra", messages=[]) for _ in range(10)))
        assert count["peak"] == 6
        with pytest.raises(LLMRequestError, match="Total request timed out"):
            await client.create(model="gpt-6.1-terra", messages=[], timeout=.001)
        assert count["active"] == 0
    asyncio.run(run())


@pytest.fixture
def isolated_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(config_store, "_CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config_store, "_config", dict(config_store._DEFAULT_CONFIG,
        llm_provider="deepseek", llm_api_key="old-provider-key", llm_model="deepseek-chat",
        llm_base_url="https://api.deepseek.com/v1"))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(ai_assistant, "client", None)
    monkeypatch.setattr(ai_assistant, "MODEL", "old")
    return TestClient(app)


def test_provider_switch_and_hot_reload(isolated_settings):
    response = isolated_settings.post("/api/settings", json={"llm_provider": "openai", "llm_api_key": "****"})
    assert response.status_code == 200
    config = response.json()["config"]
    assert config["llm_model"] == "gpt-6.1-terra"
    assert config["llm_api_key"] == ""
    assert ai_assistant.MODEL == "gpt-6.1-terra"
    assert ai_assistant.client.provider == "openai"
    # Empty keys must clear the old in-memory client too.
    isolated_settings.post("/api/settings", json={"llm_api_key": "test-only"})
    assert isolated_settings.get("/api/settings").json()["llm_api_key"] == "****"
    isolated_settings.post("/api/settings", json={"llm_api_key": ""})
    with pytest.raises(LLMConfigurationError):
        ai_assistant.client.require_key()
    assert isolated_settings.post("/api/settings/test").status_code == 503
    assert isolated_settings.post("/api/trader/analyze/AAPL", json={}).status_code == 503
    assert isolated_settings.post("/api/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 503


def test_invalid_config_is_not_persisted(isolated_settings):
    before = dict(config_store.get_config())
    response = isolated_settings.post("/api/settings", json={"llm_reasoning_effort": "invalid"})
    assert response.status_code == 422
    assert config_store.get_config() == before


def test_openai_never_uses_deepseek_env(tmp_path, monkeypatch):
    monkeypatch.setattr(config_store, "_CONFIG_PATH", tmp_path / "missing.json")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "wrong-provider-key")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    config = config_store._load_config()
    assert config["llm_api_key"] == ""
    assert config["llm_base_url"] == "https://api.openai.com/v1"
