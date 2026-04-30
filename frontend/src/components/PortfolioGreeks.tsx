"use client";

/**
 * PortfolioGreeks — aggregate Δ/Γ/Θ/ν across paper-portfolio positions
 * + risk scenarios (spot ±5%, IV ±5pts, crash, rally).
 *
 * Data flow:
 *   localStorage paper positions → POST /api/portfolio/greeks
 *   → backend fetches live spot + 30D HV per ticker, computes BSM Greeks,
 *     sums per leg with sign convention, and runs full revaluation under shocks.
 *
 * Design choices:
 *   - "Refresh" button is manual — Greeks change with spot but we don't
 *     want to silently spam the data API. User chooses when to update.
 *   - Scenario tiles use color tone based on sign for at-a-glance reading.
 *   - All numbers shown with $ and proper sign — no hidden absolute values.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity, RefreshCw, TrendingUp, TrendingDown, Minus, AlertCircle, Loader2,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { listPaperPositions } from "@/lib/paperPortfolio";
import {
  fetchPortfolioGreeks,
  type PortfolioGreeksResponse,
  type PortfolioGreeksPositionRequest,
} from "@/lib/api";

interface ScenarioMeta {
  key: string;
  label_en: string;
  label_zh: string;
  hint_en: string;
  hint_zh: string;
}

const SCENARIOS: ScenarioMeta[] = [
  { key: "spot_-5pct", label_en: "Spot −5%", label_zh: "股价 −5%", hint_en: "underlying drops 5%", hint_zh: "标的下跌 5%" },
  { key: "spot_-2pct", label_en: "Spot −2%", label_zh: "股价 −2%", hint_en: "underlying drops 2%", hint_zh: "标的下跌 2%" },
  { key: "spot_+2pct", label_en: "Spot +2%", label_zh: "股价 +2%", hint_en: "underlying up 2%", hint_zh: "标的上涨 2%" },
  { key: "spot_+5pct", label_en: "Spot +5%", label_zh: "股价 +5%", hint_en: "underlying up 5%", hint_zh: "标的上涨 5%" },
  { key: "iv_+5pts", label_en: "IV +5pts", label_zh: "IV +5pts", hint_en: "implied vol up 5%", hint_zh: "隐含波动率 +5%" },
  { key: "iv_-5pts", label_en: "IV −5pts", label_zh: "IV −5pts", hint_en: "implied vol down 5%", hint_zh: "隐含波动率 −5%" },
  { key: "crash", label_en: "Crash (-10% / +10pt IV)", label_zh: "暴跌 (-10% / +10pt IV)", hint_en: "VIX-spike scenario", hint_zh: "类 VIX 急升" },
  { key: "rally", label_en: "Rally (+5% / -5pt IV)", label_zh: "上涨 (+5% / -5pt IV)", hint_en: "risk-on rally", hint_zh: "风险偏好回升" },
];

export default function PortfolioGreeks() {
  const { locale } = useAppStore();
  const [data, setData] = useState<PortfolioGreeksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionCount, setPositionCount] = useState(0);

  const refresh = useCallback(async () => {
    const positions = listPaperPositions();
    setPositionCount(positions.length);

    if (positions.length === 0) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const requestPositions: PortfolioGreeksPositionRequest[] = positions.map((p) => ({
        ticker: p.ticker,
        legs: p.legs,
        dte_days: p.dte_days,
        entry_date: p.entry_date,
      }));
      const result = await fetchPortfolioGreeks(requestPositions);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isZh = locale === "zh";

  if (positionCount === 0) {
    return null; // Hide if no positions — PaperPortfolio empty state already handles this
  }

  return (
    <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-100 to-cyan-100 flex items-center justify-center">
            <Activity className="w-4.5 h-4.5 text-emerald-600" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight flex items-center gap-2">
              {isZh ? "投资组合希腊字母" : "Portfolio Greeks"}
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                NEW
              </span>
            </h3>
            <p className="text-[11px] text-[var(--text-2)] mt-0.5">
              {isZh
                ? `Δ/Γ/Θ/ν 聚合 · ${positionCount} 个仓位 · 实时 BSM 估算`
                : `Δ/Γ/Θ/ν aggregation · ${positionCount} positions · live BSM`}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="h-9 px-3 rounded-lg border border-[var(--line-mid)] text-xs font-semibold flex items-center gap-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {isZh ? "刷新" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-xs">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <span className="text-red-700">{error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Aggregated totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <GreekTile
              greek="Δ"
              label={isZh ? "净 Delta" : "Net Delta"}
              dollars={data.totals.delta_dollars}
              hint={isZh ? "$/$1 标的移动" : "$/$1 spot move"}
            />
            <GreekTile
              greek="Γ"
              label={isZh ? "净 Gamma" : "Net Gamma"}
              dollars={data.totals.gamma_dollars}
              hint={isZh ? "Δ 变化/$1 移动" : "Δ change/$1"}
            />
            <GreekTile
              greek="Θ"
              label={isZh ? "净 Theta" : "Net Theta"}
              dollars={data.totals.theta_dollars}
              hint={isZh ? "$/天 时间衰减" : "$/day time decay"}
            />
            <GreekTile
              greek="ν"
              label={isZh ? "净 Vega" : "Net Vega"}
              dollars={data.totals.vega_dollars}
              hint={isZh ? "$/1pt IV 变化" : "$/1pt IV change"}
            />
          </div>

          {/* Risk scenarios */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
                {isZh ? "风险情景模拟" : "Risk Scenarios"}
              </span>
              <div className="flex-1 h-px bg-[var(--line-soft)]" />
              <span className="text-[10px] text-[var(--text-2)]">
                {isZh ? "完整 BSM 重估" : "full BSM revaluation"}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {SCENARIOS.map((s) => {
                const pnl = data.scenarios[s.key];
                if (pnl === undefined) return null;
                return (
                  <ScenarioTile
                    key={s.key}
                    label={isZh ? s.label_zh : s.label_en}
                    pnl={pnl}
                    hint={isZh ? s.hint_zh : s.hint_en}
                  />
                );
              })}
            </div>
          </div>

          {/* Per-position breakdown */}
          {data.positions.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)] mb-2.5">
                {isZh ? "逐仓位分解" : "Per-Position Breakdown"}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left border-b border-[var(--line-soft)]">
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)]">{isZh ? "标的" : "Ticker"}</th>
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)]">{isZh ? "现价" : "Spot"}</th>
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)]">DTE</th>
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)] text-right">Δ$</th>
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)] text-right">Γ$</th>
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)] text-right">Θ$/d</th>
                      <th className="py-2 px-2 font-semibold text-[var(--text-2)] text-right">ν$/1pt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p, i) => (
                      <tr key={`${p.ticker}-${i}`} className="border-b border-[var(--line-soft)] last:border-0">
                        <td className="py-2 px-2 font-bold text-[var(--text-0)] mono">{p.ticker}</td>
                        <td className="py-2 px-2 mono">${p.spot_price.toFixed(2)}</td>
                        <td className="py-2 px-2 mono text-[var(--text-2)]">{p.dte_remaining}d</td>
                        <td className={`py-2 px-2 mono text-right font-semibold ${p.delta_dollars >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          ${p.delta_dollars.toFixed(0)}
                        </td>
                        <td className="py-2 px-2 mono text-right text-[var(--text-1)]">
                          ${p.gamma_dollars.toFixed(1)}
                        </td>
                        <td className={`py-2 px-2 mono text-right ${p.theta_dollars >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          ${p.theta_dollars.toFixed(2)}
                        </td>
                        <td className={`py-2 px-2 mono text-right ${p.vega_dollars >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          ${p.vega_dollars.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.fetch_errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-amber-900">
                <span className="font-semibold">{isZh ? "部分数据未能加载: " : "Partial data: "}</span>
                {data.fetch_errors.join("; ")}
              </div>
            </div>
          )}
        </>
      )}

      {!data && !loading && !error && positionCount > 0 && (
        <div className="text-center py-6 text-xs text-[var(--text-2)]">
          {isZh ? "点击刷新加载希腊字母" : "Click refresh to compute Greeks"}
        </div>
      )}
    </div>
  );
}

function GreekTile({ greek, label, dollars, hint }: { greek: string; label: string; dollars: number; hint: string }) {
  const tone = dollars > 0 ? "up" : dollars < 0 ? "down" : "neutral";
  const colorClass =
    tone === "up" ? "text-emerald-700" : tone === "down" ? "text-red-700" : "text-[var(--text-0)]";
  const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : Minus;
  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-gradient-to-br from-white to-[var(--bg-1)] p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">{label}</span>
        <span className="text-base font-bold text-[var(--text-2)]">{greek}</span>
      </div>
      <div className={`text-lg font-bold mono flex items-center gap-1 ${colorClass}`}>
        <Icon className="w-3.5 h-3.5" />
        {dollars >= 0 ? "+" : ""}${dollars.toFixed(0)}
      </div>
      <div className="text-[10px] text-[var(--text-2)] mt-0.5">{hint}</div>
    </div>
  );
}

function ScenarioTile({ label, pnl, hint }: { label: string; pnl: number; hint: string }) {
  const isPositive = pnl > 0;
  const isNegative = pnl < 0;
  const bgClass = isPositive ? "bg-emerald-50 border-emerald-200" : isNegative ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200";
  const textClass = isPositive ? "text-emerald-700" : isNegative ? "text-red-700" : "text-gray-700";
  return (
    <div className={`rounded-xl border p-2.5 ${bgClass}`}>
      <div className={`text-[10px] uppercase tracking-wide font-bold ${textClass}`}>{label}</div>
      <div className={`text-base font-bold mono mt-0.5 ${textClass}`}>
        {isPositive ? "+" : ""}${pnl.toFixed(0)}
      </div>
      <div className="text-[9.5px] text-[var(--text-2)] mt-0.5 leading-tight">{hint}</div>
    </div>
  );
}
