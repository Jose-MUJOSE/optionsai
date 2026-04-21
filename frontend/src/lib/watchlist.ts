// ============================================================
// OptionsAI — Watchlist (localStorage-backed, polled live prices)
// ============================================================
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMarketData } from "./api";

export type AssetCategory =
  | "stock"
  | "etf"
  | "crypto"
  | "forex"
  | "futures"
  | "hk"
  | "cn"
  | "index";

export interface WatchItem {
  ticker: string;
  category: AssetCategory;
  addedAt: number;
}

export interface WatchQuote {
  price: number;
  changePct: number;
  iv?: number;
  ivRank?: number;
  updatedAt: number;
}

const STORAGE_KEY = "optionsai.watchlist.v1";
const REFRESH_MS = 30_000;

// Common ETF tickers (non-exhaustive, deterministic — no fabrication)
const ETF_SET = new Set([
  "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "VEA", "VWO", "VT",
  "GLD", "SLV", "USO", "UNG", "TLT", "IEF", "HYG", "LQD",
  "ARKK", "ARKG", "ARKW", "ARKQ", "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "XLP", "XLU", "XLB",
  "EEM", "EFA", "FXI", "MCHI", "EWJ", "INDA",
  "TQQQ", "SQQQ", "SOXL", "SOXS", "UVXY", "VXX",
]);

const INDEX_SET = new Set([
  "^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^HSI", "^N225", "000001.SS",
]);

/** Deterministic, pattern-based classifier. No fabrication. */
export function classifyTicker(raw: string): AssetCategory {
  const t = raw.trim().toUpperCase();
  if (INDEX_SET.has(t) || t.startsWith("^")) return "index";
  if (t.endsWith("-USD") || t.endsWith("-USDT") || t.endsWith("-BTC")) return "crypto";
  if (t.endsWith("=F")) return "futures";
  if (t.endsWith("=X")) return "forex";
  if (t.endsWith(".HK")) return "hk";
  if (t.endsWith(".SS") || t.endsWith(".SZ")) return "cn";
  if (ETF_SET.has(t)) return "etf";
  return "stock";
}

export const CATEGORY_LABELS: Record<AssetCategory, { en: string; zh: string; color: string }> = {
  stock:   { en: "Stocks",   zh: "股票",   color: "#48c4ff" },
  etf:     { en: "ETFs",     zh: "ETF",    color: "#8a6cff" },
  crypto:  { en: "Crypto",   zh: "加密货币", color: "#ffb648" },
  forex:   { en: "Forex",    zh: "外汇",    color: "#30ffc1" },
  futures: { en: "Futures",  zh: "期货",    color: "#ff4e6a" },
  hk:      { en: "HK Stocks", zh: "港股",   color: "#ff89c2" },
  cn:      { en: "A-Shares", zh: "A股",     color: "#ffcf4e" },
  index:   { en: "Indices",  zh: "指数",    color: "#7bdcff" },
};

function readStorage(): WatchItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultList();
    const parsed = JSON.parse(raw) as WatchItem[];
    if (!Array.isArray(parsed)) return defaultList();
    return parsed.filter(
      (x): x is WatchItem =>
        !!x && typeof x.ticker === "string" && typeof x.category === "string"
    );
  } catch {
    return defaultList();
  }
}

function defaultList(): WatchItem[] {
  const now = Date.now();
  return [
    { ticker: "AAPL",    category: "stock",  addedAt: now },
    { ticker: "NVDA",    category: "stock",  addedAt: now },
    { ticker: "SPY",     category: "etf",    addedAt: now },
    { ticker: "BTC-USD", category: "crypto", addedAt: now },
  ];
}

function writeStorage(items: WatchItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Silently ignore storage errors (quota exceeded, Safari private mode).
  }
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, WatchQuote>>({});
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Hydrate from storage on mount
  useEffect(() => {
    setItems(readStorage());
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Persist on change
  useEffect(() => {
    if (items.length > 0 || window.localStorage.getItem(STORAGE_KEY)) {
      writeStorage(items);
    }
  }, [items]);

  const add = useCallback((rawTicker: string, categoryOverride?: AssetCategory) => {
    const ticker = rawTicker.trim().toUpperCase();
    if (!ticker) return;
    setItems((prev) => {
      if (prev.some((x) => x.ticker === ticker)) return prev;
      return [
        ...prev,
        {
          ticker,
          category: categoryOverride ?? classifyTicker(ticker),
          addedAt: Date.now(),
        },
      ];
    });
  }, []);

  const remove = useCallback((ticker: string) => {
    setItems((prev) => prev.filter((x) => x.ticker !== ticker));
    setQuotes((prev) => {
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
  }, []);

  const recategorize = useCallback((ticker: string, category: AssetCategory) => {
    setItems((prev) => prev.map((x) => (x.ticker === ticker ? { ...x, category } : x)));
  }, []);

  const autoClassifyAll = useCallback(() => {
    setItems((prev) => prev.map((x) => ({ ...x, category: classifyTicker(x.ticker) })));
  }, []);

  const refreshOne = useCallback(async (ticker: string) => {
    setLoadingTickers((prev) => new Set(prev).add(ticker));
    try {
      const md = await fetchMarketData(ticker);
      if (!mountedRef.current) return;
      setQuotes((prev) => ({
        ...prev,
        [ticker]: {
          price: md.spot_price,
          changePct: md.change_pct,
          iv: md.iv_current,
          ivRank: md.iv_rank,
          updatedAt: Date.now(),
        },
      }));
    } catch {
      // Keep previous quote on failure; UI shows stale timestamp.
    } finally {
      if (mountedRef.current) {
        setLoadingTickers((prev) => {
          const next = new Set(prev);
          next.delete(ticker);
          return next;
        });
      }
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const current = items.map((x) => x.ticker);
    // Fire in parallel but don't await (UI updates per-ticker)
    current.forEach((t) => {
      void refreshOne(t);
    });
  }, [items, refreshOne]);

  // Initial + periodic refresh
  useEffect(() => {
    if (items.length === 0) return;
    void refreshAll();
    const id = window.setInterval(() => {
      void refreshAll();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  return {
    items,
    quotes,
    loadingTickers,
    add,
    remove,
    recategorize,
    autoClassifyAll,
    refreshOne,
    refreshAll,
  };
}
