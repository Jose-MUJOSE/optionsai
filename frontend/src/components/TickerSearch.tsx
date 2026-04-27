"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Search, Loader2, ChevronDown, AlertCircle } from "lucide-react";

// US market only — A-shares have no individual stock options, HK/forex/futures
// either have no public chain or no retail options market. Crypto pairs (BTC-USD)
// are blocked too. Index symbols (^GSPC) are intentionally absent — direct the
// user to the corresponding ETF instead.
const TICKER_GROUPS = {
  us:    { label_key: "market.us"    as const, tickers: ["AAPL", "TSLA", "NVDA", "AMZN", "META", "MSFT", "GOOGL", "AVGO"] },
  etf:   { label_key: "market.etf"   as const, tickers: ["SPY", "QQQ", "IWM", "DIA", "VTI", "GLD", "TLT", "ARKK"] },
  blue:  { label_key: "market.blue"  as const, tickers: ["BRK.B", "JPM", "JNJ", "V", "MA", "WMT", "PG", "UNH"] },
};

type GroupKey = keyof typeof TICKER_GROUPS;

// Client-side mirror of backend US validation. Catches obvious bad input
// before round-tripping to the API.
const US_TICKER_RE = /^[A-Z][A-Z0-9]{0,4}(\.[AB])?$/;

interface TickerSearchProps {
  showChips?: boolean;
}

export default function TickerSearch({ showChips = true }: TickerSearchProps) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { searchTicker, isLoadingMarket, marketData, marketError, locale } = useAppStore();

  // Local-format check: covers the obvious cases (suffixes like .HK, =F, -)
  // and gives instant feedback before hitting the network.
  const validateLocally = (raw: string): string | null => {
    const t = raw.trim().toUpperCase();
    if (!t) return locale === "zh" ? "请输入股票代码" : "Please enter a ticker";
    if (t.includes(".")) {
      const suffix = t.split(".", 2)[1];
      if (suffix === "SS" || suffix === "SZ") {
        return locale === "zh"
          ? "暂不支持 A 股（无个股期权）。请输入美股代码，如 AAPL、TSLA。"
          : "A-shares not supported (no individual stock options). Enter a US ticker like AAPL.";
      }
      if (suffix === "HK") {
        return locale === "zh" ? "暂不支持港股，请输入美股代码。" : "HK stocks not supported. Enter a US ticker.";
      }
      if (suffix !== "A" && suffix !== "B") {
        return locale === "zh" ? `无法识别的代码后缀 .${suffix}` : `Unrecognized suffix .${suffix}`;
      }
    }
    if (t.includes("=")) {
      return locale === "zh"
        ? "暂不支持期货/外汇代码。"
        : "Futures and forex not supported.";
    }
    if (t.includes("-")) {
      return locale === "zh"
        ? "暂不支持加密货币对（无期权市场）。"
        : "Crypto pairs not supported (no options market).";
    }
    if (t.startsWith("^")) {
      return locale === "zh"
        ? "指数无可交易期权，请改用对应 ETF（如 SPY、QQQ、DIA）。"
        : "Index symbols have no tradable options. Use the corresponding ETF (SPY, QQQ, DIA).";
    }
    if (!US_TICKER_RE.test(t)) {
      return locale === "zh"
        ? "请输入 1-5 个字母的美股代码"
        : "Enter a 1-5 letter US ticker";
    }
    return null;
  };

  const submit = (raw: string) => {
    const err = validateLocally(raw);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    searchTicker(raw.trim());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  const visibleGroups: GroupKey[] = expanded
    ? (Object.keys(TICKER_GROUPS) as GroupKey[])
    : ["us", "etf"];

  // Surface either the local validation error or the server-side validation error
  const displayError = clientError ?? (marketError && /A-shares|港股|invalid|无效|不支持|not supported/i.test(marketError) ? marketError : null);

  return (
    <div className="w-full max-w-xl space-y-3">
      <form onSubmit={handleSubmit} className="relative w-full">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-2)]" />
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value.toUpperCase());
            if (clientError) setClientError(null);
          }}
          placeholder={locale === "zh" ? "输入美股代码（如 AAPL、TSLA）" : "Enter US ticker (AAPL, TSLA, ...)"}
          className={`w-full pl-11 pr-11 py-2.5 bg-white border rounded-full text-[var(--text-0)] placeholder-[var(--text-3)] text-sm focus:outline-none focus:ring-4 transition-all shadow-[var(--shadow-sm)] ${
            displayError
              ? "border-red-400 focus:border-red-500 focus:ring-red-100"
              : "border-[var(--line-mid)] focus:border-[var(--accent)] focus:ring-[var(--accent-soft)]"
          }`}
        />
        {isLoadingMarket && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--accent)] animate-spin" />
        )}
      </form>

      {displayError && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700 anim-fade-up"
        >
          <AlertCircle className="w-4 h-4 mt-px shrink-0" />
          <span className="leading-snug">{displayError}</span>
        </div>
      )}

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
                    onClick={() => submit(ticker)}
                    className="px-2.5 py-0.5 text-[11px] font-medium bg-white hover:bg-[var(--accent-soft)] text-[var(--text-1)] hover:text-[var(--accent-hot)] rounded-full border border-[var(--line-soft)] hover:border-[rgba(45,76,221,0.24)] transition-all cursor-pointer mono hover:scale-105 hover:-translate-y-px"
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
