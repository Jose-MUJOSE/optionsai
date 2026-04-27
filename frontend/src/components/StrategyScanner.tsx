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

// ---------- Universe categories ----------
// Curated US-only baskets. Keeping each under ~30 tickers so a single scan
// stays under the rate-limit budget for free Yahoo / Polygon endpoints.

type CategoryKey =
  | "watchlist"
  | "mag7"
  | "dow30"
  | "sp50"
  | "ndx_top"
  | "etf_core"
  | "semiconductors"
  | "ai_software"
  | "banks"
  | "healthcare"
  | "energy"
  | "consumer"
  | "ev_auto"
  | "biotech"
  | "china_adr"
  | "custom";

const CATEGORY_TICKERS: Record<Exclude<CategoryKey, "watchlist" | "custom">, string[]> = {
  // The Magnificent Seven — most liquid tech mega-caps
  mag7: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
  // Dow Jones Industrial Average components (curated subset)
  dow30: [
    "AAPL", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
    "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM",
    "MRK", "MSFT", "NKE", "PG", "TRV", "UNH", "V", "VZ", "WBA", "WMT",
  ],
  // Top S&P 500 by weight
  sp50: [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "BRK.B",
    "AVGO", "TSLA", "JPM", "LLY", "V", "XOM", "MA", "UNH", "COST",
    "WMT", "PG", "JNJ", "HD", "ABBV", "NFLX", "BAC", "CRM", "MRK",
    "CVX", "ORCL", "AMD", "KO",
  ],
  // Nasdaq-100 top names
  ndx_top: [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO",
    "COST", "NFLX", "PEP", "ADBE", "AMD", "CSCO", "TMUS", "CMCSA",
    "QCOM", "INTU", "TXN", "AMGN", "ISRG", "BKNG", "GILD", "MU",
  ],
  // Major broad-market & sector ETFs
  etf_core: ["SPY", "QQQ", "IWM", "DIA", "VTI", "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "GLD", "TLT", "ARKK"],
  // Semiconductor leaders
  semiconductors: ["NVDA", "AVGO", "AMD", "TSM", "QCOM", "INTC", "MU", "AMAT", "LRCX", "ASML", "KLAC", "MRVL", "ON", "ARM"],
  // AI software & cloud
  ai_software: ["MSFT", "GOOGL", "META", "ORCL", "CRM", "ADBE", "PLTR", "NOW", "SNOW", "DDOG", "MDB", "NET", "CRWD"],
  // Big banks & financials
  banks: ["JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "SCHW", "AXP", "USB", "PNC"],
  // Healthcare & pharma
  healthcare: ["UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY", "AMGN", "GILD"],
  // Energy
  energy: ["XOM", "CVX", "COP", "OXY", "SLB", "EOG", "MPC", "PSX", "VLO"],
  // Consumer staples + discretionary leaders
  consumer: ["AMZN", "WMT", "COST", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "BKNG", "DIS"],
  // EV & auto
  ev_auto: ["TSLA", "F", "GM", "RIVN", "LCID", "NIO", "XPEV", "LI", "TM"],
  // Biotech
  biotech: ["AMGN", "GILD", "REGN", "VRTX", "BIIB", "MRNA", "ILMN", "INCY"],
  // China ADRs (US-listed)
  china_adr: ["BABA", "PDD", "JD", "NIO", "BIDU", "TME", "BILI", "TCOM"],
};

interface CategoryMeta {
  zh: { label: string; desc: string };
  en: { label: string; desc: string };
}

const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  watchlist:    { zh: { label: "我的自选", desc: "扫描自选列表" },           en: { label: "My Watchlist",     desc: "Scan your saved tickers" } },
  mag7:         { zh: { label: "科技七雄", desc: "Magnificent 7 大科技" }, en: { label: "Magnificent 7",    desc: "Top 7 tech mega-caps" } },
  dow30:        { zh: { label: "道指 30",  desc: "道琼斯工业指数成份" },    en: { label: "Dow 30",           desc: "Dow Jones constituents" } },
  sp50:         { zh: { label: "标普 50",  desc: "S&P 500 头部权重股" },    en: { label: "S&P Top 50",       desc: "Top S&P 500 by weight" } },
  ndx_top:      { zh: { label: "纳指领头", desc: "纳斯达克 100 主力" },     en: { label: "Nasdaq Top",       desc: "Nasdaq-100 leaders" } },
  etf_core:     { zh: { label: "核心 ETF", desc: "宽基 + 行业 ETF" },        en: { label: "Core ETFs",        desc: "Broad + sector ETFs" } },
  semiconductors:{ zh:{ label: "半导体",   desc: "AI / 芯片产业链" },        en: { label: "Semiconductors",   desc: "AI & chip supply chain" } },
  ai_software:  { zh: { label: "AI 软件",  desc: "云 + AI 软件巨头" },       en: { label: "AI Software",      desc: "Cloud & AI leaders" } },
  banks:        { zh: { label: "银行金融", desc: "大银行 + 投行" },          en: { label: "Banks",            desc: "Big banks & broker-dealers" } },
  healthcare:   { zh: { label: "医疗健康", desc: "制药 + 医疗器械" },        en: { label: "Healthcare",       desc: "Pharma & med devices" } },
  energy:       { zh: { label: "能源",     desc: "石油 + 能源服务" },        en: { label: "Energy",           desc: "Oil & energy services" } },
  consumer:     { zh: { label: "消费",     desc: "必选 + 可选消费" },        en: { label: "Consumer",         desc: "Staples & discretionary" } },
  ev_auto:      { zh: { label: "电车汽车", desc: "EV + 传统车企" },          en: { label: "EV & Auto",        desc: "EV + legacy automakers" } },
  biotech:      { zh: { label: "生物技术", desc: "生物科技龙头" },           en: { label: "Biotech",          desc: "Top biotech names" } },
  china_adr:    { zh: { label: "中概股",   desc: "美股上市中国公司" },       en: { label: "China ADRs",       desc: "US-listed Chinese companies" } },
  custom:       { zh: { label: "自定义",   desc: "粘贴自己的 ticker" },      en: { label: "Custom",           desc: "Paste your own tickers" } },
};

// Order in the grid — popular categories first
const CATEGORY_ORDER: CategoryKey[] = [
  "watchlist", "mag7", "ndx_top", "sp50", "dow30", "etf_core",
  "semiconductors", "ai_software", "banks", "healthcare",
  "energy", "consumer", "ev_auto", "biotech", "china_adr", "custom",
];

const DEFAULT_UNIVERSE = CATEGORY_TICKERS.mag7;

export default function StrategyScanner() {
  const { locale, searchTicker } = useAppStore();
  const { items: watchlistItems } = useWatchlist();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  const [preset, setPreset] = useState<ScannerPreset>("high_iv_rank");
  const [category, setCategory] = useState<CategoryKey>("mag7");
  const [customTickers, setCustomTickers] = useState<string>("");
  const [response, setResponse] = useState<ScannerResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Resolve the active universe from the selected category.
   * - "watchlist" → user's saved watchlist
   * - "custom"    → comma/space-separated ticker list
   * - everything else → CATEGORY_TICKERS[key]
   */
  const universe = useMemo(() => {
    if (category === "watchlist") {
      return watchlistItems.length > 0 ? watchlistItems.map((x) => x.ticker) : DEFAULT_UNIVERSE;
    }
    if (category === "custom") {
      return customTickers
        .split(/[,\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 30);
    }
    return CATEGORY_TICKERS[category];
  }, [category, customTickers, watchlistItems]);

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
            {lang === "zh" ? "扫描板块" : "Scan category"}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {CATEGORY_ORDER.map((key) => {
              const meta = CATEGORY_META[key][lang];
              const active = category === key;
              const count =
                key === "watchlist"
                  ? watchlistItems.length
                  : key === "custom"
                  ? customTickers.split(/[,\s]+/).filter(Boolean).length
                  : CATEGORY_TICKERS[key].length;
              const disabled = key === "watchlist" && watchlistItems.length === 0;
              return (
                <button
                  key={key}
                  onClick={() => !disabled && setCategory(key)}
                  disabled={disabled}
                  className={`text-left rounded-lg border px-2.5 py-2 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--shadow-blue)]"
                      : "border-[var(--line-soft)] hover:bg-[var(--bg-2)] hover:border-[var(--accent)]/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={`text-[12px] font-bold ${active ? "text-[var(--accent-hot)]" : "text-[var(--text-0)]"} truncate`}>
                      {meta.label}
                    </span>
                    {count > 0 && key !== "custom" && (
                      <span
                        className={`text-[9px] font-bold mono px-1.5 py-0.5 rounded-full shrink-0 ${
                          active
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--bg-2)] text-[var(--text-2)]"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-2)] mt-0.5 truncate">{meta.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Custom ticker input — only shown when "custom" category is selected */}
          {category === "custom" && (
            <div className="mt-3 anim-fade-up">
              <input
                value={customTickers}
                onChange={(e) => setCustomTickers(e.target.value)}
                placeholder={lang === "zh" ? "粘贴 ticker (空格/逗号分隔, 最多 30)" : "AAPL, NVDA, TSLA... (max 30)"}
                className="w-full px-3 py-2 text-sm border border-[var(--line-soft)] rounded-lg bg-[var(--bg-2)] focus:outline-none focus:border-[var(--accent)] mono"
              />
            </div>
          )}

          {/* Resolved universe preview */}
          <div className="text-[10px] text-[var(--text-2)] mt-2.5 leading-relaxed">
            {lang === "zh" ? "即将扫描" : "Will scan"}{" "}
            <span className="font-semibold text-[var(--text-1)]">({universe.length})</span>
            : <span className="mono font-semibold text-[var(--text-1)]">
              {universe.slice(0, 12).join(", ")}
              {universe.length > 12 ? ` … (+${universe.length - 12})` : ""}
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
