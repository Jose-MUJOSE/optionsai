"use client";

/**
 * Options Strategy Scanner (formerly "Strategy Scanner").
 *
 * Multi-select universe + IV/flow/earnings preset → ranked list of US tickers
 * meeting the preset's threshold. Backend caps a single scan at 30 tickers
 * (options-data calls are expensive); the resolver dedupes the union and
 * truncates accordingly.
 *
 * Honesty:
 *   - Each preset uses a transparent threshold computed from real data.
 *   - Per-ticker failures don't kill the whole scan.
 *   - Results ranked by actual signal value, not a secret score.
 */

import { useCallback, useMemo, useState } from "react";
import { Radar, Loader2, ArrowRight, AlertCircle, Sigma } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useWatchlist } from "@/lib/watchlist";
import { runScanner } from "@/lib/api";
import type { ScannerPreset, ScannerResponse } from "@/lib/api";
import FeatureGuide from "./FeatureGuide";
import { CATEGORIES, CATEGORY_ORDER, resolveUniverse, type CategoryKey } from "@/lib/tickerUniverse";

type Locale = "zh" | "en";

const PRESET_COPY: Record<
  ScannerPreset,
  { zh: { label: string; desc: string }; en: { label: string; desc: string } }
> = {
  high_iv_rank: {
    zh: { label: "高 IV Rank (≥60)", desc: "IV 相对历史偏高, 适合卖方策略" },
    en: { label: "High IV Rank (≥60)", desc: "Rich IV vs history → favor premium sellers" },
  },
  low_iv_rank: {
    zh: { label: "低 IV Rank (≤30)", desc: "IV 相对历史偏低, 适合买方策略" },
    en: { label: "Low IV Rank (≤30)", desc: "Cheap IV vs history → favor premium buyers" },
  },
  bullish_flow: {
    zh: { label: "看涨资金占优", desc: "异动 call 名义金额占比 > 65%" },
    en: { label: "Bullish unusual flow", desc: "Unusual call notional > 65% of total" },
  },
  bearish_flow: {
    zh: { label: "看跌资金占优", desc: "异动 put 名义金额占比 > 65%" },
    en: { label: "Bearish unusual flow", desc: "Unusual put notional > 65% of total" },
  },
  earnings_week: {
    zh: { label: "一周内财报", desc: "7 天内发布季度财报" },
    en: { label: "Earnings this week", desc: "Earnings within 7 days" },
  },
};

const PRESETS: ScannerPreset[] = [
  "high_iv_rank",
  "low_iv_rank",
  "bullish_flow",
  "bearish_flow",
  "earnings_week",
];

// Group categories visually so the picker doesn't dump 35 chips in one row.
const GROUP_LABELS: Record<"personal" | "indices" | "sectors" | "themes", { zh: string; en: string }> = {
  personal: { zh: "个人", en: "Personal" },
  indices: { zh: "指数与 ETF", en: "Indices & ETFs" },
  sectors: { zh: "行业板块", en: "Sectors" },
  themes: { zh: "主题策略", en: "Themes" },
};

