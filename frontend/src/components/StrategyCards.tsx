"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";
import { Sparkles, Loader2 } from "lucide-react";

const TAG_COLORS: Record<string, string> = {
  "\u9ad8\u6760\u6746": "bg-amber-50 text-amber-600 border-amber-200",
  "\u5e73\u8861\u578b": "bg-blue-50 text-blue-600 border-blue-200",
  "\u9ad8\u80dc\u7387": "bg-emerald-50 text-emerald-600 border-emerald-200",
  "\u6536\u79df\u578b": "bg-purple-50 text-purple-600 border-purple-200",
  "\u8fdb\u9636\u578b": "bg-rose-50 text-rose-600 border-rose-200",
};

export default function StrategyCards() {
  const { strategies, selectedStrategyIndex, setSelectedStrategy, strategyError, locale, topPickAnalysis, isTopPickLoading } = useAppStore();
  // Snapshot "now" once via lazy useState so DTE math stays pure per render.
  const [nowMs] = useState(() => Date.now());

  if (strategyError) {
    return <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">{strategyError}</div>;
  }
  if (strategies.length === 0) return null;

  return (
    <div className="anim-fade-up">
      <h3 className="text-sm font-medium text-gray-500 mb-3">{t("strategy.recommended", locale)}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-children">
        {strategies.map((s, i) => {
          const isSelected = i === selectedStrategyIndex;
          const tagColor = TAG_COLORS[s.tag] || TAG_COLORS["\u5e73\u8861\u578b"];
          const ratio = s.max_loss !== 0 ? (s.max_profit / Math.abs(s.max_loss)) : Infinity;
          return (
            <button key={i} onClick={() => setSelectedStrategy(i)}
              className={`text-left p-5 rounded-2xl border transition-all duration-200 cursor-pointer anim-fade-up
                ${isSelected
                  ? "bg-white border-blue-400 shadow-lg shadow-blue-100/50 ring-1 ring-blue-200"
                  : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-md"
                }`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-gray-800">{locale === "zh" ? s.name : s.name_en}</h4>
                    {i === 0 && (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 font-semibold">
                        <Sparkles className="w-3 h-3" />
                        {locale === "zh" ? "\u9996\u9009" : "Top Pick"}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{locale === "zh" ? s.name_en : s.name}</span>
                </div>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${tagColor}`}>{s.tag}</span>
              </div>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div>
                  <div className="text-[11px] text-gray-400">{t("strategy.winRate", locale)}</div>
                  <div className="text-sm font-bold text-blue-600">{s.win_probability.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">{t("strategy.maxReturn", locale)}</div>
                  <div className="text-sm font-bold text-emerald-600">+{s.max_profit_pct.toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">{t("strategy.maxLoss", locale)}</div>
                  <div className="text-sm font-bold text-red-500">${s.max_loss.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">{t("strategy.riskReward", locale)}</div>
                  <div className="text-sm font-bold text-gray-700">1:{ratio === Infinity ? "\u221e" : ratio.toFixed(1)}</div>
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(s.win_probability, 100)}%` }} />
              </div>
              <div className="space-y-1">
                {s.legs.map((leg, j) => (
                  <div key={j} className="text-xs text-gray-500 font-mono">
                    <span className={leg.action === "BUY" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{leg.action}</span> {leg.quantity}x ${leg.strike} {leg.option_type} @ ${leg.premium.toFixed(2)}
                  </div>
                ))}
                <div className="text-xs text-gray-400 mt-1">
                  {t("strategy.capital", locale)}: ${s.required_capital.toFixed(0)} | {t("strategy.breakeven", locale)}: {s.breakevens.map(b => `$${b.toFixed(2)}`).join(", ") || "N/A"}
                </div>
                {s.legs[0]?.expiration && (
                  <div className="text-xs text-gray-400 mt-1">
                    Exp: {s.legs[0].expiration} ({Math.max(0, Math.floor((new Date(s.legs[0].expiration).getTime() - nowMs) / 86400000))}d)
                  </div>
                )}
              </div>
              {isSelected && s.max_loss !== 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="text-xs text-gray-400 mb-2 font-medium">{t("strategy.positionSizing", locale)}</div>
                  <div className="flex gap-2 flex-wrap">
                    {[10000, 25000, 50000, 100000].map((acct) => {
                      const contracts = Math.max(1, Math.floor((acct * 0.02) / Math.abs(s.max_loss)));
                      return (
                        <div key={acct} className="text-xs bg-gray-50 rounded-lg px-2.5 py-1 border border-gray-100">
                          <span className="text-gray-500">${(acct / 1000).toFixed(0)}K:</span> <span className="text-gray-800 font-semibold">{contracts}x</span> <span className="text-gray-400">(${(s.required_capital * contracts).toFixed(0)})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {i === 0 && (topPickAnalysis || isTopPickLoading) && (
                <div className="mt-4 pt-4 border-t border-blue-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-semibold text-blue-600">
                      {locale === "zh" ? "AI \u63a8\u8350\u7406\u7531" : "AI Analysis"}
                    </span>
                    {isTopPickLoading && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
                  </div>
                  {topPickAnalysis && (
                    <div className="text-xs text-gray-600 leading-relaxed prose-light prose prose-xs max-w-none">
                      <ReactMarkdown>{topPickAnalysis}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
