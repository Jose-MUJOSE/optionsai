"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  FileDown,
  Loader2,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  History,
  Trash2,
  Eye,
  Users,
  Target as TargetIcon,
  ListChecks,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import {
  downloadTraderReport,
  type TraderMode,
  type ResearcherResult,
  type ManagerDecision,
  type ManagerStockDecision,
  type ManagerOptionsDecision,
  type ManagerSynthesis,
} from "@/lib/api";
import TraderPayoffChart from "./TraderPayoffChart";

// Canonical analyst order — mirrors backend RESEARCHER_SPECS (v3 lineup).
// Each analyst is a distinct domain expert; Bull/Bear were removed because
// they were argumentative roles, not real research roles.
const RESEARCHER_ORDER = [
  "quant",
  "technical",
  "fundamental",
  "credit",
  "macro",
  "industry",
  "volatility",
  "event",
  "flow",
  "risk",
] as const;

const STANCE_STYLES: Record<string, { bg: string; text: string; ring: string; icon: typeof TrendingUp }> = {
  bullish: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", icon: TrendingUp },
  bearish: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200", icon: TrendingDown },
  neutral: { bg: "bg-slate-50", text: "text-slate-600", ring: "ring-slate-200", icon: Minus },
};

// Institutional-grade titles. We expose seniority and discipline in the
// label so users understand each agent occupies a real sell-side role,
// not a generic "AI persona". The shorter name stays as the main heading;
// the desk label shows in the credential strip.
const RESEARCHER_META: Record<string, { name_en: string; name_zh: string; desk_en: string; desk_zh: string; icon: string }> = {
  quant:       { name_en: "Quantitative Analyst",       name_zh: "量化分析师",       desk_en: "Factor & Statistics",       desk_zh: "因子与统计",     icon: "🧪" },
  technical:   { name_en: "Technical Trader",            name_zh: "技术派交易员",     desk_en: "Tape Reading",              desk_zh: "盘面解读",       icon: "📊" },
  fundamental: { name_en: "Fundamental Analyst",         name_zh: "基本面分析师",     desk_en: "Equity Coverage",           desk_zh: "权益覆盖",       icon: "💼" },
  credit:      { name_en: "Credit & Balance-Sheet",      name_zh: "信用与资产负债",   desk_en: "Credit / IG Desk",          desk_zh: "信用席位",       icon: "🏦" },
  macro:       { name_en: "Macro Strategist",            name_zh: "宏观策略师",       desk_en: "Cross-Asset Macro",         desk_zh: "跨资产宏观",     icon: "🌐" },
  industry:    { name_en: "Sector Coverage Lead",        name_zh: "行业首席",         desk_en: "Sector Coverage",           desk_zh: "行业覆盖",       icon: "🏭" },
  volatility:  { name_en: "Volatility Strategist",       name_zh: "波动率策略师",     desk_en: "Options & Vol Desk",        desk_zh: "期权波动率台",   icon: "🎯" },
  event:       { name_en: "Event-Driven Analyst",        name_zh: "事件驱动分析师",   desk_en: "Catalyst Desk",             desk_zh: "催化剂席位",     icon: "📰" },
  flow:        { name_en: "Flow & Positioning",          name_zh: "资金流与持仓",     desk_en: "Prime Flow Desk",           desk_zh: "资金流席位",     icon: "💸" },
  risk:        { name_en: "Risk Manager",                name_zh: "风险管理师",       desk_en: "Risk Parity Desk",          desk_zh: "风险管理台",     icon: "🛡️" },
};

