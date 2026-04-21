"use client";

import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

export default function StrategyComparison() {
  const { strategies, locale } = useAppStore();
  if (strategies.length < 2) return null;

  const metrics = [
    { key: "strategy.winRate", fn: (s: typeof strategies[0]) => `${s.win_probability.toFixed(1)}%`, best: (arr: typeof strategies) => Math.max(...arr.map(x => x.win_probability)), cmp: (s: typeof strategies[0], best: number) => s.win_probability === best, color: "text-emerald-600" },
    { key: "strategy.maxReturn", fn: (s: typeof strategies[0]) => `+${s.max_profit_pct.toFixed(0)}%`, best: (arr: typeof strategies) => Math.max(...arr.map(x => x.max_profit_pct)), cmp: (s: typeof strategies[0], best: number) => s.max_profit_pct === best, color: "text-emerald-600" },
    { key: "strategy.maxLoss", fn: (s: typeof strategies[0]) => `$${s.max_loss.toFixed(0)}`, best: (arr: typeof strategies) => Math.max(...arr.map(x => x.max_loss)), cmp: (s: typeof strategies[0], best: number) => s.max_loss === best, color: "text-blue-600" },
    { key: "strategy.capital", fn: (s: typeof strategies[0]) => `$${s.required_capital.toFixed(0)}`, best: () => 0, cmp: () => false, color: "" },
    { key: "strategy.breakeven", fn: (s: typeof strategies[0]) => s.breakevens.map(b => `$${b.toFixed(0)}`).join(", ") || "N/A", best: () => 0, cmp: () => false, color: "" },
    { key: "strategy.riskReward", fn: (s: typeof strategies[0]) => { const r = s.max_loss !== 0 ? s.max_profit / Math.abs(s.max_loss) : Infinity; return `1:${r === Infinity ? "\u221e" : r.toFixed(1)}`; }, best: (arr: typeof strategies) => Math.max(...arr.map(x => x.max_loss !== 0 ? x.max_profit / Math.abs(x.max_loss) : 9999)), cmp: (s: typeof strategies[0], best: number) => { const r = s.max_loss !== 0 ? s.max_profit / Math.abs(s.max_loss) : 9999; return Math.abs(r - best) < 0.01; }, color: "text-indigo-600" },
    { key: "strategy.legs", fn: (s: typeof strategies[0]) => `${s.legs.length}`, best: () => 0, cmp: () => false, color: "" },
  ];

  return (
    <div className="anim-fade-up">
      <h3 className="text-sm font-medium text-gray-500 mb-3">{t("compare.title", locale)}</h3>
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs">{t("compare.metric", locale)}</th>
                {strategies.map((s, i) => (
                  <th key={i} className="text-center px-4 py-3 text-gray-700 font-semibold text-xs min-w-[130px]">
                    {locale === "zh" ? s.name : s.name_en}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-600">
              {metrics.map((m, mi) => {
                const bestVal = m.best(strategies);
                return (
                  <tr key={mi} className={mi < metrics.length - 1 ? "border-b border-gray-50" : ""}>
                    <td className="px-5 py-2.5 text-gray-400 text-xs font-medium">{t(m.key as Parameters<typeof t>[0], locale)}</td>
                    {strategies.map((s, i) => (
                      <td key={i} className={`text-center px-4 py-2.5 text-xs ${m.cmp(s, bestVal) ? `${m.color} font-bold` : ""}`}>
                        {m.fn(s)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
