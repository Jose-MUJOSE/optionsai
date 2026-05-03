"use client";

/**
 * MarketNotice — bilingual banner that calls out market-specific limitations.
 *
 * For A-share / HK tickers, options-related features (chain, IV, GEX,
 * strategies, scanner, pattern scanner pieces) are unavailable because those
 * markets don't have a US-style listed options chain.
 *
 * We surface this prominently on the dashboard the moment a non-US ticker is
 * loaded, so the user understands up-front why the "Options Research" tab is
 * empty and the strategies view shows no recommendations.
 */

import { Info } from "lucide-react";
import { useAppStore } from "@/lib/store";

/** Detect ticker market from suffix. Same rules as the validators. */
function detectMarket(ticker: string): "us" | "cn_a" | "hk" {
  const t = ticker.toUpperCase().trim();
  if (/\d{6}\.(SS|SZ)$/.test(t)) return "cn_a";
  if (/\d{4,5}\.HK$/.test(t)) return "hk";
  return "us";
}

export default function MarketNotice() {
  const { marketData, locale } = useAppStore();
  if (!marketData) return null;
  const market = detectMarket(marketData.ticker);
  if (market === "us") return null;

  const isZh = locale === "zh";
  const marketLabel = market === "cn_a"
    ? (isZh ? "A 股" : "A-share")
    : (isZh ? "港股" : "Hong Kong");

  return (
    <div className="rounded-2xl bg-gradient-to-r from-[var(--accent-soft)] to-[rgba(109,78,224,0.08)] border border-[var(--line-mid)] p-4 anim-fade-up">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/80 flex items-center justify-center flex-shrink-0">
          <Info className="w-4 h-4 text-[var(--accent)]" strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-bold text-[var(--text-0)]">
              {isZh ? `当前为${marketLabel}研究模式` : `${marketLabel} Research Mode`}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent)] text-white tracking-wider">
              {isZh ? "仅股票研究" : "STOCK ONLY"}
            </span>
          </div>
          <p className="text-xs text-[var(--text-1)] leading-relaxed">
            {isZh
              ? `${marketLabel}没有个股期权数据。本平台为您提供股票研究、技术形态、财报历史、分析师评级等所有股票相关功能，但「期权研究」「策略推荐」「策略扫描器」等期权功能不可用。如需期权研究请输入美股代码（如 AAPL、TSLA）。`
              : `${marketLabel} stocks have no listed options chain. All stock-research features remain available — fundamentals, technical patterns, earnings history, analyst ratings — but Options Research, Strategies, and the Strategy Scanner are unavailable. For options research, enter a US ticker (e.g. AAPL, TSLA).`}
          </p>
        </div>
      </div>
    </div>
  );
}
