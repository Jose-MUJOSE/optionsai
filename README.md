<div align="center">

# 🎯 OptionsAI

**AI-powered options strategy assistant for retail investors**

*Real market data · Multi-agent analysis · Beginner-friendly explanations*

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## What is OptionsAI?

OptionsAI is a full-stack web platform that helps **beginner retail investors** understand and evaluate options strategies. Instead of drowning users in raw Greeks and IV numbers, it combines real market data with a multi-agent AI pipeline to deliver plain-language strategy recommendations with clearly stated risk, breakeven, and probability of profit.

> **Scope disclaimer:** OptionsAI provides analysis and educational recommendations only. It does not execute trades, manage portfolios, or constitute financial advice.

---

## Features

- 📊 **Candlestick Chart** — TradingView-quality OHLCV chart powered by `lightweight-charts`. Supports MA5/10/20/30 overlays, 5 time ranges, and manual trend-line drawing.

- 🔗 **Full Options Chain** — Dual-sided call/put table with Greeks view and Probability view. ATM row highlighted. Win probability calculated via Black-Scholes N(d₂). Beginner tooltips on every Greek column header.

- 🤖 **Multi-Agent AI Chat** — Three-stage pipeline: **Researcher** (parallel data collection) → **Analyst** (streaming LLM strategy analysis) → **Verifier** (consistency check with auto-retry). Real-time status indicators show which agent is active.

- 📈 **IV Term Structure** — Implied volatility curve across all available expirations. IV rank and percentile vs. 1-year history.

- 📉 **Short & Flow Panel** — Real FINRA RegSHO daily short volume + Yahoo Finance short interest. Chip distribution estimate (VWAP-weighted). Institutional ownership changes (13F). Put/Call ratio from live option OI.

- ⚡ **Strategy Engine** — Automatically selects the best strategy (covered call, bull call spread, iron condor, straddle, etc.) based on your market outlook. Generates payoff diagram, max loss/profit, and break-even points.

- 🔄 **Strategy Backtest** — Walk-forward BSM pricing simulation over historical price data. P&L curve per contract.

- 🌍 **Bilingual UI** — Full English / 中文 toggle. Every label and explanation available in both languages.

- 📷 **Multimodal Chart Input** — Paste or drag-drop a chart screenshot into the AI chat. The AI analyzes the image alongside market data (requires a vision-capable LLM such as GPT-4o).

