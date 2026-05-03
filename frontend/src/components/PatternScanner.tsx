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

type Locale = "zh" | "en";

// Same universe presets as StrategyScanner so users have one mental model.
type CategoryKey =
  | "watchlist" | "mag7" | "dow30" | "sp50" | "ndx_top" | "etf_core"
  | "semiconductors" | "ai_software" | "banks" | "healthcare"
  | "energy" | "consumer" | "ev_auto" | "biotech" | "china_adr" | "custom";

const CATEGORY_TICKERS: Record<Exclude<CategoryKey, "watchlist" | "custom">, string[]> = {
  mag7: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
  dow30: ["AAPL", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS", "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK", "MSFT", "NKE", "PG", "TRV", "UNH", "V", "VZ", "WBA", "WMT"],
  sp50: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "BRK.B", "AVGO", "TSLA", "JPM", "LLY", "V", "XOM", "MA", "UNH", "COST", "WMT", "PG", "JNJ", "HD", "ABBV", "NFLX", "BAC", "CRM", "MRK", "CVX", "ORCL", "AMD", "KO"],
  ndx_top: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "COST", "NFLX", "PEP", "ADBE", "AMD", "CSCO", "TMUS", "CMCSA", "QCOM", "INTU", "TXN", "AMGN", "ISRG", "BKNG", "GILD", "MU"],
  etf_core: ["SPY", "QQQ", "IWM", "DIA", "VTI", "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "GLD", "TLT", "ARKK"],
  semiconductors: ["NVDA", "AVGO", "AMD", "TSM", "QCOM", "INTC", "MU", "AMAT", "LRCX", "ASML", "KLAC", "MRVL", "ON", "ARM"],
  ai_software: ["MSFT", "GOOGL", "META", "ORCL", "CRM", "ADBE", "PLTR", "NOW", "SNOW", "DDOG", "MDB", "NET", "CRWD"],
  banks: ["JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "SCHW", "AXP", "USB", "PNC"],
  healthcare: ["UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY", "AMGN", "GILD"],
  energy: ["XOM", "CVX", "COP", "OXY", "SLB", "EOG", "MPC", "PSX", "VLO"],
  consumer: ["AMZN", "WMT", "COST", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "BKNG", "DIS"],
  ev_auto: ["TSLA", "F", "GM", "RIVN", "LCID", "NIO", "XPEV", "LI", "TM"],
  biotech: ["AMGN", "GILD", "REGN", "VRTX", "BIIB", "MRNA", "ILMN", "INCY"],
  china_adr: ["BABA", "PDD", "JD", "NIO", "BIDU", "TME", "BILI", "TCOM"],
};

const CATEGORY_LABELS: Record<CategoryKey, { zh: string; en: string }> = {
  watchlist: { zh: "我的自选", en: "Watchlist" },
  mag7: { zh: "科技七雄", en: "Magnificent 7" },
  dow30: { zh: "道指 30", en: "Dow 30" },
  sp50: { zh: "标普 50", en: "S&P Top 50" },
  ndx_top: { zh: "纳指领头", en: "Nasdaq Top" },
  etf_core: { zh: "核心 ETF", en: "Core ETFs" },
  semiconductors: { zh: "半导体", en: "Semiconductors" },
  ai_software: { zh: "AI 软件", en: "AI Software" },
  banks: { zh: "银行金融", en: "Banks" },
  healthcare: { zh: "医疗健康", en: "Healthcare" },
  energy: { zh: "能源", en: "Energy" },
  consumer: { zh: "消费", en: "Consumer" },
  ev_auto: { zh: "电车汽车", en: "EV & Auto" },
  biotech: { zh: "生物技术", en: "Biotech" },
  china_adr: { zh: "中概股", en: "China ADRs" },
  custom: { zh: "自定义", en: "Custom" },
};

const CATEGORY_ORDER: CategoryKey[] = [
  "watchlist", "mag7", "ndx_top", "sp50", "dow30", "etf_core",
  "semiconductors", "ai_software", "banks", "healthcare",
  "energy", "consumer", "ev_auto", "biotech", "china_adr", "custom",
];

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

  /** Resolve all selected categories into a deduplicated ticker universe.
   *  Each selected category contributes its tickers; we keep insertion order
   *  by category-priority but dedupe so a ticker that appears in Mag7 AND
   *  S&P50 only runs once. The backend caps at 30. */
  const universe = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (ticker: string) => {
      const t = ticker.trim().toUpperCase();
      if (!t || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };
    for (const key of CATEGORY_ORDER) {
      if (!selectedCategories.has(key)) continue;
      if (key === "watchlist") {
        watchlistItems.forEach((x) => add(x.ticker));
      } else if (key === "custom") {
        customTickers
          .split(/[,\s]+/)
          .filter(Boolean)
          .forEach(add);
      } else {
        CATEGORY_TICKERS[key].forEach(add);
      }
    }
    return out.slice(0, 30);
  }, [selectedCategories, customTickers, watchlistItems]);

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
              return (
                <button
                  key={p.code}
                  onClick={() => togglePattern(p.code)}
                  className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer truncate ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-hot)]"
                      : "border-[var(--line-soft)] bg-white hover:border-[var(--line-mid)] text-[var(--text-1)]"
                  }`}
                  title={lang === "zh" ? p.name_zh : p.name_en}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: dirColor }} />
                  {lang === "zh" ? p.name_zh : p.name_en}
                </button>
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

        {/* Universe selector */}
        <div className="mt-4">
          <div className="text-[10.5px] text-[var(--text-2)] uppercase tracking-wider font-semibold mb-2">
            {lang === "zh" ? "扫描范围" : "Universe"}
            <span className="ml-2 text-[var(--text-3)] normal-case">
              ({lang === "zh" ? `${universe.length} 个标的` : `${universe.length} tickers`})
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_ORDER.map((key) => {
              const active = selectedCategories.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleCategory(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)]"
                      : "bg-[var(--bg-2)] text-[var(--text-1)] hover:bg-[var(--bg-3)]"
                  }`}
                >
                  {CATEGORY_LABELS[key][lang]}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 text-[10px] text-[var(--text-3)]">
            {lang === "zh"
              ? "可多选；后端最多扫描 30 个去重后的标的"
              : "Multi-select; backend caps the deduplicated universe at 30 tickers"}
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