export default function OptionsStrategyScanner() {
  const { locale, searchTicker } = useAppStore();
  const { items: watchlistItems } = useWatchlist();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  const [preset, setPreset] = useState<ScannerPreset>("high_iv_rank");
  const [selectedCategories, setSelectedCategories] = useState<Set<CategoryKey>>(new Set(["mag7"]));
  const [customTickers, setCustomTickers] = useState<string>("");
  const [response, setResponse] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /** Resolve the union of all selected categories (deduplicated, capped at 30). */
  const universe = useMemo(() => {
    return resolveUniverse(
      selectedCategories,
      watchlistItems.map((x) => x.ticker),
      customTickers,
      30,
    );
  }, [selectedCategories, customTickers, watchlistItems]);

  const toggleCategory = useCallback((key: CategoryKey) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Don't allow zero categories — fall back to mag7.
        if (next.size === 0) next.add("mag7");
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const r = await runScanner(preset, universe);
      setResponse(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [preset, universe]);

  // Group categories by their `group` field for visual organization
  const groupedCategories = useMemo(() => {
    const out: Record<string, CategoryKey[]> = { personal: [], indices: [], sectors: [], themes: [] };
    for (const key of CATEGORY_ORDER) {
      const g = CATEGORIES[key].group;
      out[g].push(key);
    }
    return out;
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
            <Sigma className="w-4 h-4 text-[var(--accent)]" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--text-0)]">
              {lang === "zh" ? "期权策略扫描器" : "Options Strategy Scanner"}
            </h2>
            <p className="text-[11px] text-[var(--text-2)]">
              {lang === "zh"
                ? "公开阈值 · 真实期权数据 · 仅美股 (A股无个股期权)"
                : "Transparent thresholds · Real options data · US-only (A-shares have no options)"}
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 space-y-5">
        {/* Preset picker */}
        <div>
          <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold mb-2 block">
            {lang === "zh" ? "扫描预设" : "Scan preset"}
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {PRESETS.map((p) => {
              const copy = PRESET_COPY[p][lang];
              const active = preset === p;
              return (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`text-left rounded-lg border px-3 py-2.5 transition-all cursor-pointer ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-blue)]"
                      : "border-[var(--line-soft)] hover:bg-[var(--bg-2)]"
                  }`}
                >
                  <div className={`text-xs font-semibold ${active ? "text-[var(--accent-hot)]" : "text-[var(--text-0)]"}`}>
                    {copy.label}
                  </div>
                  <div className="text-[10px] text-[var(--text-2)] mt-0.5">{copy.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-select universe — grouped by category type */}
        <div>
          <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold mb-2 block">
            {lang === "zh" ? "扫描范围（可多选）" : "Scan universe (multi-select)"}
            <span className="ml-2 normal-case text-[var(--accent-hot)]">
              {lang === "zh" ? `已选 ${selectedCategories.size} 类` : `${selectedCategories.size} selected`}
            </span>
          </label>
          <div className="space-y-3">
            {(["personal", "indices", "sectors", "themes"] as const).map((group) => {
              const keys = groupedCategories[group] || [];
              if (keys.length === 0) return null;
              return (
                <div key={group}>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)] mb-1.5 font-semibold">
                    {GROUP_LABELS[group][lang]}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
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
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5 ${
                            active
                              ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white shadow-[var(--shadow-blue)]"
                              : "bg-[var(--bg-2)] text-[var(--text-1)] hover:bg-[var(--bg-3)]"
                          }`}
                        >
                          <span>{meta[lang].label}</span>
                          {count > 0 && key !== "custom" && (
                            <span
                              className={`text-[9px] mono px-1.5 py-0.5 rounded-full ${
                                active ? "bg-white/25 text-white" : "bg-white text-[var(--text-2)]"
                              }`}
                            >
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
              value={customTickers}
              onChange={(e) => setCustomTickers(e.target.value)}
              placeholder={lang === "zh" ? "粘贴 ticker (空格/逗号分隔, 最多 30)" : "AAPL, NVDA, TSLA... (max 30)"}
              className="mt-3 w-full px-3 py-2 text-sm border border-[var(--line-soft)] rounded-lg bg-[var(--bg-2)] focus:outline-none focus:border-[var(--accent)] mono"
            />
          )}

          {/* Resolved universe preview */}
          <div className="text-[10.5px] text-[var(--text-2)] mt-3 leading-relaxed bg-[var(--bg-1)] border border-[var(--line-soft)] rounded-lg px-3 py-2">
            <span className="font-semibold">
              {lang === "zh" ? "即将扫描" : "Will scan"}{" "}
              <span className="text-[var(--accent-hot)]">({universe.length})</span>:
            </span>{" "}
            <span className="mono">
              {universe.slice(0, 15).join(", ")}
              {universe.length > 15 ? ` … (+${universe.length - 15})` : ""}
            </span>
            {universe.length === 30 && (
              <span className="ml-2 text-[10px] text-[var(--accent-hot)]">
                {lang === "zh" ? "（已达 30 个上限）" : "(30 cap reached)"}
              </span>
            )}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={handleScan}
          disabled={loading || universe.length === 0}
          className="h-10 px-5 rounded-lg bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white text-sm font-semibold flex items-center gap-2 hover:shadow-[var(--shadow-blue)] hover:-translate-y-px transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {lang === "zh" ? "扫描中..." : "Scanning..."}
            </>
          ) : (
            <>
              <Radar className="w-4 h-4" />
              {lang === "zh" ? "开始扫描" : "Run scan"}
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {response && (
        <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-[var(--text-0)]">
              {lang === "zh"
                ? `命中 ${response.hits.length} / 扫描 ${response.scanned}`
                : `${response.hits.length} hits out of ${response.scanned} scanned`}
            </div>
            <div className="text-[11px] text-[var(--text-2)]">
              {lang === "zh" ? "预设" : "Preset"}:{" "}
              <span className="font-semibold text-[var(--accent)]">
                {PRESET_COPY[response.preset][lang].label}
              </span>
            </div>
          </div>
          {response.hits.length === 0 ? (
            <p className="text-xs text-[var(--text-2)] italic py-4 text-center">
              {lang === "zh"
                ? "当前扫描范围内没有符合条件的标的。换个预设或扩大范围试试。"
                : "No tickers match this preset right now. Try another preset or a wider universe."}
            </p>
          ) : (
            <div className="space-y-2">
              {response.hits.map((hit) => (
                <button
                  key={hit.ticker}
                  onClick={() => searchTicker(hit.ticker)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-[var(--line-soft)] hover:bg-[var(--bg-2)] hover:border-[var(--accent-soft)] transition-all cursor-pointer group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="mono font-bold text-sm text-[var(--text-0)]">{hit.ticker}</span>
                      {hit.spot_price ? (
                        <span className="text-[11px] text-[var(--text-2)] mono">
                          ${hit.spot_price.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-[var(--text-1)] mt-0.5">{hit.reason}</div>
                  </div>
                  <div className="text-right min-w-[90px]">
                    <div className="text-xs text-[var(--text-2)] uppercase tracking-wider">{hit.signal_label}</div>
                    <div className="text-sm mono font-semibold text-[var(--accent)]">
                      {typeof hit.signal_value === "number" ? hit.signal_value.toFixed(1) : hit.signal_value ?? "-"}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--text-2)] group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 text-[10px] text-[var(--text-2)] leading-relaxed border-t border-[var(--line-soft)] pt-3">
            {Object.entries(response.data_sources).map(([k, v]) => (
              <div key={k}>
                <span className="font-semibold uppercase tracking-wider">{k}:</span> {v}
              </div>
            ))}
          </div>
        </div>
      )}

      <FeatureGuide
        title={lang === "zh" ? "期权策略扫描器" : "Options Strategy Scanner"}
        dataSource={
          lang === "zh"
            ? "Yahoo Finance 期权链 + 历史 IV / Polygon.io 异动数据 / FINRA 财报日历"
            : "Yahoo Finance options chain + historical IV / Polygon.io flow / FINRA earnings calendar"
        }
        howToRead={
          lang === "zh"
            ? [
                "选多个分类（如「半导体」+「AI 软件」+「医疗器械」），后端自动去重 + 上限 30",
                "选预设：高 IV Rank、低 IV Rank、看涨/看跌资金流、一周内财报",
                "结果按实际信号数值排序；点击 ticker 直接打开仪表盘",
              ]
            : [
                "Pick multiple categories (e.g. Semis + AI Software + Med Devices); backend dedupes & caps at 30",
                "Choose a preset: high/low IV Rank, bullish/bearish flow, or earnings within 7 days",
                "Results ranked by raw signal value; click any ticker to open the dashboard",
              ]
        }
        whatItMeans={
          lang === "zh"
            ? [
                "高 IV Rank 适合卖方策略 (空头 strangle / iron condor)",
                "低 IV Rank 适合买方 (long straddle / 长期 call)",
                "异动 call 占比高常预示主力做多倾向",
              ]
            : [
                "High IV Rank → favor premium sellers (short strangles, iron condors)",
                "Low IV Rank → favor premium buyers (long straddles, long calls)",
                "High unusual call flow often signals smart-money bullish positioning",
              ]
        }
        actions={
          lang === "zh"
            ? [
                "用一周内财报扫出 IV 即将放大的标的，提前部署跨式",
                "高 IV Rank 中筛 OI 大的合约卖空 strangle，限制方向风险",
                "看涨资金流配合高 IV Rank 慎选 long call，可能买在最贵的时候",
              ]
            : [
                "Use 'earnings this week' to find IV expansion candidates and pre-position straddles",
                "From high IV Rank list, sell strangles on highest-OI strikes to cap directional risk",
                "Beware: bullish flow + high IV Rank means long calls are expensive — consider spreads",
              ]
        }
        caveat={lang === "zh" ? "仅美股期权数据；A股 / 港股标的会被自动跳过" : "US options only; A-share / HK tickers are skipped"}
        locale={locale}
      />
    </div>
  );
}
