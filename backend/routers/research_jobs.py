import io
import json
import zipfile
import re
import asyncio
from uuid import uuid5, NAMESPACE_URL
from typing import Literal
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.services.research_jobs import jobs
from backend.services.trader_agent import RESEARCHER_SPECS
from backend.services.ticker_validator import validate_us_ticker
from backend.services import ai_assistant
from backend.services.llm_client import LLMConfigurationError
from backend.routers.trader import TraderReportRequest, _build_word_report
from backend.services.llm_schemas import ResearcherOutput, ManagerOutput
from backend.services.research_jobs import now
from backend.services.report_chat import report_chats, report_summary

router = APIRouter(prefix="/research-jobs", tags=["Research tasks and results"])


class QueueSettings(BaseModel):
    parallel_jobs: Literal[1, 2, 3]


@router.get("/queue-settings")
async def queue_settings():
    return {"parallel_jobs": jobs.limit, "max_llm_requests": 6}


@router.post("/queue-settings")
async def set_queue_settings(req: QueueSettings):
    jobs.set_limit(req.parallel_jobs)
    return await queue_settings()


class Submission(BaseModel):
    tickers: list[str] = Field(min_length=1, max_length=1000)
    mode: Literal["stock", "options"] = "stock"
    locale: Literal["zh", "en"] = "zh"
    selected_researchers: list[str] = Field(default_factory=list)
    request_id: str = Field(min_length=8, max_length=80)
    batch_name: str = Field(default="", max_length=120)


def require_key():
    try:
        ai_assistant.client.require_key()
    except LLMConfigurationError as error:
        raise HTTPException(503, str(error)) from None


def get_job(job_id):
    try:
        return jobs.get(job_id)
    except KeyError:
        raise HTTPException(404, "任务不存在 / Task not found") from None


@router.post("")
async def submit(req: Submission):
    require_key()
    tickers = list(dict.fromkeys(re.sub(r"[./]([AB])$", r"-\1", t.strip().upper()) for t in req.tickers))
    invalid = [t for t in tickers if not validate_us_ticker(t).valid]
    if invalid:
        raise HTTPException(422, "请使用美股 / ETF 代码: " + ", ".join(invalid))
    selected = req.selected_researchers or list(RESEARCHER_SPECS)
    if len(selected) != len(set(selected)) or any(r not in RESEARCHER_SPECS for r in selected):
        raise HTTPException(422, "研究员选择无效")
    existing = [job for job in jobs.all() if job.get("request_id") == req.request_id]
    if existing:
        return sorted(existing, key=lambda job: job["created_at"])
    if sum(job["status"] in {"queued", "running"} for job in jobs.all()) + len(tickers) > 2000:
        raise HTTPException(409, "队列最多容纳 2000 个进行中任务，请等待或取消部分任务")
    return jobs.enqueue(tickers, req.mode, req.locale, selected, req.request_id, req.batch_name.strip())


@router.get("")
async def list_jobs():
    # Only summaries, never the full reports for every polling request.
    return [{k: v for k, v in job.items() if k not in {"researchers", "manager", "manager_context", "events"}} |
            {"researcher_count": len(job["researchers"]), "summary": report_summary(job)} for job in jobs.all()]


class LegacyHistory(BaseModel):
    entries: list[dict] = Field(max_length=30)


