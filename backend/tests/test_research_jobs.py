import asyncio
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient
from backend.services.research_jobs import ResearchJobs
from backend.services import config_store, ai_assistant
from backend.routers import research_jobs as routes
from backend.main import app


def event(kind, **data):
    return "data: " + json.dumps(dict(type=kind, **data)) + "\n\n"


class FakePipeline:
    calls = []

    def __init__(self, client, model, fetcher):
        pass

    async def run(self, ticker, mode, locale, selected):
        self.calls.append(ticker)
        yield event("phase", phase="research_start")
        yield event("researcher", result=dict(id="risk", stance="neutral", confidence=5, headline="Test only", key_points=[]))
        await asyncio.sleep(.01)
        yield event("manager_context", context="frozen test context")
        yield event("phase", phase="manager_start")
        yield event("done", researchers=[dict(id="risk", headline="Test only")], manager=dict(decision="hold", conviction=5, thesis="test", _parse_error=ticker == "FAIL"))

    async def _call_manager(self, researchers, context, mode, locale):
        assert context == "frozen test context"
        return dict(decision="hold", conviction=5, thesis="test synthesis")


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(config_store, "_config", dict(config_store._DEFAULT_CONFIG,
        llm_api_key="test-only", llm_model="gpt-6.1-terra", llm_base_url="https://api.openai.com/v1"))
    FakePipeline.calls = []
    return ResearchJobs(tmp_path, FakePipeline)


def test_batch_persists_sequential_results_and_idempotency(service):
    async def run():
        rows = service.enqueue(["AAPL", "MSFT"], "stock", "zh", ["risk"], "same-request")
        assert [j["id"] for j in service.enqueue(["AAPL", "MSFT"], "stock", "zh", ["risk"], "same-request")] == [j["id"] for j in rows]
        await service.worker
        assert FakePipeline.calls == ["AAPL", "MSFT"]
        disk = ResearchJobs(service.root)
        assert all(job["status"] == "completed" for job in disk.all())
        assert disk.get(rows[0]["id"])["manager"]["thesis"] == "test"
        assert "test-only" not in "".join(path.read_text() for path in service.root.glob("*.json"))
    asyncio.run(run())


def test_failed_manager_preserves_briefings_and_retry_skips_analysts(service):
    async def run():
        old = service.enqueue(["FAIL"], "stock", "zh", ["risk"], "failed-request")[0]
        await service.worker
        old = service.get(old["id"])
        assert old["status"] == "failed" and old["researchers"]
        new = service.retry(old["id"])
        await service.worker
        assert service.get(new["id"])["status"] == "completed"
        assert FakePipeline.calls == ["FAIL"]
        assert service.get(old["id"])["status"] == "failed"
    asyncio.run(run())


def test_cancel_active_preserves_partial_and_next_job_runs(service):
    reached = asyncio.Event()
    class Hanging(FakePipeline):
        async def run(self, ticker, *args):
            if ticker == "AAPL":
                yield event("researcher", result={"id": "risk", "headline": "saved"})
                reached.set()
                await asyncio.Event().wait()
            else:
                async for chunk in super().run(ticker, *args):
                    yield chunk
    service.pipeline_factory = Hanging
    async def run():
        rows = service.enqueue(["AAPL", "MSFT"], "stock", "zh", ["risk"], "cancel-test")
        await reached.wait()
        await service.cancel(rows[0]["id"])
        await service.worker
        first = service.get(rows[0]["id"])
        assert first["status"] == "cancelled" and first["researchers"]
        assert service.get(rows[1]["id"])["status"] == "completed"
    asyncio.run(run())


def test_restart_does_not_repeat_paid_jobs(service):
    async def run():
        rows = service.enqueue(["AAPL"], "stock", "zh", ["risk"], "restart-test")
        service.worker.cancel()
        await asyncio.gather(service.worker, return_exceptions=True)
        restored = ResearchJobs(service.root)
        restored.recover()
        assert restored.get(rows[0]["id"])["status"] == "interrupted"
        assert restored.worker is None
    asyncio.run(run())


