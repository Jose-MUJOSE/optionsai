"use client";

/**
 * Interactive payoff chart.
 *
 * The previous version rendered the backend-computed payoff curve and that's it.
 * This version adds a "What-If" mode where the user can drag each leg's strike
 * and quantity sliders to see how the curve changes in real time — without
 * a server round-trip.
 *
 * Math: at expiration, an option's value is its intrinsic value:
 *   call: max(spot - strike, 0)
 *   put:  max(strike - spot, 0)
 *
 * Net P&L per leg = (intrinsic - premium) × quantity × 100 × {+1 if BUY, -1 if SELL}.
 *
 * We don't try to reprice mid-life with BSM — that requires IV per leg and is
 * out of scope. The intrinsic-at-expiration assumption matches what the backend
 * already does and what beginner users expect.
 */

import { useMemo, useState, useCallback, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { Sparkles, RotateCcw } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import type { OptionLeg } from "@/types";

const PRICE_GRID_STEPS = 80;

/** Compute total P&L for a basket of legs at a given underlying price. */
function legsPnL(legs: OptionLeg[], spotPrice: number): number {
  let total = 0;
  for (const leg of legs) {
    const intrinsic = leg.option_type === "CALL"
      ? Math.max(spotPrice - leg.strike, 0)
      : Math.max(leg.strike - spotPrice, 0);
    const direction = leg.action === "BUY" ? 1 : -1;
    // Multiplier 100 = standard option contract size
    total += direction * (intrinsic - leg.premium) * leg.quantity * 100;
  }
  return total;
}

/** Find break-even prices by detecting zero crossings on the P&L curve. */
function findBreakevens(legs: OptionLeg[], priceLow: number, priceHigh: number): number[] {
  const breakevens: number[] = [];
  const steps = 400;
  const dx = (priceHigh - priceLow) / steps;
  let prevPrice = priceLow;
  let prevPnl = legsPnL(legs, prevPrice);
  for (let i = 1; i <= steps; i++) {
    const price = priceLow + i * dx;
    const pnl = legsPnL(legs, price);
    if ((prevPnl < 0 && pnl >= 0) || (prevPnl > 0 && pnl <= 0)) {
      // Linear interpolation for sub-step accuracy
      const t = prevPnl / (prevPnl - pnl);
      breakevens.push(prevPrice + t * dx);
    }
    prevPrice = price;
    prevPnl = pnl;
  }
  return breakevens;
}

export default function PayoffChart() {
  const { strategies, selectedStrategyIndex, marketData, targetPrice, locale } = useAppStore();
  const strategy = strategies[selectedStrategyIndex];

  // ---- Interactive editable copy of legs ----
  const [editLegs, setEditLegs] = useState<OptionLeg[]>([]);
  const [editMode, setEditMode] = useState(false);

  // Reset editLegs whenever the underlying strategy changes
  useEffect(() => {
    if (strategy?.legs) {
      setEditLegs(strategy.legs.map((l) => ({ ...l })));
      setEditMode(false);
    }
  }, [strategy]);

  const resetLegs = useCallback(() => {
    if (strategy?.legs) {
      setEditLegs(strategy.legs.map((l) => ({ ...l })));
    }
  }, [strategy]);

  const updateLeg = useCallback((index: number, patch: Partial<OptionLeg>) => {
    setEditLegs((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  // ---- Compute payoff curve ----
  const { chartData, breakevens, currentPnL, modified } = useMemo(() => {
    if (!strategy || !marketData) return { chartData: [], breakevens: [], currentPnL: 0, modified: false };

    const spot = marketData.spot_price;
    const legs = editMode ? editLegs : strategy.legs;
    if (!legs.length) return { chartData: [], breakevens: [], currentPnL: 0, modified: false };

    // Build a price grid: ±35% around spot, biased toward strikes
    const minStrike = Math.min(...legs.map((l) => l.strike));
    const maxStrike = Math.max(...legs.map((l) => l.strike));
    const priceLow = Math.min(spot * 0.65, minStrike * 0.85);
    const priceHigh = Math.max(spot * 1.35, maxStrike * 1.15);
    const dx = (priceHigh - priceLow) / PRICE_GRID_STEPS;

    const data: { price: number; pnl: number; profit: number; loss: number }[] = [];
    for (let i = 0; i <= PRICE_GRID_STEPS; i++) {
      const price = priceLow + i * dx;
      const pnl = legsPnL(legs, price);
      data.push({ price, pnl, profit: pnl > 0 ? pnl : 0, loss: pnl < 0 ? pnl : 0 });
    }

    const bes = findBreakevens(legs, priceLow, priceHigh);
    const curPnL = legsPnL(legs, spot);

    // Did the user actually change anything?
    const isModified = editMode && JSON.stringify(legs) !== JSON.stringify(strategy.legs);

    return { chartData: data, breakevens: bes, currentPnL: curPnL, modified: isModified };
  }, [strategy, marketData, editLegs, editMode]);

  if (!strategy || !marketData) return null;
  if (!chartData.length) return null;

  const spot = marketData.spot_price;
  const isZh = locale === "zh";

  return (
    <div className="w-full min-w-0 anim-fade-up">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-medium text-gray-500">
          {t("chart.title", locale)} &mdash; {locale === "zh" ? strategy.name : strategy.name_en}
          {modified && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              {isZh ? "已修改" : "MODIFIED"}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`h-8 px-3 text-[11px] font-semibold rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
              editMode
                ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm"
                : "bg-white border border-[var(--line-mid)] text-[var(--text-1)] hover:border-violet-400 hover:text-violet-600"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isZh ? (editMode ? "退出 What-If" : "What-If 模式") : (editMode ? "Exit What-If" : "What-If Mode")}
          </button>
          {editMode && modified && (
            <button
              onClick={resetLegs}
              className="h-8 px-3 text-[11px] font-semibold rounded-full bg-white border border-[var(--line-mid)] text-[var(--text-1)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              {isZh ? "重置" : "Reset"}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div style={{ width: "100%", height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 30 }}>
              <defs>
                <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="redGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="price"
                stroke="#d1d5db"
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                angle={-45}
                textAnchor="end"
                tickCount={8}
              />
              <YAxis
                stroke="#d1d5db"
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                  color: "#374151",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                }}
                formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, "P&L"]}
                labelFormatter={(label: unknown) => `Price: $${Number(label).toFixed(2)}`}
              />
              <Area type="monotone" dataKey="profit" stroke="#059669" fill="url(#greenGrad)" strokeWidth={0} />
              <Area type="monotone" dataKey="loss" stroke="#dc2626" fill="url(#redGrad)" strokeWidth={0} />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke={modified ? "#8b5cf6" : "#2563eb"}
                fill="none"
                strokeWidth={2.5}
              />
              <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="3 3" />
              <ReferenceLine
                x={chartData.reduce((prev, curr) =>
                  Math.abs(curr.price - spot) < Math.abs(prev.price - spot) ? curr : prev,
                ).price}
                stroke="#f59e0b"
                strokeDasharray="5 5"
                label={{
                  value: `${t("chart.currentPrice", locale)} $${spot.toFixed(0)}`,
                  fill: "#d97706",
                  fontSize: 11,
                  position: "top" as const,
                }}
              />
              {breakevens.map((be, i) => (
                <ReferenceLine
                  key={`be-${i}`}
                  x={chartData.reduce((prev, curr) =>
                    Math.abs(curr.price - be) < Math.abs(prev.price - be) ? curr : prev,
                  ).price}
                  stroke="#8b5cf6"
                  strokeDasharray="5 5"
                  label={{
                    value: `BE $${be.toFixed(0)}`,
                    fill: "#7c3aed",
                    fontSize: 11,
                    position: (["insideTopRight", "insideBottomRight"] as const)[i] || "insideTopRight",
                  }}
                />
              ))}
              {targetPrice && (
                <ReferenceLine
                  x={chartData.reduce((prev, curr) =>
                    Math.abs(curr.price - targetPrice) < Math.abs(prev.price - targetPrice) ? curr : prev,
                  ).price}
                  stroke="#059669"
                  strokeDasharray="5 5"
                  label={{
                    value: `${t("chart.target", locale)} $${targetPrice.toFixed(0)}`,
                    fill: "#059669",
                    fontSize: 11,
                    position: "insideTop" as const,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Live stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100">
          <StatTile
            label={isZh ? "当前价 P&L" : "P&L at Spot"}
            value={`$${currentPnL.toFixed(0)}`}
            color={currentPnL >= 0 ? "emerald" : "red"}
          />
          <StatTile
            label={isZh ? "盈亏平衡" : "Breakevens"}
            value={breakevens.length > 0 ? breakevens.map((b) => `$${b.toFixed(0)}`).join(" / ") : "—"}
            color="violet"
          />
          <StatTile
            label={isZh ? "最大盈利" : "Max Profit"}
            value={`$${Math.max(...chartData.map((d) => d.pnl)).toFixed(0)}`}
            color="emerald"
          />
          <StatTile
            label={isZh ? "最大亏损" : "Max Loss"}
            value={`$${Math.min(...chartData.map((d) => d.pnl)).toFixed(0)}`}
            color="red"
          />
        </div>

        {/* Leg editor — visible only in What-If mode */}
        {editMode && (
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3 anim-fade-up">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-violet-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700">
                {isZh ? "拖动滑块调整每条腿（仅本地预览，不改原策略）" : "Drag to adjust each leg (local preview only)"}
              </span>
            </div>
            <div className="space-y-3">
              {editLegs.map((leg, i) => (
                <LegEditor
                  key={i}
                  leg={leg}
                  originalLeg={strategy.legs[i]}
                  spotPrice={spot}
                  locale={locale}
                  onChange={(patch) => updateLeg(i, patch)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-center gap-6 mt-4 text-xs text-gray-400 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-500 inline-block rounded" /> {t("chart.currentPrice", locale)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-purple-500 inline-block rounded" /> {t("chart.breakeven", locale)}
          </span>
          {targetPrice && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" /> {t("chart.target", locale)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: "emerald" | "red" | "violet" }) {
  const colorClass = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    violet: "text-violet-600",
  }[color];
  return (
    <div className="rounded-xl bg-gray-50/60 border border-gray-100 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">{label}</div>
      <div className={`text-base font-bold mt-1 mono ${colorClass}`}>{value}</div>
    </div>
  );
}

function LegEditor({
  leg,
  originalLeg,
  spotPrice,
  locale,
  onChange,
}: {
  leg: OptionLeg;
  originalLeg: OptionLeg | undefined;
  spotPrice: number;
  locale: "zh" | "en";
  onChange: (patch: Partial<OptionLeg>) => void;
}) {
  const isZh = locale === "zh";
  // Strike slider: ±25% of spot, in $0.50 steps for fine control near ATM
  const strikeMin = Math.max(1, spotPrice * 0.75);
  const strikeMax = spotPrice * 1.25;
  const strikeStep = spotPrice >= 100 ? 1 : 0.5;
  const isModified = originalLeg && (leg.strike !== originalLeg.strike || leg.quantity !== originalLeg.quantity);

  const actionColor = leg.action === "BUY"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-red-50 text-red-700 border-red-200";
  const typeColor = leg.option_type === "CALL"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <div className={`rounded-xl border p-3 transition-all ${
      isModified ? "border-violet-300 bg-violet-50/40" : "border-gray-200 bg-white"
    }`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[11px] text-gray-500 font-semibold">
          {isZh ? `第 ${1} 条腿` : `Leg`}
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${actionColor}`}>
          {leg.action}
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColor}`}>
          {leg.option_type}
        </span>
        <span className="text-[10px] text-gray-500 mono">
          {isZh ? "权利金" : "Premium"} ${leg.premium.toFixed(2)}
        </span>
        {isModified && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-200 text-violet-800 ml-auto">
            {isZh ? "已改" : "MOD"}
          </span>
        )}
      </div>

      {/* Strike slider */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
            {isZh ? "行权价" : "Strike"}
          </span>
          <span className="text-[12px] font-bold mono text-gray-700">
            ${leg.strike.toFixed(2)}
            {originalLeg && originalLeg.strike !== leg.strike && (
              <span className="ml-1 text-[10px] text-gray-400">({originalLeg.strike.toFixed(2)})</span>
            )}
          </span>
        </div>
        <input
          type="range"
          min={strikeMin}
          max={strikeMax}
          step={strikeStep}
          value={leg.strike}
          onChange={(e) => onChange({ strike: Number(e.target.value) })}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
        <div className="flex justify-between text-[9px] text-gray-400 mono">
          <span>${strikeMin.toFixed(0)}</span>
          <span>${spotPrice.toFixed(0)} ATM</span>
          <span>${strikeMax.toFixed(0)}</span>
        </div>
      </div>

      {/* Quantity slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
            {isZh ? "合约数" : "Contracts"}
          </span>
          <span className="text-[12px] font-bold mono text-gray-700">
            {leg.quantity}
            {originalLeg && originalLeg.quantity !== leg.quantity && (
              <span className="ml-1 text-[10px] text-gray-400">({originalLeg.quantity})</span>
            )}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={leg.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) })}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
      </div>
    </div>
  );
}
