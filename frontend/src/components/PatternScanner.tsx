"use client";

/**
 * PatternScanner — scan a basket of tickers for technical chart patterns.
 *
 * Detects 30 patterns: 7 single-candle, 6 two-candle, 4 three-candle,
 * 5 trend/MA, 4 breakout, 4 indicator-based. Each ticker can have
 * multiple patterns firing simultaneously — we surface all of them.
 *
 * Workflow:
 *   1. User picks a ticker universe (Mag7, S&P50, watchlist, custom, etc.)
 *   2. User picks specific patterns OR direction filter (or "all")
 *   3. Hit Scan → backend runs detect_all() per ticker, returns matches
 *   4. Results show ticker + last close + every fired pattern with confidence
 *   5. Click a ticker → opens it in the dashboard for deeper review
 *
 * Honesty caveat surfaced in FeatureGuide: these are CLASSIC pattern
 * definitions, not statistically validated alpha signals.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Radar, Loader2, ArrowRight, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronDown } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useWatchlist } from "@/lib/watchlist";
import { fetchPatternCatalog, runPatternScanner } from "@/lib/api";
import type { PatternCatalogItem, PatternScanResponse } from "@/lib/api";
import { CATEGORIES, CATEGORY_ORDER, resolveUniverse, type CategoryKey } from "@/lib/tickerUniverse";

type Locale = "zh" | "en";

// Visual grouping reused from StrategyScanner
const GROUP_LABELS: Record<"personal" | "indices" | "sectors" | "themes", { zh: string; en: string }> = {
  personal: { zh: "个人", en: "Personal" },
  indices: { zh: "指数与 ETF", en: "Indices & ETFs" },
  sectors: { zh: "行业板块", en: "Sectors" },
  themes: { zh: "主题策略", en: "Themes" },
};

type DirectionFilter = "all" | "bullish" | "bearish" | "neutral";

export default function PatternScanner() {
  const { locale, searchTicker } = useAppStore();
  const { items: watchlistItems } = useWatchlist();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  const [catalog, setCatalog] = useState<PatternCatalogItem[]>([]);
  const [selectedPatterns, setSelectedPatterns] = useState<Set<string>>(new Set());
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  // Multi-select universe: user can combine several baskets (e.g. Mag7 + Banks)
  // and the union is scanned, deduplicated, capped at 30 by the backend.
  const [selectedCategories, setSelectedCategories] = useState<Set<CategoryKey>>(new Set(["mag7"]));
  const [customTickers, setCustomTickers] = useState<string>("");
  const [response, setResponse] = useState<PatternScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllPatterns, setShowAllPatterns] = useState(false);

  // Load catalog once on mount
  useEffect(() => {
    fetchPatternCatalog()
      .then((r) => setCatalog(r.patterns))
      .catch(() => {/* catalog load failure → user just sees empty filter */});
  }, []);

  /** Resolve selected categories → deduplicated ticker universe (capped at 30). */
  const universe = useMemo(() => {
    return resolveUniverse(
      selectedCategories,
      watchlistItems.map((x) => x.ticker),
      customTickers,
      30,
    );
  }, [selectedCategories, customTickers, watchlistItems]);

  // Group categories by their visual group (personal/indices/sectors/themes)
  const groupedCategories = useMemo(() => {
    const out: Record<string, CategoryKey[]> = { personal: [], indices: [], sectors: [], themes: [] };
    for (const key of CATEGORY_ORDER) {
      const g = CATEGORIES[key].group;
      out[g].push(key);
    }
    return out;
  }, []);

  const toggleCategory = useCallback((key: CategoryKey) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Don't allow zero categories — that would scan nothing. Force Mag7
        // back as a fallback so the Run button always has something to do.
        if (next.size === 0) next.add("mag7");
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const togglePattern = useCallback((code: string) => {
    setSelectedPatterns((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const patterns = selectedPatterns.size > 0 ? Array.from(selectedPatterns) : null;
      const directions = directionFilter === "all" ? null : [directionFilter];
      const r = await runPatternScanner(universe, patterns, directions);
      setResponse(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedPatterns, directionFilter, universe]);

  const visibleCatalog = useMemo(() => {
    if (directionFilter === "all") return catalog;
    return catalog.filter((p) => p.direction === directionFilter);
  }, [catalog, directionFilter]);

  const displayedPatterns = showAllPatterns ? visibleCatalog : visibleCatalog.slice(0, 12);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-5">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.12)] flex items-center justify-center">
            <Radar className="w-4 h-4 text-[var(--accent)]" strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
              {lang === "zh" ? "技术形态扫描器" : "Pattern Scanner"}
            </h3>
            <div className="text-[10.5px] text-[var(--text-2)] tracking-wide">
              {lang === "zh"
                ? "30 种经典 K 线 / 均线 / 突破形态 — 启发式信号，非投资建议"
                : "30 classic candle / MA / breakout patterns — heuristic signals, not investment advice"}
            </div>
          </div>
        </div>

        {/* Direction filter pills */}
        <div className="mt-4 flex items-center gap-1.5 text-xs flex-wrap">
          <span className="text-[10.5px] text-[var(--text-2)] uppercase tracking-wider font-semibold mr-1">
            {lang === "zh" ? "方向" : "Direction"}:
          </span>
          {([
            ["all", lang === "zh" ? "全部" : "All"],
            ["bullish", lang === "zh" ? "看涨" : "Bullish"],
            ["bearish", lang === "zh" ? "看跌" : "Bearish"],
            ["neutral", lang === "zh" ? "中性" : "Neutral"],
          ] as const).map(([key, label]) => {
            const active = directionFilter === key;
            return (
              <button
                key={key}
                onClick={() => setDirectionFilter(key as DirectionFilter)}
                className={`px-3 py-1.5 rounded-full font-semibold transition-all cursor-pointer ${
                  active
                    ? key === "bullish" ? "bg-[var(--fin-up)] text-white" :
                      key === "bearish" ? "bg-[var(--fin-down)] text-white" :
                      key === "neutral" ? "bg-[var(--text-3)] text-white" :
                      "bg-[var(--accent)] text-white"
                    : "bg-[var(--bg-2)] text-[var(--text-1)] hover:bg-[var(--bg-3)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Pattern selector grid */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10.5px] text-[var(--text-2)] uppercase tracking-wider font-semibold">
              {lang === "zh" ? "形态选择" : "Patterns"}
              {selectedPatterns.size > 0 && (
                <span className="ml-2 text-[var(--accent-hot)] font-bold normal-case">
                  ({lang === "zh" ? `已选 ${selectedPatterns.size}` : `${selectedPatterns.size} selected`})
                </span>
              )}
            </span>
            {selectedPatterns.size > 0 && (
              <button
                onClick={() => setSelectedPatterns(new Set())}
                className="text-[10.5px] text-[var(--text-2)] hover:text-[var(--accent-hot)] cursor-pointer"
              >
                {lang === "zh" ? "清空" : "Clear"}
              </button>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-3)] mb-2">
            {lang === "zh"
              ? "不选 = 检测全部形态"
              : "None selected = detect all patterns"}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
            {displayedPatterns.map((p) => {
              const active = selectedPatterns.has(p.code);
              const dirColor =
                p.direction === "bullish" ? "var(--fin-up)" :
                p.direction === "bearish" ? "var(--fin-down)" :
                "var(--text-3)";
              const desc = lang === "zh" ? p.description_zh : p.description_en;
              return (
                <div key={p.code} className="relative group">
                  <button
                    onClick={() => togglePattern(p.code)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer truncate ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-hot)]"
                        : "border-[var(--line-soft)] bg-white hover:border-[var(--line-mid)] text-[var(--text-1)]"
                    }`}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: dirColor }} />
                    {lang === "zh" ? p.name_zh : p.name_en}
                  </button>
                  {/* Hover tooltip with plain-language explanation for beginners.
                      Renders above the button so it never gets clipped by the
                      grid container; opacity transition keeps it from feeling jumpy. */}
                  {desc && (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute z-30 left-0 right-0 -top-2 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    >
                      <div className="bg-[var(--text-0)] text-white text-[11px] leading-snug rounded-lg px-3 py-2 shadow-lg max-w-[280px]">
                        <div className="font-bold mb-1 flex items-center gap-1.5">
                          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: dirColor }} />
                          {lang === "zh" ? p.name_zh : p.name_en}
                          <span className="ml-auto text-[9px] opacity-70 uppercase tracking-wider">
                            {p.direction === "bullish" ? (lang === "zh" ? "看涨" : "Bullish") :
                             p.direction === "bearish" ? (lang === "zh" ? "看跌" : "Bearish") :
                             (lang === "zh" ? "中性" : "Neutral")}
                          </span>
                        </div>
                        <div className="opacity-90">{desc}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {visibleCatalog.length > 12 && (
            <button
              onClick={() => setShowAllPatterns((v) => !v)}
              className="mt-2 text-[11px] text-[var(--accent-hot)] hover:underline cursor-pointer flex items-center gap-1"
            >
              {showAllPatterns
                ? (lang === "zh" ? "收起" : "Show less")
                : (lang === "zh" ? `查看全部 ${visibleCatalog.length} 种形态` : `Show all ${visibleCatalog.length} patterns`)}
              <ChevronDown className={`w-3 h-3 transition-transform ${showAllPatterns ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>

        {/* Universe selector — grouped multi-select using shared categories */}
        <div className="mt-4">
          <div className="text-[10.5px] text-[var(--text-2)] uppercase tracking-wider font-semibold mb-2 flex items-center gap-2">
            <span>{lang === "zh" ? "扫描范围（可多选）" : "Universe (multi-select)"}</span>
            <span className="text-[var(--accent-hot)] normal-case">
              {lang === "zh" ? `已选 ${selectedCategories.size} 类` : `${selectedCategories.size} selected`}
            </span>
            <span className="text-[var(--text-3)] normal-case">
              ({lang === "zh" ? `${universe.length} 个标的` : `${universe.length} tickers`})
            </span>
          </div>
          <div className="space-y-2">
            {(["personal", "indices", "sectors", "themes"] as const).map((group) => {
              const keys = groupedCategories[group] || [];
              if (keys.length === 0) return null;
              return (
                <div key={group}>
                  <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-3)] mb-1 font-semibold">
                    {GROUP_LABELS[group][lang]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {keys.map((key) => {
                      const meta = CATEGORIES[key];
                      const active = selectedCategories.has(key);
                      const count =
                        key === "watchlist" ? watchlistItems.length :
                        key === "custom" ? customTickers.split(/[,\s]+/).filter(Boolean).length :
                        meta.tickers.length;
                      const disabled = key === "watchlist" && watchlistItems.length === 0;
                      return (
                        <button
                          key={key}
                          onClick={() => !disabled && toggleCategory(key)}
                          disabled={disabled}
                          title={meta[lang].desc}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1 ${
                            active
                              ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)]"
                              : "bg-[var(--bg-2)] text-[var(--text-1)] hover:bg-[var(--bg-3)]"
                          }`}
                        >
                          <span>{meta[lang].label}</span>
                          {count > 0 && key !== "custom" && (
                            <span className={`text-[8.5px] mono px-1 rounded-full ${active ? "bg-white/25 text-white" : "bg-white text-[var(--text-2)]"}`}>
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedCategories.has("custom") && (
            <input
              type="text"
              value={customTickers}
              onChange={(e) => setCustomTickers(e.target.value)}
              placeholder={lang === "zh" ? "如：AAPL, MSFT, NVDA" : "e.g. AAPL, MSFT, NVDA"}
              className="mt-2 w-full px-3 py-2 rounded-lg bg-[var(--bg-1)] border border-[var(--line-mid)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          )}

          <div className="text-[10.5px] text-[var(--text-2)] mt-3 leading-relaxed bg-[var(--bg-1)] border border-[var(--line-soft)] rounded-lg px-3 py-2">
            <span className="font-semibold">
              {lang === "zh" ? "即将扫描" : "Will scan"}{" "}
              <span className="text-[var(--accent-hot)]">({universe.length})</span>:
            </span>{" "}
            <span className="mono">
              {universe.slice(0, 15).join(", ")}
              {universe.length > 15 ? ` … (+${universe.length - 15})` : ""}
            </span>
          </div>
        </div>

        {/* Run button */}
        <div className="mt-4">
          <button
            onClick={handleScan}
            disabled={loading || universe.length === 0}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white font-bold text-sm shadow-[var(--shadow-blue)] hover:-translate-y-px transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 justify-center"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
            {loading
              ? (lang === "zh" ? "扫描中..." : "Scanning...")
              : (lang === "zh" ? "运行扫描" : "Run Scan")}
          </button>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="rounded-xl bg-[var(--fin-down-soft)] border border-[rgba(211,59,77,0.28)] p-3 flex items-center gap-2 text-sm text-[var(--fin-down)]">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {response && (
        <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h4 className="text-sm font-bold text-[var(--text-0)]">
              {lang === "zh"
                ? `匹配结果 (${response.matched} / ${response.scanned})`
                : `Results (${response.matched} of ${response.scanned})`}
            </h4>
          </div>

          {response.results.length === 0 ? (
            <div className="text-center py-12 text-sm text-[var(--text-2)]">
              {lang === "zh" ? "未匹配到任何形态" : "No patterns matched."}
            </div>
          ) : (
            <div className="space-y-2.5">
              {response.results.map((r) => {
                const topHit = r.hits[0];
                const directionIcon =
                  topHit.direction === "bullish" ? <TrendingUp className="w-4 h-4 text-[var(--fin-up)]" /> :
                  topHit.direction === "bearish" ? <TrendingDown className="w-4 h-4 text-[var(--fin-down)]" /> :
                  <Minus className="w-4 h-4 text-[var(--text-3)]" />;
                return (
                  <div
                    key={r.ticker}
                    className="rounded-xl bg-[var(--bg-1)] border border-[var(--line-soft)] p-3.5 hover:border-[var(--line-mid)] transition-all"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                      <div className="flex items-center gap-3">
                        {directionIcon}
                        <button
                          onClick={() => searchTicker(r.ticker)}
                          className="mono text-base font-bold text-[var(--accent-hot)] hover:underline cursor-pointer"
                        >
                          {r.ticker}
                        </button>
                        <span className="mono text-xs text-[var(--text-1)]">
                          ${r.last_close.toFixed(2)}
                        </span>
                      </div>
                      <button
                        onClick={() => searchTicker(r.ticker)}
                        className="flex items-center gap-1 text-[10.5px] text-[var(--accent-hot)] hover:underline cursor-pointer"
                      >
                        {lang === "zh" ? "打开仪表盘" : "Open Dashboard"}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {r.hits.map((h) => {
                        const dirColor =
                          h.direction === "bullish" ? "bg-[var(--fin-up-soft)] text-[var(--fin-up)] border border-[rgba(10,143,90,0.28)]" :
                          h.direction === "bearish" ? "bg-[var(--fin-down-soft)] text-[var(--fin-down)] border border-[rgba(211,59,77,0.28)]" :
                          "bg-[var(--bg-2)] text-[var(--text-1)] border border-[var(--line-mid)]";
                        return (
                          <span
                            key={h.code}
                            className={`text-[10.5px] font-semibold px-2 py-1 rounded-md ${dirColor}`}
                            title={lang === "zh" ? h.description_zh : h.description_en}
                          >
                            {lang === "zh" ? h.name_zh : h.name_en}
                            <span className="ml-1.5 opacity-70 mono">
                              {(h.confidence * 100).toFixed(0)}%
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
