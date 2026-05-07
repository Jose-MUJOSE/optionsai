"use client";

/**
 * Payoff chart for the Trader Agent's options decision.
 *
 * Inputs: the structured `option_legs` produced by the PM in OPTIONS mode,
 * plus the underlying spot price.
 *
 * What-If mode lets the user drag each leg's strike + quantity sliders.
 * Max P/L, breakeven and payoff curve all recompute live in the browser
 * — no backend round-trip needed.
 *
 * Math: at expiration, each option is worth its intrinsic value, and the
 * net P&L per leg is `(intrinsic - premium) * qty * 100 * sign(side)`.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Sparkles, RotateCcw } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { TraderOptionLeg } from "@/lib/api";

const PRICE_GRID_STEPS = 80;

function legPnL(leg: TraderOptionLeg, spot: number): number {
  const intrinsic =
    leg.type === "call" ? Math.max(spot - leg.strike, 0) : Math.max(leg.strike - spot, 0);
  const direction = leg.side === "buy" ? 1 : -1;
  return direction * (intrinsic - leg.premium) * leg.quantity * 100;
}

function legsPnL(legs: TraderOptionLeg[], spot: number): number {
  return legs.reduce((sum, leg) => sum + legPnL(leg, spot), 0);
}

function findBreakevens(legs: TraderOptionLeg[], priceLow: number, priceHigh: number): number[] {
  const breakevens: number[] = [];
  const steps = 400;
  const dx = (priceHigh - priceLow) / steps;
  let prevPrice = priceLow;
  let prevPnl = legsPnL(legs, prevPrice);
  for (let i = 1; i <= steps; i++) {
    const price = priceLow + i * dx;
    const pnl = legsPnL(legs, price);
    if ((prevPnl < 0 && pnl >= 0) || (prevPnl > 0 && pnl <= 0)) {
      const ratio = prevPnl / (prevPnl - pnl);
      breakevens.push(prevPrice + ratio * dx);
    }
    prevPrice = price;
    prevPnl = pnl;
  }
  return breakevens;
}

interface TraderPayoffChartProps {
  legs: TraderOptionLeg[];
  spotPrice: number;
  locale: Locale;
}

export default function TraderPayoffChart({ legs, spotPrice, locale }: TraderPayoffChartProps) {
  // Prop-derived state with the React 19+ blessed reset pattern: track
  // the previous prop in state and reset on identity change without an effect.
  const [editLegs, setEditLegs] = useState<TraderOptionLeg[]>(() => legs.map((l) => ({ ...l })));
  const [editMode, setEditMode] = useState(false);
  const [prevLegsRef, setPrevLegsRef] = useState(legs);
  if (legs !== prevLegsRef) {
    setPrevLegsRef(legs);
    setEditLegs(legs.map((l) => ({ ...l })));
    setEditMode(false);
  }

  const resetLegs = useCallback(() => {
    setEditLegs(legs.map((l) => ({ ...l })));
  }, [legs]);

  const updateLeg = useCallback((index: number, patch: Partial<TraderOptionLeg>) => {
    setEditLegs((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  const isZh = locale === "zh";

  const { chartData, breakevens, currentPnL, modified, maxProfit, maxLoss } = useMemo(() => {
    if (!legs.length || !spotPrice) {
      return {
        chartData: [],
        breakevens: [],
        currentPnL: 0,
        modified: false,
        maxProfit: 0,
        maxLoss: 0,
      };
    }
    const activeLegs = editMode ? editLegs : legs;
    if (!activeLegs.length) {
      return {
        chartData: [],
        breakevens: [],
        currentPnL: 0,
        modified: false,
        maxProfit: 0,
        maxLoss: 0,
      };
    }

    const minStrike = Math.min(...activeLegs.map((l) => l.strike));
    const maxStrike = Math.max(...activeLegs.map((l) => l.strike));
    const priceLow = Math.min(spotPrice * 0.65, minStrike * 0.85);
    const priceHigh = Math.max(spotPrice * 1.35, maxStrike * 1.15);
    const dx = (priceHigh - priceLow) / PRICE_GRID_STEPS;

    const data: { price: number; pnl: number; profit: number; loss: number }[] = [];
    for (let i = 0; i <= PRICE_GRID_STEPS; i++) {
      const price = priceLow + i * dx;
      const pnl = legsPnL(activeLegs, price);
      data.push({ price, pnl, profit: pnl > 0 ? pnl : 0, loss: pnl < 0 ? pnl : 0 });
    }

    const bes = findBreakevens(activeLegs, priceLow, priceHigh);
    const curPnL = legsPnL(activeLegs, spotPrice);
    const isModified = editMode && JSON.stringify(activeLegs) !== JSON.stringify(legs);
    const mp = data.reduce((m, d) => Math.max(m, d.pnl), -Infinity);
    const ml = data.reduce((m, d) => Math.min(m, d.pnl), Infinity);

    return {
      chartData: data,
      breakevens: bes,
      currentPnL: curPnL,
      modified: isModified,
      maxProfit: mp,
      maxLoss: ml,
    };
  }, [legs, spotPrice, editMode, editLegs]);

  if (!legs.length || !spotPrice || !chartData.length) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-800">
        {isZh
          ? "盈亏图渲染失败：投资经理未提供结构化期权腿数据。"
          : "Payoff chart unavailable: PM did not provide structured option_legs."}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white p-4 anim-fade-up">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700">
            {isZh ? "盈亏图（到期日）" : "Payoff at Expiration"}
          </span>
          {modified && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-200 text-violet-800">
              {isZh ? "已修改" : "MODIFIED"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`h-7 px-2.5 text-[10.5px] font-semibold rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
              editMode
                ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm"
                : "bg-white border border-violet-200 text-violet-700 hover:border-violet-400"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {isZh
              ? editMode
                ? "退出 What-If"
                : "What-If 模式"
              : editMode
                ? "Exit What-If"
                : "What-If Mode"}
          </button>
          {editMode && modified && (
            <button
              onClick={resetLegs}
              className="h-7 px-2.5 text-[10.5px] font-semibold rounded-full bg-white border border-violet-200 text-violet-700 hover:border-violet-400 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              {isZh ? "重置" : "Reset"}
            </button>
          )}
        </div>
      </div>

      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
            <defs>
              <linearGradient id="trader-greenGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#059669" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#059669" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="trader-redGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="5%" stopColor="#dc2626" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="price"
              stroke="#cbd5e1"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              tickCount={7}
            />
            <YAxis
              stroke="#cbd5e1"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}
              formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, "P&L"]}
              labelFormatter={(label: unknown) => `Price: $${Number(label).toFixed(2)}`}
            />
            <Area type="monotone" dataKey="profit" stroke="#059669" fill="url(#trader-greenGrad)" strokeWidth={0} />
            <Area type="monotone" dataKey="loss" stroke="#dc2626" fill="url(#trader-redGrad)" strokeWidth={0} />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke={modified ? "#8b5cf6" : "#2563eb"}
              fill="none"
              strokeWidth={2.2}
            />
            <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
            <ReferenceLine
              x={chartData.reduce((prev, curr) =>
                Math.abs(curr.price - spotPrice) < Math.abs(prev.price - spotPrice) ? curr : prev,
              ).price}
              stroke="#f59e0b"
              strokeDasharray="5 5"
              label={{
                value: `${t("chart.currentPrice", locale)} $${spotPrice.toFixed(0)}`,
                fill: "#d97706",
                fontSize: 10,
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
                  fontSize: 10,
                  position: (["insideTopRight", "insideBottomRight"] as const)[i] || "insideTopRight",
                }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-violet-100">
        <StatTile
          label={isZh ? "现价 P&L" : "P&L at Spot"}
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
          value={Number.isFinite(maxProfit) ? `$${maxProfit.toFixed(0)}` : "—"}
          color="emerald"
        />
        <StatTile
          label={isZh ? "最大亏损" : "Max Loss"}
          value={Number.isFinite(maxLoss) ? `$${maxLoss.toFixed(0)}` : "—"}
          color="red"
        />
      </div>

      {editMode && (
        <div className="mt-3 pt-3 border-t border-violet-100 space-y-2.5 anim-fade-up">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-violet-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
              {isZh
                ? "拖动滑块调整每条腿（仅本地预览）"
                : "Drag sliders to adjust each leg (preview only)"}
            </span>
          </div>
          <div className="space-y-2.5">
            {editLegs.map((leg, i) => (
              <LegEditor
                key={i}
                index={i}
                leg={leg}
                originalLeg={legs[i]}
                spotPrice={spotPrice}
                locale={locale}
                onChange={(patch) => updateLeg(i, patch)}
              />
            ))}
          </div>
        </div>
      )}
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
    <div className="rounded-lg bg-white/70 border border-violet-100 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <div className={`text-sm font-bold mt-0.5 mono ${colorClass}`}>{value}</div>
    </div>
  );
}

function LegEditor({
  index,
  leg,
  originalLeg,
  spotPrice,
  locale,
  onChange,
}: {
  index: number;
  leg: TraderOptionLeg;
  originalLeg: TraderOptionLeg | undefined;
  spotPrice: number;
  locale: Locale;
  onChange: (patch: Partial<TraderOptionLeg>) => void;
}) {
  const isZh = locale === "zh";
  const strikeMin = Math.max(1, spotPrice * 0.7);
  const strikeMax = spotPrice * 1.3;
  const strikeStep = spotPrice >= 100 ? 1 : 0.5;
  const isModified =
    originalLeg && (leg.strike !== originalLeg.strike || leg.quantity !== originalLeg.quantity);

  const sideColor =
    leg.side === "buy"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-red-50 text-red-700 border-red-200";
  const typeColor =
    leg.type === "call"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <div
      className={`rounded-xl border p-2.5 transition-all ${
        isModified ? "border-violet-300 bg-violet-50/40" : "border-violet-100 bg-white/70"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] text-slate-500 font-semibold">
          {isZh ? `第 ${index + 1} 腿` : `Leg ${index + 1}`}
        </span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase ${sideColor}`}>
          {leg.side}
        </span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase ${typeColor}`}>
          {leg.type}
        </span>
        <span className="text-[9px] text-slate-500 mono">
          {isZh ? "权利金" : "Premium"} ${leg.premium.toFixed(2)}
        </span>
        {isModified && (
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-200 text-violet-800 ml-auto">
            {isZh ? "已改" : "MOD"}
          </span>
        )}
      </div>

      <div className="space-y-1 mb-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">
            {isZh ? "行权价" : "Strike"}
          </span>
          <span className="text-[11px] font-bold mono text-slate-700">
            ${leg.strike.toFixed(2)}
            {originalLeg && originalLeg.strike !== leg.strike && (
              <span className="ml-1 text-[9px] text-slate-400">({originalLeg.strike.toFixed(2)})</span>
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
          className="w-full h-1 bg-violet-100 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">
            {isZh ? "合约数" : "Contracts"}
          </span>
          <span className="text-[11px] font-bold mono text-slate-700">
            {leg.quantity}
            {originalLeg && originalLeg.quantity !== leg.quantity && (
              <span className="ml-1 text-[9px] text-slate-400">({originalLeg.quantity})</span>
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
          className="w-full h-1 bg-violet-100 rounded-full appearance-none cursor-pointer accent-violet-500"
        />
      </div>
    </div>
  );
}
