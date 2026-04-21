"use client";

/**
 * StrategyScanner (Phase 6a)
 *
 * Data honesty:
 *   - Scans user-chosen tickers (default: their watchlist).
 *   - Each preset uses a transparent threshold computed from real data.
 *   - Fire-and-forget per ticker — a 429/500 on one ticker won't tank the rest.
 *   - Results are NOT ordered by a secret score: they're ordered by the
 *     actual signal value, so the user can reproduce the ranking.
 */

import { useCallback, useMemo, useState } from "react";
import { Radar, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useWatchlist } from "@/lib/watchlist";
import { runScanner } from "@/lib/api";
import type { ScannerPreset, ScannerResponse } from "@/lib/api";
import FeatureGuide from "./FeatureGuide";

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

const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD",
  "SPY", "QQQ", "IWM", "NFLX", "AVGO", "CRM", "BABA",
];

export default function StrategyScanner() {
  const { locale, searchTicker } = useAppStore();
  const { items: watchlistItems } = useWatchlist();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  const [preset, setPreset] = useState<ScannerPreset>("high_iv_rank");
  const [customTickers, setCustomTickers] = useState<string>("");
  const [useWatchlistUniverse, setUseWatchlistUniverse] = useState<boolean>(true);
  const [response, setResponse] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const universe = useMemo(() => {
    if (customTickers.trim()) {
      return customTickers
        .split(/[,\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
    }
    if (useWatchlistUniverse && watchlistItems.length > 0) {
      return watchlistItems.map((x) => x.ticker);
    }
    return DEFAULT_UNIVERSE;
  }, [customTickers, useWatchlistUniverse, watchlistItems]);

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
            <Radar className="w-4.5 h-4.5 text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--text-0)]">
              {lang === "zh" ? "策略扫描器" : "Strategy Scanner"}
            </h2>
            <p className="text-[11px] text-[var(--text-2)]">
              {lang === "zh"
                ? "公开阈值 · 真实数据 · 可复现排序"
                : "Transparent thresholds · Real data · Reproducible ranking"}
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 space-y-4">
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
                  <div
                    className={`text-xs font-semibold ${
                      active ? "text-[var(--accent-hot)]" : "text-[var(--text-0)]"
                    }`}
                  >
                    {copy.label}
                  </div>
                  <div className="text-[10px] text-[var(--text-2)] mt-0.5">{copy.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold mb-2 block">
            {lang === "zh" ? "扫描范围" : "Universe"}
          </label>
          <div className="flex items-center gap-3 mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--text-1)] cursor-pointer">
              <input
                type="checkbox"
                checked={useWatchlistUniverse}
                onChange={(e) => setUseWatchlistUniverse(e.target.checked)}
                className="cursor-pointer"
              />
              {lang === "zh"
                ? `使用自选股 (${watchlistItems.length})`
                : `Use watchlist (${watchlistItems.length})`}
            </label>
            <span className="text-[10px] text-[var(--text-2)]">
              {lang === "zh"
                ? "或粘贴自定义 ticker (空格/逗号分隔, 最多 30)"
                : "or paste custom tickers (comma/space separated, max 30)"}
            </span>
          </div>
          <input
            value={customTickers}
            onChange={(e) => setCustomTickers(e.target.value)}
            placeholder="AAPL, NVDA, TSLA..."
            className="w-full px-3 py-2 text-sm border border-[var(--line-soft)] rounded-lg bg-[var(--bg-2)] focus:outline-none focus:border-[var(--accent)] mono"
          />
          <div className="text-[10px] text-[var(--text-2)] mt-1.5">
            {lang === "zh" ? "即将扫描" : "Will scan"}:{" "}
            <span className="mono font-semibold text-[var(--text-1)]">
              {universe.slice(0, 10).join(", ")}
              {universe.length > 10 ? ` … (+${universe.length - 10})` : ""}
            </span>
          </div>
        </div>

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
                      <span className="mono font-bold text-sm text-[var(--text-0)]">
                        {hit.ticker}
                      </span>
                      {hit.spot_price ? (
                        <span className="text-[11px] text-[var(--text-2)] mono">
                          ${hit.spot_price.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-[var(--text-1)] mt-0.5">{hit.reason}</div>
                  </div>
                  <div className="text-right min-w-[90px]">
                    <div className="text-xs text-[var(--text-2)] uppercase tracking-wider">
                      {hit.signal_label}
                    </div>
                    <div className="text-sm mono font-semibold text-[var(--accent)]">
                      {typeof hit.signal_value === "number"
                        ? hit.signal_value.toFixed(1)
                        : hit.signal_value ?? "-"}
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
        locale={lang}
        title={lang === "zh" ? "策略扫描器" : "Strategy Scanner"}
        dataSource={
          lang === "zh"
            ? "IV Rank (滚动 HV 历史) · 期权链 volume+OI · Yahoo/Polygon 财报日。全部为真实公开数据, 无第三方情绪评分。"
            : "IV Rank (rolling HV history) · Chain volume+OI · Yahoo/Polygon earnings. All public real data, no 3rd-party sentiment."
        }
        howToRead={
          lang === "zh"
            ? [
                "High IV Rank (≥60): IV 处在历史前 40%, 期权 premium 偏贵",
                "Low IV Rank (≤30): IV 处在历史后 30%, 期权 premium 偏便宜",
                "异动资金: 异动合约总名义金额大于 $100K 才会触发",
                "Earnings week: 未来 7 天内发布财报的标的",
              ]
            : [
                "High IV Rank (≥60): IV in top 40% of history → premiums expensive",
                "Low IV Rank (≤30): IV in bottom 30% → premiums cheap",
                "Unusual flow: needs >$100K aggregate unusual notional to fire",
                "Earnings week: earnings date within next 7 days",
              ]
        }
        whatItMeans={
          lang === "zh"
            ? [
                "高 IV Rank → Iron Condor / Credit Spread / Covered Call 胜率更高",
                "低 IV Rank → Long Call / Long Put / Debit Spread 成本更低",
                "异动资金与价格趋势背离 → 警惕反转可能",
                "财报周 → 预期大波动, 建议用波动率中性策略",
              ]
            : [
                "High IV Rank → sell premium: Iron Condor, Credit Spread, Covered Call",
                "Low IV Rank → buy premium: Long Call / Put, Debit Spread",
                "Flow diverging from price → watch for reversal",
                "Earnings week → expect big moves, use vega-neutral structures",
              ]
        }
        actions={
          lang === "zh"
            ? [
                "点击命中的标的直接跳转到仪表盘, 做深度分析",
                "扫描器只是第一道漏斗, 最终仍需看 Greeks + 基本面",
                "扩大扫描范围可能发现小市值机会, 但流动性风险更大",
              ]
            : [
                "Click a hit to jump into the dashboard for full analysis",
                "Scanner is just the first filter — still check Greeks + fundamentals",
                "Wider universes surface small caps but carry liquidity risk",
              ]
        }
        caveat={
          lang === "zh"
            ? "扫描器仅筛选信号, 不构成买卖建议。单次扫描最多 30 个 ticker, 并发请求需要 5-15 秒。"
            : "Scanner only filters signals, not buy/sell advice. Max 30 tickers per scan; concurrent fetch takes 5–15s."
        }
      />
    </div>
  );
}
