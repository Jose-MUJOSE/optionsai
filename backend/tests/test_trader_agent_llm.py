"""Tests for TraderAgentPipeline._llm_json_with_retry — the structured-output
retry loop. Uses a fake OpenAI-compatible client; no network, no real LLM.
"""
import asyncio

import pytest

from backend.services.llm_schemas import ManagerOutput, ResearcherOutput
from backend.services.trader_agent import TraderAgentPipeline


# ------------------------------------------------------------------
# Fake OpenAI-compatible client
# ------------------------------------------------------------------

class _FakeMessage:
    def __init__(self, content: str):
        self.content = content


class _FakeChoice:
    def __init__(self, content: str):
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content: str):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    """Replays scripted replies; an Exception entry raises instead."""

    def __init__(self, replies, reject_json_mode: bool = False):
        self.replies = list(replies)
        self.reject_json_mode = reject_json_mode
        self.calls = 0
        self.kwargs_seen: list[dict] = []

    async def create(self, **kwargs):
        self.kwargs_seen.append(kwargs)
        if self.reject_json_mode and "response_format" in kwargs:
            raise RuntimeError("response_format is not supported by this provider")
        reply = self.replies[min(self.calls, len(self.replies) - 1)]
        self.calls += 1
        if isinstance(reply, Exception):
            raise reply
        return _FakeResponse(reply)


class _FakeChat:
    def __init__(self, completions):
        self.completions = completions


class _FakeClient:
    def __init__(self, completions):
        self.chat = _FakeChat(completions)


def _pipeline(replies, reject_json_mode: bool = False):
    completions = _FakeCompletions(replies, reject_json_mode=reject_json_mode)
    p = TraderAgentPipeline(_FakeClient(completions), "test-model", fetcher=None)
    # Zero out backoff so tests run instantly.
    p.INITIAL_BACKOFF_SECONDS = 0.0
    p.MAX_BACKOFF_SECONDS = 0.0
    return p, completions


_MESSAGES = [{"role": "system", "content": "Return JSON"},
             {"role": "user", "content": "go"}]


def _run(p, model_cls=ManagerOutput):
    return asyncio.run(p._llm_json_with_retry(
        label="test", messages=_MESSAGES, temperature=0.3,
        max_tokens=100, model_cls=model_cls,
    ))


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestLlmJsonWithRetry:
    def test_valid_first_attempt(self):
        p, fake = _pipeline(['{"decision": "buy", "conviction": 8}'])
        out = _run(p)
        assert out["decision"] == "buy"
        assert fake.calls == 1
        # JSON mode was attempted on the first call.
        assert "response_format" in fake.kwargs_seen[0]

    def test_invalid_then_valid_retries_with_nudge(self):
        p, fake = _pipeline([
            "Sorry, here is my analysis in prose form.",
            '{"decision": "sell", "conviction": 6}',
        ])
        out = _run(p)
        assert out["decision"] == "sell"
        assert fake.calls == 2
        # Second attempt carries the corrective nudge (longer message list).
        assert len(fake.kwargs_seen[1]["messages"]) > len(fake.kwargs_seen[0]["messages"])

    def test_all_invalid_returns_none(self):
        p, fake = _pipeline(["no json 1", "no json 2", "no json 3"])
        assert _run(p) is None
        assert fake.calls == p.MAX_RETRIES

    def test_schema_violation_counts_as_failure(self):
        # Valid JSON but missing required `decision` -> must retry, not accept.
        p, fake = _pipeline([
            '{"conviction": 7}',
            '{"decision": "hold", "conviction": 7}',
        ])
        out = _run(p)
        assert out["decision"] == "hold"
        assert fake.calls == 2

    def test_provider_rejecting_json_mode_falls_back(self):
        p, fake = _pipeline(
            ['{"decision": "buy", "conviction": 9}'],
            reject_json_mode=True,
        )
        out = _run(p)
        assert out is not None and out["decision"] == "buy"
        # First call attempted JSON mode and was rejected; a later call
        # succeeded without response_format.
        assert "response_format" in fake.kwargs_seen[0]
        assert "response_format" not in fake.kwargs_seen[-1]
        assert p._json_mode_supported is False

    def test_transport_error_then_success(self):
        p, fake = _pipeline([
            RuntimeError("connection reset"),
            '{"decision": "buy", "conviction": 5}',
        ])
        out = _run(p)
        assert out["decision"] == "buy"
        assert fake.calls == 2

    def test_researcher_schema_lenient(self):
        # Researcher output is lenient: an empty object validates with defaults.
        p, fake = _pipeline(["{}"])
        out = _run(p, model_cls=ResearcherOutput)
        assert out["stance"] == "neutral"
        assert out["confidence"] == 5
        assert fake.calls == 1

    def test_fenced_output_accepted(self):
        p, fake = _pipeline(['```json\n{"decision": "BUY", "conviction": 8}\n```'])
        out = _run(p)
        assert out["decision"] == "BUY"