def test_parallel_scheduler_respects_limit(service):
    counter = {"active": 0, "peak": 0}
    class Concurrent(FakePipeline):
        async def run(self, *args):
            counter["active"] += 1
            counter["peak"] = max(counter["peak"], counter["active"])
            try:
                await asyncio.sleep(.03)
                async for chunk in super().run(*args):
                    yield chunk
            finally:
                counter["active"] -= 1
    service.pipeline_factory = Concurrent
    async def run():
        service.set_limit(2)
        rows = service.enqueue(["AAPL", "MSFT", "NVDA", "SPY"], "stock", "zh", ["risk"], "parallel-test")
        await service.worker
        assert counter["peak"] == 2
        assert all(service.get(row["id"])["status"] == "completed" for row in rows)
        assert ResearchJobs(service.root).limit == 2
    asyncio.run(run())


def test_deadline_fails_and_keeps_partial(service):
    class Hanging(FakePipeline):
        async def run(self, *args):
            yield event("researcher", result={"id": "risk", "headline": "saved"})
            await asyncio.Event().wait()
    service.pipeline_factory = Hanging
    service.deadline = .02
    async def run():
        job = service.enqueue(["AAPL"], "stock", "zh", ["risk"], "deadline-test")[0]
        await service.worker
        saved = service.get(job["id"])
        assert saved["status"] == "failed" and saved["researchers"]
    asyncio.run(run())


def test_result_exports_and_legacy_import_are_durable(service, monkeypatch):
    monkeypatch.setattr(routes, "jobs", service)
    client = TestClient(app)
    entry = dict(id="legacy-1", ticker="AAPL", mode="stock", locale="zh", researchers=[dict(id="risk", headline="Test only")], manager=dict(decision="hold", conviction=5, thesis="test"))
    result = client.post("/api/research-jobs/import", json={"entries": [entry]})
    assert result.status_code == 200
    job_id = result.json()[0]["id"]
    assert client.post("/api/research-jobs/import", json={"entries": [entry]}).json()[0]["id"] == job_id
    assert len(service.all()) == 1
    assert client.get(f"/api/research-jobs/{job_id}/export/json").json()["manager"]["thesis"] == "test"
    doc = client.get(f"/api/research-jobs/{job_id}/export/docx")
    assert doc.status_code == 200 and zipfile.is_zipfile(io.BytesIO(doc.content))
    bundle = client.get(f"/api/research-jobs/export.zip?ids={job_id}")
    assert len(zipfile.ZipFile(io.BytesIO(bundle.content)).namelist()) == 2
    assert client.get("/api/research-jobs/not-an-id").status_code == 404


def test_sector_batch_keeps_every_ticker_name_and_idempotency(service, monkeypatch):
    from pathlib import Path
    catalog = json.loads((Path(__file__).resolve().parents[2] / 'frontend/src/data/research-catalog.json').read_text(encoding='utf-8'))
    bank_tickers = next(c['symbols'] for c in catalog['categories'] if c['id'] == 'banks')
    monkeypatch.setattr(routes, 'jobs', service)
    monkeypatch.setattr(routes, 'require_key', lambda: None)
    monkeypatch.setattr(service, 'wake', lambda: None)  # no real API calls
    client = TestClient(app)
    body = dict(tickers=bank_tickers, request_id='sector-bank-test', batch_name='银行完整快照', selected_researchers=['risk'])
    response = client.post('/api/research-jobs', json=body)
    assert response.status_code == 200
    assert [r['ticker'] for r in response.json()] == bank_tickers
    assert all(r['batch_name'] == '银行完整快照' for r in response.json())
    assert len(service.all()) > 30
    repeat = client.post('/api/research-jobs', json=body)
    assert [r['id'] for r in repeat.json()] == [r['id'] for r in response.json()]
    assert len(service.all()) == len(bank_tickers)
    assert client.post('/api/research-jobs', json=dict(body, tickers=['AAPL'] * 1001)).status_code == 422


def test_catalog_symbols_validate_and_class_shares_deduplicate(service, monkeypatch):
    from pathlib import Path
    from backend.services.ticker_validator import validate_us_ticker
    catalog = json.loads((Path(__file__).resolve().parents[2] / 'frontend/src/data/research-catalog.json').read_text(encoding='utf-8'))
    assert all(validate_us_ticker(t).valid and validate_us_ticker(t).market == 'us' for t in catalog['stocks'])
    monkeypatch.setattr(routes, 'jobs', service)
    monkeypatch.setattr(routes, 'require_key', lambda: None)
    monkeypatch.setattr(service, 'wake', lambda: None)
    client = TestClient(app)
    response = client.post('/api/research-jobs', json=dict(tickers=['BRK.B', 'BRK-B', 'BRK/B'], request_id='share-class-test'))
    assert response.status_code == 200 and [r['ticker'] for r in response.json()] == ['BRK-B']
