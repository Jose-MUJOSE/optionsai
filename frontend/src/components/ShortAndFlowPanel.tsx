"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export default function ShortAndFlowPanel() {
  const { shortData, isShortDataLoading, marketData, locale } = useAppStore();
  const [activeTab, setActiveTab] = useState<"short" | "chip" | "smart">("short");

  if (!marketData) return null;

  if (isShortDataLoading) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm anim-fade-up">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">{t("short.title", locale)}</h3>
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {t("short.loading", locale)}
        </div>
      </div>
    );
  }

  if (!shortData) return null;

  const { short_interest, daily_short_volume, chip_distribution, smart_money } = shortData;

  const fmt = (v: number | null, suffix = "") => v != null ? `${v.toLocaleString()}${suffix}` : t("short.noData", locale);
  const fmtM = (v: number | null) => v != null ? `${(v / 1_000_000).toFixed(1)}M` : t("short.noData", locale);
  const sortedBuckets = [...(chip_distribution?.buckets ?? [])].sort((a, b) => b.price - a.price);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm anim-fade-up overflow-hidden">
      {/* Header + Tabs */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">{t("short.title", locale)}</h3>
        <div className="flex gap-1">
          {(["short", "chip", "smart"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === tab
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t(`short.tab${tab === "short" ? 1 : tab === "chip" ? 2 : 3}` as "short.tab1" | "short.tab2" | "short.tab3", locale)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {/* Tab 1: Short Selling */}
        {activeTab === "short" && (
          <div className="space-y-4">
            {/* Explanatory guide */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 space-y-1.5">
              {locale === "zh" ? (
                <>
                  <p className="font-semibold text-blue-900 mb-1">卖空数据解读指南</p>
                  <p>• <span className="font-medium">空头占流通股% (Short % of Float)</span>：空头持仓占流通股的比例。&gt;20%为极高，&gt;10%为高，&lt;5%为低。越高说明市场对该股悲观情绪越强。</p>
                  <p>• <span className="font-medium">回补天数 (Days to Cover)</span>：按日均成交量计算，空头全部平仓需要多少天。&gt;5天为较高挤压风险，数值越大，潜在轧空风险越大。</p>
                  <p>• <span className="font-medium">每日卖空占比</span>：单日卖空量/总成交量。FINRA RegSHO 来源，通常股票约40-50%为正常，显著偏高可能反映看空情绪。</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-blue-900 mb-1">Short Selling Guide</p>
                  <p>• <span className="font-medium">Short % of Float</span>: Short positions as % of float. &gt;20% = very high, &gt;10% = high, &lt;5% = low. Higher values indicate more bearish sentiment.</p>
                  <p>• <span className="font-medium">Days to Cover</span>: Days needed to cover all shorts at average daily volume. &gt;5 days = elevated squeeze risk. Higher = more short squeeze potential.</p>
                  <p>• <span className="font-medium">Daily Short Volume %</span>: Short volume / total volume per day. Source: FINRA RegSHO. ~40-50% is normal; significantly higher may reflect bearish sentiment.</p>
                </>
              )}
            </div>
            {/* Stats cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">{t("short.pctFloat", locale)}</div>
                <div className="text-lg font-bold text-red-500">{fmt(short_interest?.short_pct_float, "%")}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">{t("short.ratio", locale)}</div>
                <div className="text-lg font-bold text-gray-700">{fmt(short_interest?.short_ratio, "d")}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">{t("short.sharesShort", locale)}</div>
                <div className="text-lg font-bold text-gray-700">{fmtM(short_interest?.shares_short ?? null)}</div>
              </div>
            </div>
            {short_interest?.date_short_interest && (
              <p className="text-xs text-gray-400 text-center">
                {locale === "zh" ? `数据截至 ${short_interest.date_short_interest}` : `As of ${short_interest.date_short_interest}`}
                {" · "}{t("short.yahooSource", locale)}
              </p>
            )}

            {/* Daily short volume chart */}
            {daily_short_volume?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">{locale === "zh" ? "每日卖空量占比 (%)" : "Daily Short Volume (%)"}</p>
                  <p className="text-xs text-gray-400">{t("short.finraSource", locale)}</p>
                </div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily_short_volume} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#9ca3af" }} tickFormatter={(v: string) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "11px" }}
                        formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, locale === "zh" ? "卖空占比" : "Short %"]}
                      />
                      <Bar dataKey="short_pct" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Chip Distribution */}
        {activeTab === "chip" && (
          <div className="space-y-3">
            {/* Disclaimer */}
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">{t("short.disclaimer", locale)}</p>
            </div>

            {chip_distribution?.buckets?.length > 0 ? (
              <div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={sortedBuckets}
                      layout="vertical"
                      margin={{ top: 0, right: 10, left: 50, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: "#9ca3af" }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                      <YAxis type="category" dataKey="price" tick={{ fontSize: 9, fill: "#9ca3af" }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                      <Tooltip
                        contentStyle={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "11px" }}
                        formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, locale === "zh" ? "持仓权重" : "Weight"]}
                        labelFormatter={(l: unknown) => `$${Number(l).toFixed(2)}`}
                      />
                      <Bar
                        dataKey="weight"
                        radius={[0, 2, 2, 0]}
                        fill="#3b82f6"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {chip_distribution.current_price > 0 && (
                  <p className="text-xs text-center text-blue-600 mt-1">
                    {locale === "zh" ? `当前价格: $${chip_distribution.current_price.toFixed(2)}` : `Current: $${chip_distribution.current_price.toFixed(2)}`}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">{t("short.noData", locale)}</div>
            )}
          </div>
        )}

        {/* Tab 3: Smart Money */}
        {activeTab === "smart" && (
          <div className="space-y-4">
            {/* Explanatory guide */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 space-y-1.5">
              {locale === "zh" ? (
                <>
                  <p className="font-semibold text-blue-900 mb-1">聪明钱解读指南</p>
                  <p>• <span className="font-medium">机构持仓 (Institutions)</span>：来自SEC 13F季度申报，显示持仓变化百分比。正数=加仓，负数=减仓。大机构（贝莱德、先锋等）的动向往往领先市场。</p>
                  <p>• <span className="font-medium">内部人交易 (Insider Transactions)</span>：来自SEC Form 4，显示公司高管/董事的买卖行为。内部人买入通常是看涨信号，内部人卖出需结合是否有预定计划（Rule 10b5-1）判断。</p>
                  <p>• <span className="font-medium">如何使用</span>：机构大幅增持+内部人买入=强烈看涨信号；机构大幅减持+内部人卖出=警惕信号。</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-blue-900 mb-1">Smart Money Guide</p>
                  <p>• <span className="font-medium">Institutions</span>: From SEC 13F quarterly filings. Shows % change in holdings. Positive = added, negative = reduced. Large institutions (BlackRock, Vanguard, etc.) often lead the market.</p>
                  <p>• <span className="font-medium">Insider Transactions</span>: From SEC Form 4. Shows buying/selling by executives and directors. Insider buying is typically bullish; insider selling should be evaluated against pre-planned Rule 10b5-1 programs.</p>
                  <p>• <span className="font-medium">How to use</span>: Large institutional buying + insider buying = strong bullish signal; large institutional selling + insider selling = warning sign.</p>
                </>
              )}
            </div>
            {/* Institutional Holdings */}
            {smart_money?.institutions?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">
                    {locale === "zh" ? "机构持仓变化 (Top 10)" : "Institutional Holdings Change (Top 10)"}
                  </p>
                  <p className="text-xs text-gray-400">{smart_money.source_institutions}</p>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {smart_money.institutions.map((inst, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-gray-50">
                      <span className="text-xs text-gray-700 truncate max-w-[55%]">{inst.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">{inst.pct_held != null ? `${inst.pct_held.toFixed(2)}%` : "-"}</span>
                        <span className={`text-xs font-medium ${inst.pct_change != null && inst.pct_change > 0 ? "text-emerald-600" : inst.pct_change != null && inst.pct_change < 0 ? "text-red-500" : "text-gray-400"}`}>
                          {inst.pct_change != null ? `${inst.pct_change > 0 ? "+" : ""}${inst.pct_change.toFixed(2)}%` : "-"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Insider Transactions */}
            {smart_money?.insiders?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">
                    {locale === "zh" ? "内部人交易" : "Insider Transactions"}
                  </p>
                  <p className="text-xs text-gray-400">{smart_money.source_insiders}</p>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {smart_money.insiders.map((txn, i) => {
                    const isBuy = txn.transaction_type.toLowerCase().includes("purchase") || txn.transaction_type.toLowerCase().includes("buy");
                    const isSell = txn.transaction_type.toLowerCase().includes("sale") || txn.transaction_type.toLowerCase().includes("sell");
                    return (
                      <div key={i} className="flex items-center justify-between py-1 border-b border-gray-50">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 block truncate">{txn.name}</span>
                          <span className="text-[10px] text-gray-400">{txn.relation} · {txn.date}</span>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isBuy ? "bg-emerald-50 text-emerald-600" : isSell ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-500"}`}>
                            {isBuy ? (locale === "zh" ? "买入" : "BUY") : isSell ? (locale === "zh" ? "卖出" : "SELL") : txn.transaction_type.slice(0, 10)}
                          </span>
                          {txn.value != null && (
                            <span className="text-xs text-gray-400">${(txn.value / 1000).toFixed(0)}K</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(!smart_money?.institutions?.length && !smart_money?.insiders?.length) && (
              <div className="text-center py-8 text-gray-400 text-sm">{t("short.noData", locale)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
