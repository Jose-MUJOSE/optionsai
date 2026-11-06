import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import research_jobs as routes
from backend.services import config_store
from backend.services.report_chat import ReportChats, build_messages, report_summary
from backend.services.research_jobs import ResearchJobs


def saved_job(ticker="AAPL", job_id="a" * 32, **extra):
    return dict(id=job_id, ticker=ticker, mode="stock", locale="zh", status="completed",
                created_at="2026-11-05T00:00:00Z", finished_at="2026-11-05T00:02:00Z",
                researchers=[dict(id="risk", name_zh="风险研究员", evidence="dated evidence")],
                manager=dict(decision="hold", conviction=6, thesis="original thesis", main_risks=["risk"]),
                manager_context="SOURCE AS OF 2026-11-04", events=[], **extra)


class FakeClient:
    calls = []
    error = None
    answer = "AAPL saved report answer [风险研究员]"

    def __init__(self, *args):
        self.chat = SimpleNamespace(completions=self)

    def require_key(self):
        pass

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.answer))])


@pytest.fixture
def chats(tmp_path, monkeypatch):
    monkeypatch.setattr(config_store, "_config", dict(config_store._DEFAULT_CONFIG, llm_api_key="never-in-output", llm_model="gpt-6.1-terra", llm_reasoning_effort="high"))
    FakeClient.calls = []
    FakeClient.error = None
    FakeClient.answer = "AAPL saved report answer [风险研究员]"
    return ReportChats(tmp_path / "chats", FakeClient)


def test_summary_never_promotes_partial_or_fills_unknowns():
    job = saved_job()
    assert report_summary(job)["conviction"] == 6
    assert "target_price" not in report_summary(job)
    job["status"] = "failed"
    assert report_summary(job) is None
    job["status"] = "completed"
    job["manager"]["_parse_error"] = True
    assert report_summary(job) is None


def test_report_chat_is_persistent_idempotent_and_report_bound(chats):
    async def run():
        job = saved_job()
        original = json.dumps(job, sort_keys=True)
        conversation = chats.submit(job, "Explain evidence", "request-001", "zh")
        assert conversation["turns"][0]["status"] == "queued"
        # Duplicate clicks even while a request is running do not issue a new call.
        assert len(chats.submit(job, "Explain evidence", "request-001", "zh")["turns"]) == 1
        with pytest.raises(ValueError, match="already"):
            chats.submit(job, "different", "request-002", "zh")
        await asyncio.gather(*list(chats.running.values()))
        assert len(FakeClient.calls) == 1
        assert FakeClient.calls[0]["model"] == "gpt-6.1-terra"
        saved = ReportChats(chats.root).get(job["id"])
        assert saved["turns"][0]["status"] == "completed"
        assert saved["turns"][0]["reasoning_effort"] == "high"
        assert "never-in-output" not in json.dumps(saved)
        assert json.dumps(job, sort_keys=True) == original
        chats.submit(saved_job("MSFT", "b" * 32), "Second report", "request-001", "en")
        await asyncio.gather(*list(chats.running.values()))
        messages = json.dumps(FakeClient.calls[-1]["messages"])
        assert "MSFT" in messages and "AAPL" not in messages
        assert chats.get("a" * 32)["turns"][0]["question"] == "Explain evidence"
    asyncio.run(run())


def test_context_keeps_snapshot_and_recent_successful_turns_only():
    turns = [dict(status="completed", question=f"question-{i}", answer=f"answer-{i}") for i in range(12)]
    turns.append(dict(status="failed", question="failed-question", answer=None))
    messages = build_messages(saved_job(), turns, "new question", "zh")
    assert len(messages) == 19
    assert "live market data" in messages[0]["content"]
    assert "2026-11-04" in messages[1]["content"]
    assert messages[2]["content"] == "question-4"
    assert messages[-1]["content"] == "new question"
    assert "failed-question" not in json.dumps(messages)


def test_failures_are_visible_without_leaking_raw_errors(chats):
    FakeClient.error = RuntimeError("never-in-output connection detail")
    async def run():
        chats.submit(saved_job(), "Why?", "request-003", "zh")
        await asyncio.gather(*list(chats.running.values()))
        result = chats.get("a" * 32)
        assert result["turns"][0]["status"] == "failed"
        assert result["turns"][0]["answer"] is None
        assert "never-in-output" not in json.dumps(result)
    asyncio.run(run())


def test_restart_keeps_question_and_never_reissues_paid_request(chats):
    record = dict(report_id="a" * 32, turns=[dict(id="request-004", question="saved", status="running", answer=None)])
    chats.save(record)
    restarted = ReportChats(chats.root, FakeClient)
    restarted.recover()
    assert restarted.get("a" * 32)["turns"][0]["status"] == "interrupted"
    assert not restarted.running and not FakeClient.calls
    with pytest.raises(KeyError):
        restarted.get("../config")


def test_api_reads_old_reports_without_rewriting_and_qa_is_separate(chats, tmp_path, monkeypatch):
    jobs = ResearchJobs(tmp_path / "reports")
    job = saved_job()
    jobs.save(job)
    path = jobs.root / (job["id"] + ".json")
    before = path.read_bytes()
    monkeypatch.setattr(routes, "jobs", jobs)
    monkeypatch.setattr(routes, "report_chats", chats)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    with TestClient(app) as client:
        summary = client.get("/api/research-jobs").json()[0]
        assert summary["summary"]["thesis"] == "original thesis"
        assert "manager_context" not in summary and "manager" not in summary
        endpoint = f"/api/research-jobs/{job['id']}/chat"
        assert client.get(endpoint).json()["turns"] == []
        assert client.post(endpoint, json=dict(question=" ", request_id="question-one")).status_code == 422
        assert client.post("/api/research-jobs/" + "b" * 32 + "/chat", json=dict(question="What?", request_id="question-one")).status_code == 404
        response = client.post(endpoint, json=dict(question="Evidence?", request_id="question-one"))
        assert response.status_code == 202
        read = client.get(endpoint).json()
        assert read["report_id"] == job["id"] and read["turns"][0]["question"] == "Evidence?"
        assert client.post(endpoint, json=dict(question="Evidence?", request_id="question-one")).status_code == 202
    assert path.read_bytes() == before
    assert len(FakeClient.calls) == 1