- 📋 **Watchlist & Paper Portfolio** — Track tickers and simulate paper trades locally.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Next.js 16)                  │
│  Zustand store · Recharts · lightweight-charts · SSE     │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼─────────────────────────────┐
│                  FastAPI Backend (Python 3.12)           │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Multi-Agent Pipeline                  │    │
│  │  ResearcherAgent → AnalystAgent → VerifierAgent  │    │
│  │  (parallel data)   (stream LLM)  (JSON check)    │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │StrategyEngine│  │BacktestEngine│  │ DataFetcher  │  │
│  │ (BSM pricing)│  │(walk-forward)│  │(async httpx) │  │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  │
└─────────────────────────────────────────────┼───────────┘
                                              │
              ┌───────────────────────────────┼───────────────┐
              │                               │               │
    ┌─────────▼──────┐            ┌──────────▼─────┐  ┌──────▼─────┐
    │  Yahoo Finance  │            │  Polygon.io     │  │  FINRA     │
    │  REST API       │            │  (backup)       │  │  RegSHO    │
    │  (primary)      │            │                 │  │  (shorts)  │
    └─────────────────┘            └─────────────────┘  └────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend framework | [Next.js 16](https://nextjs.org) + [React 19](https://react.dev) | App shell, routing, SSR |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) | Utility-first styling |
| State management | [Zustand 5](https://zustand-demo.pmnd.rs) | Global client state |
| Charts | [lightweight-charts 5](https://tradingview.github.io/lightweight-charts/) | Candlestick / OHLCV |
| Charts (data viz) | [Recharts 3](https://recharts.org) | Payoff, IV, short volume |
| Backend framework | [FastAPI](https://fastapi.tiangolo.com) | REST API + SSE streaming |
| HTTP client | [httpx](https://www.python-httpx.org) | Async requests to data APIs |
| Numerical | [NumPy](https://numpy.org) + [SciPy](https://scipy.org) + [pandas](https://pandas.pydata.org) | BSM pricing, statistics |
| LLM | [OpenAI-compatible API](https://platform.openai.com/docs) | DeepSeek / GPT-4o / any |
| Market data | Yahoo Finance REST + Polygon.io | Real-time prices, options |
| Short data | FINRA RegSHO public files | Daily short volume |

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- A DeepSeek or OpenAI API key

### 1. Clone and configure

```bash
git clone https://github.com/Jose-MUJOSE/optionsai.git
cd optionsai

# Backend config
cp backend/.env.example backend/.env
# Edit backend/.env and add your API key:
#   DEEPSEEK_API_KEY=sk-...
```

### 2. Install dependencies

```bash
# Backend
python -m venv venv
source venv/Scripts/activate      # Windows
# source venv/bin/activate         # macOS / Linux
pip install -r backend/requirements.txt

# Frontend
cd frontend
npm install
cd ..
```

### 3. Run

```bash
# Terminal 1 — backend
venv/Scripts/python.exe -m uvicorn backend.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open **http://localhost:3000**, type a ticker (e.g. `AAPL`), and explore.

> **Windows shortcut:** double-click `start.bat` to launch both servers at once.

---

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DEEPSEEK_API_KEY` | ✅ | LLM API key (DeepSeek / OpenAI-compatible) | `sk-abc123...` |
| `DEEPSEEK_BASE_URL` | ✅ | LLM base URL | `https://api.deepseek.com/v1` |
| `POLYGON_API_KEY` | Optional | Polygon.io backup data source | `your_key_here` |
| `HOST` | Optional | Backend bind address | `0.0.0.0` |
| `PORT` | Optional | Backend port | `8000` |

The app works with DeepSeek, OpenAI GPT-4o, or any OpenAI-compatible endpoint. Change the base URL and model name in the Settings panel (⚙️) without restarting.

---

## API Reference

All endpoints are prefixed with `/api`. Interactive docs at `http://localhost:8000/docs`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ohlcv/{ticker}` | OHLCV bars for candlestick chart |
| `GET` | `/api/iv-term-structure/{ticker}` | IV curve across expirations |
| `GET` | `/api/options-snapshot/{ticker}` | ATM Greeks snapshot |
| `GET` | `/api/expirations/{ticker}` | Available expiration dates |
| `GET` | `/api/short-data/{ticker}` | Short interest + FINRA daily short volume |
| `GET` | `/api/gex/{ticker}` | Gamma exposure by strike |
| `GET` | `/api/earnings-moves/{ticker}` | Historical earnings move magnitudes |
| `GET` | `/api/unusual-flow/{ticker}` | Unusual options activity |
| `POST` | `/api/strategies` | Generate ranked strategy recommendations |
| `POST` | `/api/backtest/{ticker}` | Run walk-forward strategy backtest |
| `POST` | `/api/scanner` | Scan multiple tickers for opportunities |
| `POST` | `/api/chat/stream` | Multi-agent AI chat (SSE streaming) |
| `POST` | `/api/forecast/{ticker}` | AI market forecast |
| `POST` | `/api/market-intel/{ticker}` | News + analyst sentiment summary |

---

## Project Structure

```
optionsai/
├── backend/
│   ├── main.py                    # FastAPI app entry point
│   ├── requirements.txt
│   ├── .env.example               # Copy to .env and fill in keys
│   ├── models/
│   │   └── schemas.py             # Pydantic request/response models
│   ├── routers/
│   │   ├── market_data.py         # Market data endpoints
│   │   ├── chat.py                # AI chat + streaming
│   │   ├── strategies.py          # Strategy generation
│   │   └── forecast.py            # Forecast + market intel
│   └── services/
│       ├── data_fetcher.py        # Yahoo Finance + Polygon.io client
│       ├── ai_assistant.py        # LLM integration + vision support
│       ├── agent_orchestrator.py  # Multi-agent pipeline
│       ├── strategy_engine.py     # Strategy selection logic
│       ├── strategy_selector.py   # Ranking and filtering
│       └── backtest_engine.py     # BSM walk-forward backtest
└── frontend/
    └── src/
        ├── app/
        │   └── page.tsx           # Main page layout
        ├── components/            # 29 UI components
        ├── lib/
        │   ├── store.ts           # Zustand global state
        │   ├── api.ts             # API client functions
        │   ├── i18n.ts            # English / Chinese translations
        │   └── imageUpload.ts     # Canvas-based image resize
        └── types/
            └── index.ts           # Shared TypeScript types
```

---

## Data Sources & Honesty

All data displayed is fetched from real public sources — no mock data, no fabricated numbers.

| Data Type | Source | Update Frequency |
|-----------|--------|-----------------|
| Stock price, options chain, IV | Yahoo Finance REST API | Real-time |
| OHLCV bars | Yahoo Finance `v8/finance/chart` | Daily / intraday |
| Backup price & aggregates | Polygon.io (free tier) | Real-time |
| Daily short volume | FINRA RegSHO public files | Daily |
| Short interest (bi-weekly) | Yahoo Finance `defaultKeyStatistics` | Bi-weekly |
| Chip distribution | VWAP-weighted estimation from OHLCV | Calculated | 
| Institutional ownership | Yahoo Finance `institutionOwnership` (13F) | Quarterly |

> ⚠️ **Chip distribution is an estimation**, not real broker settlement data. A clear disclaimer is shown in the UI.

---

## Roadmap

- [x] Candlestick chart with MA overlays and trend-line drawing
- [x] Full options chain (Greeks view + Probability view)
- [x] Multi-agent AI pipeline with Researcher → Analyst → Verifier
- [x] IV term structure and IV rank history
- [x] Short interest + FINRA daily short volume panel
- [x] Strategy backtest with BSM walk-forward simulation
- [x] GEX (Gamma Exposure) panel
- [x] Earnings historical move analysis
- [x] Unusual options flow detection
- [x] Paper portfolio tracker
- [x] Bilingual UI (English / 中文)
- [x] Multimodal chart image input to AI chat
- [ ] Vercel / Railway one-click deploy button
- [ ] WebSocket real-time price updates
- [ ] Options flow scanner with filters
- [ ] Portfolio Greeks aggregation

---

## Contributing

Pull requests are welcome. For major changes, open an issue first to discuss what you would like to change.

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add some feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<div align="center">

Built with ❤️ using FastAPI · Next.js · DeepSeek · Yahoo Finance

</div>