export default function TraderAgent() {
  const { marketData, locale } = useAppStore();
  // All trader state lives in the store so analysis continues even when this
  // component unmounts (e.g. user switches to Dashboard mid-run).
  const traderMode = useAppStore((s) => s.traderMode);
  const traderPhase = useAppStore((s) => s.traderPhase);
  const traderResearchers = useAppStore((s) => s.traderResearchers);
  const traderManager = useAppStore((s) => s.traderManager);
  const traderError = useAppStore((s) => s.traderError);
  const traderTicker = useAppStore((s) => s.traderTicker);
  const traderHistory = useAppStore((s) => s.traderHistory);
  const traderSelectedResearchers = useAppStore((s) => s.traderSelectedResearchers);
  const traderActiveCount = useAppStore((s) => s.traderActiveCount);
  const setTraderMode = useAppStore((s) => s.setTraderMode);
  const toggleTraderResearcher = useAppStore((s) => s.toggleTraderResearcher);
  const setTraderSelectedResearchers = useAppStore((s) => s.setTraderSelectedResearchers);
  const runTraderAnalysis = useAppStore((s) => s.runTraderAnalysis);
  const resetTraderAnalysis = useAppStore((s) => s.resetTraderAnalysis);
  const loadTraderHistoryEntry = useAppStore((s) => s.loadTraderHistory);
  const deleteTraderHistoryEntry = useAppStore((s) => s.deleteTraderHistory);
  const hydrateTraderHistory = useAppStore((s) => s.hydrateTraderHistory);

  const [downloading, setDownloading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSelector, setShowSelector] = useState(false);

  // One-time hydration of saved analyses from localStorage
  useEffect(() => {
    hydrateTraderHistory();
  }, [hydrateTraderHistory]);

  const ticker = marketData?.ticker ?? null;
  const isRunning = traderPhase === "gathering" || traderPhase === "research" || traderPhase === "manager";
  const liveTicker = traderTicker ?? ticker;

  const orderedResearchers = useMemo(() => {
    const map = new Map(traderResearchers.map((r) => [r.id, r]));
    return RESEARCHER_ORDER.map((id) => map.get(id)).filter(Boolean) as ResearcherResult[];
  }, [traderResearchers]);

  const handleRun = useCallback(() => {
    if (!ticker) return;
    void runTraderAnalysis(ticker);
  }, [ticker, runTraderAnalysis]);

  const handleDownload = useCallback(async () => {
    if (!liveTicker || !traderManager) return;
    setDownloading(true);
    try {
      const blob = await downloadTraderReport({
        ticker: liveTicker,
        mode: traderMode,
        locale,
        researchers: orderedResearchers,
        manager: traderManager,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OptionsAI_Trader_${liveTicker}_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [liveTicker, traderMode, locale, orderedResearchers, traderManager]);

  if (!ticker && !liveTicker) {
    return <TraderEmptyState history={traderHistory} onLoad={loadTraderHistoryEntry} onDelete={deleteTraderHistoryEntry} locale={locale} />;
  }

  return (
    <div className="space-y-6">
      {/* Header / Mode Selector */}
      <div className="card-elevated p-5 space-y-4 anim-fade-up">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 via-violet-700 to-indigo-700 flex items-center justify-center shadow-md">
                <Brain className="w-5 h-5 text-white" strokeWidth={2.2} />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white anim-data-pulse" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-[var(--text-0)] tracking-tight">{t("trader.title", locale)}</h2>
                  <span className="text-[9px] font-bold tracking-[0.18em] uppercase px-1.5 py-0.5 rounded bg-slate-900 text-amber-300">
                    {locale === "zh" ? "机构级" : "Institutional"}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-2)] uppercase tracking-[0.16em] font-semibold">
                  OptionsAI Research Desk · {t("trader.subtitle", locale)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {traderHistory.length > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="h-9 px-3.5 text-xs font-semibold rounded-full bg-white border border-[var(--line-mid)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:-translate-y-px transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                {locale === "zh" ? `历史 (${traderHistory.length})` : `History (${traderHistory.length})`}
              </button>
            )}
            {traderPhase === "done" && traderManager && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="h-9 px-3.5 text-xs font-semibold rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)] hover:-translate-y-px transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t("trader.downloading", locale)}
                  </>
                ) : (
                  <>
                    <FileDown className="w-3.5 h-3.5" />
                    {t("trader.downloadReport", locale)}
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Mode pills */}
        <div className="grid grid-cols-2 gap-3">
          <ModePill
            active={traderMode === "stock"}
            onClick={() => !isRunning && setTraderMode("stock")}
            disabled={isRunning}
            title={t("trader.modeStock", locale)}
            hint={t("trader.modeStockHint", locale)}
            icon={<TrendingUp className="w-4 h-4" />}
            colorFrom="from-emerald-400"
            colorTo="to-cyan-500"
          />
          <ModePill
            active={traderMode === "options"}
            onClick={() => !isRunning && setTraderMode("options")}
            disabled={isRunning}
            title={t("trader.modeOptions", locale)}
            hint={t("trader.modeOptionsHint", locale)}
            icon={<Sparkles className="w-4 h-4" />}
            colorFrom="from-violet-400"
            colorTo="to-fuchsia-500"
          />
        </div>

        {/* Researcher selector */}
        <ResearcherSelector
          isOpen={showSelector}
          onToggleOpen={() => setShowSelector((v) => !v)}
          selected={traderSelectedResearchers}
          onToggle={toggleTraderResearcher}
          onSetAll={(ids) => setTraderSelectedResearchers(ids)}
          disabled={isRunning}
          locale={locale}
        />

        <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
          <div className="text-xs text-[var(--text-2)] flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono font-bold text-[var(--accent)]">{liveTicker || ticker}</span>
            <span className="text-[var(--line-mid)]">•</span>
            <span className="truncate">
              {(() => {
                const n = traderSelectedResearchers.length === 0 ? 9 : traderSelectedResearchers.length;
                if (locale === "zh") return `${n} 位研究员将分析此股票，最后由投资经理给出决策`;
                return `${n} researcher${n === 1 ? "" : "s"} will analyze this ticker, then a Portfolio Manager decides`;
              })()}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(traderPhase === "done" || traderPhase === "error") && (
              <button
                onClick={resetTraderAnalysis}
                className="h-9 px-3 text-[11px] font-semibold rounded-full bg-white border border-[var(--line-mid)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all cursor-pointer"
                title={locale === "zh" ? "清空当前分析" : "Clear current analysis"}
              >
                {locale === "zh" ? "清空" : "Clear"}
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={isRunning || !ticker}
              className="h-10 px-5 text-xs font-bold rounded-full bg-gradient-to-r from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)] hover:-translate-y-px hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("trader.running", locale)}
                </>
              ) : (
                <>
                  <Brain className="w-3.5 h-3.5" />
                  {t("trader.runAnalysis", locale)}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* History panel — collapsible */}
      {showHistory && traderHistory.length > 0 && (
        <HistoryPanel
          entries={traderHistory}
          onLoad={(id) => {
            loadTraderHistoryEntry(id);
            setShowHistory(false);
          }}
          onDelete={deleteTraderHistoryEntry}
          locale={locale}
        />
      )}

      {/* Background note if running but viewing was paused */}
      {isRunning && (
        <div className="rounded-lg bg-violet-50 border border-violet-200 p-2.5 text-[11px] text-violet-800 flex items-center gap-2 anim-fade-up">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 anim-data-pulse" />
          {locale === "zh"
            ? "分析在后台运行，切换其他板块不会中断"
            : "Analysis is running in the background — navigating away won't stop it"}
        </div>
      )}

      {/* Error banner */}
      {traderPhase === "error" && traderError && (
        <div className="card p-4 border border-red-200 bg-red-50 flex items-start gap-3 anim-fade-up">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-red-800 mb-1">
              {locale === "zh" ? "分析失败" : "Analysis failed"}
            </div>
            <div className="text-xs text-red-700 leading-relaxed">{traderError}</div>
          </div>
        </div>
      )}

      {/* Live phase indicator */}
      {isRunning && (
        <PhaseIndicator
          phase={traderPhase}
          researchersDone={traderResearchers.length}
          totalCount={traderActiveCount}
          locale={locale}
        />
      )}

      {/* Final Manager Decision */}
      {traderManager && <ManagerCard manager={traderManager} mode={traderMode} locale={locale} />}

      {/* Researcher Grid */}
      {(orderedResearchers.length > 0 || isRunning) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-2)]">
              {t("trader.researchers", locale)}
            </h3>
            <div className="flex-1 h-px bg-gradient-to-r from-[var(--line-mid)] to-transparent" />
            <span className="text-[10px] text-[var(--text-2)] mono">
              {orderedResearchers.length}/{RESEARCHER_ORDER.length}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {RESEARCHER_ORDER.map((id) => {
              const r = orderedResearchers.find((x) => x.id === id);
              return r ? (
                <ResearcherCard key={id} researcher={r} locale={locale} />
              ) : isRunning ? (
                <ResearcherSkeleton key={id} id={id} locale={locale} />
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// History panel
// ============================================================

import type { TraderHistoryEntry } from "@/lib/store";

function HistoryPanel({
  entries,
  onLoad,
  onDelete,
  locale,
}: {
  entries: TraderHistoryEntry[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  locale: "zh" | "en";
}) {
  return (
    <div className="card-elevated p-4 anim-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-[var(--accent)]" />
        <h3 className="text-sm font-bold text-[var(--text-0)]">
          {locale === "zh" ? "已保存的分析" : "Saved Analyses"}
        </h3>
        <span className="text-[10px] text-[var(--text-2)] mono">({entries.length})</span>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => {
          const date = new Date(entry.timestamp);
          const dateStr = date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          const decision = String(entry.manager.decision || "").toUpperCase();
          const conv = entry.manager.conviction;
          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[var(--line-soft)] hover:border-[var(--accent)]/40 hover:shadow-sm transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-[var(--text-0)] text-sm">{entry.ticker}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent-hot)]">
                    {entry.mode === "stock"
                      ? (locale === "zh" ? "股票" : "Stock")
                      : (locale === "zh" ? "期权" : "Options")}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700">
                    {decision} · {conv}/10
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-2)] mt-1">{dateStr}</div>
              </div>
              <button
                onClick={() => onLoad(entry.id)}
                className="h-8 px-3 text-[11px] font-semibold rounded-full bg-[var(--accent-soft)] text-[var(--accent-hot)] hover:bg-[var(--accent)] hover:text-white transition-all flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Eye className="w-3 h-3" />
                {locale === "zh" ? "查看" : "View"}
              </button>
              <button
                onClick={() => onDelete(entry.id)}
                className="h-8 w-8 rounded-full text-[var(--text-2)] hover:text-red-500 hover:bg-red-50 transition-all flex items-center justify-center cursor-pointer shrink-0"
                title={locale === "zh" ? "删除" : "Delete"}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

/**
 * ResearcherSelector — collapsible card letting the user pick which of the
 * 9 researchers to run.
 *
 * Cost rationale (visible to user): each researcher = ~1 LLM call. Running
 * 5 instead of 9 saves ~44% of LLM cost. Bull + Bear is the minimum useful
 * combo (cheapest debate). Empty list = "all" — we prefer that over a
 * length-9 array so the URL/query stays clean.
 */
function ResearcherSelector(props: {
  isOpen: boolean;
  onToggleOpen: () => void;
  selected: string[];           // empty = all
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
  disabled: boolean;
  locale: "zh" | "en";
}) {
  const isZh = props.locale === "zh";
  const ALL_IDS = RESEARCHER_ORDER as readonly string[];
  const isAll = props.selected.length === 0;
  const activeCount = isAll ? ALL_IDS.length : props.selected.length;

  const isSelected = (id: string) => isAll || props.selected.includes(id);

  // Compact analyst metadata for the selector grid — short labels because
  // each pill must fit in a 3-col layout. Long titles live in RESEARCHER_META.
  const META: Record<string, { name_en: string; name_zh: string; icon: string; color: string }> = {
    quant:       { name_en: "Quant",          name_zh: "量化因子",   icon: "🧪", color: "violet" },
    technical:   { name_en: "Technicals",     name_zh: "技术分析",   icon: "📊", color: "blue" },
    fundamental: { name_en: "Fundamentals",   name_zh: "基本面",     icon: "💼", color: "purple" },
    credit:      { name_en: "Credit",         name_zh: "信用",       icon: "🏦", color: "indigo" },
    macro:       { name_en: "Macro",          name_zh: "宏观",       icon: "🌐", color: "cyan" },
    industry:    { name_en: "Sector",         name_zh: "行业",       icon: "🏭", color: "amber" },
    volatility:  { name_en: "Volatility",     name_zh: "波动率",     icon: "🎯", color: "teal" },
    event:       { name_en: "Event-Driven",   name_zh: "事件驱动",   icon: "📰", color: "rose" },
    flow:        { name_en: "Flow",           name_zh: "资金流",     icon: "💸", color: "emerald" },
    risk:        { name_en: "Risk",           name_zh: "风险管理",   icon: "🛡️", color: "slate" },
  };

  const presets: { label_en: string; label_zh: string; ids: string[] }[] = [
    { label_en: "All 10 (full team)",     label_zh: "全部 10 位",            ids: [] },
    { label_en: "Stock-focused (6)",      label_zh: "股票专项 (6)",          ids: ["quant", "technical", "fundamental", "credit", "macro", "event"] },
    { label_en: "Options-focused (5)",    label_zh: "期权专项 (5)",          ids: ["technical", "volatility", "event", "flow", "risk"] },
    { label_en: "Quick read (3)",         label_zh: "快速判断 (3)",          ids: ["technical", "fundamental", "macro"] },
  ];

  return (
    <div className={`rounded-2xl border ${props.isOpen ? "border-violet-300 bg-violet-50/40" : "border-[var(--line-soft)] bg-white"} transition-all`}>
      <button
        onClick={props.onToggleOpen}
        disabled={props.disabled}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-2)]">
            {isZh ? "选择研究员" : "Select Researchers"}
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
            {activeCount}/{ALL_IDS.length}
          </span>
          {!isAll && (
            <span className="text-[9.5px] text-violet-700 italic">
              {isZh ? "已自定义 · 节省 LLM 成本" : "custom · saves LLM cost"}
            </span>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-2)] transition-transform ${props.isOpen ? "rotate-180" : ""}`} />
      </button>

      {props.isOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-violet-200 space-y-3 anim-fade-up">
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const isActive = isAll
                ? p.ids.length === 0
                : p.ids.length === props.selected.length && p.ids.every((x) => props.selected.includes(x));
              return (
                <button
                  key={p.label_en}
                  onClick={() => !props.disabled && props.onSetAll(p.ids)}
                  disabled={props.disabled}
                  className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer disabled:cursor-not-allowed ${
                    isActive
                      ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm"
                      : "bg-white border border-[var(--line-mid)] text-[var(--text-1)] hover:border-violet-400 hover:text-violet-600"
                  }`}
                >
                  {isZh ? p.label_zh : p.label_en}
                </button>
              );
            })}
          </div>

          {/* Individual researcher checkboxes */}
          <div className="grid grid-cols-3 gap-1.5">
            {ALL_IDS.map((id) => {
              const m = META[id];
              const checked = isSelected(id);
              return (
                <button
                  key={id}
                  onClick={() => !props.disabled && props.onToggle(id)}
                  disabled={props.disabled}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] transition-all cursor-pointer disabled:cursor-not-allowed text-left ${
                    checked
                      ? "bg-white border-violet-300 shadow-sm"
                      : "bg-gray-50 border-gray-200 opacity-50 hover:opacity-80"
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    checked ? "bg-violet-500 border-violet-500" : "bg-white border-gray-300"
                  }`}>
                    {checked && <span className="text-white text-[8px] font-bold">✓</span>}
                  </span>
                  <span className="text-base shrink-0">{m.icon}</span>
                  <span className={`font-semibold truncate ${checked ? "text-[var(--text-0)]" : "text-[var(--text-2)]"}`}>
                    {isZh ? m.name_zh : m.name_en}
                  </span>
                </button>
              );
            })}
          </div>

          {!isAll && props.selected.length === 1 && (
            <div className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              {isZh ? "提示：仅选 1 位分析师将跳过辩论环节" : "Note: only 1 analyst — debate phase will be skipped"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModePill(props: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  hint: string;
  icon: React.ReactNode;
  colorFrom: string;
  colorTo: string;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={`group relative overflow-hidden rounded-2xl p-4 text-left transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
        props.active
          ? "ring-2 ring-[var(--accent)] bg-white shadow-[var(--shadow-blue)] -translate-y-px"
          : "bg-white border border-[var(--line-soft)] hover:border-[var(--accent)]/40 hover:-translate-y-px hover:shadow-md"
      }`}
    >
      {props.active && (
        <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${props.colorFrom} ${props.colorTo} opacity-20 blur-2xl`} />
      )}
      <div className="relative flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform ${
            props.active
              ? `bg-gradient-to-br ${props.colorFrom} ${props.colorTo} text-white shadow-md scale-105`
              : "bg-[var(--bg-2)] text-[var(--text-2)] group-hover:scale-105"
          }`}
        >
          {props.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${props.active ? "text-[var(--text-0)]" : "text-[var(--text-1)]"}`}>
            {props.title}
          </div>
          <div className="text-[11px] text-[var(--text-2)] mt-0.5 leading-snug">{props.hint}</div>
        </div>
        {props.active && <CheckCircle2 className="w-5 h-5 text-[var(--accent)] shrink-0 anim-fade-up" />}
      </div>
    </button>
  );
}

