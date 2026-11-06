"""
OptionsAI - 期权策略与智能分析平台 (Backend)
FastAPI 主入口
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pathlib import Path
from contextlib import asynccontextmanager

load_dotenv(Path(__file__).resolve().parent / ".env")

@asynccontextmanager
async def lifespan(app):
    from backend.services.report_chat import report_chats
    from backend.services.research_jobs import jobs
    jobs.recover()
    report_chats.recover()
    yield
    await jobs.shutdown()
    await report_chats.shutdown()


app = FastAPI(
    lifespan=lifespan,
    title="OptionsAI API",
    description="期权策略引擎 + AI 投研助手",
    version="0.1.0",
)

# CORS - 允许 Next.js 前端 (localhost:3000) 访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "OptionsAI API is running", "version": "0.1.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "application": "optionsai"}


# 注册 API 路由
from backend.routers import market_data, strategies, chat, forecast, settings, trader
app.include_router(market_data.router, prefix="/api")
app.include_router(strategies.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(forecast.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(trader.router, prefix="/api")
from backend.routers import research_jobs
app.include_router(research_jobs.router, prefix="/api")
