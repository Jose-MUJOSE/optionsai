"use client";

import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Sparkles, Loader2 } from "lucide-react";

export default function ControlPanel() {
  const {
    marketData, targetPct, setTargetPct, selectedExpiration, setExpiration,
    preferenceWeight, setPreferenceWeight, selectedTrend, calculateStrategies,
    isLoadingStrategies, locale, priceMode, setPriceMode,
    targetPriceUpper, setTargetPriceUpper, targetPriceLower, setTargetPriceLower,
    budget, setBudget, maxLoss, setMaxLoss, maxLossType, setMaxLossType,
  } = useAppStore();

  if (!marketData) return null;

  const formatExp = (exp: string) => {
    const dte = Math.floor((new Date(exp).getTime() - Date.now()) / 86400000);
    return `${exp} (${dte}d)`;
  };

  const prefMap = [
    { max: 0.2, key: "aggressive" },
    { max: 0.4, key: "growth" },
    { max: 0.6, key: "balanced" },
    { max: 0.8, key: "conservative" },
    { max: 1.01, key: "safe" },
  ];
  const prefKey = prefMap.find(p => preferenceWeight <= p.max)?.key || "balanced";
  const prefColors: Record<string, string> = {
    aggressive: "text-red-500", growth: "text-orange-500", balanced: "text-blue-600",
    conservative: "text-indigo-500", safe: "text-purple-600",
  };

  const inputClass = "w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-800 placeholder-gray-400 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all shadow-sm";

  return (
    <div className="space-y-5 anim-fade-up">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPriceMode("single")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer ${
            priceMode === "single"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          {t("ctrl.singleMode", locale)}
        </button>
        <button
          onClick={() => setPriceMode("range")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer ${
            priceMode === "range"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          {t("ctrl.rangeMode", locale)}
        </button>
      </div>

      {/* Price Inputs */}
      {priceMode === "single" ? (
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.targetPct", locale)}</label>
            <input type="number" step="0.5" value={targetPct ?? ""} onChange={(e) => setTargetPct(e.target.value ? parseFloat(e.target.value) : null)} placeholder="e.g. +15"
              className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.targetPrice", locale)}</label>
            <input type="number" step="0.5" value={useAppStore.getState().targetPrice ?? ""} onChange={(e) => useAppStore.getState().setTargetPrice(e.target.value ? parseFloat(e.target.value) : null)} placeholder={`e.g. ${(marketData.spot_price * 1.15).toFixed(0)}`}
              className={inputClass} />
          </div>
        </div>
      ) : (
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.lowerPrice", locale)}</label>
            <input type="number" step="0.5" value={targetPriceLower ?? ""} onChange={(e) => setTargetPriceLower(e.target.value ? parseFloat(e.target.value) : null)} placeholder={`e.g. ${(marketData.spot_price * 0.95).toFixed(0)}`}
              className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.upperPrice", locale)}</label>
            <input type="number" step="0.5" value={targetPriceUpper ?? ""} onChange={(e) => setTargetPriceUpper(e.target.value ? parseFloat(e.target.value) : null)} placeholder={`e.g. ${(marketData.spot_price * 1.05).toFixed(0)}`}
              className={inputClass} />
          </div>
        </div>
      )}

      {/* Budget & Max Loss */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.budget", locale)}</label>
          <input
            type="number"
            step="100"
            min="0"
            value={budget ?? ""}
            onChange={(e) => setBudget(e.target.value ? parseFloat(e.target.value) : null)}
            placeholder={t("ctrl.budgetPlaceholder", locale)}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.maxLoss", locale)}</label>
          <div className="flex gap-1.5">
            <input
              type="number"
              step="10"
              min="0"
              value={maxLoss ?? ""}
              onChange={(e) => setMaxLoss(e.target.value ? parseFloat(e.target.value) : null)}
              placeholder={t("ctrl.maxLossPlaceholder", locale)}
              className={inputClass + " flex-1"}
            />
            <select
              value={maxLossType}
              onChange={(e) => setMaxLossType(e.target.value as "dollar" | "percent")}
              className="px-2 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-600 text-xs focus:outline-none focus:border-blue-400 transition-all cursor-pointer"
            >
              <option value="dollar">{t("ctrl.maxLossDollar", locale)}</option>
              <option value="percent">{t("ctrl.maxLossPercent", locale)}</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-500 mb-1.5 block">{t("ctrl.expiration", locale)}</label>
        <select value={selectedExpiration || ""} onChange={(e) => setExpiration(e.target.value)}
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-800 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all shadow-sm cursor-pointer">
          {marketData.expirations.map((exp) => (
            <option key={exp} value={exp}>{formatExp(exp)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <label className="text-sm font-medium text-gray-500">{t("ctrl.preference", locale)}</label>
          <span className={`text-sm font-bold ${prefColors[prefKey]}`}>
            {t(`pref.${prefKey}` as Parameters<typeof t>[0], locale)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-blue-500 whitespace-nowrap w-16 font-medium">{t("ctrl.highReturn", locale)}</span>
          <div className="flex-1 relative">
            <input type="range" min={0} max={1} step={0.05} value={preferenceWeight} onChange={(e) => setPreferenceWeight(parseFloat(e.target.value))} className="w-full" />
            <div className="flex justify-between px-0.5 -mt-1">
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <div key={v} className={`w-1.5 h-1.5 rounded-full ${Math.abs(preferenceWeight - v) < 0.13 ? "bg-blue-500" : "bg-gray-300"}`} />
              ))}
            </div>
          </div>
          <span className="text-xs text-purple-500 whitespace-nowrap w-16 text-right font-medium">{t("ctrl.highWin", locale)}</span>
        </div>
        <p className="text-xs text-gray-400 mt-3">{t(`pref.${prefKey}Desc` as Parameters<typeof t>[0], locale)}</p>
      </div>

      {/* Generate Strategy Button */}
      <button
        onClick={() => calculateStrategies()}
        disabled={isLoadingStrategies || !selectedTrend || !selectedExpiration}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-sm transition-all shadow-sm hover:shadow-md active:scale-[0.98] cursor-pointer"
      >
        {isLoadingStrategies ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("ctrl.calculating", locale)}
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            {locale === "zh" ? "生成期权策略" : "Generate Strategies"}
          </>
        )}
      </button>
    </div>
  );
}
