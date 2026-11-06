"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Download, GitCompareArrows, Search, X } from "lucide-react";
import catalog from "@/data/research-catalog.json";
import { useAppStore } from "@/lib/store";
import { useResearchFeed } from "@/lib/useResearchFeed";
import { useLocalPreference } from "@/lib/useLocalPreference";
import { researchZipURL, type ResearchJob } from "@/lib/researchJobs";
import { comparisonCSV, dateLabel, downloadText, researchButton as button, selectReports, stanceClass, stanceGroup, stanceLabel, summaryOf } from "@/lib/researchDisplay";

const stocks: Record<string, { name: string; industry: string }> = catalog.stocks;
export const companyName = (ticker: string) => stocks[ticker]?.name || ticker;
export const stockCategories = (ticker: string) => catalog.categories.filter(c => c.symbols.includes(ticker));

export default function ReportLibrary({ onOpen }: { onOpen: (id: string) => void }) {
  const { locale } = useAppStore(); const zh = locale === "zh";
  const { jobs, error, loaded, refresh } = useResearchFeed();
  const [filters, setFilters] = useLocalPreference("optionsai.reportFilters.v1", { query: "", mode: "all", batch: "all", category: "all", stance: "all", sort: "date", latest: false });
  const [checked, setChecked] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(50);
  const completed = jobs.filter(j => j.status === "completed");
  const batches = [...new Map(jobs.filter(j => j.request_id && j.batch_name).map(j => [j.request_id!, j.batch_name!])).entries()];
  const categories = catalog.categories.filter(c => completed.some(j => c.symbols.includes(j.ticker)));
  const rows = useMemo(() => selectReports(jobs, filters.latest, filters.sort).filter(j => {
    const term = filters.query.trim().toLowerCase();
    return (!term || `${j.ticker} ${companyName(j.ticker)} ${j.batch_name || ""}`.toLowerCase().includes(term)) &&
      (filters.mode === "all" || j.mode === filters.mode) && (filters.batch === "all" || j.request_id === filters.batch) &&
      (filters.category === "all" || catalog.categories.find(c => c.id === filters.category)?.symbols.includes(j.ticker)) &&
      (filters.stance === "all" || stanceGroup(summaryOf(j)?.decision) === stanceGroup(filters.stance));
  }), [jobs, filters]);
  const selection = completed.filter(j => checked.includes(j.id));
  const update = (part: Partial<typeof filters>) => { setFilters(f => ({ ...f, ...part })); setLimit(50); };
  const toggle = (id: string) => setChecked(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const compareRows = selection.length >= 2 && selection.length <= 4 ? selection : [];
  const decisions = [...new Set(completed.map(j => stanceGroup(summaryOf(j)?.decision)).filter(Boolean))];

  return <div className="space-y-5 pb-12" data-testid="report-library">
    <div className="flex items-start justify-between gap-4 flex-wrap"><p className="text-sm text-slate-600">{!loaded ? (zh ? "正在读取已保存报告…" : "Loading saved reports…") : error && !completed.length ? (zh ? "暂时无法读取报告，请检查研究服务。" : "Unable to read reports. Please check the service.") : zh ? `已保存 ${completed.length} 份报告。横向比较观点与风险，再打开详情核对依据。` : `${completed.length} saved reports. Compare the evidence and risks, then open a report.`}</p>
      <button className={button} onClick={() => { void refresh().catch(e => setNotice(e.message)); }}>{zh ? "刷新" : "Refresh"}</button></div>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 flex-1 min-w-52"><Search size={16} className="text-slate-400" /><input aria-label={zh ? "搜索报告" : "Search reports"} className="w-full py-2.5 outline-none text-sm bg-transparent" placeholder={zh ? "搜索代码、公司或批次" : "Ticker, company or batch"} value={filters.query} onChange={e => update({ query: e.target.value })} /></label>
        <select aria-label={zh ? "报告类型" : "Report type"} className={button} value={filters.mode} onChange={e => update({ mode: e.target.value })}><option value="all">{zh ? "股票与期权" : "Stocks & options"}</option><option value="stock">{zh ? "股票" : "Stocks"}</option><option value="options">{zh ? "期权" : "Options"}</option></select>
        <select aria-label={zh ? "报告分类" : "Report category"} className={`${button} max-w-52`} value={filters.category} onChange={e => update({ category: e.target.value })}><option value="all">{zh ? "全部板块" : "All sectors"}</option>{categories.map(c => <option key={c.id} value={c.id}>{zh ? c.zh : c.en}</option>)}</select>
        <select aria-label={zh ? "报告批次" : "Report batch"} className={`${button} max-w-52`} value={filters.batch} onChange={e => update({ batch: e.target.value })}><option value="all">{zh ? "全部批次" : "All batches"}</option>{batches.map(([id, name]) => <option key={id} value={id}>{name} · {id.slice(0, 6)}</option>)}</select>
        <select aria-label={zh ? "AI观点筛选" : "Filter AI stance"} className={button} value={filters.stance} onChange={e => update({ stance: e.target.value })}><option value="all">{zh ? "全部观点" : "All stances"}</option>{decisions.map(s => <option key={s} value={s}>{stanceLabel(s, zh)}</option>)}</select>
      </div>
      <div className="flex flex-wrap gap-3 items-center text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.latest} onChange={e => update({ latest: e.target.checked })} />{zh ? "仅每只股票 / 类型的最新报告" : "Latest per ticker & type"}</label>
        <select aria-label={zh ? "报告排序" : "Sort reports"} className={button} value={filters.sort} onChange={e => update({ sort: e.target.value })}><option value="date">{zh ? "最新生成优先" : "Newest first"}</option><option value="ticker">{zh ? "股票代码" : "Ticker"}</option><option value="conviction">{zh ? "主观信心高到低" : "Conviction high to low"}</option></select>
        <button className="text-blue-700 text-xs" onClick={() => update({ query: "", mode: "all", batch: "all", category: "all", stance: "all", latest: false })}>{zh ? "重置筛选" : "Reset filters"}</button>
        <span className="ml-auto text-slate-500 text-xs">{zh ? `匹配 ${rows.length} 份` : `${rows.length} matching`}</span>
      </div>
    </section>
    {(error || notice) && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error || notice}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={!rows.length} onClick={() => setChecked(rows.map(j => j.id))}>{zh ? "选择全部匹配报告" : "Select matching reports"}</button>
      <button className={button} disabled={selection.length < 2 || selection.length > 4} onClick={() => setCompare(v => !v)}><GitCompareArrows size={16} />{zh ? "并排对比（2–4 份）" : "Compare (2–4)"}</button>
      <button className={button} disabled={!rows.length} onClick={() => downloadText("OptionsAI-comparison.csv", comparisonCSV(selection.length ? selection : rows), "text/csv;charset=utf-8")}><Download size={15} />{zh ? `导出${selection.length ? "所选" : "当前"}对比表` : "Export comparison CSV"}</button>
      {!!selection.length && <><span className="text-xs text-slate-500">{zh ? `已选 ${selection.length} 份（含隐藏行）` : `${selection.length} selected (includes hidden rows)`}</span><button className="text-xs text-blue-700" onClick={() => { setChecked([]); setCompare(false); }}>{zh ? "清空选择" : "Clear selection"}</button>
        {Array.from({ length: Math.ceil(selection.length / 100) }, (_, i) => <a key={i} className={button} href={researchZipURL(selection.slice(i * 100, i * 100 + 100).map(j => j.id))}>{zh ? "报告 ZIP" : "Reports ZIP"}{selection.length > 100 ? ` ${i + 1}` : ""}</a>)}</>}
    </div>
    {compare && compareRows.length > 0 && <section className="rounded-2xl border border-blue-200 bg-blue-50/30 p-4 space-y-4" data-testid="report-comparison">
      <div className="flex justify-between items-center"><h2 className="font-bold">{zh ? "所选报告 · 并排阅读" : "Selected reports · side by side"}</h2><button className={button} onClick={() => setCompare(false)} aria-label={zh ? "关闭对比" : "Close comparison"}><X size={16} /></button></div>
      <p className="text-xs text-slate-500">{zh ? "以下为各份报告的原始结论摘要；报告日期、分析类型与期限可能不同。" : "Original report conclusions. Dates, analysis types and horizons may differ."}</p>
      <div className="overflow-x-auto"><div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${compareRows.length}, minmax(260px, 1fr))` }}>{compareRows.map(j => <ComparisonCard key={j.id} job={j} zh={zh} onOpen={onOpen} />)}</div></div>
    </section>}
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm text-left min-w-[880px]" data-testid="report-results-table">
        <caption className="sr-only">{zh ? "已保存研究报告结果对比表" : "Saved report comparison table"}</caption>
        <thead className="bg-slate-50 text-slate-500 text-xs"><tr><th className="p-3 w-10"><span className="sr-only">{zh ? "选择" : "Select"}</span></th>{(zh ? ["股票 / 板块", "AI 观点", "核心依据", "风险节选", "生成时间 / 期限", ""] : ["Stock / sector", "AI stance", "Core thesis", "Risk excerpt", "Generated / horizon", ""]).map((h, i) => <th key={i} className="py-3 px-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.slice(0, limit).map(j => { const s = summaryOf(j); const cats = stockCategories(j.ticker); return <tr key={j.id} className={checked.includes(j.id) ? "bg-blue-50/60" : "hover:bg-slate-50/70"}>
          <td className="p-3"><input type="checkbox" aria-label={`${zh ? "选择报告" : "Select report"} ${j.ticker} ${j.id.slice(0, 8)}`} checked={checked.includes(j.id)} onChange={() => toggle(j.id)} /></td>
          <td className="p-3 w-44"><button className="font-bold text-blue-700 hover:underline" onClick={() => onOpen(j.id)}>{j.ticker}</button><p className="text-xs text-slate-500 mt-1 max-w-40 truncate" title={companyName(j.ticker)}>{companyName(j.ticker)}</p><p className="text-[11px] text-slate-500 mt-1">{cats.slice(0, 2).map(c => zh ? c.zh : c.en).join(" · ") || (zh ? "未分类" : "Unclassified")} · {j.mode === "stock" ? (zh ? "股票" : "Stock") : (zh ? "期权" : "Options")}</p></td>
          <td className="p-3 w-28"><span className={`inline-block rounded-md border px-2 py-1 text-xs font-semibold ${stanceClass(s?.decision)}`}>{stanceLabel(s?.decision, zh)}</span><p className="text-xs text-slate-500 mt-2">{zh ? "信心 " : "Conviction "}{s?.conviction == null ? "—" : `${s.conviction}/10`}</p></td>
          <td className="p-3 max-w-72"><p className="line-clamp-3 leading-relaxed text-slate-700" title={s?.thesis}>{s?.thesis || (zh ? "未提供摘要" : "No thesis recorded")}</p></td>
          <td className="p-3 max-w-56"><p className="line-clamp-3 leading-relaxed text-slate-600" title={s?.main_risks?.[0]}>{s?.main_risks?.[0] || (zh ? "未单独列出" : "Not separately listed")}</p></td>
          <td className="p-3 w-40 text-xs text-slate-500 leading-relaxed"><p>{dateLabel(j.finished_at || j.created_at, zh)}</p><p className="mt-1 line-clamp-2">{s?.time_horizon || s?.expiration || (zh ? "期限未提供" : "No horizon recorded")}</p></td>
          <td className="p-3"><button className="text-blue-700 inline-flex gap-1 items-center whitespace-nowrap text-xs font-semibold" onClick={() => onOpen(j.id)}>{zh ? "详情" : "Open"}<ArrowUpRight size={14} /></button></td>
        </tr>; })}</tbody>
      </table></div>
      {!rows.length && <div className="py-14 text-center text-slate-500 text-sm">{!loaded ? (zh ? "正在读取报告…" : "Loading reports…") : error ? (zh ? "服务暂不可用，请稍后刷新。" : "Service unavailable. Please refresh.") : completed.length ? (zh ? "没有符合筛选条件的报告，试试重置筛选。" : "No matching reports. Try resetting filters.") : (zh ? "还没有完成的报告。完成研究后会自动出现在这里。" : "Completed reports will appear here automatically.")}</div>}
      {rows.length > limit && <div className="p-4 text-center"><button className={button} onClick={() => setLimit(n => n + 50)}>{zh ? `加载更多（已显示 ${limit} / ${rows.length}）` : `Load more (${limit} / ${rows.length})`}</button></div>}
    </div>
    <p className="text-xs text-slate-500">{zh ? "信心分是模型的主观判断，不是胜率。表中时间为报告生成时间；行情及财务数据的时点请在报告详情核对。分类来自已保存的板块快照。" : "Conviction is a subjective model score, not a win probability. Dates reflect report generation, not live quote freshness. Categories use the saved catalog snapshot."}</p>
  </div>;
}

function ComparisonCard({ job, zh, onOpen }: { job: ResearchJob; zh: boolean; onOpen: (id: string) => void }) {
  const s = summaryOf(job);
  const fields = [
    [zh ? "核心依据" : "Thesis", s?.thesis], [zh ? "主要风险" : "Risks", s?.main_risks?.join("\n\n")],
    [zh ? "催化因素" : "Catalysts", s?.key_catalysts?.join("\n\n")], [zh ? "研究期限" : "Horizon", s?.time_horizon || s?.expiration],
    [zh ? "原报告计划 / 结构" : "Original plan / structure", s?.structure || [s?.entry_zone, s?.target_price, s?.stop_loss].filter(Boolean).join("\n\n")],
  ];
  return <article className="bg-white border border-slate-200 rounded-xl p-4 text-sm"><button className="text-blue-700 font-bold text-lg" onClick={() => onOpen(job.id)}>{job.ticker} ↗</button><p className="text-xs text-slate-500 mt-1">{companyName(job.ticker)}</p><p className="text-xs text-slate-500 mt-2">{dateLabel(job.finished_at || job.created_at, zh)} · {job.mode}</p><div className="flex items-center gap-2 my-4"><span className={`border rounded-md px-2 py-1 text-xs ${stanceClass(s?.decision)}`}>{stanceLabel(s?.decision, zh)}</span><span className="text-xs text-slate-500">{zh ? "主观信心 " : "Conviction "}{s?.conviction == null ? "—" : `${s.conviction}/10`}</span></div>{fields.map(([label, value]) => <div className="border-t border-slate-100 pt-3 mt-3" key={label}><h3 className="text-xs font-semibold text-slate-500 mb-2">{label}</h3><p className="whitespace-pre-wrap leading-relaxed text-slate-700">{value || (zh ? "原报告未提供" : "Not in the report")}</p></div>)}</article>;
}
