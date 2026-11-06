"use client";

import { LayoutDashboard, Star, Newspaper, Target, Settings, FolderOpen, Radar, Bell, Brain, Sigma, Activity, BookOpen, ListChecks, Plus, ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useLocalPreference } from "@/lib/useLocalPreference";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

export type AppView =
  | "workbench"
  | "tasks"
  | "reports"
  | "report"
  | "dashboard"
  | "options"
  | "watchlist"
  | "news"
  | "strategies"
  | "trader"
  | "paper"
  | "scanner"
  | "patterns"
  | "alerts"
  | "settings";

interface SidebarProps {
  view: AppView;
  onViewChange: (view: AppView) => void;
  onOpenSettings: () => void;
  /** Click on the OptionsAI logo to return to the research desk. */
  onGoHome: () => void;
  /** Current pixel width; parent controls resize state. */
  width: number;
}

export default function Sidebar({ view, onViewChange, onOpenSettings, onGoHome, width }: SidebarProps) {
  const { locale, setLocale } = useAppStore();

  const compact = width < 190; // collapse labels below this width
  const [optionsOpen, setOptionsOpen] = useLocalPreference("optionsai.optionsNav.v1", false);
  useEffect(() => { if (["options", "strategies", "scanner", "paper"].includes(view)) setOptionsOpen(true); }, [view, setOptionsOpen]);

  // Daily stock workflow first; specialized options tools remain grouped below.
  const zh = locale === "zh";
  const groups: Array<{ id: string; label: string; items: Array<{ id: AppView; icon: typeof LayoutDashboard; label: string; badge?: string }> }> = [
    { id: "research", label: zh ? "股票研究" : "STOCK RESEARCH", items: [
      { id: "workbench", icon: LayoutDashboard, label: zh ? "研究工作台" : "Research desk" },
      { id: "trader", icon: Plus, label: zh ? "新建研究" : "New research" },
      { id: "tasks", icon: ListChecks, label: zh ? "任务中心" : "Task center" },
      { id: "reports", icon: BookOpen, label: zh ? "报告库与对比" : "Reports & compare" },
      { id: "dashboard", icon: Brain, label: zh ? "个股行情与研究" : "Stock overview" },
      { id: "watchlist", icon: Star, label: zh ? "自选股票" : "Watchlist" },
    ] },
    { id: "discovery", label: zh ? "发现与跟踪" : "DISCOVER & TRACK", items: [
      { id: "news", icon: Newspaper, label: zh ? "市场资讯" : "Market news" },
      { id: "patterns", icon: Activity, label: zh ? "形态选股" : "Patterns" },
      { id: "alerts", icon: Bell, label: zh ? "事件提醒" : "Event alerts" },
    ] },
    { id: "options", label: zh ? "期权工具箱" : "OPTIONS TOOLKIT", items: [
      { id: "options", icon: Sigma, label: zh ? "期权研究" : "Options research" },
      { id: "strategies", icon: Target, label: zh ? "期权策略" : "Strategies" },
      { id: "scanner", icon: Radar, label: zh ? "期权策略扫描器" : "Options scanner" },
      { id: "paper", icon: FolderOpen, label: zh ? "模拟仓位" : "Paper portfolio" },
    ] },
  ];

  return (
    <aside
      style={{ width }}
      className="h-screen flex-shrink-0 flex flex-col bg-white/85 backdrop-blur-xl border-r border-[var(--line-soft)] relative z-10 transition-[width] duration-150"
    >
      {/* Subtle blue vertical sheen — decorative, alive */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-transparent via-[var(--accent)] to-transparent opacity-30 pointer-events-none"
      />

      {/* Brand — clickable returns to home */}
      <button
        onClick={onGoHome}
        title={t("home.backToHome", locale)}
        aria-label={t("home.backToHome", locale)}
        className="w-full px-5 py-6 border-b border-[var(--line-soft)] cursor-pointer hover:bg-[var(--bg-2)]/40 transition-colors group/brand"
      >
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)] shadow-[var(--shadow-blue)] flex items-center justify-center overflow-hidden group-hover/brand:scale-105 group-hover/brand:rotate-[8deg] transition-transform duration-300">
            <span className="text-white font-bold text-sm tracking-tight relative z-10">O</span>
            {/* rotating light sweep inside logo */}
            <div aria-hidden className="absolute inset-0 opacity-40">
              <div className="absolute inset-[-40%] rounded-full bg-gradient-conic from-white/0 via-white/60 to-white/0 anim-drift" />
            </div>
          </div>
          {!compact && (
            <div className="leading-tight min-w-0 text-left">
              <div className="text-[15px] font-semibold tracking-tight whitespace-nowrap">
                <span className="text-gradient-blue">Options</span>
                <span className="text-[var(--text-0)]">AI</span>
              </div>
              <div className="text-[9.5px] text-[var(--text-2)] uppercase tracking-[0.18em] mt-0.5 font-semibold truncate">
                {zh ? "股票与期权研究工作台" : "Stocks & options research"}
              </div>
            </div>
          )}
        </div>
      </button>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto" aria-label={zh ? "主导航" : "Main navigation"}>
        {groups.map(group => <div key={group.id}>
          {group.id === "options" ? <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(v => !v)} className="w-full px-3 pb-2 flex items-center justify-between text-[10px] font-semibold tracking-wider text-slate-500" title={group.label}>{compact ? <Sigma size={16} /> : group.label}<ChevronDown size={13} className={optionsOpen ? "rotate-180" : ""} /></button> : !compact && <p className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-400">{group.label}</p>}
        {(group.id !== "options" || optionsOpen) && group.items.map(({ id, icon: Icon, label, badge }) => {
          const active = view === id || (id === "reports" && view === "report");
          return (
            <button
              key={id}
              onClick={() => onViewChange(id)}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              title={compact ? label : undefined}
              className={`w-full group flex items-center ${compact ? "justify-center" : "gap-3"} px-3 py-2.5 rounded-lg text-sm transition-all duration-150 cursor-pointer relative ${
                active
                  ? "bg-[var(--accent-soft)] text-[var(--accent-hot)] font-semibold"
                  : "text-[var(--text-1)] hover:text-[var(--accent-hot)] hover:bg-[var(--bg-2)]"
              }`}
            >
              {active && (
                <>
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-[var(--accent)]" />
                  <span className="absolute left-[6px] top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[var(--accent)] anim-data-pulse" />
                </>
              )}
              <Icon
                className={`w-[18px] h-[18px] shrink-0 transition-all ${
                  active
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-2)] group-hover:text-[var(--accent)] group-hover:scale-110"
                }`}
                strokeWidth={active ? 2.4 : 1.85}
              />
              {!compact && (
                <>
                  <span className="truncate flex-1 text-left">{label}</span>
                  {badge && (
                    <span className="text-[8.5px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-sm">
                      {badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}</div>)}
      </nav>

      {/* Footer controls */}
      <div className="px-3 py-4 border-t border-[var(--line-soft)] space-y-1">
        <button
          onClick={() => setLocale(locale === "en" ? "zh" : "en")}
          className={`w-full flex items-center ${compact ? "justify-center" : "gap-3"} px-3 py-2 rounded-lg text-xs text-[var(--text-1)] hover:text-[var(--accent-hot)] hover:bg-[var(--bg-2)] transition-all cursor-pointer`}
          title={locale === "en" ? "Switch to Chinese" : "Switch to English"}
        >
          <span className="w-5 h-5 rounded-md bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.12)] text-[10px] font-mono text-[var(--accent-hot)] flex items-center justify-center font-bold border border-[rgba(45,76,221,0.18)] shrink-0">
            {locale === "en" ? "中" : "EN"}
          </span>
          {!compact && <span className="font-semibold truncate">{locale === "en" ? "中文" : "English"}</span>}
        </button>
        <button
          onClick={onOpenSettings}
          aria-label={t("settings.title", locale)}
          className={`w-full flex items-center ${compact ? "justify-center" : "gap-3"} px-3 py-2 rounded-lg text-xs text-[var(--text-1)] hover:text-[var(--accent-hot)] hover:bg-[var(--bg-2)] transition-all cursor-pointer`}
        >
          <Settings className="w-4 h-4 text-[var(--text-2)] group-hover:rotate-45 transition-transform shrink-0" strokeWidth={1.9} />
          {!compact && <span className="font-semibold truncate">{t("settings.title", locale)}</span>}
        </button>

        {!compact && (
          <div className="px-3 pt-3 text-[10px] text-[var(--text-2)] uppercase tracking-widest flex items-center gap-2 font-semibold">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-[var(--fin-up)] anim-data-pulse" />
              <span className="absolute inset-0 rounded-full bg-[var(--fin-up)]" />
            </span>
            <span className="truncate">{zh ? "本地研究工作台" : "LOCAL RESEARCH DESK"}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
