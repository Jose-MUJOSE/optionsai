"""Responses API transport with the completion shape used by existing features.

OpenAI calls share one translation boundary; legacy providers keep their SDK
protocol. Credentials are never included in transport errors or log messages.
"""
from types import SimpleNamespace
import json
import asyncio

import httpx
from openai import AsyncOpenAI


class LLMConfigurationError(RuntimeError):
    pass


class LLMRequestError(RuntimeError):
    pass


class LLMClient:
    def __init__(self, api_key, base_url, provider="openai", reasoning_effort="high", transport=None):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.provider = provider
        self.reasoning_effort = reasoning_effort
        self.transport = transport
        self.chat = SimpleNamespace(completions=self)
        self.request_gate = None

    def require_key(self):
        if not self.api_key or self.api_key.startswith("your_"):
            raise LLMConfigurationError("请在设置中填写并保存 API Key / Configure your API key in Settings.")

    @staticmethod
    def _input(messages):
        result = []
        for message in messages:
            content = message.get("content", "")
            if isinstance(content, list):
                converted = []
                for part in content:
                    if part["type"] == "text":
                        converted.append({"type": "input_text", "text": part["text"]})
                    elif part["type"] == "image_url":
                        image = part["image_url"]
                        converted.append({"type": "input_image", "image_url": image["url"],
                                          "detail": image.get("detail", "auto")})
                    else:
                        raise ValueError("Unsupported message content type")
                content = converted
            result.append({"role": message["role"], "content": content})
        return result

    @staticmethod
    def _check_response(data):
        if data.get("status") != "completed":
            reason = (data.get("incomplete_details") or {}).get("reason", "failed")
            # Only known metadata, never upstream free text or credentials.
            reason = reason if reason in {"max_output_tokens", "content_filter"} else "failed"
            raise LLMRequestError(f"OpenAI response incomplete ({reason}); no complete report was produced.")

    @staticmethod
    def _check_http(response):
        if response.is_success:
            return
        hints = {401: "API Key 无效 / Invalid API key", 403: "账户无访问权限 / Access denied",
                 404: "模型不可用，请检查账户模型权限 / Model unavailable",
                 429: "额度不足或请求限流 / Quota or rate limit",
                 400: "模型或请求参数不受支持 / Unsupported model or request"}
        raise LLMRequestError(f"OpenAI HTTP {response.status_code}: " + hints.get(response.status_code, "服务暂不可用 / Service unavailable"))

    async def create(self, **kwargs):
        # httpx read timeout resets per chunk; bound total non-stream request time.
        try:
            if self.request_gate is not None:
                async with self.request_gate:
                    return await asyncio.wait_for(self._create(**kwargs), timeout=kwargs.get("timeout", 180.0))
            return await asyncio.wait_for(self._create(**kwargs), timeout=kwargs.get("timeout", 180.0))
        except TimeoutError:
            raise LLMRequestError("OpenAI 总请求超时 / Total request timed out; saved briefings remain available.") from None

    async def _create(self, *, model, messages, temperature=None, max_tokens=4096,
                     stream=False, timeout=180.0, response_format=None, **kwargs):
        self.require_key()
        if self.provider != "openai":
            legacy = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, max_retries=0)
            try:
                args = dict(model=model, messages=messages, temperature=temperature,
                            max_tokens=max_tokens, stream=stream, timeout=timeout, **kwargs)
                if response_format:
                    args["response_format"] = response_format
                response = await legacy.chat.completions.create(**args)
                if stream:
                    async def legacy_stream():
                        try:
                            async for chunk in response:
                                yield chunk
                        finally:
                            await response.close()
                            await legacy.close()
                    return legacy_stream()
                await legacy.close()
                return response
            except BaseException:
                await legacy.close()
                raise
        payload = {"model": model, "input": self._input(messages), "store": False,
                   "reasoning": {"effort": self.reasoning_effort},
                   # Reasoning and visible text share this budget.
                   "max_output_tokens": max(16384, max_tokens), "stream": stream}
        if response_format:
            payload["text"] = {"format": response_format}
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if stream:
            return self._stream(payload, headers, timeout)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=15), transport=self.transport) as http:
                response = await http.post(f"{self.base_url}/responses", json=payload, headers=headers)
                self._check_http(response)
                data = response.json()
        except httpx.TimeoutException:
            raise LLMRequestError("OpenAI 请求超时 / Request timed out; please retry.") from None
        except httpx.RequestError:
            raise LLMRequestError("无法连接 OpenAI / Cannot connect to OpenAI.") from None
        self._check_response(data)
        text = "".join(part.get("text", "") for item in data.get("output", [])
                       if item.get("type") == "message" for part in item.get("content", [])
                       if part.get("type") == "output_text")
        if not text.strip():
            raise LLMRequestError("OpenAI 未返回可用文本 / Empty or refused response.")
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    async def _stream(self, payload, headers, timeout):
        completed = False
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=15), transport=self.transport) as http:
                async with http.stream("POST", f"{self.base_url}/responses", json=payload, headers=headers) as response:
                    self._check_http(response)
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if raw == "[DONE]":
                            break
                        event = json.loads(raw)
                        kind = event.get("type")
                        if kind == "response.output_text.delta":
                            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=event["delta"]))])
                        elif kind == "response.completed":
                            self._check_response(event["response"])
                            completed = True
                        elif kind in {"response.failed", "response.incomplete", "error"}:
                            raise LLMRequestError("OpenAI 流式响应失败或不完整 / Incomplete streaming response.")
        except httpx.TimeoutException:
            raise LLMRequestError("OpenAI 请求超时 / Request timed out.") from None
        except httpx.RequestError:
            raise LLMRequestError("OpenAI 连接中断 / Connection interrupted.") from None
        if not completed:
            raise LLMRequestError("OpenAI 流在完成前中断 / Stream ended before completion.")
