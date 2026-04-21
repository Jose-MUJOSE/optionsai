"use client";

import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Loader2 } from "lucide-react";

export default function IVTermStructure() {
  const { ivTermStructure, isIVTermLoading, marketData, locale } = useAppStore();

  if (!marketData) return null;

  if (isIVTermLoading) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm anim-fade-up">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{t("ivTerm.title", locale)}</h3>
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {t("ivTerm.loading", locale)}
        </div>
      </div>
    );
  }

  if (!ivTermStructure || ivTermStructure.length === 0) return null;

  const chartData = ivTermStructure.map((item) => ({
    name: `${item.dte}d`,
    expiration: item.expiration,
    dte: item.dte,
    iv: parseFloat(item.atm_iv.toFixed(1)),
  }));

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm anim-fade-up">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{t("ivTerm.title", locale)}</h3>

      {/* Chart */}
      <div className="h-48 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickFormatter={(v: number) => `${v}%`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                fontSize: "12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              formatter={(value: unknown) => [`${value}%`, "ATM IV"]}
              labelFormatter={(label: unknown) => `${label}`}
            />
            <Line
              type="monotone"
              dataKey="iv"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4, fill: "#3b82f6", stroke: "white", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "#2563eb" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-gray-100">
              <th className="text-left py-2 px-2 font-medium">{t("ivTerm.expiration", locale)}</th>
              <th className="text-center py-2 px-2 font-medium">{t("ivTerm.dte", locale)}</th>
              <th className="text-right py-2 px-2 font-medium">{t("ivTerm.atmIv", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {ivTermStructure.map((item, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="py-1.5 px-2 text-gray-700">{item.expiration}</td>
                <td className="py-1.5 px-2 text-center text-gray-500">{item.dte}d</td>
                <td className="py-1.5 px-2 text-right font-medium text-blue-600">
                  {item.atm_iv.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
