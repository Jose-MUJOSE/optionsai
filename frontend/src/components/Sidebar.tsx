"use client";

import { LayoutDashboard, Star, Newspaper, Target, Settings, FolderOpen, Radar, Bell } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

export type AppView =
  | "dashboard"
  | "watchlist"
  | "news"
  | "strategies"
  | "paper"
  | "scanner"
  | "alerts"
  | "settings";

interface SidebarProps {
  view: AppView;
  onViewChange: (view: AppView) => void;
  onOpenSettings: () => void;
  /** Current pixel width; parent controls resize state. */
  width: number;
}

export default function Sidebar({ view, onViewChange, onOpenSettings, width }: SidebarProps) {
  const { locale, setLocale } = useAppStore();

  const compact = width < 190; // collapse labels below this width

  const items: Array<{ id: AppView; icon: typeof LayoutDashboard; label: string }> = [
    { id: "dashboard",  icon: LayoutDashboard, label: t("nav.dashboard",  locale) },
    { id: "watchlist",  icon: Star,            label: t("nav.watchlist",  locale) },
    { id: "news",       icon: Newspaper,       label: t("nav.news",       locale) },
    { id: "strategies", icon: Target,          label: t("nav.strategies", locale) },
    { id: "paper",      icon: FolderOpen,      label: locale === "zh" ? "模拟仓位" : "Paper" },
    { id: "scanner",    icon: Radar,           label: locale === "zh" ? "策略扫描器" : "Scanner" },
    { id: "alerts",     icon: Bell,            label: locale === "zh" ? "事件提醒" : "Alerts" },
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

      {/* Brand */}
      <div className="px-5 py-6 border-b border-[var(--line-soft)]">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)] shadow-[var(--shadow-blue)] flex items-center justify-center overflow-hidden">
            <span className="text-white font-bold text-sm tracking-tight relative z-10">O</span>
            {/* rotating light sweep inside logo */}
            <div aria-hidden className="absolute inset-0 opacity-40">
              <div className="absolute inset-[-40%] rounded-full bg-gradient-conic from-white/0 via-white/60 to-white/0 anim-drift" />
            </div>
          </div>
          {!compact && (
            <div className="leading-tight min-w-0">
              <div className="text-[15px] font-semibold tracking-tight whitespace-nowrap">
                <span className="text-gradient-blue">Options</span>
                <span className="text-[var(--text-0)]">AI</span>
              </div>
              <div className="text-[9.5px] text-[var(--text-2)] uppercase tracking-[0.18em] mt-0.5 font-semibold truncate">
                {t("app.subtitle", locale)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map(({ id, icon: Icon, label }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => onViewChange(id)}
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
              {!compact && <span className="truncate">{label}</span>}
            </button>
          );
        })}
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
            <span className="truncate">{t("nav.live", locale)}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
