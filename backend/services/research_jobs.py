"""Local durable research queue, independently of HTTP.

Each state transition is atomically saved. Restart never silently reissues a
paid request: unfinished jobs become interrupted and require explicit retry.
"""
import asyncio
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timezone
from uuid import uuid4

from backend.services.config_store import get_config
from backend.services.llm_client import LLMClient
from backend.services.data_fetcher import DataFetcher
from backend.services.trader_agent import TraderAgentPipeline

ROOT = Path(__file__).resolve().parent.parent / "data" / "research_jobs"
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


def now():
    return datetime.now(timezone.utc).isoformat()


class ResearchJobs:
    def __init__(self, root=ROOT, pipeline_factory=TraderAgentPipeline, deadline=1800):
        self.root = Path(root)
        self.pipeline_factory = pipeline_factory
        self.deadline = deadline
        self.worker = None
        self.active = None
        self.active_id = None
        self.running = {}
        self.limit = 2
        self.llm_gate = None
        settings = self.root / "queue-settings.json"
        if settings.exists():
            self.limit = max(1, min(3, int(json.loads(settings.read_text())["parallel_jobs"])))

    def save(self, job):
        self.root.mkdir(parents=True, exist_ok=True)
        job["updated_at"] = now()
        fd, temporary = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(job, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.root / (job["id"] + ".json"))
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def get(self, job_id):
        if len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
            raise KeyError(job_id)
        try:
            return json.loads((self.root / (job_id + ".json")).read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise KeyError(job_id) from None

    def all(self):
        jobs = [json.loads(path.read_text(encoding="utf-8")) for path in self.root.glob("*.json") if len(path.stem) == 32]
        return sorted(jobs, key=lambda job: job["created_at"], reverse=True)

    def recover(self):
        for job in self.all():
            if job["status"] in {"running", "queued"}:
                job.update(status="interrupted", error="服务已重启；已有简报已保存，请手动重试。", finished_at=now())
                self.save(job)

    def enqueue(self, tickers, mode, locale, researchers, request_id, batch_name=""):
        previous = [job for job in self.all() if job.get("request_id") == request_id]
        if previous:
            return sorted(previous, key=lambda job: job["created_at"])
        config = get_config()
        result = []
        for ticker in tickers:
            job = dict(id=uuid4().hex, request_id=request_id, ticker=ticker, batch_name=batch_name,
                       mode=mode, locale=locale, selected_researchers=researchers,
                       model=config["llm_model"], provider=config["llm_provider"],
                       reasoning_effort=config["llm_reasoning_effort"],
                       status="queued", phase="queued", created_at=now(),
                       started_at=None, finished_at=None, phase_started_at=None,
                       researchers=[], manager=None, error=None, manager_context=None,
                       active_count=len(researchers), events=[])
            self.save(job)
            result.append(job)
        self.wake()
        return result

    def wake(self):
        if self.worker is None or self.worker.done():
            self.worker = asyncio.create_task(self._work())

    def set_limit(self, limit):
        if limit not in {1, 2, 3}:
            raise ValueError("并行数必须为 1–3")
        self.limit = limit
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / "queue-settings.json"
        temporary = self.root / "queue-settings.tmp"
        temporary.write_text(json.dumps({"parallel_jobs": limit}), encoding="utf-8")
        os.replace(temporary, target)
        self.wake()

    def retry(self, job_id):
        old = self.get(job_id)
        if old["status"] not in TERMINAL - {"completed"}:
            raise ValueError("只有未完成任务可以重试")
        result = self.enqueue([old["ticker"]], old["mode"], old["locale"], old["selected_researchers"], uuid4().hex, old.get("batch_name", ""))[0]
        # Failed synthesis reuses the frozen briefings/context, avoiding another
        # ten analyst calls. A new record keeps the failed original inspectable.
        if old.get("manager_context") and old.get("researchers"):
            result.update(researchers=old["researchers"], manager_context=old["manager_context"], resume_manager=True)
        result["parent_id"] = old["id"]
        self.save(result)
        return result

    async def cancel(self, job_id):
        job = self.get(job_id)
        if job["status"] in TERMINAL:
            return job
        job.update(status="cancelled", error="用户已停止；已有内容已保留。", finished_at=now())
        self.save(job)
        if job_id in self.running:
            task = self.running[job_id]
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return self.get(job_id)

    async def shutdown(self):
        if self.worker:
            self.worker.cancel()
        for task in self.running.values():
            task.cancel()
        await asyncio.gather(*(task for task in [self.worker, *self.running.values()] if task), return_exceptions=True)
        self.recover()

    async def _work(self):
        try:
            while True:
                pending = [job for job in reversed(self.all()) if job["status"] == "queued" and job["id"] not in self.running]
                for job in pending[:max(0, self.limit - len(self.running))]:
                    self.running[job["id"]] = asyncio.create_task(self._run(job["id"]))
                if not self.running:
                    return
                done, _ = await asyncio.wait(self.running.values(), timeout=0.5, return_when=asyncio.FIRST_COMPLETED)
                for job_id, task in list(self.running.items()):
                    if task in done:
                        try:
                            task.result()
                        except asyncio.CancelledError:
                            pass
                        except Exception:
                            self.event(job_id, {"type": "error", "message": "任务执行异常；已有结果保留，请重试。"})
                        del self.running[job_id]
        finally:
            for task in self.running.values():
                task.cancel()
            await asyncio.gather(*self.running.values(), return_exceptions=True)
            self.running.clear()

    def event(self, job_id, event):
        job = self.get(job_id)
        if job["status"] != "running":
            return
        kind = event.get("type")
        if kind == "phase":
            job.update(phase=event["phase"], phase_started_at=now())
        elif kind == "selected":
            job["active_count"] = event["count"]
        elif kind == "researcher":
            job["researchers"] = [r for r in job["researchers"] if r["id"] != event["result"]["id"]] + [event["result"]]
        elif kind == "rebuttal":
            for researcher in job["researchers"]:
                if researcher["id"] == event["id"]:
                    researcher["rebuttal"] = dict(event["rebuttal"], opponent_id=event["opponent_id"])
        elif kind == "manager_context":
            job["manager_context"] = event["context"]
        elif kind == "manager":
            job["manager"] = event["result"]
        elif kind == "done":
            manager = event.get("manager")
            job.update(researchers=event["researchers"], manager=manager)
            if not manager or manager.get("_parse_error"):
                job.update(status="failed", error="投资经理未生成有效最终结果；简报已保存，可仅重试汇总。")
            else:
                job.update(status="completed", phase="completed")
            job["finished_at"] = now()
        elif kind == "error":
            job.update(status="failed", error=event["message"], finished_at=now())
        if kind in {"phase", "researcher", "manager", "done", "error"}:
            job["events"].append({"at": now(), "type": kind, "phase": job["phase"],
                                   "researcher": event.get("result", {}).get("id")})
        self.save(job)

    async def _run(self, job_id):
        job = self.get(job_id)
        config = get_config()
        fetcher = DataFetcher()
        job.update(status="running", phase="gathering_data", started_at=now(), phase_started_at=now())
        self.save(job)
        try:
            if config["llm_provider"] != job["provider"]:
                raise ValueError("提供商已更改，请重新创建任务，以免使用错误密钥。")
            llm = LLMClient(config["llm_api_key"], config["llm_base_url"], job["provider"], job["reasoning_effort"])
            if self.llm_gate is None:
                self.llm_gate = asyncio.Semaphore(6)
            llm.request_gate = self.llm_gate
            llm.require_key()
            pipeline = self.pipeline_factory(llm, job["model"], fetcher)
            if job["provider"] == "openai":
                pipeline.MAX_CONCURRENT_LLM_CALLS = 6
            async with asyncio.timeout(self.deadline):
                if job.get("resume_manager"):
                    self.event(job_id, {"type": "phase", "phase": "manager_start"})
                    manager = await pipeline._call_manager(job["researchers"], job["manager_context"], job["mode"], job["locale"])
                    self.event(job_id, {"type": "done", "researchers": job["researchers"], "manager": manager})
                else:
                    async for chunk in pipeline.run(job["ticker"], job["mode"], job["locale"], job["selected_researchers"]):
                        for line in chunk.splitlines():
                            if line.startswith("data: "):
                                self.event(job_id, json.loads(line[6:]))
                if self.get(job_id)["status"] == "running":
                    raise RuntimeError("分析未返回完成事件；已保存阶段结果。")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            message = "分析超过 30 分钟，已停止；已有简报已保存。" if isinstance(error, TimeoutError) else str(error)
            # Never persist a provider response that might contain credentials.
            if config.get("llm_api_key"):
                message = message.replace(config["llm_api_key"], "[redacted]")
            self.event(job_id, {"type": "error", "message": message[:1000]})
        finally:
            await fetcher.close()


jobs = ResearchJobs()
