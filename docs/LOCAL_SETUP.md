# Local setup and usage

## Windows

Install Python 3.12 and Node.js 22 or later, then run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

Double-click `start.bat` to start the backend and production frontend and open <http://localhost:3000>. Repeated startup reuses owned running services. Use `stop.bat` to stop them. Closing the browser does not stop background tasks; shutting down the computer or backend interrupts them.

After updating source code, wait for active research and report questions to finish, stop the app, and rebuild:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch.ps1 -Rebuild
```

The launcher verifies process ownership and readiness. It refuses to terminate an unrelated program using the app's ports.

## Model configuration

Open Settings, choose OpenAI, and enter your API key locally. The example configuration uses `https://api.openai.com/v1`, model `gpt-6.1-terra`, and reasoning effort `high`. Use a model available to your account. Saving settings and testing the connection are separate actions; connection tests, research and questions incur API usage.

Alternatively configure `backend/.env` from `backend/.env.example`. Local saved configuration is in `backend/config.json`; neither file belongs in Git. Never put a key in frontend source or a public issue.

## Research workflow

1. **New research:** select sectors or concepts, merge pools, remove unwanted stocks, and name the batch. The dated catalog currently contains 43 categories; curated themes are not exhaustive market membership lists. Up to 1,000 tickers may be submitted per batch.
2. **Task center:** monitor progress and saved analyst briefings. Parallelism is configurable from 1 to 3 stocks, with a shared maximum of 6 queued research / report-Q&A API calls. Failed final synthesis can reuse saved briefings when available. Restarts do not silently resubmit paid research.
3. **Reports & comparison:** search by ticker/company, filter by sector, batch, type or stance, and sort results. Select 2–4 reports for side-by-side reading. Export selected or filtered rows to CSV; report ZIP files contain Word and JSON, split at 100 reports per archive.
4. **Report details:** read the summary first, then expand the full manager report, analyst briefings and original source snapshot. Report generation time is distinct from market data time. Missing source dates remain unknown, and conviction is not a win probability.
5. **Report Q&A:** ask questions about the selected saved report. Questions do not fetch live quotes or read other reports. Replies are saved separately; repeated submission of the same pending request ID does not create another paid call. Interrupted questions require manual resubmission.
6. **Options toolkit:** access options research, strategies, scanners and paper positions. The batch form also retains an options mode.

Language, page position, draft stock lists and report filters are remembered in the browser. Searching for live stock data can also trigger existing AI forecast/news features; browsing saved reports does not.

## Local data and backups

- `backend/data/research_jobs/`: original reports, partial results and queue settings.
- `backend/data/report_chats/`: conversations keyed by report ID.
- `backend/config.json` and `backend/.env`: local credentials/settings.
- `.runtime/`: logs, process ownership records and local verification artifacts.

Back up report and conversation directories before moving computers. Treat configuration backups as secrets. These files are intentionally excluded from GitHub; cloning the repository does not restore private research history. Browser-specific preferences and watchlists are stored in localStorage.

## Verification

```powershell
.\venv\Scripts\python.exe -m pytest -q -o addopts=''
```

From `frontend`:

```powershell
npm test
npm run build
```

Tests use synthetic/mocked AI responses. Passing tests does not validate investment performance or all third-party market data. Runtime data comes from configured market data providers, not from the language model.
