"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Layers, ListChecks, Plus, RefreshCw } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useResearchFeed } from "@/lib/useResearchFeed";
import { useLocalPreference } from "@/lib/useLocalPreference";
import { cancelResearchJob, importResearchHistory } from "@/lib/researchJobs";
import { dateLabel, isActiveJob, phaseLabel, researchButton as button, researchPrimary, stanceClass, stanceLabel, statusLabel, summaryOf } from "@/lib/researchDisplay";
import { companyName } from "./ReportLibrary";
import type { AppView } from "./Sidebar";

export function ResearchHome({ onNavigate, onOpen }: { onNavigate: (view: AppView) => void; onOpen: (id: string) => void }) {
  const { locale } = useAppStore(); const zh = locale === "zh";
  const { jobs, error, loaded } = useResearchFeed();
  const completed = jobs.filter(j => j.status === "completed"); const active = jobs.filter(isActiveJob);
  const interrupted = jobs.filter(j => ["failed", "interrupted"].includes(j.status));
  return <div className="space-y-6 pb-12" data-testid="research-home">
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-6 md:p-8">
      <p className="text-[11px] tracking-[0.18em] font-bold text-blue-600">OPTIONS AI · RESEARCH DESK</p>
      <h2 className="text-2xl md:text-3xl font-bold mt-3 text-slate-900">{zh ? "从一个板块，找到值得深入研究的股票。" : "From a sector to a focused research shortlist."}</h2>
      <p className="mt-3 text-sm text-slate-600 leading-relaxed max-w-2xl">{zh ? "选择股票池 → 批量研究 → 对比观点与风险 → 阅读报告、继续追问。研究成果自动保存在本机。" : "Build a universe → analyze in batches → compare evidence and risks → read and ask follow-up questions. Reports are saved locally."}</p>
      <div className="flex flex-wrap gap-3 mt-6"><button className={researchPrimary} onClick={() => { localStorage.setItem("optionsai.researchMode.v1", JSON.stringify("stock")); onNavigate("trader"); }}><Plus size={16} />{zh ? "新建股票研究" : "New stock research"}</button><button className={button} onClick={() => onNavigate("reports")}><BookOpen size={16} />{zh ? "查看报告与对比" : "Reports & comparison"}</button></div>
    </section>
    <div className="grid sm:grid-cols-3 gap-4">{[
      { label: zh ? "已保存报告" : "Saved reports", count: completed.length, view: "reports" as AppView, icon: BookOpen, filter: "all" },
      { label: zh ? "进行中的任务" : "Active tasks", count: active.length, view: "tasks" as AppView, icon: ListChecks, filter: "active" },
      { label: zh ? "需要查看的任务" : "Needs attention", count: interrupted.length, view: "tasks" as AppView, icon: RefreshCw, filter: "attention" },
    ].map(({ label, count, view, icon: Icon, filter }) => <button key={view + label} onClick={() => { if (view === "tasks") { localStorage.setItem("optionsai.taskFilter.v1", JSON.stringify(filter)); localStorage.setItem("optionsai.taskQuery.v1", JSON.stringify("")); localStorage.setItem("optionsai.taskBatch.v1", JSON.stringify("all")); } onNavigate(view); }} className="text-left bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-300 flex justify-between items-center"><div><p className="text-xs text-slate-500">{label}</p><p className="text-3xl font-bold mt-2 text-slate-900">{loaded && !error ? count : "—"}</p></div><Icon size={24} className="text-blue-400" /></button>)}</div>
    {error && <p role="alert" className="text-sm p-3 rounded-xl bg-amber-50 text-amber-800">{zh ? "暂时无法连接研究服务：" : "Cannot reach the research service: "}{error}</p>}
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">{zh ? "最近完成的研究" : "Recent research"}</h2><button className="text-xs text-blue-700 flex gap-1 items-center" onClick={() => onNavigate("reports")}>{zh ? "全部报告" : "All reports"}<ArrowRight size={14} /></button></div>
      <div className="grid md:grid-cols-2 gap-4">{completed.slice(0, 6).map(j => { const s = summaryOf(j); return <button key={j.id} onClick={() => onOpen(j.id)} className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all"><div className="flex items-center justify-between gap-3"><span className="font-bold text-blue-700">{j.ticker}</span><span className={`border px-2 py-1 rounded-md text-xs ${stanceClass(s?.decision)}`}>{stanceLabel(s?.decision, zh)}</span></div><p className="text-xs text-slate-500 mt-1 truncate">{companyName(j.ticker)}</p><p className="text-sm text-slate-600 leading-relaxed mt-3 line-clamp-2">{s?.thesis || (zh ? "打开完整报告查看依据" : "Open the full report")}</p><p className="text-[11px] text-slate-400 mt-4">{dateLabel(j.finished_at || j.created_at, zh)} · {j.mode === "stock" ? (zh ? "股票" : "Stock") : (zh ? "期权" : "Options")}</p></button>; })}</div>
      {loaded && !completed.length && !error && <div className="text-sm text-slate-500 p-8 bg-white rounded-xl border border-dashed border-slate-200">{zh ? "开始第一批研究后，完成的报告会出现在这里。" : "Your completed research will appear here."}</div>}
    </section>
    <button className="w-full rounded-xl border border-slate-200 bg-white p-5 flex items-center gap-4 text-left hover:border-blue-300" onClick={() => onNavigate("options")}><Layers size={20} className="text-slate-400" /><div className="flex-1"><p className="text-sm font-semibold">{zh ? "期权工具箱" : "Options toolkit"}</p><p className="text-xs text-slate-500 mt-1">{zh ? "期权链、波动率、策略与扫描器，仍可随时使用。" : "Options chains, volatility, strategies and scanners remain available."}</p></div><ArrowRight size={16} className="text-slate-400" /></button>
  </div>;
}

export function ResearchTasks({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { locale, traderHistory, hydrateTraderHistory } = useAppStore(); const zh = locale === "zh";
  const { jobs, error, loaded, refresh } = useResearchFeed();
  const [filter, setFilter] = useLocalPreference("optionsai.taskFilter.v1", "all");
  const [query, setQuery] = useLocalPreference("optionsai.taskQuery.v1", "");
  const [batch, setBatch] = useLocalPreference("optionsai.taskBatch.v1", "all");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(50);
  useEffect(() => { hydrateTraderHistory(); }, [hydrateTraderHistory]);
  const rows = jobs.filter(j => (filter === "all" || (filter === "active" ? isActiveJob(j) : filter === "attention" ? ["failed", "interrupted"].includes(j.status) : j.status === filter)) && j.ticker.includes(query.trim().toUpperCase()) && (batch === "all" || j.request_id === batch));
  const batches = [...new Map(jobs.filter(j => j.batch_name && j.request_id).map(j => [j.request_id!, j.batch_name!])).entries()];
  const run = async (action: () => Promise<void>) => { setBusy(true); setNotice(""); try { await action(); await refresh(); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <div className="pb-12 space-y-4" data-testid="research-tasks">
    <div className="flex flex-wrap justify-between gap-3 items-center"><p className="text-sm text-slate-500">{zh ? `${jobs.filter(isActiveJob).length} 个任务进行中。关闭网页后后台继续；完成后自动进入报告库。` : `${jobs.filter(isActiveJob).length} active tasks. Work continues when the page closes.`}</p><button className={researchPrimary} onClick={onNew}><Plus size={16} />{zh ? "新建研究" : "New research"}</button></div>
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-2 items-center">
      <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-40" aria-label={zh ? "搜索任务代码" : "Find task ticker"} placeholder={zh ? "搜索代码" : "Ticker"} value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }} />
      <select className={button} aria-label={zh ? "任务状态" : "Task status"} value={filter} onChange={e => { setFilter(e.target.value); setLimit(50); }}>{[ ["all", "全部状态", "All statuses"], ["active", "排队 / 分析中", "Active"], ["attention", "失败 / 中断", "Needs attention"], ["completed", "已完成", "Completed"], ["cancelled", "已停止", "Stopped"] ].map(([value, cn, en]) => <option key={value} value={value}>{zh ? cn : en}</option>)}</select>
      <select className={`${button} max-w-64`} aria-label={zh ? "任务批次" : "Task batch"} value={batch} onChange={e => { setBatch(e.target.value); setLimit(50); }}><option value="all">{zh ? "全部批次" : "All batches"}</option>{batches.map(([id, name]) => <option key={id} value={id}>{name} · {id.slice(0, 6)}</option>)}</select>
      <button className={button} onClick={() => { setQuery(""); setBatch("all"); setFilter("all"); }}>{zh ? "重置筛选" : "Reset filters"}</button><button className={`${button} ml-auto`} disabled={busy} onClick={() => void run(async () => {})}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button>
    </div>
    {(error || notice) && <p role="status" className="text-sm p-3 bg-amber-50 text-amber-900 rounded-xl">{error || notice}</p>}
    {!rows.length && <p className="p-8 text-center text-slate-500 text-sm">{!loaded ? (zh ? "读取任务中…" : "Loading…") : (zh ? "没有符合条件的任务。" : "No matching tasks.")}</p>}
    <div className="space-y-3">{rows.slice(0, limit).map(job => <article key={job.id} className="border border-slate-200 rounded-xl bg-white p-4 flex flex-wrap gap-4 items-center"><div className="flex-1 min-w-48"><div className="flex flex-wrap gap-3 items-center"><button className="text-blue-700 font-bold" onClick={() => onOpen(job.id)}>{job.ticker}</button><span className={`text-xs px-2 py-1 rounded-md ${job.status === "completed" ? "bg-emerald-50 text-emerald-800" : isActiveJob(job) ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}>{statusLabel(job.status, zh)}</span><span className="text-xs text-slate-500">{job.mode === "stock" ? (zh ? "股票" : "Stock") : (zh ? "期权" : "Options")}</span></div><p className="text-xs text-slate-500 mt-2">{phaseLabel(job.phase, zh)} · {zh ? "已保存简报 " : "Saved analysts "}{job.researcher_count || 0}/{job.active_count} · {dateLabel(job.created_at, zh)}</p>{job.batch_name && <p className="text-xs text-slate-500 mt-1">{job.batch_name}</p>}{job.error && <p className="text-xs text-amber-700 mt-2 line-clamp-2">{job.error}</p>}</div><button className={button} onClick={() => onOpen(job.id)}>{job.status === "completed" ? (zh ? "阅读报告" : "Read report") : (zh ? "查看进度 / 恢复" : "Progress / recover")}</button>{isActiveJob(job) && <button className={button} disabled={busy} onClick={() => void run(async () => { await cancelResearchJob(job.id); })}>{zh ? "停止" : "Stop"}</button>}</article>)}</div>
    {rows.length > limit && <button className={button} onClick={() => setLimit(n => n + 50)}>{zh ? "加载更多" : "Load more"}</button>}
    {traderHistory.length > 0 && <button className={button} disabled={busy} onClick={() => void run(async () => { await importResearchHistory(traderHistory); setNotice(zh ? "旧历史已导入，原记录保留。" : "Legacy reports imported. Originals retained."); })}>{zh ? `导入本浏览器旧历史（${traderHistory.length}）` : `Import browser history (${traderHistory.length})`}</button>}
  </div>;
}