function PhaseIndicator(props: { phase: string; researchersDone: number; totalCount: number; locale: "zh" | "en" }) {
  const total = Math.max(1, props.totalCount);  // avoid div-by-zero
  const labels: Record<string, string> = {
    gathering: t("trader.gathering", props.locale),
    research: `${t("trader.researchPhase", props.locale)} (${props.researchersDone}/${total})`,
    debate: props.locale === "zh" ? "看多/看空交叉辩论中..." : "Bull/Bear cross-examining...",
    manager: t("trader.managerPhase", props.locale),
  };
  const pct =
    props.phase === "gathering" ? 5 :
    props.phase === "research" ? 5 + (props.researchersDone / total) * 70 :
    props.phase === "debate" ? 82 :
    props.phase === "manager" ? 92 : 0;

  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex items-center gap-3 mb-3">
        <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
        <span className="text-sm font-semibold text-[var(--text-0)]">{labels[props.phase] || ""}</span>
      </div>
      <div className="h-1.5 bg-[var(--bg-2)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)] transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ResearcherCard({ researcher, locale }: { researcher: ResearcherResult; locale: "zh" | "en" }) {
  const [expanded, setExpanded] = useState(false);
  // Defensively coerce — older saved analyses or transient LLM failures may
  // produce results without a stance string; never let this crash the card.
  const safeStance = (researcher.stance ?? "neutral") as "bullish" | "bearish" | "neutral";
  const stance = STANCE_STYLES[safeStance] ?? STANCE_STYLES.neutral;
  const StanceIcon = stance.icon;
  // Prefer the curated front-end title (e.g. "Senior Equity Analyst") so the
  // desk name is consistent regardless of what the LLM happened to echo back.
  const meta = RESEARCHER_META[researcher.id];
  const name = meta
    ? (locale === "zh" ? meta.name_zh : meta.name_en)
    : (locale === "zh" ? researcher.name_zh : researcher.name_en);
  const desk = meta ? (locale === "zh" ? meta.desk_zh : meta.desk_en) : null;
  const stanceLabel = t(
    `trader.stance${safeStance.charAt(0).toUpperCase() + safeStance.slice(1)}` as "trader.stanceBullish",
    locale,
  );

  return (
    <div className="card hover:shadow-md hover:-translate-y-px transition-all duration-200 anim-fade-up">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0 leading-none">{researcher.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <h4 className="text-sm font-bold text-[var(--text-0)] truncate">{name}</h4>
              <span
                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${stance.bg} ${stance.text} ring-1 ${stance.ring} flex items-center gap-1 shrink-0`}
              >
                <StanceIcon className="w-2.5 h-2.5" />
                {stanceLabel}
              </span>
            </div>
            {desk && (
              <div className="text-[9.5px] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold mb-1.5">
                {desk}
              </div>
            )}
            <p className="text-[12.5px] text-[var(--text-1)] leading-snug line-clamp-2">{researcher.headline}</p>
            <div className="flex items-center gap-2 mt-2">
              <ConvictionDots value={researcher.confidence} />
              <span className="text-[10px] text-[var(--text-2)] mono">{researcher.confidence}/10</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2 border-t border-[var(--line-soft)] text-[10px] uppercase tracking-widest font-semibold text-[var(--text-2)] hover:text-[var(--accent)] hover:bg-[var(--bg-2)] transition-colors flex items-center justify-center gap-1 cursor-pointer"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {t("trader.viewBriefing", locale)}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-[var(--line-soft)] bg-[var(--bg-1)]/40 space-y-3 anim-fade-up">
          {researcher.evidence && <Section label={t("trader.evidence", locale)} text={researcher.evidence} />}
          {researcher.key_points?.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-1.5">
                {t("trader.keyPoints", locale)}
              </div>
              <ul className="space-y-1">
                {researcher.key_points.map((p, i) => (
                  <li key={i} className="text-[12px] text-[var(--text-1)] leading-snug flex gap-2">
                    <span className="text-[var(--accent)] mt-0.5">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {researcher.risks && <Section label={t("trader.risks", locale)} text={researcher.risks} muted />}

          {/* Debate-phase rebuttal block — every researcher rebuts a peer */}
          {researcher.rebuttal && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                  {locale === "zh" ? "辩论回应" : "Debate Response"}
                </span>
                {researcher.rebuttal.opponent_id && (
                  <span className="text-[9.5px] font-medium text-violet-700/80">
                    {locale === "zh"
                      ? `→ 回应 ${researcher.rebuttal.opponent_id}`
                      : `→ rebutting ${researcher.rebuttal.opponent_id}`}
                  </span>
                )}
              </div>
              {researcher.rebuttal.rebuttal && (
                <div>
                  <div className="text-[9.5px] font-semibold uppercase tracking-wider text-violet-700 mb-0.5">
                    {locale === "zh" ? "反驳对方" : "Rebuttal"}
                  </div>
                  <div className="text-[12px] text-violet-900 leading-snug">{researcher.rebuttal.rebuttal}</div>
                </div>
              )}
              {researcher.rebuttal.reinforced_evidence && (
                <div>
                  <div className="text-[9.5px] font-semibold uppercase tracking-wider text-violet-700 mb-0.5">
                    {locale === "zh" ? "强化证据" : "Reinforced Evidence"}
                  </div>
                  <div className="text-[12px] text-violet-900 leading-snug">{researcher.rebuttal.reinforced_evidence}</div>
                </div>
              )}
              {researcher.rebuttal.concession && (
                <div>
                  <div className="text-[9.5px] font-semibold uppercase tracking-wider text-violet-700 mb-0.5">
                    {locale === "zh" ? "诚实让步" : "Concession"}
                  </div>
                  <div className="text-[12px] text-violet-900/80 italic leading-snug">{researcher.rebuttal.concession}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, text, muted = false }: { label: string; text: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-1">{label}</div>
      <div className={`text-[12px] leading-snug ${muted ? "text-[var(--text-2)] italic" : "text-[var(--text-1)]"}`}>
        {text}
      </div>
    </div>
  );
}

function ConvictionDots({ value }: { value: number }) {
  const v = Math.max(0, Math.min(10, value));
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={`w-1 h-3 rounded-sm transition-colors ${
            i < v ? "bg-gradient-to-t from-[var(--accent)] to-[var(--accent-violet)]" : "bg-[var(--bg-2)]"
          }`}
        />
      ))}
    </div>
  );
}

function ResearcherSkeleton({ id, locale }: { id: string; locale: "zh" | "en" }) {
  const m = RESEARCHER_META[id] || { name_en: id, name_zh: id, icon: "❓" };
  const name = locale === "zh" ? m.name_zh : m.name_en;
  return (
    <div className="card p-4 opacity-70">
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0 leading-none grayscale opacity-50">{m.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-bold text-[var(--text-2)] truncate">{name}</h4>
            <Loader2 className="w-3 h-3 text-[var(--accent)] animate-spin" />
          </div>
          <div className="space-y-1.5">
            <div className="h-2 bg-[var(--bg-2)] rounded-full w-3/4 shimmer" />
            <div className="h-2 bg-[var(--bg-2)] rounded-full w-1/2 shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ManagerCard({
  manager,
  mode,
  locale,
}: {
  manager: ManagerDecision;
  mode: TraderMode;
  locale: "zh" | "en";
}) {
  const isStock = mode === "stock";
  const stockMgr = manager as ManagerStockDecision;
  const optMgr = manager as ManagerOptionsDecision;

  const decision = String(manager.decision || "").toLowerCase();
  const decisionTheme =
    decision === "buy" || decision === "bullish"
      ? { from: "from-emerald-500", to: "to-teal-600", text: "text-white", label: t("trader.decisionBuy", locale) }
      : decision === "sell" || decision === "bearish"
      ? { from: "from-red-500", to: "to-rose-600", text: "text-white", label: t("trader.decisionSell", locale) }
      : decision === "hold" || decision === "neutral"
      ? { from: "from-slate-400", to: "to-slate-500", text: "text-white", label: t("trader.decisionHold", locale) }
      : { from: "from-violet-500", to: "to-indigo-600", text: "text-white", label: String(manager.decision).toUpperCase() };

  const synthesis: ManagerSynthesis = manager.synthesis || {};
  const hasSynthesis = Object.values(synthesis).some((v) => typeof v === "string" && v.trim().length > 0);

  return (
    <div className="card-elevated overflow-hidden anim-fade-up relative">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${decisionTheme.from} ${decisionTheme.to}`} />
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-[var(--accent-soft)] to-transparent blur-3xl pointer-events-none" />

      <div className="relative p-6 space-y-5">
        {/* Title row */}
        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <h3 className="text-base font-bold text-[var(--text-0)] tracking-tight">
                {t("trader.finalDecision", locale)}
              </h3>
            </div>
            <div className="text-[10.5px] text-[var(--text-2)] uppercase tracking-[0.18em] font-semibold">
              Portfolio Manager · {locale === "zh" ? "投资经理" : "PM"}
            </div>
          </div>
          <div className="flex-1" />
          <div
            className={`px-5 py-2 rounded-full bg-gradient-to-r ${decisionTheme.from} ${decisionTheme.to} ${decisionTheme.text} shadow-md flex items-center gap-2`}
          >
            <span className="text-sm font-black tracking-wider">{decisionTheme.label}</span>
            <span className="w-px h-4 bg-white/40" />
            <span className="text-xs font-bold opacity-90 mono">{manager.conviction}/10</span>
          </div>
        </div>

        {/* Consensus score (new) */}
        {manager.consensus_score && (
          <div className="rounded-lg bg-[var(--accent-soft)] border border-[rgba(45,76,221,0.18)] px-3 py-2 flex items-start gap-2">
            <Users className="w-4 h-4 text-[var(--accent)] mt-px shrink-0" />
            <div className="text-[12.5px] text-[var(--accent-hot)] leading-snug">
              <span className="font-semibold">{locale === "zh" ? "共识：" : "Consensus: "}</span>
              {manager.consensus_score}
            </div>
          </div>
        )}

        {/* Thesis */}
        {manager.thesis && (
          <div className="rounded-xl bg-gradient-to-br from-[var(--bg-1)] to-[var(--bg-2)]/50 border border-[var(--line-soft)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-2">
              {t("trader.thesis", locale)}
            </div>
            <p className="text-[13px] text-[var(--text-0)] leading-relaxed whitespace-pre-line">{manager.thesis}</p>
          </div>
        )}

        {/* Mode-specific stats grid */}
        {isStock ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {stockMgr.entry_zone && <Stat label={t("trader.entryZone", locale)} value={stockMgr.entry_zone} />}
            {stockMgr.target_price && <Stat label={t("trader.targetPrice", locale)} value={stockMgr.target_price} accent="up" />}
            {stockMgr.stop_loss && <Stat label={t("trader.stopLoss", locale)} value={stockMgr.stop_loss} accent="down" />}
            {stockMgr.time_horizon && <Stat label={t("trader.timeHorizon", locale)} value={stockMgr.time_horizon} />}
            {stockMgr.position_sizing && <Stat label={t("trader.positionSize", locale)} value={stockMgr.position_sizing} />}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {optMgr.direction && <Stat label={t("trader.direction", locale)} value={optMgr.direction} />}
            {optMgr.expiration && <Stat label={t("trader.expiration", locale)} value={optMgr.expiration} />}
            {optMgr.win_probability && <Stat label={t("trader.winProb", locale)} value={optMgr.win_probability} accent="up" />}
            {optMgr.max_loss && <Stat label={t("trader.maxLoss", locale)} value={optMgr.max_loss} accent="down" />}
            {optMgr.max_profit && <Stat label={t("trader.maxProfit", locale)} value={optMgr.max_profit} accent="up" />}
            {optMgr.breakeven && <Stat label={t("trader.breakeven", locale)} value={optMgr.breakeven} />}
          </div>
        )}

        {/* Options structure full-width */}
        {!isStock && optMgr.structure && (
          <div className="rounded-xl bg-violet-50 border border-violet-200 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700 mb-1">
              {t("trader.structure", locale)}
            </div>
            <div className="text-[13px] font-semibold text-violet-900 mono">{optMgr.structure}</div>
          </div>
        )}

        {/* Live payoff chart with What-If — only when PM provided structured legs */}
        {!isStock && optMgr.option_legs && optMgr.option_legs.length > 0 && optMgr.underlying_price && (
          <TraderPayoffChart
            legs={optMgr.option_legs}
            spotPrice={optMgr.underlying_price}
            locale={locale}
          />
        )}

        {/* Catalysts + Risks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {manager.key_catalysts && manager.key_catalysts.length > 0 && (
            <BulletGroup label={t("trader.catalysts", locale)} items={manager.key_catalysts} accent="emerald" />
          )}
          {manager.main_risks && manager.main_risks.length > 0 && (
            <BulletGroup label={t("trader.risks", locale)} items={manager.main_risks} accent="rose" />
          )}
        </div>

        {/* Actionable steps (NEW) */}
        {manager.actionable_steps && manager.actionable_steps.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="w-4 h-4 text-amber-700" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                {locale === "zh" ? "具体执行步骤" : "Actionable Steps"}
              </span>
            </div>
            <ol className="space-y-1.5">
              {manager.actionable_steps.map((step, i) => (
                <li key={i} className="text-[12.5px] text-amber-900 leading-snug flex gap-2">
                  <span className="font-bold text-amber-700 mono shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Per-researcher synthesis (NEW) */}
        {hasSynthesis && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TargetIcon className="w-4 h-4 text-[var(--accent-violet)]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-1)]">
                {locale === "zh" ? "如何综合 10 位分析师观点" : "How the 10 Analysts Were Weighed"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {RESEARCHER_ORDER.map((id) => {
                const text = synthesis[id as keyof ManagerSynthesis];
                if (!text) return null;
                const meta = RESEARCHER_META[id];
                const name = locale === "zh" ? meta.name_zh : meta.name_en;
                return (
                  <div
                    key={id}
                    className="rounded-lg bg-white border border-[var(--line-soft)] p-3 hover:border-[var(--accent)]/30 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-base leading-none">{meta.icon}</span>
                      <span className="text-[11px] font-bold text-[var(--text-0)]">{name}</span>
                    </div>
                    <div className="text-[12px] text-[var(--text-1)] leading-snug">{text}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Debate summary */}
        {manager.debate_summary && (
          <div className="text-[12.5px] text-[var(--text-1)] border-l-2 border-[var(--accent)] pl-3 leading-relaxed bg-[var(--bg-1)]/40 py-2 rounded-r-md">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-1">
              {t("trader.debateSummary", locale)}
            </div>
            {manager.debate_summary}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "up" | "down" }) {
  const accentClass =
    accent === "up" ? "text-emerald-600" : accent === "down" ? "text-red-600" : "text-[var(--text-0)]";
  return (
    <div className="rounded-xl bg-white border border-[var(--line-soft)] p-3 hover:border-[var(--accent)]/30 hover:shadow-sm transition-all">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-1">{label}</div>
      <div className={`text-sm font-bold ${accentClass} mono break-words`}>{value}</div>
    </div>
  );
}

function BulletGroup({ label, items, accent }: { label: string; items: string[]; accent: "emerald" | "rose" }) {
  const tone =
    accent === "emerald"
      ? { bg: "bg-emerald-50", border: "border-emerald-200", dot: "text-emerald-500", text: "text-emerald-900", labelColor: "text-emerald-700" }
      : { bg: "bg-rose-50", border: "border-rose-200", dot: "text-rose-500", text: "text-rose-900", labelColor: "text-rose-700" };
  return (
    <div className={`rounded-xl ${tone.bg} ${tone.border} border p-4`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider ${tone.labelColor} mb-2`}>{label}</div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className={`text-[12.5px] ${tone.text} leading-snug flex gap-2`}>
            <span className={`${tone.dot} mt-0.5`}>▸</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TraderEmptyState({
  history,
  onLoad,
  onDelete,
  locale,
}: {
  history: TraderHistoryEntry[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  locale: "zh" | "en";
}) {
  const hydrate = useAppStore((s) => s.hydrateTraderHistory);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Methodology bullets framed like an institutional desk note. Static text
  // by design — describes how the pipeline works, no LLM calls needed.
  const methodology: { title_en: string; title_zh: string; desc_en: string; desc_zh: string }[] = [
    {
      title_en: "10 domain-locked desks",
      title_zh: "10 个领域独占研究台",
      desc_en: "Quant, technicals, fundamentals, credit, macro, sector, volatility, event-driven, flow, risk — each desk sees ONLY its own data block, eliminating shared evidence and forcing genuinely independent reasoning.",
      desc_zh: "量化、技术、基本面、信用、宏观、行业、波动率、事件、资金流、风险——每个席位只能看到本席位的数据，杜绝共用证据，确保独立思考。",
    },
    {
      title_en: "Strict 1v1 stance debate",
      title_zh: "严格 1v1 立场辩论",
      desc_en: "Every analyst is paired with the highest-conviction peer of OPPOSING stance for a written cross-examination — concession, rebuttal, reinforced evidence. No genuine disagreement = no fabricated debate.",
      desc_zh: "每位分析师与立场相反、信念度最高的同行 1v1 配对，进行书面交叉质询——让步、反驳、强化证据。没有真分歧则跳过辩论。",
    },
    {
      title_en: "Portfolio Manager call",
      title_zh: "投资经理决策",
      desc_en: "Final BUY / HOLD / SELL with conviction score, entry zone, stop-loss, and time horizon — backed by the consolidated research package.",
      desc_zh: "最终给出 BUY / HOLD / SELL 决策、信念评分、入场区间、止损位、时间周期 — 全部基于研究包合并依据。",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center py-12 text-center anim-fade-up">
        <div className="relative w-24 h-24 mb-8">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-slate-800 via-violet-600 to-indigo-700 border border-violet-200 shadow-lg" />
          <div className="absolute inset-0 rounded-2xl overflow-hidden">
            <div className="shimmer absolute inset-0" />
          </div>
          <Brain className="absolute inset-0 m-auto w-10 h-10 text-white anim-float-slow" strokeWidth={1.8} />
        </div>
        <div className="flex items-center gap-2 mb-2 flex-wrap justify-center">
          <h2 className="text-xl font-bold text-[var(--text-0)] tracking-tight">
            {t("trader.emptyTitle", locale)}
          </h2>
          <span className="text-[9px] font-bold tracking-[0.18em] uppercase px-1.5 py-0.5 rounded bg-slate-900 text-amber-300">
            {locale === "zh" ? "机构级" : "Institutional"}
          </span>
        </div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-2)] font-semibold mb-2">
          OptionsAI Research Desk
        </p>
        <p className="text-sm text-[var(--text-1)] max-w-md leading-relaxed">{t("trader.emptyDesc", locale)}</p>
      </div>

      {/* Methodology card — institutional-style three-column brief. */}
      <div className="rounded-2xl border border-[var(--line-soft)] bg-gradient-to-br from-white to-slate-50/40 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-gradient-to-b from-violet-500 to-indigo-600 rounded-full" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-2)]">
            {locale === "zh" ? "研究方法" : "Research Methodology"}
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {methodology.map((m, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-mono font-bold text-[var(--accent)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h4 className="text-[13px] font-bold text-[var(--text-0)]">
                  {locale === "zh" ? m.title_zh : m.title_en}
                </h4>
              </div>
              <p className="text-[12px] text-[var(--text-1)] leading-relaxed">
                {locale === "zh" ? m.desc_zh : m.desc_en}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-[var(--line-soft)] text-[10.5px] text-[var(--text-2)] leading-relaxed flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-px shrink-0" />
          <span>
            {locale === "zh"
              ? "本研究台输出仅供研究参考，不构成投资建议。所有结论基于公开数据与 LLM 推理，可能包含错误。"
              : "Research desk output is for informational purposes only and does not constitute investment advice. All conclusions are derived from public data and LLM reasoning and may contain errors."}
          </span>
        </div>
      </div>

      {history.length > 0 && (
        <HistoryPanel entries={history} onLoad={onLoad} onDelete={onDelete} locale={locale} />
      )}
    </div>
  );
}
