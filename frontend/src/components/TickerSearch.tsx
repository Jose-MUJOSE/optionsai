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
const CN_SS_RE = /^\d{6}\.SS$/;     // Shanghai A-shares (e.g. 600519.SS)
const CN_SZ_RE = /^\d{6}\.SZ$/;     // Shenzhen A-shares (e.g. 000001.SZ)
const HK_RE = /^\d{4,5}\.HK$/;       // Hong Kong stocks (e.g. 0700.HK)

interface TickerSearchProps {
  showChips?: boolean;
}

export default function TickerSearch({ showChips = true }: TickerSearchProps) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const { searchTicker, isLoadingMarket, marketData, marketError, locale } = useAppStore();

  // Local-format check: covers the obvious cases (suffixes like =F, -, ^)
  // and gives instant feedback before hitting the network. We accept US,
  // A-share, and HK formats — non-options markets just have their options
  // features auto-disabled downstream.
  const validateLocally = (raw: string): string | null => {
    const t = raw.trim().toUpperCase();
    if (!t) return locale === "zh" ? "请输入股票代码" : "Please enter a ticker";

    // Accept A-shares (Shanghai/Shenzhen) and HK explicitly. These formats
    // pass validation; options-related views will be disabled by the store
    // based on `marketData.expirations.length === 0`.
    if (CN_SS_RE.test(t) || CN_SZ_RE.test(t) || HK_RE.test(t) || US_TICKER_RE.test(t)) {
      return null;
    }

    if (t.includes("=")) {
      return locale === "zh"
        ? "暂不支持期货/外汇代码。"
        : "Futures and forex not supported.";
    }
    if (t.includes("-")) {
      return locale === "zh"
        ? "暂不支持加密货币对。"
        : "Crypto pairs not supported.";
    }
    if (t.startsWith("^")) {
      return locale === "zh"
        ? "指数代码无可交易期权，请改用对应 ETF（如 SPY、QQQ、DIA）。"
        : "Index symbols have no tradable options. Use the corresponding ETF (SPY, QQQ, DIA).";
    }
    if (t.includes(".")) {
      const suffix = t.split(".", 2)[1];
      return locale === "zh"
        ? `无法识别的代码后缀「.${suffix}」。请输入美股（AAPL）、A股（600519.SS）或港股（0700.HK）。`
        : `Unrecognized suffix .${suffix}. Use US (AAPL), A-share (600519.SS), or HK (0700.HK).`;
    }
    return locale === "zh"
      ? "代码格式错误。美股 1-5 字母、A股 6 位数字+.SS/.SZ、港股 4-5 位数字+.HK。"
      : "Invalid format. US: 1-5 letters; A-share: 6 digits+.SS/.SZ; HK: 4-5 digits+.HK.";
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
          placeholder={locale === "zh" ? "美股 AAPL / A股 600519.SS / 港股 0700.HK" : "US: AAPL · A-share: 600519.SS · HK: 0700.HK"}
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
