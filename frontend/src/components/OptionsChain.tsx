"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Loader2 } from "lucide-react";
import GreekTooltip from "./GreekTooltip";
import type { FullOptionContract } from "@/lib/api";

export default function OptionsChain() {
  const [showAll, setShowAll] = useState(false);
  const {
    fullOptionsChain, isOptionsChainLoading, optionsChainView, setOptionsChainView,
    marketData, selectedExpiration, optionsSnapshot, locale,
  } = useAppStore();

  if (!marketData || !selectedExpiration) return null;

  const spot = marketData.spot_price;
  const dte = optionsSnapshot?.dte;
  const atmIv = optionsSnapshot?.atm_iv;

  // Find ATM strike index
  const findATMIndex = (contracts: FullOptionContract[]) => {
    if (!contracts.length) return -1;
    let minDiff = Infinity;
    let idx = 0;
    contracts.forEach((c, i) => {
      const diff = Math.abs(c.strike - spot);
      if (diff < minDiff) { minDiff = diff; idx = i; }
    });
    return idx;
  };

  const fmt = (v: number | null | undefined, dec = 4) =>
    v != null ? v.toFixed(dec) : "-";
  const fmtPct = (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)}%` : "-";
  const fmtPrice = (v: number | null | undefined) =>
    v != null ? `$${v.toFixed(2)}` : "-";

  const calls = fullOptionsChain?.calls ?? [];
  const puts = fullOptionsChain?.puts ?? [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const callATMIdx = findATMIndex(calls);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const putATMIdx = findATMIndex(puts);

  // Match calls and puts by strike
  const allStrikes = Array.from(new Set([
    ...calls.map(c => c.strike),
    ...puts.map(p => p.strike),
  ])).sort((a, b) => a - b);

  const callMap = new Map(calls.map(c => [c.strike, c]));
  const putMap = new Map(puts.map(p => [p.strike, p]));

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm anim-fade-up overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">{t("chain.title", locale)}</h3>
          {dte != null && (
            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
              {selectedExpiration} · {dte}d
            </span>
          )}
          {atmIv != null && (
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              ATM IV {atmIv.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setOptionsChainView("greeks")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              optionsChainView === "greeks"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t("chain.greeksView", locale)}
          </button>
          <button
            onClick={() => setOptionsChainView("probability")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              optionsChainView === "probability"
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t("chain.probView", locale)}
          </button>
        </div>
      </div>

      {/* Table */}
      {isOptionsChainLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {t("chain.loading", locale)}
        </div>
      ) : !allStrikes.length ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {t("common.na", locale)}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {/* Call side header */}
                {optionsChainView === "greeks" ? (
                  <>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">
                      <span className="inline-flex items-center justify-end gap-0.5">Delta<GreekTooltip greek="delta" locale={locale} /></span>
                    </th>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">
                      <span className="inline-flex items-center justify-end gap-0.5">Gamma<GreekTooltip greek="gamma" locale={locale} /></span>
                    </th>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">
                      <span className="inline-flex items-center justify-end gap-0.5">Theta<GreekTooltip greek="theta" locale={locale} /></span>
                    </th>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">Mid</th>
                  </>
                ) : (
                  <>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">{t("chain.winPct", locale)}</th>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">{t("chain.breakeven", locale)}</th>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">Mid</th>
                    <th className="py-2.5 px-2 text-right text-gray-400 font-medium">OI</th>
                  </>
                )}
                {/* Call label */}
                <th className="py-2.5 px-1 text-right text-emerald-600 font-semibold text-[10px]">CALL</th>

                {/* Strike center */}
                <th className="py-2.5 px-3 text-center text-gray-600 font-semibold bg-gray-100 min-w-[80px]">
                  {locale === "zh" ? "行权价" : "Strike"}
                </th>

                {/* Put label */}
                <th className="py-2.5 px-1 text-left text-red-500 font-semibold text-[10px]">PUT</th>

                {/* Put side header */}
                {optionsChainView === "greeks" ? (
                  <>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">Mid</th>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">
                      <span className="inline-flex items-center gap-0.5">Theta<GreekTooltip greek="theta" locale={locale} /></span>
                    </th>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">
                      <span className="inline-flex items-center gap-0.5">Gamma<GreekTooltip greek="gamma" locale={locale} /></span>
                    </th>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">
                      <span className="inline-flex items-center gap-0.5">Delta<GreekTooltip greek="delta" locale={locale} /></span>
                    </th>
                  </>
                ) : (
                  <>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">OI</th>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">Mid</th>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">{t("chain.breakeven", locale)}</th>
                    <th className="py-2.5 px-2 text-left text-gray-400 font-medium">{t("chain.winPct", locale)}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(showAll ? allStrikes : allStrikes.filter(s => Math.abs(s - spot) <= 10)).map((strike) => {
                const call = callMap.get(strike);
                const put = putMap.get(strike);
                const isATM = Math.abs(strike - spot) <= (allStrikes[1] - allStrikes[0]) * 0.6;

                return (
                  <tr key={strike} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${isATM ? "bg-blue-50 hover:bg-blue-100" : ""}`}>
                    {/* Call side */}
                    {optionsChainView === "greeks" ? (
                      <>
                        <td className="py-1.5 px-2 text-right text-gray-700">{call ? fmt(call.delta, 4) : "-"}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500">{call ? fmt(call.gamma, 4) : "-"}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500">{call ? fmt(call.theta, 4) : "-"}</td>
                        <td className="py-1.5 px-2 text-right font-medium text-gray-700">{call ? fmtPrice(call.mid_price) : "-"}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 px-2 text-right text-emerald-600 font-medium">{call ? fmtPct(call.win_probability) : "-"}</td>
                        <td className="py-1.5 px-2 text-right text-gray-600">{call ? fmtPrice(call.breakeven) : "-"}</td>
                        <td className="py-1.5 px-2 text-right font-medium text-gray-700">{call ? fmtPrice(call.mid_price) : "-"}</td>
                        <td className="py-1.5 px-2 text-right text-gray-400">{call ? (call.open_interest > 999 ? `${(call.open_interest/1000).toFixed(1)}K` : call.open_interest) : "-"}</td>
                      </>
                    )}
                    <td className="py-1.5 px-1" />

                    {/* Strike center */}
                    <td className={`py-1.5 px-3 text-center font-bold text-sm bg-gray-100 ${isATM ? "text-blue-700 bg-blue-100" : "text-gray-700"}`}>
                      {strike}
                      {isATM && <span className="ml-1 text-[9px] text-blue-500 font-normal">ATM</span>}
                    </td>

                    <td className="py-1.5 px-1" />

                    {/* Put side */}
                    {optionsChainView === "greeks" ? (
                      <>
                        <td className="py-1.5 px-2 text-left font-medium text-gray-700">{put ? fmtPrice(put.mid_price) : "-"}</td>
                        <td className="py-1.5 px-2 text-left text-gray-500">{put ? fmt(put.theta, 4) : "-"}</td>
                        <td className="py-1.5 px-2 text-left text-gray-500">{put ? fmt(put.gamma, 4) : "-"}</td>
                        <td className="py-1.5 px-2 text-left text-gray-700">{put ? fmt(put.delta, 4) : "-"}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 px-2 text-left text-gray-400">{put ? (put.open_interest > 999 ? `${(put.open_interest/1000).toFixed(1)}K` : put.open_interest) : "-"}</td>
                        <td className="py-1.5 px-2 text-left font-medium text-gray-700">{put ? fmtPrice(put.mid_price) : "-"}</td>
                        <td className="py-1.5 px-2 text-left text-gray-600">{put ? fmtPrice(put.breakeven) : "-"}</td>
                        <td className="py-1.5 px-2 text-left text-red-500 font-medium">{put ? fmtPct(put.win_probability) : "-"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!showAll && allStrikes.some(s => Math.abs(s - spot) > 10) && (
                <tr>
                  <td colSpan={10} className="py-3 text-center">
                    <button onClick={() => setShowAll(true)} className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer">
                      ▼ {locale === "zh" ? "展开全部行权价" : "Show all strikes"}
                    </button>
                  </td>
                </tr>
              )}
              {showAll && (
                <tr>
                  <td colSpan={10} className="py-3 text-center">
                    <button onClick={() => setShowAll(false)} className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer">
                      ▲ {locale === "zh" ? "收起" : "Collapse"}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
