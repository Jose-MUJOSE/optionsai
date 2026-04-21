"use client";

/**
 * StrategyBacktest — 期权策略历史回测 (Phase 3)
 *
 * 数据诚实性:
 *   - 股价回放: 100% 真实 Yahoo Finance OHLCV
 *   - 期权价格: Black-Scholes 理论价, 明确标注 "理论价 (BSM)" 而非历史成交价
 *   - σ: 滚动 30 日真实已实现波动率
 *   - r: 4.5% (T-bill 近似假设)
 *
 * 禁止: 伪造历史期权成交价、隐藏 BSM 假设
 */

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { PlayCircle, Loader2, TrendingUp, TrendingDown, Plus, Info } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import FeatureGuide from "./FeatureGuide";
import { runBacktest, type BacktestResponse, type BacktestStrategy } from "@/lib/api";
import { addPaperPosition } from "@/lib/paperPortfolio";

const STRATEGIES: { value: BacktestStrategy; zh: string; en: string }[] = [
  { value: "long_call", zh: "买入看涨 (Long Call)", en: "Long Call" },
  { value: "long_put", zh: "买入看跌 (Long Put)", en: "Long Put" },
  { value: "short_call", zh: "卖出看涨 (Short Call)", en: "Short Call" },
  { value: "short_put", zh: "卖出看跌 (Short Put)", en: "Short Put" },
  { value: "bull_call_spread", zh: "牛市看涨价差", en: "Bull Call Spread" },
  { value: "bear_put_spread", zh: "熊市看跌价差", en: "Bear Put Spread" },
  { value: "long_straddle", zh: "买入跨式 (Long Straddle)", en: "Long Straddle" },
  { value: "short_strangle", zh: "卖出宽跨式 (Short Strangle)", en: "Short Strangle" },
];

const DTE_CHOICES = [7, 14, 30, 45, 60, 90];
const HOLD_PERCENT_CHOICES = [25, 50, 75, 100];