@router.post("/import")
async def import_history(req: LegacyHistory):
    if len(json.dumps(req.entries, ensure_ascii=False)) > 5_000_000:
        raise HTTPException(413, "历史记录过大")
    prepared = []
    try:
        for entry in req.entries:
            ticker = str(entry["ticker"]).upper()
            if not validate_us_ticker(ticker).valid or entry["mode"] not in {"stock", "options"}:
                raise ValueError("Invalid historical ticker or mode")
            manager = ManagerOutput.model_validate(entry["manager"]).model_dump()
            researchers = [ResearcherOutput.model_validate(r).model_dump() for r in entry["researchers"]]
            if len(researchers) > 30 or any(not r.get("id") for r in researchers):
                raise ValueError("Invalid researcher records")
            job_id = uuid5(NAMESPACE_URL, "optionsai-legacy:" + str(entry["id"])).hex
            try:
                prepared.append(jobs.get(job_id))
                continue
            except KeyError:
                pass
            prepared.append(dict(id=job_id, request_id="legacy:" + str(entry["id"]), ticker=ticker,
                mode=entry["mode"], locale="zh" if entry.get("locale") == "zh" else "en", selected_researchers=[r["id"] for r in researchers],
                model="历史导入 / legacy", provider="unknown", reasoning_effort="unknown", source="browser_history",
                status="failed" if manager.get("_parse_error") else "completed", phase="completed", created_at=now(),
                started_at=None, phase_started_at=None, finished_at=now(), researchers=researchers, manager=manager,
                manager_context=None, error="旧记录最终汇总无效" if manager.get("_parse_error") else None,
                active_count=len(researchers), events=[], legacy_timestamp=entry.get("timestamp")))
    except (ValueError, KeyError, TypeError):
        raise HTTPException(422, "历史格式不完整，原浏览器记录未更改。") from None
    for job in prepared:
        jobs.save(job)
    return prepared


def word(job):
    manager = job.get("manager") if job["status"] == "completed" else None
    if not manager:
        manager = {"decision": "未完成 / INCOMPLETE", "conviction": 0,
                   "thesis": f"状态: {job['status']}。{job.get('error') or '正在处理中'}。以下是已保存的阶段简报，不是最终结论。"}
    return _build_word_report(TraderReportRequest(ticker=job["ticker"], mode=job["mode"],
            locale=job["locale"], researchers=job["researchers"], manager=manager))


@router.get("/export.zip")
async def export_zip(ids: str):
    selected = list(dict.fromkeys(ids.split(",")))
    if len(selected) > 100:
        raise HTTPException(422, "一次最多导出 100 个任务")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for job_id in selected:
            job = get_job(job_id)
            name = f"{job['ticker']}_{job['id']}"
            archive.writestr(name + ".json", json.dumps(job, ensure_ascii=False, indent=2))
            archive.writestr(name + ".docx", word(job))
    return Response(buffer.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="OptionsAI-results.zip"'})


@router.get("/{job_id}")
async def detail(job_id: str):
    return get_job(job_id)


class ReportQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    locale: Literal["zh", "en"] = "zh"


@router.get("/{job_id}/chat")
async def read_report_chat(job_id: str):
    get_job(job_id)
    return report_chats.get(job_id)


@router.post("/{job_id}/chat", status_code=202)
async def ask_report(job_id: str, req: ReportQuestion):
    job = get_job(job_id)
    question = req.question.strip()
    if not question:
        raise HTTPException(422, "请输入问题 / Enter a question")
    if jobs.llm_gate is None:
        jobs.llm_gate = asyncio.Semaphore(6)
    try:
        return report_chats.submit(job, question, req.request_id, req.locale, jobs.llm_gate)
    except LLMConfigurationError as error:
        raise HTTPException(503, str(error)) from None
    except ValueError as error:
        raise HTTPException(409, str(error)) from None


@router.post("/{job_id}/cancel")
async def cancel(job_id: str):
    get_job(job_id)
    return await jobs.cancel(job_id)


@router.post("/{job_id}/retry")
async def retry(job_id: str):
    require_key()
    get_job(job_id)
    try:
        return jobs.retry(job_id)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None


@router.get("/{job_id}/export/{format}")
async def export(job_id: str, format: Literal["json", "docx"]):
    job = get_job(job_id)
    data = word(job) if format == "docx" else json.dumps(job, ensure_ascii=False, indent=2).encode("utf-8")
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" if format == "docx" else "application/json"
    return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="OptionsAI_{job["ticker"]}_{job_id[:8]}.{format}"'})
