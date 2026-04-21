"use client";

import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import type { TrendExpectation, TrendOption } from "@/types";

const TRENDS: (TrendOption & { label_key: string })[] = [
  { value: "slight_up", label: "Slight Up", label_key: "trend.slight_up", icon: "\u2197", color: "emerald" },
  { value: "up", label: "Bullish", label_key: "trend.up", icon: "\u2191", color: "emerald" },
  { value: "strong_up", label: "Strong Up", label_key: "trend.strong_up", icon: "\u21c8", color: "emerald" },
  { value: "volatile_up", label: "Vol. Up", label_key: "trend.volatile_up", icon: "\u2195\u2191", color: "teal" },
  { value: "neutral", label: "Neutral", label_key: "trend.neutral", icon: "\u2194", color: "slate" },
  { value: "slight_down", label: "Slight Down", label_key: "trend.slight_down", icon: "\u2198", color: "red" },
  { value: "down", label: "Bearish", label_key: "trend.down", icon: "\u2193", color: "red" },
  { value: "strong_down", label: "Strong Down", label_key: "trend.strong_down", icon: "\u21ca", color: "red" },
  { value: "volatile_down", label: "Vol. Down", label_key: "trend.volatile_down", icon: "\u2195\u2193", color: "orange" },
  { value: "high_volatile", label: "High Vol.", label_key: "trend.high_volatile", icon: "\u26a1", color: "purple" },
];

const COLOR_MAP: Record<string, { text: string; active: string; ring: string }> = {
  emerald: { text: "text-emerald-600", active: "bg-emerald-50 border-emerald-400 shadow-emerald-100", ring: "ring-emerald-200" },
  teal: { text: "text-teal-600", active: "bg-teal-50 border-teal-400 shadow-teal-100", ring: "ring-teal-200" },
  slate: { text: "text-gray-600", active: "bg-gray-50 border-gray-400 shadow-gray-100", ring: "ring-gray-200" },
  red: { text: "text-red-500", active: "bg-red-50 border-red-400 shadow-red-100", ring: "ring-red-200" },
  orange: { text: "text-orange-500", active: "bg-orange-50 border-orange-400 shadow-orange-100", ring: "ring-orange-200" },
  purple: { text: "text-purple-600", active: "bg-purple-50 border-purple-400 shadow-purple-100", ring: "ring-purple-200" },
};

export default function TrendSelector() {
  const { selectedTrend, setTrend, locale } = useAppStore();

  return (
    <div className="anim-fade-up">
      <label className="text-sm font-medium text-gray-500 mb-3 block">{t("trend.title", locale)}</label>
      <div className="grid grid-cols-5 gap-2">
        {TRENDS.map((tr) => {
          const isSelected = selectedTrend === tr.value;
          const c = COLOR_MAP[tr.color];
          return (
            <button
              key={tr.value}
              onClick={() => setTrend(tr.value as TrendExpectation)}
              className={`flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-sm transition-all duration-200 cursor-pointer
                ${isSelected
                  ? `${c.active} shadow-md ring-1 ${c.ring}`
                  : "bg-white border-gray-200 hover:bg-gray-50 hover:shadow-sm"
                }
              `}
            >
              <span className="text-lg mb-1">{tr.icon}</span>
              <span className={`text-xs font-medium ${isSelected ? c.text : "text-gray-500"}`}>
                {t(tr.label_key as Parameters<typeof t>[0], locale)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
