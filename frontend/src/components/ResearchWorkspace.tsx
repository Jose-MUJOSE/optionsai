"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { ManagerCard, ResearcherCard } from "./TraderAgent";
import ResearchUniversePicker from "./ResearchUniversePicker";
import { parseTickers, MAX_RESEARCH_BATCH } from "@/lib/researchSelection";
import type { TraderMode } from "@/lib/api";
import { listResearchJobs, getResearchJob, submitResearchJobs, cancelResearchJob, retryResearchJob,
  researchExportURL, researchZipURL, importResearchHistory, getQueueSettings, setQueueParallel, type ResearchJob } from "@/lib/researchJobs";

const ANALYSTS = [
  ["quant", "量化", "Quant"], ["technical", "技术", "Technical"], ["fundamental", "基本面", "Fundamental"],
  ["credit", "信用", "Credit"], ["macro", "宏观", "Macro"], ["industry", "行业", "Industry"],
  ["volatility", "波动率", "Volatility"], ["event", "事件", "Events"], ["flow", "资金流", "Flow"], ["risk", "风险", "Risk"],
];
const STATES: Record<string, [string, string]> = { queued: ["排队中", "Queued"], running: ["处理中", "Running"],
  completed: ["已完成", "Completed"], failed: ["失败 · 简报已保留", "Failed · saved"],
  interrupted: ["服务中断 · 可恢复", "Interrupted"], cancelled: ["已停止", "Stopped"] };
const PHASES: Record<string, [string, string]> = { queued: ["等待开始", "Waiting"], gathering_data: ["收集行情", "Gathering data"],
  research_start: ["研究员分析", "Analysts"], debate_start: ["交叉辩论", "Debate"],
  manager_start: ["投资经理汇总", "Final synthesis"], completed: ["结果已保存", "Saved"] };
const button = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed";
const active = (job: ResearchJob) => job.status === "queued" || job.status === "running";
function elapsed(job: ResearchJob, clock: number) {
  const start = Date.parse(job.started_at || job.created_at);
  const end = job.finished_at ? Date.parse(job.finished_at) : clock;
  return `${Math.max(0, Math.floor((end - start) / 60000))}m ${Math.max(0, Math.floor((end - start) / 1000) % 60)}s`;
}

