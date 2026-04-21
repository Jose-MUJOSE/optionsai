"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Search, Loader2, ChevronDown } from "lucide-react";

const TICKER_GROUPS = {
  us:     { label_key: "market.us"     as const, tickers: ["AAPL", "TSLA", "NVDA", "AMZN", "META", "MSFT", "GOOGL", "AVGO"] },
  etf:    { label_key: "market.etf"    as const, tickers: ["SPY", "QQQ", "IWM", "DIA", "VTI", "GLD", "TLT", "ARKK"] },
  crypto: { label_key: "market.crypto" as const, tickers: ["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "BNB-USD", "XRP-USD"] },
  futures:{ label_key: "market.futures" as const, tickers: ["GC=F", "CL=F", "NG=F", "ES=F", "NQ=F", "SI=F"] },
  forex:  { label_key: "market.forex"  as const, tickers: ["EURUSD=X", "JPY=X", "GBPUSD=X", "AUDUSD=X", "CNY=X"] },
  hk:     { label_key: "market.hk"     as const, tickers: ["0700.HK", "9988.HK", "9618.HK", "0005.HK", "1810.HK", "2318.HK"] },
  cn:     { label_key: "market.cn"     as const, tickers: ["600519.SS", "000858.SZ", "601318.SS", "300750.SZ", "000001.SZ", "600036.SS"] },
  index:  { label_key: "market.index"  as const, tickers: ["^GSPC", "^DJI", "^IXIC", "^VIX", "^RUT"] },
};

type GroupKey = keyof typeof TICKER_GROUPS;

interface TickerSearchProps {
  /** When true, render the chips grid below the search input. Set false for compact inline use. */
  showChips?: boolean;
}

export default function TickerSearch({ showChips = true }: TickerSearchProps) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { searchTicker, isLoadingMarket, marketData, locale } = useAppStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) searchTicker(input.trim());
  };

  const visibleGroups: GroupKey[] = expanded
    ? (Object.keys(TICKER_GROUPS) as GroupKey[])
    : ["us", "etf", "crypto"];

  return (
    <div className="w-full max-w-xl space-y-3">
      <form onSubmit={handleSubmit} className="relative w-full">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-2)]" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder={t("search.placeholder", locale)}
          className="w-full pl-11 pr-11 py-2.5 bg-white border border-[var(--line-mid)] rounded-full text-[var(--text-0)] placeholder-[var(--text-3)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition-all shadow-[var(--shadow-sm)]"
        />
        {isLoadingMarket && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--accent)] animate-spin" />
        )}
      </form>

      {showChips && !marketData && (
        <div className="space-y-1.5">
          {visibleGroups.map((key) => {
            const group = TICKER_GROUPS[key];
            return (
              <div key={key} className="flex items-center gap-1.5 flex-wrap anim-fade-up">
                <span className="text-[10px] text-[var(--text-2)] w-14 shrink-0 font-semibold uppercase tracking-widest">
                  {t(group.label_key, locale)}
                </span>
                {group.tickers.map((ticker) => (
                  <button
                    key={ticker}
                    onClick={() => searchTicker(ticker)}
                    className="px-2.5 py-0.5 text-[11px] font-medium bg-white hover:bg-[var(--accent-soft)] text-[var(--text-1)] hover:text-[var(--accent-hot)] rounded-full border border-[var(--line-soft)] hover:border-[rgba(45,76,221,0.24)] transition-all cursor-pointer mono"
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            );
          })}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-[var(--text-2)] hover:text-[var(--accent)] uppercase tracking-widest mt-2 transition-colors cursor-pointer font-medium"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? t("search.less", locale) : t("search.more", locale)}
          </button>
        </div>
      )}
    </div>
  );
}
