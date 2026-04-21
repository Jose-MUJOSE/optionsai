"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

const NEWS_DEFAULT_SHOW = 8;

export default function MarketIntel() {
  const { marketIntel, isMarketIntelLoading, marketIntelError, locale, marketData } = useAppStore();
  const [newsExpanded, setNewsExpanded] = useState(false);

  if (isMarketIntelLoading) {
    return (
      <div className="text-center text-blue-500 text-sm font-medium py-6 anim-pulse-soft">
        {t("intel.loading", locale)}
      </div>
    );
  }

  if (marketIntelError || !marketIntel) return null;

  const hasNews = marketIntel.news && marketIntel.news.length > 0;
  const hasEvents = marketIntel.events && marketIntel.events.length > 0;
  const hasAnalysts = marketIntel.analyst_targets && marketIntel.analyst_targets.length > 0;
  if (!hasNews && !hasEvents && !hasAnalysts) return null;

  const spotPrice = marketData?.spot_price ?? marketIntel.spot_price ?? 0;

  const getRatingColor = (rating: string) => {
    const lower = rating.toLowerCase();
    if (lower.includes("buy") || lower.includes("outperform") || lower.includes("overweight") || lower.includes("上调") || lower.includes("upgrade") || lower.includes("首次覆盖")) return "text-emerald-600 bg-emerald-50";
    if (lower.includes("hold") || lower.includes("neutral") || lower.includes("sector perform") || lower.includes("持有") || lower.includes("维持") || lower.includes("重申")) return "text-amber-600 bg-amber-50";
    if (lower.includes("sell") || lower.includes("underperform") || lower.includes("underweight") || lower.includes("下调") || lower.includes("downgrade")) return "text-red-600 bg-red-50";
    return "text-gray-600 bg-gray-50";
  };

  const getUpsideColor = (upside: number) => {
    if (upside > 15) return "text-emerald-600";
    if (upside > 0) return "text-emerald-500";
    if (upside > -10) return "text-amber-500";
    return "text-red-500";
  };

  const eventTypeIcons: Record<string, string> = {
    earnings: "\u{1F4CA}",
    product: "\u{1F680}",
    regulatory: "\u2696\uFE0F",
    other: "\u{1F4CC}",
  };

  return (
    <div className="space-y-4 anim-fade-up">
      <h3 className="text-sm font-medium text-gray-500">{t("intel.title", locale)}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-children">
        {/* Latest News */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("intel.news", locale)}</h4>
          {hasNews ? (
            <div className="space-y-1">
              {marketIntel.news.slice(0, newsExpanded ? undefined : NEWS_DEFAULT_SHOW).map((item, i) => (
                <a
                  key={i}
                  href={item.url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block group"
                >
                  <div className="border-l-2 border-transparent group-hover:border-blue-400 pl-3 py-1.5 transition-all cursor-pointer">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-gray-400">{item.date}</span>
                      {item.source && <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{item.source}</span>}
                    </div>
                    <p className="text-sm text-gray-700 group-hover:text-blue-600 transition-colors leading-snug font-medium">
                      {item.title}
                    </p>
                    {item.summary && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.summary}</p>
                    )}
                  </div>
                </a>
              ))}
              {marketIntel.news.length > NEWS_DEFAULT_SHOW && (
                <button
                  onClick={() => setNewsExpanded(!newsExpanded)}
                  className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium cursor-pointer transition-colors"
                >
                  {newsExpanded
                    ? (locale === "zh" ? "折叠" : "Show less")
                    : (locale === "zh" ? `展开全部 (${marketIntel.news.length})` : `Show all (${marketIntel.news.length})`)}
                </button>
              )}
            </div>
          ) : (
            <div className="text-xs text-gray-400">{locale === "zh" ? "暂无新闻数据" : "No news available"}</div>
          )}
        </div>

        {/* Upcoming Events */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("intel.events", locale)}</h4>
          {hasEvents ? (
            <div className="space-y-3">
              {marketIntel.events.map((item, i: number) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-base mt-0.5">{eventTypeIcons[item.type] || "\u{1F4CC}"}</span>
                  <div>
                    <div className="text-[10px] text-gray-400 font-medium">{item.date}</div>
                    <div className="text-sm text-gray-700 leading-snug">{item.description}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-400">{locale === "zh" ? "暂无事件数据" : "No events available"}</div>
          )}
        </div>

        {/* Analyst Targets - now with individual target prices */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("intel.analysts", locale)}</h4>
          {hasAnalysts ? (
            <div className="space-y-2.5">
              {marketIntel.analyst_targets.map((item, i: number) => {
                const isConsensus = i === 0 && (item.institution === "\u534e\u5c14\u8857\u5171\u8bc6" || item.institution === "Wall Street Consensus");
                const targetPrice = item.target_price as number | null;
                const upside = targetPrice && spotPrice > 0 ? ((targetPrice - spotPrice) / spotPrice * 100) : null;

                return (
                  <div key={i} className={`${isConsensus ? "bg-blue-50 rounded-xl p-3 -mx-1 mb-2" : "py-1"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${isConsensus ? "text-blue-700" : "text-gray-700"}`}>
                          {item.institution as string}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {(item.date as string) && <span className="text-[10px] text-gray-400">{item.date as string}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${getRatingColor(item.rating as string || "")}`}>
                          {item.rating as string}
                        </span>
                        {targetPrice != null && targetPrice > 0 && (
                          <div className="text-right">
                            <div className="text-sm font-bold text-gray-800">${targetPrice}</div>
                            {upside !== null && (
                              <div className={`text-[10px] font-medium ${getUpsideColor(upside)}`}>
                                {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {isConsensus && (item.target_high as number) && (item.target_low as number) && (
                      <div className="mt-2 flex items-center gap-3 text-[10px]">
                        <span className="text-gray-500">
                          {locale === "zh" ? "\u76ee\u6807\u533a\u95f4" : "Range"}: <span className="font-medium text-gray-700">${item.target_low as number} - ${item.target_high as number}</span>
                        </span>
                        {(item.num_analysts as number) > 0 && (
                          <span className="text-gray-500">
                            {locale === "zh" ? "\u5206\u6790\u5e08\u6570" : "Analysts"}: <span className="font-medium text-gray-700">{item.num_analysts as number}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-gray-400">{locale === "zh" ? "\u6682\u65e0\u5206\u6790\u5e08\u6570\u636e" : "No analyst data available"}</div>
          )}
        </div>
      </div>
    </div>
  );
}
