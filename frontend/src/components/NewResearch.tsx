"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useLocalPreference } from "@/lib/useLocalPreference";
import { getQueueSettings, setQueueParallel, submitResearchJobs } from "@/lib/researchJobs";
import { parseTickers, MAX_RESEARCH_BATCH } from "@/lib/researchSelection";
import { researchButton as button, researchPrimary } from "@/lib/researchDisplay";
import type { TraderMode } from "@/lib/api";
import ResearchUniversePicker from "./ResearchUniversePicker";

const ANALYSTS = [["quant", "量化", "Quant"], ["technical", "技术", "Technical"], ["fundamental", "基本面", "Fundamental"], ["credit", "信用", "Credit"], ["macro", "宏观", "Macro"], ["industry", "行业", "Industry"], ["volatility", "波动率", "Volatility"], ["event", "事件", "Events"], ["flow", "资金流", "Flow"], ["risk", "风险", "Risk"]];

export default function NewResearch({ onTasks }: { onTasks: () => void }) {
  const { locale, ticker } = useAppStore(); const zh = locale === "zh";
  const [input, setInput] = useState(""); const [batchName, setBatchName] = useState("");
  const [mode, setMode] = useLocalPreference<TraderMode>("optionsai.researchMode.v1", "stock");
  const [analysts, setAnalysts] = useLocalPreference("optionsai.researchAnalysts.v1", ANALYSTS.map(a => a[0]));
  const [parallel, setParallel] = useState(1); const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const requestRef = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    setInput(localStorage.getItem("optionsai_research_draft") || "");
    setBatchName(localStorage.getItem("optionsai_research_batch_name") || "");
    try { const pending = localStorage.getItem("optionsai.researchPending.v1"); if (pending) requestRef.current = JSON.parse(pending); } catch { /* no pending submission */ }
    getQueueSettings().then(s => { setParallel(s.parallel_jobs); setSettingsLoaded(true); }).catch(e => setError(e.message));
  }, []);
  const updateInput = (value: string) => { setInput(value); localStorage.setItem("optionsai_research_draft", value); };
  const tickers = parseTickers(input);
  const submit = async () => {
    if (!tickers.length || tickers.length > MAX_RESEARCH_BATCH || !analysts.length || busy) return;
    setBusy(true); setError("");
    const batch_name = batchName.trim() || (zh ? "板块 / 批量研究" : "Sector / batch research");
    const data = { tickers, mode, locale, selected_researchers: analysts, batch_name }; const payload = JSON.stringify(data);
    if (requestRef.current?.payload !== payload) requestRef.current = { payload, id: crypto.randomUUID() };
    try {
      localStorage.setItem("optionsai.researchPending.v1", JSON.stringify(requestRef.current));
      const rows = await submitResearchJobs({ ...data, request_id: requestRef.current!.id });
      requestRef.current = null; localStorage.removeItem("optionsai.researchPending.v1");
      localStorage.setItem("optionsai.taskBatch.v1", JSON.stringify(rows[0].request_id || "all"));
      localStorage.setItem("optionsai.taskFilter.v1", JSON.stringify("all"));
      localStorage.setItem("optionsai.taskQuery.v1", JSON.stringify(""));
      onTasks();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-5 pb-12" data-testid="research-workspace">
    <div className="flex gap-2 items-center text-xs text-slate-500 flex-wrap"><span className="font-semibold text-blue-700">{zh ? "1 选择股票" : "1 Choose stocks"}</span><ArrowRight size={13} /><span>{zh ? "2 设置分析" : "2 Configure"}</span><ArrowRight size={13} /><span>{zh ? "3 在任务中心查看进度" : "3 Track tasks"}</span></div>
    <ResearchUniversePicker selected={tickers} onChange={values => updateInput(values.join(", "))} locale={locale} disabled={busy} />
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex justify-between gap-3 items-center"><h2 className="font-bold">{zh ? "待分析清单与设置" : "Research list & settings"}</h2><span className={`text-sm font-semibold ${tickers.length > MAX_RESEARCH_BATCH ? "text-red-700" : "text-blue-700"}`}>{tickers.length} / {MAX_RESEARCH_BATCH}</span></div>
      <label className="block text-sm text-slate-600" htmlFor="research-batch-name">{zh ? "本批名称" : "Batch name"}</label><input id="research-batch-name" value={batchName} maxLength={120} disabled={busy} onChange={e => { setBatchName(e.target.value); localStorage.setItem("optionsai_research_batch_name", e.target.value); }} className="w-full border border-slate-200 p-3 rounded-lg text-sm" placeholder={zh ? "例如：商业航天＋半导体 · 本周研究" : "e.g. Space + semiconductors"} />
      <label className="block text-sm text-slate-600" htmlFor="research-tickers">{zh ? "股票代码（可手动增删，逗号、空格或换行分隔）" : "Tickers (edit freely, separated by commas or new lines)"}</label><textarea id="research-tickers" disabled={busy} value={input} onChange={e => updateInput(e.target.value)} rows={3} className="w-full border border-slate-200 rounded-xl p-3 text-sm" placeholder="AAPL, NVDA, AXTI" />
      {ticker && <button className={button} onClick={() => updateInput([...new Set([...tickers, ticker])].join(", "))}>{zh ? `加入当前 ${ticker}` : `Add ${ticker}`}</button>}
      <div className="flex flex-wrap gap-4 items-center"><label className="text-sm text-slate-600">{zh ? "分析类型 " : "Mode "}<select className={button} value={mode} disabled={busy} onChange={e => setMode(e.target.value as TraderMode)} aria-label={zh ? "分析类型" : "Analysis mode"}><option value="stock">{zh ? "股票研究" : "Stock research"}</option><option value="options">{zh ? "期权研究" : "Options research"}</option></select></label>
        <label className="text-sm text-slate-600">{zh ? "同时分析 " : "Parallel jobs "}<select className={button} value={parallel} disabled={busy || !settingsLoaded} aria-label={zh ? "并行任务数" : "Parallel jobs"} onChange={e => { const count = Number(e.target.value); setBusy(true); setQueueParallel(count).then(s => setParallel(s.parallel_jobs)).catch(e => setError(e.message)).finally(() => setBusy(false)); }}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select>{zh ? " 只" : " stocks"}</label></div>
      <details className="rounded-xl border border-slate-200 p-4"><summary className="text-sm font-medium cursor-pointer">{zh ? `研究员设置 · 已选 ${analysts.length} / 10` : `Analysts · ${analysts.length} / 10 selected`}</summary><div className="flex flex-wrap gap-2 mt-4">{ANALYSTS.map(([id, cn, en]) => <label key={id} className={`px-3 py-2 rounded-lg text-sm border ${analysts.includes(id) ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}><input type="checkbox" disabled={busy} checked={analysts.includes(id)} className="mr-2" onChange={() => setAnalysts(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id])} />{zh ? cn : en}</label>)}</div><button className="text-xs text-blue-700 mt-3" disabled={busy} onClick={() => setAnalysts(ANALYSTS.map(a => a[0]))}>{zh ? "选择全部研究员" : "Select all analysts"}</button></details>
      {error && <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-lg">{error}</p>}
      {tickers.length > MAX_RESEARCH_BATCH && <p className="text-sm text-red-700">{zh ? `每批最多 ${MAX_RESEARCH_BATCH} 只，请删减清单。` : `At most ${MAX_RESEARCH_BATCH} stocks per batch.`}</p>}
      <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4"><button className={researchPrimary} onClick={() => void submit()} disabled={busy || !settingsLoaded || !tickers.length || !analysts.length || tickers.length > MAX_RESEARCH_BATCH}>{busy ? (zh ? "处理中…" : "Working…") : (zh ? `开始分析 ${tickers.length} 只` : `Analyze ${tickers.length} stocks`)}<ArrowRight size={15} /></button><p className="text-xs text-slate-500 leading-relaxed">{zh ? `每只 ${analysts.length} 位研究员；同时分析 ${parallel} 只，总 API 并发上限 6。` : `${analysts.length} analysts; ${parallel} concurrent stocks, up to 6 API requests.`}<br />{zh ? "使用已保存的模型设置，提交后产生 API 费用。" : "Uses saved model settings. Submission incurs API charges."}</p></div>
      <p className="text-xs text-slate-500 leading-relaxed">{zh ? "关闭网页不会中断后台分析；关闭电脑或停止服务会中断。已完成简报自动保存，恢复需手动重试。" : "Closing the page is safe. Stopping the computer or service interrupts analysis; saved work is retained and retry is manual."}</p>
    </section>
  </div>;
}
