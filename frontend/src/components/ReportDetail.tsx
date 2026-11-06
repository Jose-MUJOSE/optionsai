"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, MessageSquare, ExternalLink } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { getResearchJob, researchExportURL, retryResearchJob, cancelResearchJob, type ResearchJob } from "@/lib/researchJobs";
import { useResearchFeed } from "@/lib/useResearchFeed";
import { dateLabel, isActiveJob, phaseLabel, researchButton as button, researchPrimary, stanceClass, stanceLabel, statusLabel, summaryOf } from "@/lib/researchDisplay";
import { companyName, stockCategories } from "./ReportLibrary";
import { ManagerCard, ResearcherCard } from "./TraderAgent";
import ReportChat from "./ReportChat";

export default function ReportDetail({ id, onOpen, onBack, onMarket }: { id: string; onOpen: (id: string) => void; onBack: () => void; onMarket: (ticker: string) => void }) {
  const { locale } = useAppStore(); const zh = locale === "zh";
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { jobs } = useResearchFeed();
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const data = await getResearchJob(id); if (!stopped) { setJob(data); setError(""); if (isActiveJob(data)) timer = setTimeout(poll, 2500); } }
      catch (e) { if (!stopped) { setError(e instanceof Error ? e.message : String(e)); timer = setTimeout(poll, 5000); } }
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [id]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const ordered = jobs.filter(j => j.status === "completed"); const at = ordered.findIndex(j => j.id === id);
  const versions = jobs.filter(j => j.ticker === job?.ticker && j.mode === job?.mode);
  const summary = job && summaryOf(job);
  return <div className="pb-12 space-y-5" data-testid="report-detail">
    <div className="flex flex-wrap items-center justify-between gap-3"><button className={button} onClick={onBack}><ArrowLeft size={15} />{zh ? "返回报告库" : "Back to reports"}</button><div className="flex gap-2 items-center"><span className="text-xs text-slate-500">{zh ? "按报告时间" : "By report date"}</span><button className={button} disabled={at <= 0} onClick={() => onOpen(ordered[at - 1].id)}><ChevronLeft size={14} />{zh ? "上一份" : "Previous"}</button><button className={button} disabled={at < 0 || at >= ordered.length - 1} onClick={() => onOpen(ordered[at + 1].id)}>{zh ? "下一份" : "Next"}<ChevronRight size={14} /></button></div></div>
    {error && <p role="alert" className="p-4 rounded-xl bg-red-50 text-sm text-red-700">{error}</p>}
    {!job && !error && <p className="p-8 text-slate-500">{zh ? "正在读取已保存报告…" : "Loading saved report…"}</p>}
    {job && <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 space-y-4">
        <div className="flex flex-wrap gap-4 justify-between items-start"><div><p className="text-[11px] font-semibold tracking-wider text-slate-500">{job.mode === "stock" ? (zh ? "股票研究报告" : "STOCK RESEARCH") : (zh ? "期权研究报告" : "OPTIONS RESEARCH")} · {statusLabel(job.status, zh)}</p><h2 className="text-3xl font-bold text-slate-900 mt-1">{job.ticker}</h2><p className="text-sm text-slate-500 mt-1">{companyName(job.ticker)}</p><p className="text-xs text-blue-600 mt-2">{stockCategories(job.ticker).map(c => zh ? c.zh : c.en).join(" · ")}</p></div>
          <div className="flex flex-wrap gap-2"><button className={researchPrimary} disabled={!job.researchers?.length && !summary} onClick={() => setChatOpen(v => !v)}><MessageSquare size={16} />{zh ? "AI 追问这份报告" : "Ask this report"}</button><a className={button} href={researchExportURL(id, "docx")}><Download size={15} />Word</a><a className={button} href={researchExportURL(id, "json")}>JSON</a></div></div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500"><span>{zh ? "生成：" : "Generated: "}{dateLabel(job.finished_at || job.created_at, zh)}</span><span>{job.model} · {job.reasoning_effort}</span><span>{zh ? "研究员 " : "Analysts "}{job.researchers.length}/{job.active_count}</span><span>ID {id.slice(0, 8)}</span>{job.batch_name && <span>{job.batch_name}</span>}</div>
        {versions.length > 1 && <label className="text-xs text-slate-500">{zh ? "同股历史版本 " : "Report versions "}<select className={button} aria-label={zh ? "切换历史报告" : "Switch report version"} value={id} onChange={e => onOpen(e.target.value)}>{versions.map(j => <option key={j.id} value={j.id}>{dateLabel(j.finished_at || j.created_at, zh)} · {statusLabel(j.status, zh)} · {j.id.slice(0, 6)}</option>)}</select></label>}
        <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">{zh ? "这是已保存的研究快照，生成时间不代表行情数据时间；未记录的数据时点不能视为实时。" : "A saved research snapshot. Report generation time is not quote time; unspecified source dates are not live data."}</p>
      </section>
      <div className={`grid gap-5 items-start ${chatOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}>
        <div className="min-w-0 space-y-5">
          {summary ? <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50/50 p-5 md:p-6 space-y-5">
            <div className="flex flex-wrap items-center gap-3"><span className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${stanceClass(summary.decision)}`}>{stanceLabel(summary.decision, zh)}</span><span className="text-sm text-slate-600">{zh ? "主观信心 " : "Conviction "}{summary.conviction == null ? "—" : `${summary.conviction}/10`}</span><span className="text-xs text-slate-500">{zh ? "非胜率" : "Not a win probability"}</span></div>
            <div><h3 className="text-xs font-semibold text-slate-500 mb-2">{zh ? "核心结论" : "Core conclusion"}</h3><p className="text-base leading-8 text-slate-800 whitespace-pre-wrap">{summary.thesis || (zh ? "原报告未提供摘要" : "No thesis recorded")}</p></div>
            <div className="grid md:grid-cols-2 gap-5 border-t border-slate-200/70 pt-4">{[[zh ? "主要风险" : "Main risks", summary.main_risks], [zh ? "催化因素" : "Catalysts", summary.key_catalysts]].map(([label, items]) => <div key={String(label)}><h3 className="text-xs font-semibold text-slate-500 mb-2">{String(label)}</h3>{Array.isArray(items) && items.length ? <ul className="space-y-2 text-sm text-slate-700 leading-relaxed list-disc pl-4">{items.slice(0, 3).map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="text-sm text-slate-500">{zh ? "原报告未单独列出" : "Not separately recorded"}</p>}</div>)}</div>
            {(summary.time_horizon || summary.expiration) && <p className="text-sm text-slate-600"><span className="font-medium">{zh ? "研究期限：" : "Horizon: "}</span>{summary.time_horizon || summary.expiration}</p>}
          </section> : <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3 text-sm text-amber-900"><p>{statusLabel(job.status, zh)} · {phaseLabel(job.phase, zh)}</p><p>{zh ? "尚无有效最终结论。已保存的阶段简报可在下方查看。" : "No valid final conclusion yet. Saved briefings are available below."}</p>{job.error && <p>{job.error}</p>}
            {isActiveJob(job) ? <button disabled={busy} className={button} onClick={() => void run(async () => { setJob(await cancelResearchJob(id)); })}>{zh ? "停止本任务" : "Stop task"}</button> : job.status !== "completed" && <button disabled={busy} className={button} onClick={() => void run(async () => { const next = await retryResearchJob(id); onOpen(next.id); })}>{job.manager_context && job.researchers.length ? (zh ? "仅重试最终汇总（API 计费）" : "Retry synthesis (API charges)") : (zh ? "重新分析（API 计费）" : "Retry analysis (API charges)")}</button>}
          </section>}
          {job.status === "completed" && job.manager && <details className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="full-manager-report"><summary className="font-semibold cursor-pointer text-sm">{zh ? "完整投资经理报告 · 交易计划、研究员综合与行动步骤" : "Full manager report · plan, synthesis & next steps"}</summary><div className="mt-5"><ManagerCard manager={job.manager} mode={job.mode} locale={locale} /></div></details>}
          <details className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="analyst-briefings"><summary className="font-semibold cursor-pointer text-sm">{zh ? "研究员原始简报与分歧" : "Original analyst briefings & disagreements"} · {job.researchers.length}</summary><div className={`mt-5 grid gap-4 ${chatOpen ? "grid-cols-1" : "xl:grid-cols-2"}`}>{job.researchers.map(r => <ResearcherCard key={r.id} researcher={r} locale={locale} />)}</div></details>
          <details className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="font-semibold cursor-pointer text-sm">{zh ? "资料快照、数据时点与任务记录" : "Source snapshot, dates & task history"}</summary><p className="mt-4 text-xs text-slate-500">{zh ? "以下是生成报告时保存的输入资料。资料未记录来源或时点时，保留为未知；不会用当前行情替换旧报告。" : "Original saved inputs. Unrecorded sources or dates remain unknown; current data does not overwrite the report."}</p><pre className="mt-3 p-4 bg-slate-50 rounded-lg text-xs whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-auto">{job.manager_context || (zh ? "这份旧报告没有保存独立的资料快照，请查看原始简报中的证据。" : "No separate source snapshot was saved. Refer to the analyst evidence.")}</pre><ul className="mt-4 text-xs text-slate-500 space-y-2">{job.events?.map((e, i) => <li key={i}>{dateLabel(e.at, zh)} · {phaseLabel(e.phase, zh)} · {e.researcher || e.type}</li>)}</ul></details>
          <button className={button} onClick={() => onMarket(job.ticker)}><ExternalLink size={14} />{zh ? `打开 ${job.ticker} 行情与股票研究` : `Open ${job.ticker} market research`}</button>
        </div>
        {chatOpen && <ReportChat key={id} job={job} zh={zh} onClose={() => setChatOpen(false)} />}
      </div>
    </>}
  </div>;
}
