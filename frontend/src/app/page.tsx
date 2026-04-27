"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Check, Star, Home as HomeIcon } from "lucide-react";
import TickerSearch from "@/components/TickerSearch";
import MarketDashboard from "@/components/MarketDashboard";
import MarketForecast from "@/components/MarketForecast";
import MarketIntel from "@/components/MarketIntel";
import IVTermStructure from "@/components/IVTermStructure";
import TrendSelector from "@/components/TrendSelector";
import ControlPanel from "@/components/ControlPanel";
import StrategyCards from "@/components/StrategyCards";
import StrategyComparison from "@/components/StrategyComparison";
import PayoffChart from "@/components/PayoffChart";
import AIChatSidebar from "@/components/AIChatSidebar";
import SettingsModal from "@/components/SettingsModal";
import CandlestickChart from "@/components/CandlestickChart";
import OptionsChain from "@/components/OptionsChain";
import ShortAndFlowPanel from "@/components/ShortAndFlowPanel";
import VolatilityRankPanel from "@/components/VolatilityRankPanel";
import EarningsMovePanel from "@/components/EarningsMovePanel";
import StrategyBacktest from "@/components/StrategyBacktest";
import PaperPortfolio from "@/components/PaperPortfolio";
import GEXPanel from "@/components/GEXPanel";
import UnusualOptionsFlow from "@/components/UnusualOptionsFlow";
import StrategyScanner from "@/components/StrategyScanner";
import EventAlerts from "@/components/EventAlerts";
import AnimatedBackground from "@/components/AnimatedBackground";
import Sidebar, { type AppView } from "@/components/Sidebar";
import Watchlist from "@/components/Watchlist";
import NewsPanel from "@/components/NewsPanel";
import TraderAgent from "@/components/TraderAgent";
import { useAppStore } from "@/lib/store";
import { useWatchlist } from "@/lib/watchlist";
import { t } from "@/lib/i18n";

const LEFT_MIN = 72;
const LEFT_MAX = 340;
const LEFT_DEFAULT = 232;
const LEFT_STORAGE_KEY = "optionsai.leftSidebarWidth.v1";

const RIGHT_MIN = 320;
const RIGHT_MAX = 700;
const RIGHT_DEFAULT = 420;
const RIGHT_STORAGE_KEY = "optionsai.rightSidebarWidth.v1";