export default function ResearchWorkspace() {
  const { locale, ticker, traderHistory, hydrateTraderHistory } = useAppStore();
  const zh = locale === "zh";
  const [input, setInput] = useState("");
  const [batchName, setBatchName] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [mode, setMode] = useState<TraderMode>("stock");
  const [parallel, setParallel] = useState(2);
  const [analysts, setAnalysts] = useState(ANALYSTS.map(a => a[0]));
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selectedRef = useRef("");
  const [detail, setDetail] = useState<ResearchJob | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState(0);
  const requestRef = useRef<{ payload: string; id: string } | null>(null);

  const choose = useCallback((id: string) => {
    selectedRef.current = id;
    setSelectedId(id);
    setDetail(null);
    window.localStorage.setItem("optionsai_research_selected", id);
  }, []);
  const refresh = useCallback(async () => {
    const rows = await listResearchJobs();
    setJobs(rows);
    setClock(Date.now());
    if (!rows.some(row => row.id === selectedRef.current) && rows.length) choose(rows.find(active)?.id || rows[0].id);
    const id = selectedRef.current;
    if (id && rows.some(row => row.id === id)) {
      const report = await getResearchJob(id);
      if (selectedRef.current === id) setDetail(report);
    }
    setConnectionError("");
  }, [choose]);
  useEffect(() => {
    hydrateTraderHistory();
    getQueueSettings().then(settings => setParallel(settings.parallel_jobs)).catch(() => {});
    const id = window.localStorage.getItem("optionsai_research_selected");
    if (id) { selectedRef.current = id; setSelectedId(id); }
    const draft = window.localStorage.getItem("optionsai_research_draft");
    if (draft) setInput(draft);
    const savedName = window.localStorage.getItem("optionsai_research_batch_name");
    if (savedName) setBatchName(savedName);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); }
      catch (e) { if (!stopped) setConnectionError(e instanceof Error ? e.message : "连接失败"); }
      if (!stopped) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [hydrateTraderHistory, refresh]);
  useEffect(() => {
    if (!selectedId) return;
    let stale = false;
    getResearchJob(selectedId).then(job => { if (!stale) setDetail(job); })
      .catch(e => { if (!stale) setError(String(e.message)); });
    return () => { stale = true; };
  }, [selectedId]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const submit = () => perform(async () => {
    const tickers = parseTickers(input);
    if (!tickers.length || !analysts.length) throw new Error(zh ? "请填写股票代码，并至少选择一位研究员。" : "Enter tickers and select at least one analyst.");
    if (tickers.length > MAX_RESEARCH_BATCH) throw new Error(zh ? `每批最多 ${MAX_RESEARCH_BATCH} 个代码，请删减清单。` : `Maximum ${MAX_RESEARCH_BATCH} tickers per batch.`);
    const batch_name = batchName.trim() || (zh ? "板块 / 批量研究" : "Sector / batch research");
    const payload = JSON.stringify({ tickers, mode, locale, selected_researchers: analysts, batch_name });
    if (requestRef.current?.payload !== payload) requestRef.current = { payload, id: crypto.randomUUID() };
    const rows = await submitResearchJobs({ tickers, mode, locale, selected_researchers: analysts, request_id: requestRef.current!.id, batch_name });
    requestRef.current = null;
    choose(rows[0].id);
    setBatchFilter(rows[0].request_id || "all");
    setNotice(zh ? `已提交 ${rows.length} 个任务；无需保持页面打开。` : `${rows.length} tasks submitted. You can close this page.`);
  });
  const selectedTickers = parseTickers(input);
  const updateInput = (value: string) => { setInput(value); window.localStorage.setItem("optionsai_research_draft", value); };
  const batches = [...new Map(jobs.filter(j => j.batch_name && j.request_id).map(j => [j.request_id!, j])).values()];
  const visible = jobs.filter(job => (batchFilter === "all" || job.request_id === batchFilter) && (filter === "all" || (filter === "active" ? active(job) : job.status === filter)) && job.ticker.includes(query.toUpperCase()));
  const reports = detail?.researchers || [];
  const exportGroups = Array.from({ length: Math.ceil(checked.length / 100) }, (_, i) => checked.slice(i * 100, (i + 1) * 100));

  return <div className="space-y-5 pb-12" data-testid="research-workspace">
    <section className="card-elevated p-5 space-y-4">
      <div><p className="text-xs font-semibold tracking-widest text-blue-600">OPTIONS AI · RESEARCH DESK</p>
        <h2 className="text-2xl font-bold mt-1">{zh ? "任务与结果中心" : "Research tasks & results"}</h2>
        <p className="text-sm text-slate-500 mt-2">{zh ? "单只 / 批量研究 → 后台执行 → 自动保存 → 查看与导出" : "Single / batch research → background queue → saved reports → export"}</p></div>
      <ResearchUniversePicker selected={selectedTickers} onChange={tickers => updateInput(tickers.join(", "))} locale={locale} disabled={busy} />
      <div className="flex flex-wrap gap-3 items-center"><label htmlFor="research-batch-name" className="text-sm font-medium">{zh ? "本批名称" : "Batch name"}</label>
        <input id="research-batch-name" maxLength={120} disabled={busy} className="flex-1 min-w-48 border border-slate-200 rounded-lg p-2 text-sm" placeholder={zh ? "例如：商业航天＋半导体 · 本周研究" : "e.g. Space + semiconductors"} value={batchName} onChange={e => { setBatchName(e.target.value); window.localStorage.setItem("optionsai_research_batch_name", e.target.value); }} /></div>
      <label className="block text-sm font-medium" htmlFor="research-tickers">{zh ? "待分析代码（可手动补充或编辑，逗号、空格或换行分隔）" : "Research tickers (add or edit, separated by commas or new lines)"}</label>
      <textarea id="research-tickers" className="w-full min-h-24 rounded-xl border border-slate-200 p-3 text-sm" value={input}
        disabled={busy} placeholder="AXTI, AAPL, NVDA" onChange={e => updateInput(e.target.value)} />
      <div className="flex flex-wrap gap-2 items-center">
        {ticker && <button className={button} onClick={() => { const text = [input, ticker].filter(Boolean).join("\n"); setInput(text); window.localStorage.setItem("optionsai_research_draft", text); }}>{zh ? `加入当前 ${ticker}` : `Add ${ticker}`}</button>}
        <label className="text-sm">{zh ? "分析类型 " : "Mode "}<select aria-label="分析类型 / Mode" className={button} value={mode} onChange={e => setMode(e.target.value as TraderMode)}>
          <option value="stock">{zh ? "股票研究" : "Stock"}</option><option value="options">{zh ? "期权研究" : "Options"}</option></select></label>
        <button className={button} onClick={() => setAnalysts(ANALYSTS.map(a => a[0]))}>{zh ? "全选研究员" : "Select all analysts"}</button>
        <label className="text-sm">{zh ? "同时分析 " : "Parallel jobs "}<select aria-label="并行任务数 / Parallel jobs" className={button} disabled={busy} value={parallel}
          onChange={e => { const count = Number(e.target.value); void perform(async () => { const settings = await setQueueParallel(count); setParallel(settings.parallel_jobs); }); }}>
          <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
        </select>{zh ? " 只" : " tickers"}</label>
      </div>
      <div className="flex flex-wrap gap-2">{ANALYSTS.map(([id, cn, en]) => <label key={id} className={`px-3 py-2 rounded-lg text-sm border ${analysts.includes(id) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200"}`}>
        <input type="checkbox" className="mr-2" checked={analysts.includes(id)} onChange={() => setAnalysts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />{zh ? cn : en}</label>)}</div>
      <div className="flex items-center flex-wrap gap-3"><button disabled={busy || !selectedTickers.length || selectedTickers.length > MAX_RESEARCH_BATCH || !analysts.length} className="rounded-xl bg-blue-600 text-white px-6 py-3 font-semibold disabled:opacity-40" onClick={submit}>
        {busy ? (zh ? "正在提交…" : "Submitting…") : (zh ? `开始批量分析 ${selectedTickers.length} 只` : `Analyze ${selectedTickers.length} stocks`)}</button>
        <p className="text-xs text-slate-500">{zh ? `每只 ${analysts.length} 位研究员；同时分析 ${parallel} 只，总 API 并发上限 6。使用已保存的模型设置并产生 API 费用。` : `${analysts.length} analysts per ticker; ${parallel} parallel jobs, at most 6 API requests. API charges apply.`}</p></div>
      <p className="text-xs text-slate-500">{zh ? "关闭网页不影响后台任务；关闭电脑或停止服务会中断。每一步自动保存，中断后手动重试，不会自动重复扣费。" : "Closing the page is safe. Stopping the server interrupts work; restart requires an explicit retry."}</p>
      {error && <p role="alert" className="text-red-700 bg-red-50 rounded-lg p-3 text-sm">{error}</p>}
      {notice && <p role="status" className="text-green-700 text-sm">{notice}</p>}
      {connectionError && <p role="alert" className="text-amber-800 bg-amber-50 p-3 text-sm">{zh ? "暂时无法同步后台，保留当前显示，正在重连。" : "Cannot sync with server. Retrying…"} {connectionError}</p>}
    </section>

    <section className="card-elevated p-5 space-y-3">
      <div className="flex flex-wrap gap-2 justify-between items-center"><h3 className="font-bold text-lg">{zh ? "全部任务与已保存结果" : "All tasks & saved results"} <span className="text-slate-400 text-sm">{jobs.length}</span></h3>
        <button className={button} disabled={busy} onClick={() => perform(refresh)}>{zh ? "刷新" : "Refresh"}</button></div>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="筛选代码 / Filter ticker" placeholder={zh ? "搜索已保存代码" : "Filter ticker"} value={query} onChange={e => setQuery(e.target.value)} className="border rounded-lg p-2 text-sm w-40" />
        <select aria-label="任务状态 / Task status" className={button} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">{zh ? "全部状态" : "All statuses"}</option><option value="active">{zh ? "排队 / 执行中" : "Active"}</option>
          <option value="completed">{zh ? "已完成" : "Completed"}</option><option value="failed">{zh ? "失败" : "Failed"}</option><option value="interrupted">{zh ? "中断" : "Interrupted"}</option><option value="cancelled">{zh ? "已停止" : "Stopped"}</option>
        </select>
        <select aria-label={zh ? "筛选研究批次" : "Filter research batch"} className={`${button} max-w-72`} value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          <option value="all">{zh ? "全部批次" : "All batches"}</option>{batches.map(j => <option key={j.request_id} value={j.request_id}>{j.batch_name} · {new Date(j.created_at).toLocaleString()} · {j.request_id?.slice(0, 6)}</option>)}
        </select>
        <button className={button} onClick={() => setChecked(visible.map(j => j.id))}>{zh ? "选择当前列表" : "Select visible"}</button>
        {checked.length > 0 && <>{exportGroups.map((ids, i) => <a key={i} className={button} href={researchZipURL(ids)}>{exportGroups.length === 1 ? (zh ? `批量下载 ZIP (${ids.length})` : `Download ZIP (${ids.length})`) : `ZIP ${i * 100 + 1}–${i * 100 + ids.length}`}</a>)}<button className={button} onClick={() => setChecked([])}>{zh ? "清除选择" : "Clear selection"}</button></>}
      </div>
      {!jobs.length && <p className="py-6 text-center text-slate-500 text-sm">{zh ? "还没有后台任务。在上方输入一个或多个代码即可开始；完成后结果会一直留在这里。" : "No tasks yet. Enter tickers above; saved reports will appear here."}</p>}
      <div className="max-h-96 overflow-auto space-y-2">{visible.map(job => <div key={job.id} className={`rounded-xl border p-3 flex flex-wrap gap-3 items-center ${selectedId === job.id ? "border-blue-400 bg-blue-50/60" : "border-slate-200"}`}>
        <input type="checkbox" aria-label={`选择 ${job.ticker} ${job.id.slice(0, 8)}`} checked={checked.includes(job.id)} onChange={() => setChecked(prev => prev.includes(job.id) ? prev.filter(id => id !== job.id) : [...prev, job.id])} />
        <button onClick={() => choose(job.id)} className="flex-1 min-w-40 text-left"><span className="font-bold text-blue-700">{job.ticker}</span> <span className="text-xs text-slate-500">{job.mode === "stock" ? (zh ? "股票" : "Stock") : (zh ? "期权" : "Options")} · {new Date(job.created_at).toLocaleString()}</span>
          {job.batch_name && <span className="block text-xs text-blue-600 mt-1">{job.batch_name}</span>}
          <p className={`text-sm mt-1 ${job.status === "failed" ? "text-red-600" : "text-slate-600"}`}>{STATES[job.status]?.[zh ? 0 : 1]} · {PHASES[job.phase]?.[zh ? 0 : 1] || job.phase} · {job.researcher_count || 0}/{job.active_count} · {elapsed(job, clock)}</p></button>
        <button className={button} onClick={() => choose(job.id)}>{zh ? "查看结果 / 进度" : "View result / progress"}</button>
        {active(job) && <button disabled={busy} className={button} onClick={() => perform(async () => { await cancelResearchJob(job.id); })}>{zh ? "停止" : "Stop"}</button>}
      </div>)}</div>
      {traderHistory.length > 0 && <button className={button} disabled={busy} onClick={() => perform(async () => { const imported = await importResearchHistory(traderHistory); setNotice(zh ? `已导入 ${imported.length} 条旧历史，原记录仍保留。` : "Legacy history imported and retained."); })}>
        {zh ? `导入本浏览器旧历史 (${traderHistory.length})` : `Import legacy history (${traderHistory.length})`}</button>}
    </section>

    {selectedId && !detail && <p className="p-4 text-slate-500">{zh ? "正在加载已保存结果…" : "Loading saved result…"}</p>}
    {detail && <section className="space-y-4" data-testid="research-result">
      <div className="card-elevated p-5 space-y-3">
        <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-xl font-bold">{detail.ticker} · {zh ? "研究结果" : "Research result"}</h3>
          <p className="text-xs text-slate-500 mt-1">{detail.model} · {detail.reasoning_effort} · {detail.mode} · {detail.id.slice(0, 8)}</p></div>
          <div className="flex flex-wrap gap-2"><a className={button} href={researchExportURL(detail.id, "docx")}>{zh ? "下载 Word 报告" : "Download Word"}</a><a className={button} href={researchExportURL(detail.id, "json")}>{zh ? "下载完整 JSON" : "Download JSON"}</a></div></div>
        <p className="text-sm font-semibold">{STATES[detail.status]?.[zh ? 0 : 1]} · {PHASES[detail.phase]?.[zh ? 0 : 1] || detail.phase} · {elapsed(detail, clock)}</p>
        {detail.batch_name && <p className="text-xs text-blue-600">{zh ? "研究批次：" : "Batch: "}{detail.batch_name}</p>}
        <p className="text-xs text-slate-500">{zh ? "最近保存：" : "Last saved: "}{new Date(detail.updated_at).toLocaleString()} · {zh ? "文件保存在本机 backend/data/research_jobs，可随时下载副本。" : "Saved locally in backend/data/research_jobs; downloads are additional copies."}</p>
        {detail.status === "running" && <p className="text-sm text-blue-700">{zh ? "后台正在处理，高推理模式可能需要数分钟。以下简报已保存，可以离开页面稍后回来查看。" : "Working in the background. High reasoning can take several minutes. Saved briefings are below."}</p>}
        {detail.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700 text-sm">{detail.error}</p>}
        {!active(detail) && detail.status !== "completed" && <button className={button} disabled={busy} onClick={() => perform(async () => { const next = await retryResearchJob(detail.id); choose(next.id); })}>
          {detail.manager_context && reports.length ? (zh ? "仅重试最终汇总（复用已存简报）" : "Retry synthesis only") : (zh ? "重新分析（产生 API 费用）" : "Retry analysis (API charges)")}</button>}
      </div>
      {detail.status === "completed" && detail.manager ? <ManagerCard manager={detail.manager} mode={detail.mode} locale={detail.locale} /> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {zh ? "尚无有效最终结论。下面是已保存的研究员简报，不代表投资经理已完成判断。" : "No valid final conclusion yet. Saved analyst briefings below are not the final decision."}</div>}
      <h3 className="font-bold">{zh ? "研究员简报（自动保存）" : "Saved analyst briefings"} {reports.length}/{detail.active_count}</h3>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{reports.map(r => <ResearcherCard key={r.id} researcher={r} locale={detail.locale} />)}</div>
      <details className="card p-4 text-xs"><summary className="cursor-pointer font-semibold">{zh ? "任务阶段记录" : "Task timeline"}</summary><ul className="mt-3 space-y-2">{(detail.events || []).map((event, i) => <li key={i}>{new Date(event.at).toLocaleTimeString()} · {PHASES[event.phase]?.[zh ? 0 : 1] || event.phase} · {event.researcher || event.type}</li>)}</ul></details>
    </section>}
  </div>;
}
