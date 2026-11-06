"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { askReportQuestion, getReportChat, type ResearchJob, type ReportConversation } from "@/lib/researchJobs";
import { dateLabel, downloadText, researchButton as button } from "@/lib/researchDisplay";

export default function ReportChat({ job, zh, onClose }: { job: ResearchJob; zh: boolean; onClose: () => void }) {
  const [conversation, setConversation] = useState<ReportConversation>({ report_id: job.id, turns: [] });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const pending = useRef<{ question: string; id: string } | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const storageKey = `optionsai.reportChat.pending.${job.id}`;
  const busy = sending || conversation.turns.some(t => ["queued", "running"].includes(t.status));
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) { pending.current = JSON.parse(raw); setInput(pending.current?.question || ""); } } catch { /* optional local retry token */ }
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await getReportChat(job.id);
        if (!stopped) {
          setConversation(result); setLoaded(true); setConnectionError("");
          if (pending.current && result.turns.some(t => t.id === pending.current?.id)) { pending.current = null; localStorage.removeItem(storageKey); setInput(""); }
        }
      } catch (e) { if (!stopped) { setConnectionError(e instanceof Error ? e.message : String(e)); setLoaded(true); } }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [job.id, storageKey]);
  const signature = conversation.turns.map(t => `${t.id}:${t.status}`).join(",");
  useEffect(() => { if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight; }, [signature]);
  const send = async () => {
    const question = input.trim(); if (!question || busy) return;
    setSending(true); setError("");
    if (pending.current?.question !== question) pending.current = { question, id: crypto.randomUUID() };
    try {
      localStorage.setItem(storageKey, JSON.stringify(pending.current));
      const result = await askReportQuestion(job.id, { question, request_id: pending.current!.id, locale: zh ? "zh" : "en" });
      setConversation(result); setInput(""); pending.current = null; localStorage.removeItem(storageKey);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSending(false); }
  };
  const prompts = zh ? ["这份报告最重要的三个依据是什么？", "哪些变化会推翻当前结论？", "研究员之间有哪些分歧？"] : ["What are the three strongest pieces of evidence?", "What would invalidate the conclusion?", "Where do the analysts disagree?"];

  return <aside className="rounded-2xl border border-blue-200 bg-white shadow-sm flex flex-col lg:sticky lg:top-4 max-h-[82vh]" data-testid="report-chat" aria-label={zh ? "当前报告 AI 追问" : "Ask this report"}>
    <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-semibold text-sm"><Sparkles size={17} className="text-blue-600" />{job.ticker} · {zh ? "报告追问" : "Report Q&A"}</div><button className="p-1 text-slate-500 hover:text-blue-700" onClick={onClose} aria-label={zh ? "收起报告追问" : "Close report Q&A"}><X size={17} /></button></div>
    <div className="px-4 py-3 bg-blue-50/60 text-xs text-slate-600 border-b border-blue-100 leading-relaxed">{zh ? "依据已保存报告，无实时行情。" : "Uses this saved report, without live quotes."}<br />{dateLabel(job.finished_at || job.created_at, zh)} · {job.id.slice(0, 8)}
      {conversation.turns.length > 0 && <button className="flex gap-1 items-center text-blue-700 mt-2" onClick={() => downloadText(`OptionsAI-${job.ticker}-conversation.json`, JSON.stringify(conversation, null, 2), "application/json")}><Download size={12} />{zh ? "下载追问记录" : "Download conversation"}</button>}</div>
    <div ref={historyRef} className="p-4 space-y-4 overflow-y-auto min-h-48 flex-1" aria-live="polite">
      {!loaded && <p className="text-xs text-slate-500">{zh ? "正在读取追问记录…" : "Loading conversation…"}</p>}
      {loaded && !conversation.turns.length && <div className="space-y-3"><p className="text-sm text-slate-500 leading-relaxed">{zh ? "无需重新输入股票代码。可以核对依据、拆解风险，或了解研究员之间的分歧。" : "Ask about the evidence, risks or analyst disagreements in this report."}</p>{prompts.map(p => <button key={p} className="w-full text-left text-xs border border-slate-200 rounded-lg p-3 hover:border-blue-300 text-slate-600" onClick={() => { setInput(p); inputRef.current?.focus(); }}>{p}</button>)}</div>}
      {conversation.turns.map(turn => <article key={turn.id} className="space-y-3">
        <div className="rounded-xl rounded-tr-sm bg-blue-50 p-3 text-sm text-slate-800 whitespace-pre-wrap break-words">{turn.question}</div>
        {turn.status === "completed" ? <div className="report-markdown text-sm leading-relaxed text-slate-700 break-words"><ReactMarkdown>{turn.answer || ""}</ReactMarkdown><p className="text-[10px] text-slate-400 mt-3">{turn.model} · {turn.reasoning_effort} · {dateLabel(turn.finished_at, zh)}</p></div> : ["queued", "running"].includes(turn.status) ? <p role="status" className="flex items-start gap-2 text-xs text-blue-700 leading-relaxed"><Loader2 className="animate-spin shrink-0 mt-0.5" size={14} />{zh ? "正在结合报告推理…可以离开页面，完成后自动保存。" : "Reading the report… You may leave this page; the reply will be saved."}</p> : <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-900"><p>{turn.error}</p><button className="underline mt-2" disabled={busy} onClick={() => { pending.current = null; setInput(turn.question); inputRef.current?.focus(); }}>{zh ? "重新填写此问题" : "Use this question again"}</button></div>}
      </article>)}
    </div>
    <div className="p-4 border-t border-slate-100 space-y-2">
      {connectionError && <p role="status" className="text-xs text-amber-800">{zh ? "暂时无法同步追问记录，正在重新连接。" : "Cannot sync conversation. Reconnecting."} {connectionError}</p>}
      {error && <p role="alert" className="text-xs text-red-700 leading-relaxed">{error} {zh ? "网络错误可再次发送，同一问题的重试不会重复提交。" : "Retrying the same pending question will not duplicate it."}</p>}
      <form onSubmit={e => { e.preventDefault(); void send(); }} className="space-y-2"><textarea ref={inputRef} aria-label={zh ? "向这份报告提问" : "Question about this report"} maxLength={4000} rows={3} placeholder={zh ? "针对这份报告提问…" : "Ask about this report…"} value={input} onChange={e => setInput(e.target.value)} className="w-full border border-slate-200 rounded-lg p-3 text-sm outline-none focus:border-blue-400 resize-y" onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">{zh ? "使用当前模型设置 · API 计费" : "Current model settings · API charges"}<br />Ctrl + Enter</span><button type="submit" className={`${button} text-blue-700`} disabled={busy || !input.trim() || !loaded}><Send size={14} />{busy ? (zh ? "回答中" : "Working") : (zh ? "发送" : "Send")}</button></div>
      </form>
    </div>
  </aside>;
}
