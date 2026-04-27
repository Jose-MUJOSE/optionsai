"use client";

import { useCallback, useMemo, useState } from "react";
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
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import {
  streamTraderAgent,
  downloadTraderReport,
  InvalidTickerError,
  type TraderMode,
  type ResearcherResult,
  type ManagerDecision,
  type ManagerStockDecision,
  type ManagerOptionsDecision,
} from "@/lib/api";

// Canonical researcher order — mirrors backend RESEARCHER_SPECS order so the
// grid renders predictably (bull/bear first, then specialists).
const RESEARCHER_ORDER = [
  "bull",
  "bear",
  "technical",
  "fundamental",
  "market",
  "industry",
  "financial",
  "news",
] as const;

const STANCE_STYLES: Record<string, { bg: string; text: string; ring: string; icon: typeof TrendingUp }> = {
  bullish: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    icon: TrendingUp,
  },
  bearish: {
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-200",
    icon: TrendingDown,
  },
  neutral: {
    bg: "bg-slate-50",
    text: "text-slate-600",
    ring: "ring-slate-200",
    icon: Minus,
  },
};

type Phase = "idle" | "gathering" | "research" | "manager" | "done" | "error";

export default function TraderAgent() {
  const { marketData, locale } = useAppStore();
  const [mode, setMode] = useState<TraderMode>("stock");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [researchers, setResearchers] = useState<ResearcherResult[]>([]);
  const [manager, setManager] = useState<ManagerDecision | null>(null);
  const [downloading, setDownloading] = useState(false);

  const ticker = marketData?.ticker ?? null;
  const isRunning = phase === "gathering" || phase === "research" || phase === "manager";

  const orderedResearchers = useMemo(() => {
    const map = new Map(researchers.map((r) => [r.id, r]));
    return RESEARCHER_ORDER.map((id) => map.get(id)).filter(Boolean) as ResearcherResult[];
  }, [researchers]);

  const handleRun = useCallback(async () => {
    if (!ticker) return;
    setPhase("gathering");
    setErrorMsg(null);
    setResearchers([]);
    setManager(null);

    try {
      for await (const event of streamTraderAgent({ ticker, mode, locale })) {
        if (event.type === "phase") {
          if (event.phase === "research_start") setPhase("research");
          else if (event.phase === "manager_start") setPhase("manager");
          else if (event.phase === "gathering_data") setPhase("gathering");
        } else if (event.type === "researcher") {
          setResearchers((prev) => {
            // dedupe by id in case of replays
            const others = prev.filter((p) => p.id !== event.result.id);
            return [...others, event.result];
          });
        } else if (event.type === "manager") {
          setManager(event.result);
        } else if (event.type === "done") {
          setResearchers(event.researchers);
          setManager(event.manager);
          setPhase("done");
        } else if (event.type === "error") {
          setErrorMsg(event.message);
          setPhase("error");
        }
      }
      setPhase((p) => (p === "manager" ? "done" : p));
    } catch (e) {
      if (e instanceof InvalidTickerError) {
        setErrorMsg(locale === "zh" ? e.messageZh : e.messageEn);
      } else {
        setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      }
      setPhase("error");
    }
  }, [ticker, mode, locale]);

  const handleDownload = useCallback(async () => {
    if (!ticker || !manager) return;
    setDownloading(true);
    try {
      const blob = await downloadTraderReport({
        ticker,
        mode,
        locale,
        researchers: orderedResearchers,
        manager,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `OptionsAI_Trader_${ticker}_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [ticker, mode, locale, orderedResearchers, manager]);

  if (!ticker) {
    return <TraderEmptyState />;
  }

  return (
    <div className="space-y-6">
      {/* Header / Mode Selector */}
      <div className="card-elevated p-5 space-y-4 anim-fade-up">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-md">
                <Brain className="w-4 h-4 text-white" strokeWidth={2.2} />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white anim-data-pulse" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-0)] tracking-tight">{t("trader.title", locale)}</h2>
                <p className="text-[11px] text-[var(--text-2)] uppercase tracking-[0.16em] font-semibold">
                  {t("trader.subtitle", locale)}
                </p>
              </div>
            </div>
          </div>
          {phase === "done" && manager && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="h-10 px-4 text-xs font-semibold rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)] hover:-translate-y-px transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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

        {/* Mode pills */}
        <div className="grid grid-cols-2 gap-3">
          <ModePill
            active={mode === "stock"}
            onClick={() => !isRunning && setMode("stock")}
            disabled={isRunning}
            title={t("trader.modeStock", locale)}
            hint={t("trader.modeStockHint", locale)}
            icon={<TrendingUp className="w-4 h-4" />}
            colorFrom="from-emerald-400"
            colorTo="to-cyan-500"
          />
          <ModePill
            active={mode === "options"}
            onClick={() => !isRunning && setMode("options")}
            disabled={isRunning}
            title={t("trader.modeOptions", locale)}
            hint={t("trader.modeOptionsHint", locale)}
            icon={<Sparkles className="w-4 h-4" />}
            colorFrom="from-violet-400"
            colorTo="to-fuchsia-500"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-xs text-[var(--text-2)] flex items-center gap-2 min-w-0">
            <span className="font-mono font-bold text-[var(--accent)]">{ticker}</span>
            <span className="text-[var(--line-mid)]">•</span>
            <span className="truncate">
              {locale === "zh"
                ? "8 位研究员将分析此股票，最后由投资经理给出决策"
                : "8 researchers will analyze this ticker, then a Portfolio Manager decides"}
            </span>
          </div>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="h-10 px-5 text-xs font-bold rounded-full bg-gradient-to-r from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)] hover:-translate-y-px hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
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

      {/* Error banner */}
      {phase === "error" && errorMsg && (
        <div className="card p-4 border border-red-200 bg-red-50 flex items-start gap-3 anim-fade-up">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-red-800 mb-1">
              {locale === "zh" ? "分析失败" : "Analysis failed"}
            </div>
            <div className="text-xs text-red-700 leading-relaxed">{errorMsg}</div>
          </div>
        </div>
      )}

      {/* Live phase indicator */}
      {isRunning && (
        <PhaseIndicator phase={phase} researchersDone={researchers.length} locale={locale} />
      )}

      {/* Final Manager Decision — top-priority, sticky-feel */}
      {manager && <ManagerCard manager={manager} mode={mode} locale={locale} />}

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
              ) : (
                <ResearcherSkeleton key={id} id={id} locale={locale} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

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
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform ${
          props.active
            ? `bg-gradient-to-br ${props.colorFrom} ${props.colorTo} text-white shadow-md scale-105`
            : "bg-[var(--bg-2)] text-[var(--text-2)] group-hover:scale-105"
        }`}>
          {props.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${props.active ? "text-[var(--text-0)]" : "text-[var(--text-1)]"}`}>
            {props.title}
          </div>
          <div className="text-[11px] text-[var(--text-2)] mt-0.5 leading-snug">{props.hint}</div>
        </div>
        {props.active && (
          <CheckCircle2 className="w-5 h-5 text-[var(--accent)] shrink-0 anim-fade-up" />
        )}
      </div>
    </button>
  );
}

function PhaseIndicator(props: { phase: Phase; researchersDone: number; locale: "zh" | "en" }) {
  const labels: Record<Phase, string> = {
    idle: "",
    gathering: t("trader.gathering", props.locale),
    research: `${t("trader.researchPhase", props.locale)} (${props.researchersDone}/8)`,
    manager: t("trader.managerPhase", props.locale),
    done: t("trader.complete", props.locale),
    error: "",
  };
  const pct =
    props.phase === "gathering" ? 5 :
    props.phase === "research" ? 5 + (props.researchersDone / 8) * 75 :
    props.phase === "manager" ? 90 :
    props.phase === "done" ? 100 : 0;

  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex items-center gap-3 mb-3">
        <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
        <span className="text-sm font-semibold text-[var(--text-0)]">{labels[props.phase]}</span>
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
  const stance = STANCE_STYLES[researcher.stance] ?? STANCE_STYLES.neutral;
  const StanceIcon = stance.icon;
  const name = locale === "zh" ? researcher.name_zh : researcher.name_en;
  const stanceLabel = t(`trader.stance${researcher.stance.charAt(0).toUpperCase() + researcher.stance.slice(1)}` as "trader.stanceBullish", locale);

  return (
    <div className={`card hover:shadow-md hover:-translate-y-px transition-all duration-200 anim-fade-up`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0 leading-none">{researcher.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-bold text-[var(--text-0)] truncate">{name}</h4>
              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${stance.bg} ${stance.text} ring-1 ${stance.ring} flex items-center gap-1 shrink-0`}>
                <StanceIcon className="w-2.5 h-2.5" />
                {stanceLabel}
              </span>
            </div>
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
          {researcher.evidence && (
            <Section label={t("trader.evidence", locale)} text={researcher.evidence} />
          )}
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
          {researcher.risks && (
            <Section label={t("trader.risks", locale)} text={researcher.risks} muted />
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
  // Display the role that's "thinking" so users know who's coming next.
  const META: Record<string, { name_en: string; name_zh: string; icon: string }> = {
    bull:        { name_en: "Bull Researcher",       name_zh: "看多研究员",   icon: "📈" },
    bear:        { name_en: "Bear Researcher",       name_zh: "看空研究员",   icon: "📉" },
    technical:   { name_en: "Technical Researcher",  name_zh: "技术面研究员", icon: "📊" },
    fundamental: { name_en: "Fundamental Researcher",name_zh: "基本面研究员", icon: "💼" },
    market:      { name_en: "Market Researcher",     name_zh: "市场研究员",   icon: "🌐" },
    industry:    { name_en: "Industry Researcher",   name_zh: "行业研究员",   icon: "🏭" },
    financial:   { name_en: "Financial Researcher",  name_zh: "财务研究员",   icon: "🧮" },
    news:        { name_en: "News & Events",         name_zh: "新闻事件",     icon: "📰" },
  };
  const m = META[id] || { name_en: id, name_zh: id, icon: "❓" };
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

  // Big-picture decision badge
  const decision = String(manager.decision || "").toLowerCase();
  const decisionTheme =
    decision === "buy" || decision === "bullish" ? { from: "from-emerald-500", to: "to-teal-600", text: "text-white", label: t("trader.decisionBuy", locale) } :
    decision === "sell" || decision === "bearish" ? { from: "from-red-500", to: "to-rose-600", text: "text-white", label: t("trader.decisionSell", locale) } :
    decision === "hold" || decision === "neutral" ? { from: "from-slate-400", to: "to-slate-500", text: "text-white", label: t("trader.decisionHold", locale) } :
    { from: "from-violet-500", to: "to-indigo-600", text: "text-white", label: String(manager.decision).toUpperCase() };

  return (
    <div className="card-elevated overflow-hidden anim-fade-up relative">
      {/* Decorative gradient banner */}
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
              <h3 className="text-base font-bold text-[var(--text-0)] tracking-tight">{t("trader.finalDecision", locale)}</h3>
            </div>
            <div className="text-[10.5px] text-[var(--text-2)] uppercase tracking-[0.18em] font-semibold">
              Portfolio Manager · {locale === "zh" ? "投资经理" : "PM"}
            </div>
          </div>
          <div className="flex-1" />
          <div className={`px-5 py-2 rounded-full bg-gradient-to-r ${decisionTheme.from} ${decisionTheme.to} ${decisionTheme.text} shadow-md flex items-center gap-2`}>
            <span className="text-sm font-black tracking-wider">{decisionTheme.label}</span>
            <span className="w-px h-4 bg-white/40" />
            <span className="text-xs font-bold opacity-90 mono">{manager.conviction}/10</span>
          </div>
        </div>

        {/* Thesis */}
        {manager.thesis && (
          <div className="rounded-xl bg-gradient-to-br from-[var(--bg-1)] to-[var(--bg-2)]/50 border border-[var(--line-soft)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-2">
              {t("trader.thesis", locale)}
            </div>
            <p className="text-[13px] text-[var(--text-0)] leading-relaxed">{manager.thesis}</p>
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

        {/* Catalysts + Risks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {manager.key_catalysts && manager.key_catalysts.length > 0 && (
            <BulletGroup
              label={t("trader.catalysts", locale)}
              items={manager.key_catalysts}
              accent="emerald"
            />
          )}
          {manager.main_risks && manager.main_risks.length > 0 && (
            <BulletGroup
              label={t("trader.risks", locale)}
              items={manager.main_risks}
              accent="rose"
            />
          )}
        </div>

        {manager.debate_summary && (
          <div className="text-[12px] text-[var(--text-2)] italic border-l-2 border-[var(--accent)] pl-3 leading-relaxed">
            <span className="font-semibold not-italic text-[var(--text-1)]">{t("trader.debateSummary", locale)}:</span>{" "}
            {manager.debate_summary}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "up" | "down" }) {
  const accentClass =
    accent === "up" ? "text-emerald-600" :
    accent === "down" ? "text-red-600" :
    "text-[var(--text-0)]";
  return (
    <div className="rounded-xl bg-white border border-[var(--line-soft)] p-3 hover:border-[var(--accent)]/30 hover:shadow-sm transition-all">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-2)] mb-1">{label}</div>
      <div className={`text-sm font-bold ${accentClass} mono`}>{value}</div>
    </div>
  );
}

function BulletGroup({ label, items, accent }: { label: string; items: string[]; accent: "emerald" | "rose" }) {
  const tone = accent === "emerald"
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

function TraderEmptyState() {
  const { locale } = useAppStore();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center anim-fade-up">
      <div className="relative w-24 h-24 mb-8">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-200 border border-violet-200 shadow-lg" />
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <div className="shimmer absolute inset-0" />
        </div>
        <Brain className="absolute inset-0 m-auto w-10 h-10 text-violet-600 anim-float-slow" strokeWidth={1.8} />
      </div>
      <h2 className="text-xl font-bold text-[var(--text-0)] tracking-tight mb-2">
        {t("trader.emptyTitle", locale)}
      </h2>
      <p className="text-sm text-[var(--text-1)] max-w-md leading-relaxed mb-6">
        {t("trader.emptyDesc", locale)}
      </p>
    </div>
  );
}
