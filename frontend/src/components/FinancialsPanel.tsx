"use client";

/**
 * FinancialsPanel — quarterly + annual revenue/profit trends.
 *
 * Two tabs:
 *   - "Quarterly" → 4 quarters bar+line: revenue bars + YoY% line, net margin line
 *   - "Annual"    → 4 fiscal years bar+line: same metrics
 *
 * Data shape: FinancialsResponse from /api/financials. Yahoo's free tier caps
 * at 4 periods of each — we surface that limit honestly via a small caption.
 *
 * The component is fully bilingual via the store's `locale`. All numeric
 * formatting respects the user's locale (e.g. en-US comma vs zh-CN comma).
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { FinancialRow } from "@/lib/api";

type Tab = "quarterly" | "annual";

function formatBillions(v: number | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString();
}

function formatPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return "n/a";
  return `${(v * 100).toFixed(decimals)}%`;
}

function formatPctSigned(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

/** Convert "2025-09-30" → "2025 Q3" / "FY 2025" depending on tab. */
function formatPeriodLabel(period: string, isAnnual: boolean): string {
  if (!period) return "—";
  const m = period.match(/^(\d{4})-(\d{2})/);
  if (!m) return period;
  const year = m[1];
  if (isAnnual) return `FY${year}`;
  const month = parseInt(m[2], 10);
  const q = Math.ceil(month / 3);
  return `${year} Q${q}`;
}

export default function FinancialsPanel() {
  const { financials, isFinancialsLoading, locale } = useAppStore();
  const [tab, setTab] = useState<Tab>("quarterly");

  const rows = useMemo<FinancialRow[]>(() => {
    if (!financials) return [];
    const list = tab === "quarterly" ? financials.quarterly : financials.annual;
    // Recharts wants oldest → newest left-to-right.
    return [...list].reverse();
  }, [financials, tab]);

  const chartData = useMemo(() => {
    return rows.map((r) => ({
      label: formatPeriodLabel(r.period, tab === "annual"),
      revenue_bn: r.revenue !== null ? r.revenue / 1e9 : null,
      net_income_bn: r.net_income !== null ? r.net_income / 1e9 : null,
      revenue_yoy_pct: r.revenue_yoy !== null ? r.revenue_yoy * 100 : null,
      net_margin_pct: r.net_margin !== null ? r.net_margin * 100 : null,
    }));
  }, [rows, tab]);

  if (isFinancialsLoading) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-6 flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (!financials || (financials.quarterly.length === 0 && financials.annual.length === 0)) {
    return null;
  }

  const titleZh = "财报历史";
  const titleEn = "Financial History";
  const subtitleZh = "Yahoo Finance 免费层最多 4 期";
  const subtitleEn = "Yahoo Finance free-tier caps at 4 periods";

  return (
    <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-5 anim-fade-up">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.12)] flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-[var(--accent)]" strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
              {locale === "zh" ? titleZh : titleEn}
            </h3>
            <div className="text-[10px] text-[var(--text-2)] tracking-wide">
              {locale === "zh" ? subtitleZh : subtitleEn}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-[var(--bg-2)] rounded-lg p-0.5 text-xs">
          {(["quarterly", "annual"] as const).map((id) => {
            const active = tab === id;
            const label = id === "quarterly"
              ? (locale === "zh" ? "季度" : "Quarterly")
              : (locale === "zh" ? "年度" : "Annual");
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-white text-[var(--accent-hot)] shadow-sm"
                    : "text-[var(--text-2)] hover:text-[var(--text-0)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Combined chart: revenue bars + YoY line + net margin line */}
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-2)" }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: "var(--text-2)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v.toFixed(0)}B`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: "var(--text-2)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "white",
                border: "1px solid var(--line-mid)",
                borderRadius: 10,
                fontSize: 12,
              }}
              formatter={(value, name) => {
                const v = typeof value === "number" ? value : null;
                const label = String(name);
                if (v === null) return ["n/a", label];
                if (label === "Revenue" || label === "营收") return [`$${v.toFixed(2)}B`, label];
                if (label === "Net Income" || label === "净利润") return [`$${v.toFixed(2)}B`, label];
                return [`${v.toFixed(2)}%`, label];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Bar
              yAxisId="left"
              dataKey="revenue_bn"
              name={locale === "zh" ? "营收" : "Revenue"}
              fill="var(--accent)"
              radius={[6, 6, 0, 0]}
              barSize={40}
            />
            <Bar
              yAxisId="left"
              dataKey="net_income_bn"
              name={locale === "zh" ? "净利润" : "Net Income"}
              fill="var(--accent-violet)"
              radius={[6, 6, 0, 0]}
              barSize={40}
              fillOpacity={0.65}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="revenue_yoy_pct"
              name={locale === "zh" ? "营收同比" : "Revenue YoY"}
              stroke="var(--fin-up)"
              strokeWidth={2.2}
              dot={{ r: 3, strokeWidth: 1.5 }}
              connectNulls
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="net_margin_pct"
              name={locale === "zh" ? "净利率" : "Net Margin"}
              stroke="var(--accent-amber)"
              strokeWidth={2.2}
              strokeDasharray="4 3"
              dot={{ r: 3, strokeWidth: 1.5 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Table — period detail */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
              <th className="text-left font-semibold py-2 pr-3">
                {locale === "zh" ? "期间" : "Period"}
              </th>
              <th className="text-right font-semibold py-2 px-3">
                {locale === "zh" ? "营收" : "Revenue"}
              </th>
              <th className="text-right font-semibold py-2 px-3">YoY</th>
              <th className="text-right font-semibold py-2 px-3">QoQ</th>
              <th className="text-right font-semibold py-2 px-3">
                {locale === "zh" ? "净利润" : "Net Income"}
              </th>
              <th className="text-right font-semibold py-2 px-3">
                {locale === "zh" ? "毛利率" : "Gross Margin"}
              </th>
              <th className="text-right font-semibold py-2 pl-3">
                {locale === "zh" ? "净利率" : "Net Margin"}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.period} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--bg-2)]/40 transition-colors">
                <td className="py-2.5 pr-3 font-mono text-[var(--text-0)] font-semibold">
                  {formatPeriodLabel(r.period, tab === "annual")}
                </td>
                <td className="py-2.5 px-3 text-right mono text-[var(--text-0)]">
                  ${formatBillions(r.revenue)}
                </td>
                <td className={`py-2.5 px-3 text-right mono font-semibold ${
                  r.revenue_yoy === null
                    ? "text-[var(--text-3)]"
                    : r.revenue_yoy >= 0
                    ? "text-[var(--fin-up)]"
                    : "text-[var(--fin-down)]"
                }`}>
                  {formatPctSigned(r.revenue_yoy)}
                </td>
                <td className={`py-2.5 px-3 text-right mono font-semibold ${
                  r.revenue_qoq === null
                    ? "text-[var(--text-3)]"
                    : r.revenue_qoq >= 0
                    ? "text-[var(--fin-up)]"
                    : "text-[var(--fin-down)]"
                }`}>
                  {formatPctSigned(r.revenue_qoq)}
                </td>
                <td className="py-2.5 px-3 text-right mono text-[var(--text-0)]">
                  ${formatBillions(r.net_income)}
                </td>
                <td className="py-2.5 px-3 text-right mono text-[var(--text-1)]">
                  {formatPct(r.gross_margin)}
                </td>
                <td className="py-2.5 pl-3 text-right mono text-[var(--text-1)]">
                  {formatPct(r.net_margin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
