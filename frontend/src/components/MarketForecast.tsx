"use client";

import { useAppStore } from "@/lib/store";
import { TrendingUp, TrendingDown, Minus, Loader2, Brain } from "lucide-react";

const DIR_CFG = {
  up: { icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
  down: { icon: TrendingDown, color: "text-red-500", bg: "bg-red-50 border-red-200" },
  neutral: { icon: Minus, color: "text-amber-500", bg: "bg-amber-50 border-amber-200" },
};

const CONF_COLOR = { high: "text-emerald-600", medium: "text-amber-500", low: "text-gray-400" };

export default function MarketForecast() {
  const { forecasts, isForecastLoading, forecastError, marketData, locale } = useAppStore();
  if (!marketData) return null;

  return (
    <div className="anim-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-medium text-gray-500">
          {locale === "zh" ? "AI \u4ef7\u683c\u9884\u6d4b" : "AI Price Forecast"}
        </h3>
        {isForecastLoading && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
      </div>

      {forecastError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-red-600 text-sm">{forecastError}</div>
      )}

      {isForecastLoading && forecasts.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-400">
            {locale === "zh" ? "AI \u6b63\u5728\u5206\u6790\u5e02\u573a\u6570\u636e..." : "AI is analyzing market data..."}
          </p>
        </div>
      )}

      {forecasts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
          {forecasts.map((f, i) => {
            const cfg = DIR_CFG[f.direction] || DIR_CFG.neutral;
            const Icon = cfg.icon;
            const confColor = CONF_COLOR[f.confidence] || CONF_COLOR.medium;
            return (
              <div key={i} className={`p-4 rounded-2xl border shadow-sm hover:shadow-md transition-shadow duration-200 ${cfg.bg} anim-fade-up`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-600">{f.timeframe_label}</span>
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                </div>
                <div className={`text-base font-bold ${cfg.color} mb-1`}>
                  ${f.price_low.toFixed(1)} - ${f.price_high.toFixed(1)}
                </div>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-[10px] text-gray-400">{locale === "zh" ? "\u7f6e\u4fe1\u5ea6" : "Conf."}:</span>
                  <span className={`text-[10px] font-semibold ${confColor}`}>
                    {f.confidence === "high" ? (locale === "zh" ? "\u9ad8" : "High") : f.confidence === "medium" ? (locale === "zh" ? "\u4e2d" : "Med") : (locale === "zh" ? "\u4f4e" : "Low")}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{f.reasoning}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
