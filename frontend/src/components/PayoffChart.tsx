"use client";

import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";

export default function PayoffChart() {
  const { strategies, selectedStrategyIndex, marketData, targetPrice, locale } = useAppStore();
  const strategy = strategies[selectedStrategyIndex];
  if (!strategy || !marketData) return null;

  const data = strategy.payoff_data;
  if (!data || data.length === 0) return null;
  const spot = marketData.spot_price;
  const chartData = data.map((d) => ({ price: d.price, pnl: d.pnl, profit: d.pnl > 0 ? d.pnl : 0, loss: d.pnl < 0 ? d.pnl : 0 }));

  return (
    <div className="w-full min-w-0 anim-fade-up">
      <h3 className="text-sm font-medium text-gray-500 mb-3">
        {t("chart.title", locale)} &mdash; {locale === "zh" ? strategy.name : strategy.name_en}
      </h3>
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
              <XAxis dataKey="price" stroke="#d1d5db" tick={{ fill: "#9ca3af", fontSize: 11 }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} angle={-45} textAnchor="end" tickCount={8} />
              <YAxis stroke="#d1d5db" tick={{ fill: "#9ca3af", fontSize: 11 }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
              <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", color: "#374151", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }} formatter={(value: unknown) => [`$${Number(value).toFixed(2)}`, "P&L"]} labelFormatter={(label: unknown) => `Price: $${Number(label).toFixed(2)}`} />
              <Area type="monotone" dataKey="profit" stroke="#059669" fill="url(#greenGrad)" strokeWidth={0} />
              <Area type="monotone" dataKey="loss" stroke="#dc2626" fill="url(#redGrad)" strokeWidth={0} />
              <Area type="monotone" dataKey="pnl" stroke="#2563eb" fill="none" strokeWidth={2.5} />
              <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="3 3" />
              <ReferenceLine
                x={data.reduce((prev, curr) => Math.abs(curr.price - spot) < Math.abs(prev.price - spot) ? curr : prev).price}
                stroke="#f59e0b" strokeDasharray="5 5"
                label={{ value: `${t("chart.currentPrice", locale)} $${spot.toFixed(0)}`, fill: "#d97706", fontSize: 11, position: "top" as const }}
              />
              {strategy.breakevens.map((be, i) => (
                <ReferenceLine key={`be-${i}`}
                  x={data.reduce((prev, curr) => Math.abs(curr.price - be) < Math.abs(prev.price - be) ? curr : prev).price}
                  stroke="#8b5cf6" strokeDasharray="5 5"
                  label={{ value: `BE $${be.toFixed(0)}`, fill: "#7c3aed", fontSize: 11, position: (["insideTopRight", "insideBottomRight"] as const)[i] || "insideTopRight" }}
                />
              ))}
              {targetPrice && (
                <ReferenceLine
                  x={data.reduce((prev, curr) => Math.abs(curr.price - targetPrice) < Math.abs(prev.price - targetPrice) ? curr : prev).price}
                  stroke="#059669" strokeDasharray="5 5"
                  label={{ value: `${t("chart.target", locale)} $${targetPrice.toFixed(0)}`, fill: "#059669", fontSize: 11, position: "insideTop" as const }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center gap-6 mt-4 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block rounded" /> {t("chart.currentPrice", locale)}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-purple-500 inline-block rounded" /> {t("chart.breakeven", locale)}</span>
          {targetPrice && <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" /> {t("chart.target", locale)}</span>}
        </div>
      </div>
    </div>
  );
}