export default function StrategyBacktest() {
  const { marketData, locale } = useAppStore();
  const ticker = marketData?.ticker ?? null;

  const [strategy, setStrategy] = useState<BacktestStrategy>("long_call");
  const [dte, setDte] = useState(30);
  const [holdPct, setHoldPct] = useState(100);
  const [entryDate, setEntryDate] = useState<string>("");
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const holdDays = Math.max(1, Math.floor((dte * holdPct) / 100));
      const r = await runBacktest(ticker, {
        strategy_type: strategy,
        entry_date: entryDate || null,
        dte_days: dte,
        hold_days: holdDays,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reset when ticker changes
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [ticker]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.bars.map((b) => ({
      date: b.date.slice(5),
      pnl: b.pnl_per_contract,
      spot: b.spot,
      pnl_pct: b.pnl_pct,
    }));
  }, [result]);

  if (!ticker) return null;

  const isWin = result ? result.final_pnl_per_contract > 0 : false;

  return (
    <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
            <PlayCircle className="w-4 h-4 text-[var(--accent)]" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
              {locale === "zh" ? "策略历史回测" : "Strategy Backtest"}
            </h3>
            <p className="text-[11px] text-[var(--text-2)] mt-0.5">
              {locale === "zh"
                ? "真实股价回放 · BSM 理论期权价"
                : "Real price replay · BSM theoretical pricing"}
            </p>
          </div>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
          {locale === "zh" ? "理论价 · 非历史成交价" : "Theoretical · Not Historical Fills"}
        </span>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
            {locale === "zh" ? "策略类型" : "Strategy"}
          </span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as BacktestStrategy)}
            className="h-9 px-2.5 rounded-lg border border-[var(--line-soft)] bg-white text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {locale === "zh" ? s.zh : s.en}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
            DTE
          </span>
          <select
            value={dte}
            onChange={(e) => setDte(Number(e.target.value))}
            className="h-9 px-2.5 rounded-lg border border-[var(--line-soft)] bg-white text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            {DTE_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d}d
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
            {locale === "zh" ? "持仓" : "Hold"}
          </span>
          <select
            value={holdPct}
            onChange={(e) => setHoldPct(Number(e.target.value))}
            className="h-9 px-2.5 rounded-lg border border-[var(--line-soft)] bg-white text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            {HOLD_PERCENT_CHOICES.map((p) => (
              <option key={p} value={p}>
                {p}% DTE
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
            {locale === "zh" ? "进场日 (可选)" : "Entry (opt)"}
          </span>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-[var(--line-soft)] bg-white text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={run}
          disabled={loading}
          className="h-9 px-4 rounded-lg bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white text-xs font-semibold flex items-center gap-2 hover:shadow-[var(--shadow-blue)] disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
          {locale === "zh" ? "运行回测" : "Run Backtest"}
        </button>
        {result && (
          <button
            onClick={() => {
              addPaperPosition({
                id: `${ticker}-${strategy}-${Date.now()}`,
                ticker,
                strategy_type: strategy,
                entry_date: result.entry_date,
                entry_spot: result.initial_spot,
                entry_price: result.initial_price_per_share,
                dte_days: dte,
                hold_days: Math.max(1, Math.floor((dte * holdPct) / 100)),
                legs: result.legs,
                created_at: new Date().toISOString(),
              });
              alert(locale === "zh" ? "已加入模拟仓位" : "Added to paper portfolio");
            }}
            className="h-9 px-3 rounded-lg border border-[var(--accent)] text-[var(--accent-hot)] text-xs font-semibold flex items-center gap-2 hover:bg-[var(--accent-soft)] transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {locale === "zh" ? "加入模拟仓位" : "Add to Paper Portfolio"}
          </button>
        )}
        {error && (
          <span className="text-xs text-red-600 font-medium">
            {error}
          </span>
        )}
      </div>

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Stat label={locale === "zh" ? "进场价" : "Entry premium"} value={`$${result.initial_price_per_share.toFixed(2)}`} hint={locale === "zh" ? "BSM 理论价" : "BSM theoretical"} />
            <Stat label={locale === "zh" ? "出场价" : "Exit premium"} value={`$${result.exit_price_per_share.toFixed(2)}`} hint={locale === "zh" ? "BSM 理论价" : "BSM theoretical"} />
            <Stat label={locale === "zh" ? "最终 P&L" : "Final P&L"} value={`$${result.final_pnl_per_contract.toFixed(0)}`} tone={isWin ? "up" : "down"} hint={`${result.final_pnl_pct.toFixed(1)}%`} />
            <Stat label={locale === "zh" ? "峰值 P&L" : "Peak P&L"} value={`$${result.max_pnl_per_contract.toFixed(0)}`} tone="up" />
            <Stat label={locale === "zh" ? "谷值 P&L" : "Trough P&L"} value={`$${result.min_pnl_per_contract.toFixed(0)}`} tone="down" />
          </div>

          {/* P&L curve */}
          <div className="h-64 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-2)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-2)" }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid var(--line-soft)", borderRadius: 8, fontSize: 12 }}
                  formatter={(value, name) => {
                    const v = typeof value === "number" ? value : Number(value);
                    const key = String(name ?? "");
                    if (!Number.isFinite(v)) return [String(value ?? ""), key];
                    if (key === "pnl") return [`$${v.toFixed(2)}`, locale === "zh" ? "每合约 P&L" : "P&L/contract"];
                    if (key === "spot") return [`$${v.toFixed(2)}`, locale === "zh" ? "股价" : "Spot"];
                    return [String(v), key];
                  }}
                />
                <ReferenceLine y={0} stroke="var(--line-mid)" strokeDasharray="2 4" />
                <Line type="monotone" dataKey="pnl" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legs summary */}
          <div className="text-[11px] text-[var(--text-2)] mb-3 leading-relaxed">
            <span className="font-semibold text-[var(--text-1)]">
              {locale === "zh" ? "腿配置: " : "Legs: "}
            </span>
            {result.legs.map((l, i) => (
              <span key={i}>
                {i > 0 && " + "}
                {l.action === "buy" ? "+" : "-"}
                {l.quantity} {l.opt_type.toUpperCase()} @ ${l.strike}
              </span>
            ))}
          </div>

          {/* Honest disclaimer */}
          <div className="text-[11px] bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-amber-900 leading-relaxed">
              <span className="font-semibold">{locale === "zh" ? "数据声明: " : "Data disclosure: "}</span>
              {String(result.data_sources?.disclaimer ?? "")}
            </div>
          </div>
        </>
      )}

      <FeatureGuide
        title={locale === "zh" ? "策略历史回测" : "Strategy Backtest"}
        locale={locale}
        dataSource={
          locale === "zh"
            ? "股价回放: Yahoo Finance 1D OHLCV (100% 真实); 期权定价: Black-Scholes 理论价 (非历史成交价); σ: 滚动 30 日真实已实现波动率; r: 4.5% (T-bill 假设)"
            : "Spot replay: Yahoo Finance 1D OHLCV (100% real); Option pricing: Black-Scholes theoretical (NOT historical fills); σ: rolling 30-day realized volatility; r: 4.5% (T-bill assumption)"
        }
        howToRead={[
          locale === "zh"
            ? "曲线是策略从进场到结束期间每合约的理论盈亏"
            : "The curve is theoretical P&L per contract from entry to exit",
          locale === "zh"
            ? "峰值/谷值展示你若选择最佳/最差时机离场时的收益"
            : "Peak/trough shows P&L if you exited at best/worst moment",
          locale === "zh"
            ? "进场/出场价 = BSM 理论价, 实际市场会因买卖价差、波动率微笑偏离"
            : "Entry/exit prices = BSM theoretical; real market differs due to bid-ask spread & volatility smile",
        ]}
        whatItMeans={[
          locale === "zh"
            ? "回测是基于历史路径的情景分析, 不是未来收益的承诺"
            : "Backtest is a scenario analysis on historical paths, not a future-return promise",
          locale === "zh"
            ? "BSM 假设恒定波动率与对数正态分布, 在重大事件 (财报/并购) 前后会失真"
            : "BSM assumes constant vol & log-normal returns — breaks around earnings/M&A",
          locale === "zh"
            ? "真实交易需考虑手续费 (~$0.65/合约)、滑点与资金占用"
            : "Real trading adds commissions (~$0.65/contract), slippage & capital tied up",
        ]}
        actions={[
          locale === "zh"
            ? "先用 long_straddle 回测, 看看历史上财报前后的理论收益轨迹"
            : "Backtest long_straddle first to see theoretical P&L around past earnings",
          locale === "zh"
            ? "改变 DTE (7/30/60), 观察 θ 衰减速率的影响"
            : "Vary DTE (7/30/60) to observe θ (time-decay) impact",
          locale === "zh"
            ? "若想追踪后续表现, 点击'加入模拟仓位'会保存到本地 (不推向真实券商)"
            : "Click 'Add to Paper Portfolio' to track hypothetically — saved locally, never sent to a broker",
        ]}
        caveat={
          locale === "zh"
            ? "BSM 理论价仅用于研究, 永远不要当作历史成交数据使用。真实期权成交价可能因流动性、事件风险、分红调整而显著不同。"
            : "BSM theoretical pricing is for research only. Real historical fills can differ materially due to liquidity, event risk, and dividend adjustments."
        }
      />
    </div>
  );
}

// -------- Helpers ---------

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const color =
    tone === "up"
      ? "text-[var(--fin-up)]"
      : tone === "down"
      ? "text-[var(--fin-down)]"
      : "text-[var(--text-0)]";
  const icon =
    tone === "up" ? (
      <TrendingUp className="w-3 h-3" />
    ) : tone === "down" ? (
      <TrendingDown className="w-3 h-3" />
    ) : null;
  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-gradient-to-br from-white to-[var(--bg-1)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
        {label}
      </div>
      <div className={`text-lg font-bold mono mt-1 flex items-center gap-1 ${color}`}>
        {icon}
        {value}
      </div>
      {hint && <div className="text-[10px] text-[var(--text-2)] mt-0.5">{hint}</div>}
    </div>
  );
}