function readStoredWidth(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default function Home() {
  const { isChatOpen, marketData, locale, searchTicker, goHome } = useAppStore();
  const { items: watchlistItems, add: addToWatchlist, remove: removeFromWatchlist } = useWatchlist();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<AppView>("dashboard");

  /** Click home/logo: clear ticker AND switch to dashboard view. */
  const handleGoHome = useCallback(() => {
    goHome();
    setView("dashboard");
  }, [goHome]);

  // Two independently resizable sidebars (persisted to localStorage).
  const [leftWidth, setLeftWidth] = useState<number>(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState<number>(RIGHT_DEFAULT);

  // Load persisted widths on mount.
  // localStorage is a client-only external system; reading it during render
  // would break SSR. A single post-hydration reconciliation is the canonical
  // pattern here, so we silence react-hooks/set-state-in-effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeftWidth(readStoredWidth(LEFT_STORAGE_KEY, LEFT_DEFAULT));
    setRightWidth(readStoredWidth(RIGHT_STORAGE_KEY, RIGHT_DEFAULT));
  }, []);

  // Persist widths when they change (debounced via rAF)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.localStorage.setItem(LEFT_STORAGE_KEY, String(leftWidth));
    });
    return () => window.cancelAnimationFrame(id);
  }, [leftWidth]);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.localStorage.setItem(RIGHT_STORAGE_KEY, String(rightWidth));
    });
    return () => window.cancelAnimationFrame(id);
  }, [rightWidth]);

  // Unified drag handling: one of "left" | "right" is active at a time.
  const dragRef = useRef<null | {
    side: "left" | "right";
    startX: number;
    startWidth: number;
  }>(null);

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        side,
        startX: e.clientX,
        startWidth: side === "left" ? leftWidth : rightWidth,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth, rightWidth]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.side === "left") {
        // Left drag: move right → widen
        const delta = e.clientX - drag.startX;
        const w = Math.min(LEFT_MAX, Math.max(LEFT_MIN, drag.startWidth + delta));
        setLeftWidth(w);
      } else {
        // Right drag: move left → widen
        const delta = drag.startX - e.clientX;
        const w = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, drag.startWidth + delta));
        setRightWidth(w);
      }
    };
    const handleMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleOpenTicker = useCallback(
    (ticker: string) => {
      searchTicker(ticker);
      setView("dashboard");
    },
    [searchTicker]
  );

  const currentTicker = marketData?.ticker ?? null;
  const isInWatchlist = useMemo(
    () => (currentTicker ? watchlistItems.some((x) => x.ticker === currentTicker) : false),
    [watchlistItems, currentTicker]
  );

  const toggleWatchlist = useCallback(() => {
    if (!currentTicker) return;
    if (isInWatchlist) removeFromWatchlist(currentTicker);
    else addToWatchlist(currentTicker);
  }, [currentTicker, isInWatchlist, addToWatchlist, removeFromWatchlist]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient light backdrop */}
      <AnimatedBackground />

      <div className="flex h-screen relative z-[1]">
        {/* Primary left navigation */}
        <Sidebar
          view={view}
          onViewChange={setView}
          onOpenSettings={() => setSettingsOpen(true)}
          onGoHome={handleGoHome}
          width={leftWidth}
        />

        {/* Left resizer */}
        <div
          onMouseDown={startDrag("left")}
          role="separator"
          aria-label="Resize left sidebar"
          className="resizer"
        />

        {/* Main column */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-8 py-6 space-y-6">
            {/* Top bar — split into title row + actions row to avoid overlap on narrow viewports.
                The title gets dedicated vertical space; actions wrap below cleanly. */}
            <header className="anim-fade-up space-y-3">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.28em] text-[var(--text-2)] font-semibold">
                    <span className="relative flex w-1.5 h-1.5">
                      <span className="absolute inset-0 rounded-full bg-[var(--fin-up)] anim-data-pulse" />
                      <span className="absolute inset-0 rounded-full bg-[var(--fin-up)]" />
                    </span>
                    {t(`nav.${view}` as "nav.dashboard", locale)}
                    {marketData && (
                      <>
                        <span className="text-[var(--line-mid)]">/</span>
                        <span className="text-[var(--accent)] mono font-bold tracking-wider">
                          {marketData.ticker}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-[var(--text-0)] mt-1">
                    {view === "dashboard"  && (marketData ? marketData.ticker : t("nav.dashboard", locale))}
                    {view === "watchlist"  && t("watchlist.title", locale)}
                    {view === "news"       && t("news.title", locale)}
                    {view === "strategies" && t("nav.strategies", locale)}
                    {view === "trader"     && t("trader.title", locale)}
                    {view === "paper"      && (locale === "zh" ? "模拟仓位" : "Paper Portfolio")}
                    {view === "scanner"    && (locale === "zh" ? "策略扫描器" : "Strategy Scanner")}
                    {view === "alerts"     && (locale === "zh" ? "事件提醒" : "Event Alerts")}
                  </h1>
                </div>

                {/* Action buttons — sit on the right of the title row when there's room,
                    otherwise wrap below thanks to flex-wrap. */}
                <div className="flex items-center gap-2 flex-wrap">
                  {marketData && (
                    <button
                      onClick={handleGoHome}
                      className="h-9 px-3.5 text-xs font-semibold rounded-full flex items-center gap-1.5 transition-all shrink-0 cursor-pointer bg-white border border-[var(--line-mid)] text-[var(--text-1)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:-translate-y-px hover:shadow-sm"
                    >
                      <HomeIcon className="w-3.5 h-3.5" />
                      {t("home.backToHome", locale)}
                    </button>
                  )}
                  {view === "dashboard" && marketData && (
                    <button
                      onClick={toggleWatchlist}
                      className={`h-9 px-3.5 text-xs font-semibold rounded-full flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                        isInWatchlist
                          ? "bg-[var(--fin-up-soft)] text-[var(--fin-up)] border border-[rgba(10,143,90,0.28)] hover:bg-[rgba(10,143,90,0.16)]"
                          : "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white border border-[var(--accent)] hover:shadow-[var(--shadow-blue)] hover:-translate-y-px"
                      }`}
                      aria-pressed={isInWatchlist}
                    >
                      {isInWatchlist ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          {t("news.inWatchlist", locale)}
                        </>
                      ) : (
                        <>
                          <Star className="w-3.5 h-3.5" />
                          {t("news.addToWatchlist", locale)}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Search row — full-width on its own line so the input has breathing room
                  and never collides with the title or action pills. */}
              {(view === "dashboard" || view === "strategies" || view === "trader") && (
                <div className="w-full max-w-xl">
                  <TickerSearch showChips={false} />
                </div>
              )}
            </header>

            {/* VIEW: Dashboard */}
            {view === "dashboard" && (
              <div className="space-y-6">
                {marketData ? (
                  <>
                    <MarketDashboard />
                    <VolatilityRankPanel />
                    <EarningsMovePanel />
                    <CandlestickChart />
                    <MarketForecast />
                    <MarketIntel />
                    <IVTermStructure />
                    <OptionsChain />
                    <GEXPanel />
                    <UnusualOptionsFlow />
                    <ShortAndFlowPanel />
                  </>
                ) : (
                  <EmptyState />
                )}
              </div>
            )}

            {/* VIEW: Trader Agent (Professional Multi-Perspective Analysis) */}
            {view === "trader" && <TraderAgent />}

            {/* VIEW: Watchlist */}
            {view === "watchlist" && <Watchlist onOpenTicker={handleOpenTicker} />}

            {/* VIEW: News */}
            {view === "news" && <NewsPanel />}

            {/* VIEW: Strategies */}
            {view === "strategies" && (
              <div className="space-y-6">
                {marketData ? (
                  <div className="space-y-6 stagger-children">
                    <TrendSelector />
                    <ControlPanel />
                    <StrategyCards />
                    <StrategyComparison />
                    <PayoffChart />
                    <StrategyBacktest />
                  </div>
                ) : (
                  <EmptyState />
                )}
              </div>
            )}

            {/* VIEW: Paper Portfolio */}
            {view === "paper" && <PaperPortfolio />}

            {/* VIEW: Scanner */}
            {view === "scanner" && <StrategyScanner />}

            {/* VIEW: Alerts */}
            {view === "alerts" && <EventAlerts />}
          </div>
        </main>

        {/* Resizable AI Chat Sidebar */}
        {isChatOpen && (
          <>
            <div
              onMouseDown={startDrag("right")}
              role="separator"
              aria-label="Resize right sidebar"
              className="resizer"
            />
            <div
              style={{ width: rightWidth }}
              className="flex-shrink-0 border-l border-[var(--line-soft)] bg-white shadow-[-8px_0_30px_-12px_rgba(24,39,110,0.12)]"
            >
              <AIChatSidebar />
            </div>
          </>
        )}
        {!isChatOpen && <AIChatSidebar />}

        <SettingsModal
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          locale={locale}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  const { locale } = useAppStore();
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center anim-fade-up">
      <div className="relative w-24 h-24 mb-8">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.18)] border border-[rgba(45,76,221,0.22)] shadow-[var(--shadow-blue)]" />
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <div className="shimmer absolute inset-0" />
        </div>
        <BarChart3 className="absolute inset-0 m-auto w-10 h-10 text-[var(--accent)] anim-float-slow" strokeWidth={1.8} />
      </div>
      <h2 className="text-xl font-bold text-[var(--text-0)] tracking-tight mb-2">
        {t("dashboard.emptyTitle", locale)}
      </h2>
      <p className="text-sm text-[var(--text-1)] max-w-md leading-relaxed mb-6">
        {t("dashboard.emptyDesc", locale)}
      </p>
      <div className="w-full max-w-xl">
        <TickerSearch />
      </div>
    </div>
  );
}
