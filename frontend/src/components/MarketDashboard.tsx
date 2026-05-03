"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import GreekTooltip from "./GreekTooltip";

function StatCard({ label, value, suffix, color }: {
  label: string; value: string | number; suffix?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200 anim-fade-up">
      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">{label}</span>
      <div className={`text-xl font-bold mt-1.5 ${color || "text-gray-800"}`}>
        {value}{suffix && <span className="text-sm font-normal text-gray-400 ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

interface MarketDashboardProps {
  /** When true, hide the ATM Greeks table (used in stock-research view).
   *  Greeks are still rendered in the options-research view. */
  hideGreeks?: boolean;
}

export default function MarketDashboard({ hideGreeks = false }: MarketDashboardProps = {}) {
  const { marketData, marketError, locale, optionsSnapshot, isSnapshotLoading, selectedExpiration } = useAppStore();

  // Snapshot of wall-clock time, captured lazily on mount.
  // Lazy useState initializer is the idiomatic way to call an impure API once.
  const [nowMs] = useState(() => Date.now());

  if (marketError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">
        Error: {marketError}
      </div>
    );
  }

  if (!marketData) return null;

  const priceColor = marketData.change_pct >= 0 ? "text-emerald-600" : "text-red-500";

  // Use snapshot IV if available (expiration-specific), otherwise fallback to market data IV
  const atmIv = optionsSnapshot?.atm_iv ?? marketData.iv_current;
  const hv30 = optionsSnapshot?.hv_30 ?? marketData.hv_30;
  const ivHvRatio = hv30 > 0 ? (atmIv / hv30) : 0;

  const ivColor = ivHvRatio > 1.3 ? "text-red-500" : ivHvRatio > 0.9 ? "text-amber-500" : "text-emerald-600";

  let ivLevel: string, ivAdvice: string, ivBgColor: string, ivTextColor: string;
  if (ivHvRatio > 1.3) {
    ivLevel = t("iv.high", locale);
    ivAdvice = t("iv.highAdvice", locale);
    ivTextColor = "text-red-600";
    ivBgColor = "bg-red-50 border-red-200";
  } else if (ivHvRatio > 0.9) {
    ivLevel = t("iv.mid", locale);
    ivAdvice = t("iv.midAdvice", locale);
    ivTextColor = "text-amber-600";
    ivBgColor = "bg-amber-50 border-amber-200";
  } else {
    ivLevel = t("iv.low", locale);
    ivAdvice = t("iv.lowAdvice", locale);
    ivTextColor = "text-emerald-600";
    ivBgColor = "bg-emerald-50 border-emerald-200";
  }

  const ticker = marketData.ticker;
  const isHK = ticker.endsWith(".HK");
  const isCN = ticker.endsWith(".SS") || ticker.endsWith(".SZ");
  const currSym = isHK ? "HK$" : isCN ? "\u00a5" : "$";

  const dte = optionsSnapshot?.dte;
  const dteLabel = dte ? `${dte}${locale === "zh" ? "天" : "d"}` : "";

  // Days-until-earnings suffix (e.g. "(12d)")
  const earningsSuffix = (() => {
    if (!marketData.next_earnings_date) return undefined;
    const days = Math.ceil(
      (new Date(marketData.next_earnings_date).getTime() - nowMs) / 86400000
    );
    return `(${days}${locale === "zh" ? "天" : "d"})`;
  })();

  return (
    <div className="space-y-3 anim-fade-up">
      {/* Row 1: Core market stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 stagger-children">
        <StatCard
          label={ticker}
          value={`${currSym}${marketData.spot_price.toFixed(2)}`}
          suffix={`${marketData.change_pct >= 0 ? "+" : ""}${marketData.change_pct.toFixed(2)}%`}
          color={priceColor}
        />
        <StatCard
          label={`${t("dashboard.atmIv", locale)}${dteLabel ? ` (${dteLabel})` : ""}`}
          value={`${atmIv.toFixed(1)}%`}
          color={ivColor}
        />
        <StatCard
          label={t("dashboard.hv30", locale)}
          value={`${hv30.toFixed(1)}%`}
        />
        <StatCard
          label={t("dashboard.ivHvRatio", locale)}
          value={ivHvRatio.toFixed(2)}
          suffix="x"
          color={ivColor}
        />
        <StatCard label={t("dashboard.earnings", locale)} value={
          marketData.next_earnings_date
            ? marketData.next_earnings_date
            : t("common.na", locale)
        } suffix={earningsSuffix} />
      </div>

      {/* IV environment bar */}
      <div className={`${ivBgColor} border rounded-2xl px-5 py-3 flex items-center justify-between anim-fade-up`}>
        <div className="flex items-center gap-3">
          <div className={`text-sm font-semibold ${ivTextColor}`}>{ivLevel}</div>
          <div className="text-xs text-gray-500">
            {t("iv.ratio", locale)}: <span className="text-gray-700 font-medium">{ivHvRatio.toFixed(2)}x</span>
          </div>
        </div>
        <div className="text-xs text-gray-500 max-w-sm text-right">{ivAdvice}</div>
      </div>

      {/* Row 2: ATM Greeks panel (only shown when snapshot loaded AND not hidden) */}
      {optionsSnapshot && !hideGreeks && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 anim-fade-up">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {t("dashboard.greeks", locale)}
              {selectedExpiration && (
                <span className="ml-2 text-blue-500 normal-case">
                  {selectedExpiration} ({dteLabel})
                </span>
              )}
            </h4>
            {isSnapshotLoading && (
              <span className="text-[10px] text-blue-400 animate-pulse">{locale === "zh" ? "更新中..." : "Updating..."}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wider">
                  <th className="text-left pb-2 font-medium"></th>
                  <th className="text-right pb-2 font-medium">{t("dashboard.strike", locale)}</th>
                  <th className="text-right pb-2 font-medium">{t("dashboard.mid", locale)}</th>
                  <th className="text-right pb-2 font-medium">IV</th>
                  <th className="text-right pb-2 font-medium">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      Delta<GreekTooltip greek="delta" locale={locale} />
                    </span>
                  </th>
                  <th className="text-right pb-2 font-medium">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      Gamma<GreekTooltip greek="gamma" locale={locale} />
                    </span>
                  </th>
                  <th className="text-right pb-2 font-medium">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      Theta<GreekTooltip greek="theta" locale={locale} />
                    </span>
                  </th>
                  <th className="text-right pb-2 font-medium">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      Vega<GreekTooltip greek="vega" locale={locale} />
                    </span>
                  </th>
                  <th className="text-right pb-2 font-medium">{t("dashboard.vol", locale)}</th>
                  <th className="text-right pb-2 font-medium">{t("dashboard.oi", locale)}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gray-50">
                  <td className="py-2 font-medium text-emerald-600">{t("dashboard.call", locale)}</td>
                  <td className="py-2 text-right text-gray-700">{currSym}{optionsSnapshot.atm_call.strike.toFixed(0)}</td>
                  <td className="py-2 text-right font-medium text-gray-800">{currSym}{optionsSnapshot.atm_call.mid.toFixed(2)}</td>
                  <td className="py-2 text-right text-gray-600">{optionsSnapshot.atm_call.iv.toFixed(1)}%</td>
                  <td className="py-2 text-right font-mono text-emerald-600">{optionsSnapshot.atm_call.delta.toFixed(3)}</td>
                  <td className="py-2 text-right font-mono text-gray-600">{optionsSnapshot.atm_call.gamma.toFixed(4)}</td>
                  <td className="py-2 text-right font-mono text-red-500">{optionsSnapshot.atm_call.theta.toFixed(3)}</td>
                  <td className="py-2 text-right font-mono text-blue-600">{optionsSnapshot.atm_call.vega.toFixed(3)}</td>
                  <td className="py-2 text-right text-gray-500">{optionsSnapshot.atm_call.volume.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-500">{optionsSnapshot.atm_call.open_interest.toLocaleString()}</td>
                </tr>
                <tr className="border-t border-gray-50">
                  <td className="py-2 font-medium text-red-500">{t("dashboard.put", locale)}</td>
                  <td className="py-2 text-right text-gray-700">{currSym}{optionsSnapshot.atm_put.strike.toFixed(0)}</td>
                  <td className="py-2 text-right font-medium text-gray-800">{currSym}{optionsSnapshot.atm_put.mid.toFixed(2)}</td>
                  <td className="py-2 text-right text-gray-600">{optionsSnapshot.atm_put.iv.toFixed(1)}%</td>
                  <td className="py-2 text-right font-mono text-red-500">{optionsSnapshot.atm_put.delta.toFixed(3)}</td>
                  <td className="py-2 text-right font-mono text-gray-600">{optionsSnapshot.atm_put.gamma.toFixed(4)}</td>
                  <td className="py-2 text-right font-mono text-red-500">{optionsSnapshot.atm_put.theta.toFixed(3)}</td>
                  <td className="py-2 text-right font-mono text-blue-600">{optionsSnapshot.atm_put.vega.toFixed(3)}</td>
                  <td className="py-2 text-right text-gray-500">{optionsSnapshot.atm_put.volume.toLocaleString()}</td>
                  <td className="py-2 text-right text-gray-500">{optionsSnapshot.atm_put.open_interest.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
