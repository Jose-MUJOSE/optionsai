"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import data from "@/data/research-catalog.json";
import { addTickers, removeTickers, selectionCoverage, MAX_RESEARCH_BATCH } from "@/lib/researchSelection";

const stocks: Record<string, { name: string; industry: string; country: string }> = data.stocks;
const GROUPS = [
  ["all", "全部", "All"], ["region", "中概 / 地域", "Region"], ["tech", "科技", "Tech"],
  ["finance", "金融", "Finance"], ["health", "生物医药", "Health"], ["industry", "工业航天", "Industry"],
  ["energy", "能源资源", "Energy"], ["consumer", "消费", "Consumer"], ["property", "地产通信", "Property & telecom"],
];
const PRIORITY = ["china", "commercial_space", "semiconductors", "insurance", "banks", "biotech", "pharma"];
const categories = [...data.categories].sort((a, b) => {
  const rank = (id: string) => PRIORITY.includes(id) ? PRIORITY.indexOf(id) : 100;
  return rank(a.id) - rank(b.id);
});
const control = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-blue-400 disabled:opacity-40";

export default function ResearchUniversePicker({ selected, onChange, locale, disabled = false }: {
  selected: string[]; onChange: (tickers: string[]) => void; locale: "zh" | "en"; disabled?: boolean;
}) {
  const zh = locale === "zh";
  const [opened, setOpened] = useState(true);
  const [categoryId, setCategoryId] = useState("china");
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [selectedSearch, setSelectedSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const category = categories.find(c => c.id === categoryId) || categories[0];
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const count = category.symbols.filter(t => selectedSet.has(t)).length;
  const filteredCategories = categories.filter(c => (group === "all" || c.group === group) &&
    `${c.zh} ${c.en} ${c.description_zh} ${c.symbols.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const filteredStocks = category.symbols.filter(t => `${t} ${stocks[t]?.name}`.toLowerCase().includes(stockSearch.toLowerCase()) && (!onlySelected || selectedSet.has(t)));
  const filteredSelected = selected.filter(t => `${t} ${stocks[t]?.name || ""}`.toLowerCase().includes(selectedSearch.toLowerCase()));
  const toggle = (symbol: string) => onChange(selectedSet.has(symbol) ? removeTickers(selected, [symbol]) : addTickers(selected, [symbol]));

  return <div className="rounded-2xl border border-blue-100 bg-white overflow-hidden" data-testid="research-universe-picker">
    <button type="button" className="w-full flex items-center justify-between gap-3 px-4 py-4 bg-blue-50/60 text-left" aria-expanded={opened} onClick={() => setOpened(!opened)}>
      <span><span className="font-bold text-slate-900">{zh ? "按板块 / 概念选股" : "Choose sectors & themes"}</span>
        <span className="block text-xs text-slate-500 mt-1">{zh ? `${categories.length} 个分类 · 可整组加入、逐只删减、多板块合并` : `${categories.length} categories · add groups, remove stocks, combine themes`}</span></span>
      <span className="flex items-center gap-2 text-blue-700 text-sm shrink-0">{zh ? `已选 ${selected.length} 只` : `${selected.length} selected`}<ChevronDown size={17} className={opened ? "rotate-180" : ""} /></span>
    </button>
    {opened && <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-1.5" aria-label={zh ? "板块分组" : "Sector groups"}>{GROUPS.map(([id, cn, en]) =>
        <button key={id} type="button" onClick={() => setGroup(id)} aria-pressed={group === id} className={`px-3 py-1.5 rounded-full text-xs ${group === id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-blue-50"}`}>{zh ? cn : en}</button>)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] gap-4">
        <div className="space-y-2 min-w-0">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 text-slate-400" size={15} /><input aria-label={zh ? "搜索板块或代码" : "Search sectors or tickers"} placeholder={zh ? "搜索板块 / 代码" : "Find a sector / ticker"} className="w-full border rounded-lg py-2 pl-8 pr-2 text-sm" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="max-h-72 lg:h-80 lg:max-h-none overflow-auto space-y-1 pr-1" role="group" aria-label={zh ? "可选板块" : "Available sectors"}>
            {filteredCategories.map(c => {
              const coverage = selectionCoverage(c.symbols, selected);
              return <button type="button" key={c.id} onClick={() => { setCategoryId(c.id); setStockSearch(""); setOnlySelected(false); }} aria-pressed={category.id === c.id} className={`w-full flex items-center justify-between gap-2 text-left rounded-lg px-3 py-2.5 text-sm ${category.id === c.id ? "bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-200" : "text-slate-600 hover:bg-slate-50"}`}>
                <span className="min-w-0"><span className="font-medium">{zh ? c.zh : c.en}</span>{coverage !== "none" && <span className="block text-[10px] text-blue-600">{coverage === "all" ? (zh ? "已全部加入" : "All added") : (zh ? "已加入部分" : "Some added")}</span>}</span><span className="text-xs tabular-nums text-slate-400">{c.symbols.length}</span>
              </button>;
            })}
            {!filteredCategories.length && <p className="text-xs text-slate-500 p-3">{zh ? "没有匹配分类，试试其他关键词。" : "No categories match."}</p>}
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 p-3 space-y-3">
          <div className="flex justify-between gap-3 items-start"><div><h3 className="font-bold">{zh ? category.zh : category.en}<span className="ml-2 text-xs font-normal text-slate-500">{category.symbols.length} {zh ? "只" : "stocks"}</span></h3>
            <p className="text-xs text-slate-500 mt-1">{zh ? category.description_zh : category.description_en}</p></div>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{category.kind === "theme" ? (zh ? "概念精选" : "Curated theme") : (zh ? "数据源分类" : "Source classification")}</span></div>
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" disabled={disabled || count === category.symbols.length} className="rounded-lg bg-blue-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-40" onClick={() => onChange(addTickers(selected, category.symbols))}>{zh ? `加入本板块全部 ${category.symbols.length} 只` : `Add all ${category.symbols.length} stocks`}</button>
            <button type="button" disabled={disabled || !count} className={control} onClick={() => onChange(removeTickers(selected, category.symbols))}>{zh ? "移除本板块" : "Remove this sector"}</button>
            <span className="text-xs text-slate-500">{zh ? `已选 ${count}/${category.symbols.length}` : `${count}/${category.symbols.length} selected`}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2"><input aria-label={zh ? "搜索板块内股票" : "Search stocks in sector"} placeholder={zh ? "代码或公司名称" : "Ticker or company"} className="border rounded-lg p-2 text-xs flex-1 min-w-28" value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
            <label className="text-xs text-slate-500"><input type="checkbox" checked={onlySelected} onChange={e => setOnlySelected(e.target.checked)} className="mr-1" />{zh ? "只看已选" : "Selected only"}</label></div>
          <div className="max-h-60 overflow-auto grid grid-cols-1 xl:grid-cols-2 gap-1 pr-1" role="group" aria-label={zh ? `${category.zh}股票列表` : `${category.en} stocks`}>
            {filteredStocks.map(t => <label key={t} className={`flex gap-2.5 items-start rounded-lg px-2 py-2 cursor-pointer min-w-0 ${selectedSet.has(t) ? "bg-blue-50/70" : "hover:bg-slate-50"}`}>
              <input type="checkbox" aria-label={`${zh ? "分析" : "Analyze"} ${t}`} disabled={disabled} checked={selectedSet.has(t)} onChange={() => toggle(t)} className="mt-1 accent-blue-600" />
              <span className="min-w-0"><span className="block text-xs font-bold text-slate-700">{t}</span><span title={stocks[t]?.name} className="block truncate text-[11px] text-slate-500">{stocks[t]?.name}</span></span>
            </label>)}
            {!filteredStocks.length && <p className="text-xs text-slate-500 p-3">{zh ? "没有匹配股票。" : "No matching stocks."}</p>}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold flex items-center gap-2"><Check size={15} className="text-blue-600" />{zh ? `待分析清单 · ${selected.length} 只` : `Research selection · ${selected.length} stocks`}</h4>
          <div className="flex items-center gap-2"><input aria-label={zh ? "搜索已选股票" : "Search selected stocks"} placeholder={zh ? "查找已选" : "Find selected"} value={selectedSearch} onChange={e => setSelectedSearch(e.target.value)} className="rounded-lg border p-1.5 text-xs w-28" /><button type="button" className="text-xs text-slate-500 hover:text-red-600" disabled={disabled || !selected.length} onClick={() => onChange([])}>{zh ? "清空清单" : "Clear selection"}</button></div></div>
        {selected.length ? <div className="flex flex-wrap gap-1.5 max-h-36 overflow-auto">{filteredSelected.map(t => <span key={t} title={stocks[t]?.name || t} className="inline-flex items-center gap-1 rounded-md bg-white border border-blue-100 pl-2 py-1 text-xs text-blue-800">{t}<button type="button" disabled={disabled} aria-label={`${zh ? "移除" : "Remove"} ${t}`} className="p-1 rounded hover:bg-red-50 hover:text-red-600" onClick={() => onChange(removeTickers(selected, [t]))}><X size={12} /></button></span>)}</div>
          : <p className="text-xs text-slate-500 py-1">{zh ? "选择左侧板块，再整组加入或勾选股票。也可以在下方手动补充代码。" : "Choose a sector, add the group or select individual stocks. You can also enter tickers below."}</p>}
        <p className={`text-xs ${selected.length > MAX_RESEARCH_BATCH ? "text-red-600" : "text-slate-500"}`} role={selected.length > MAX_RESEARCH_BATCH ? "alert" : undefined}>{selected.length > MAX_RESEARCH_BATCH ? (zh ? `已超过每批 ${MAX_RESEARCH_BATCH} 只，请删减后提交；没有自动截断股票。` : `Over ${MAX_RESEARCH_BATCH} stocks. Reduce the selection; no stocks are silently dropped.`) : (zh ? "同一股票只分析一次；点 × 即可移除，切换板块不会把它自动加回来。" : "Duplicates are merged. Remove a ticker with ×; switching sectors will not re-add it.")}</p>
      </div>
      <details className="text-[11px] text-slate-500"><summary className="cursor-pointer">{zh ? `收录范围与来源 · ${data.retrieved_at.slice(0, 10)} 快照` : `Coverage & sources · ${data.retrieved_at.slice(0, 10)}`}</summary>
        <p className="mt-2 leading-relaxed">{zh ? `覆盖 ${Object.keys(stocks).length.toLocaleString()} 只不重复股票。行业分类收录该快照中符合行业字段、通过上市目录核对的普通股及 ADR；概念精选由人工归类，包含产业链公司，不是全市场完整概念名单。分类可能重叠，名单不会实时更新。` : "Industry baskets include matching equities and ADRs in the snapshot, checked against listing directories. Curated themes include suppliers and are not exhaustive. Categories overlap; the snapshot is not live."}</p>
        <div className="flex flex-wrap gap-3 mt-1"><a href="https://www.nasdaq.com/market-activity/stocks/screener" target="_blank" rel="noreferrer" className="underline">Nasdaq Stock Screener</a><a href="https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs" target="_blank" rel="noreferrer" className="underline">Nasdaq Symbol Directory</a></div>
      </details>
    </div>}
  </div>;
}
