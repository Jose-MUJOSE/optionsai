import type { ResearchJob, ReportSummary } from "./researchJobs";

export const researchButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:border-blue-400 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer";
export const researchPrimary = "inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";
export const isActiveJob = (job: ResearchJob) => job.status === "queued" || job.status === "running";
export function summaryOf(job: ResearchJob): ReportSummary | null {
  return job.status === "completed" ? (job.summary || job.manager || null) : null;
}
export function stanceLabel(value: string | undefined, zh: boolean) {
  const map: Record<string, string> = { buy: "看多", hold: "观望", sell: "看空", bullish: "看多", neutral: "中性", bearish: "看空" };
  return value ? (zh ? map[value.toLowerCase()] || value : value.toUpperCase()) : (zh ? "未提供" : "Not provided");
}
export function stanceGroup(value?: string) {
  const raw = (value || "").trim().toLowerCase();
  if (["buy", "bullish", "买入", "看多", "增持"].includes(raw)) return "buy";
  if (["sell", "bearish", "卖出", "看空", "减持"].includes(raw)) return "sell";
  if (["hold", "neutral", "持有", "观望", "中性"].includes(raw)) return "hold";
  return raw;
}
export function stanceClass(value?: string) {
  return stanceGroup(value) === "buy" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : stanceGroup(value) === "sell" ? "bg-rose-50 text-rose-800 border-rose-200" : "bg-slate-100 text-slate-700 border-slate-200";
}
export function dateLabel(value: string | null | undefined, zh: boolean) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(zh ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : (zh ? "未记录" : "Not recorded");
}
export function statusLabel(status: string, zh: boolean) {
  const map: Record<string, string> = { queued: "排队中", running: "分析中", completed: "已完成", failed: "失败 · 简报已保存", interrupted: "已中断 · 可重试", cancelled: "已停止" };
  return zh ? map[status] || status : status;
}
export function phaseLabel(phase: string, zh: boolean) {
  const map: Record<string, [string, string]> = { queued: ["等待开始", "Waiting"], gathering_data: ["收集行情", "Gathering data"], research_start: ["研究员分析", "Analysts"], debate_start: ["交叉辩论", "Debate"], manager_start: ["投资经理汇总", "Final synthesis"], completed: ["结果已保存", "Saved"] };
  return map[phase]?.[zh ? 0 : 1] || phase;
}
export function selectReports(jobs: ResearchJob[], latestOnly: boolean, sort: string) {
  let rows = jobs.filter(j => j.status === "completed").sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (latestOnly) {
    const seen = new Set<string>();
    rows = rows.filter(job => { const key = `${job.ticker}:${job.mode}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return rows.sort((a, b) => sort === "ticker" ? a.ticker.localeCompare(b.ticker) : sort === "conviction" ? (summaryOf(b)?.conviction ?? -1) - (summaryOf(a)?.conviction ?? -1) : Date.parse(b.created_at) - Date.parse(a.created_at));
}
export function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function comparisonCSV(rows: ResearchJob[]) {
  // Treat model-generated values as text, including formula prefixes in spreadsheet apps.
  const cell = (v: unknown) => '"' + String(v ?? "").replace(/^(?:[\t\r\n]|\s*[=+@-])/, "'$&").replace(/"/g, '""') + '"';
  const header = ["代码", "类型", "报告生成时间", "AI观点", "主观信心(非胜率)", "核心依据", "主要风险", "催化因素", "期限", "报告ID"];
  const values = rows.map(j => { const s = summaryOf(j); return [j.ticker, j.mode, j.finished_at || j.created_at, s?.decision, s?.conviction, s?.thesis, s?.main_risks?.join("；"), s?.key_catalysts?.join("；"), s?.time_horizon || s?.expiration, j.id]; });
  return "\uFEFF" + [header, ...values].map(row => row.map(cell).join(",")).join("\r\n");
}
