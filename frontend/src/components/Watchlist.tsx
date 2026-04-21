"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, RefreshCw, Sparkles, X, Search, ArrowUpRight } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import {
  useWatchlist,
  classifyTicker,
  CATEGORY_LABELS,
  type AssetCategory,
} from "@/lib/watchlist";

interface WatchlistProps {
  onOpenTicker: (ticker: string) => void;
}

export default function Watchlist({ onOpenTicker }: WatchlistProps) {
  const { locale } = useAppStore();
  const { items, quotes, loadingTickers, add, remove, autoClassifyAll, refreshAll, refreshOne } = useWatchlist();

  const [inputValue, setInputValue] = useState("");
  const [filter, setFilter] = useState<AssetCategory | "all">("all");

  const grouped = useMemo(() => {
    const map = new Map<AssetCategory, typeof items>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    return map;
  }, [items]);

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = inputValue.trim().toUpperCase();
    if (!ticker) return;
    add(ticker);
    setInputValue("");
  };

  const catFilters: Array<AssetCategory | "all"> = [
    "all",
    ...Array.from(grouped.keys()),
  ];

  return (
    <div className="anim-fade-up space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[var(--text-0)]">
            {t("watchlist.title", locale)}
          </h2>
          <p className="text-xs text-[var(--text-2)] mt-1">
            {t("watchlist.subtitle", locale)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={autoClassifyAll}
            className="px-3 py-1.5 text-xs flex items-center gap-1.5 rounded-lg accent-border bg-white text-[var(--text-1)] hover:text-[var(--accent-hot)] transition-all cursor-pointer"
            title={t("watchlist.autoClassify", locale)}
          >
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
            {t("watchlist.autoClassify", locale)}
          </button>
          <button
            onClick={() => void refreshAll()}
            className="px-3 py-1.5 text-xs flex items-center gap-1.5 rounded-lg accent-border bg-white text-[var(--text-1)] hover:text-[var(--accent-hot)] transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("watchlist.refresh", locale)}
          </button>
        </div>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="panel px-4 py-3 flex items-center gap-3">
        <Search className="w-4 h-4 text-[var(--text-2)] shrink-0" />
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.toUpperCase())}
          placeholder={t("watchlist.addPlaceholder", locale)}
          className="flex-1 bg-transparent text-sm text-[var(--text-0)] placeholder-[var(--text-3)] outline-none"
        />
        {inputValue && (
          <span className="text-[10px] uppercase tracking-widest text-[var(--text-2)]">
            → <span className="text-[var(--accent)] ml-1 font-semibold">
              {CATEGORY_LABELS[classifyTicker(inputValue)][locale]}
            </span>
          </span>
        )}
        <button
          type="submit"
          disabled={!inputValue.trim()}
          className="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hot)] transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_2px_8px_-2px_rgba(45,76,221,0.45)] cursor-pointer font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> {t("watchlist.add", locale)}
        </button>
      </form>

      {/* Category filter chips */}
      {items.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {catFilters.map((f) => {
            const label = f === "all" ? t("watchlist.all", locale) : CATEGORY_LABELS[f as AssetCategory][locale];
            const count = f === "all" ? items.length : grouped.get(f as AssetCategory)?.length ?? 0;
            const color = f === "all" ? "#2d4cdd" : CATEGORY_LABELS[f as AssetCategory].color;
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[11px] font-medium rounded-full border transition-all cursor-pointer ${
                  active
                    ? "border-[var(--accent)] text-[var(--accent-hot)] bg-[var(--accent-soft)]"
                    : "border-[var(--line-soft)] text-[var(--text-2)] bg-white hover:text-[var(--text-0)] hover:border-[var(--line-mid)]"
                }`}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                  style={{ background: color }}
                />
                {label}
                <span className="ml-1.5 text-[var(--text-3)]">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="panel py-16 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[var(--accent-soft)] border border-[rgba(45,76,221,0.18)] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div className="text-sm text-[var(--text-0)] font-medium mb-1">{t("watchlist.emptyTitle", locale)}</div>
          <div className="text-xs text-[var(--text-2)]">{t("watchlist.emptyDesc", locale)}</div>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((item) => {
            const q = quotes[item.ticker];
            const isLoading = loadingTickers.has(item.ticker);
            const up = (q?.changePct ?? 0) >= 0;
            const color = CATEGORY_LABELS[item.category].color;
            return (
              <div
                key={item.ticker}
                className="panel relative px-4 py-3.5 group hover:shadow-[var(--shadow-md)] hover:border-[var(--line-mid)] transition-all anim-fade-up"
              >
                {/* Category strip */}
                <div
                  className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r"
                  style={{ background: color }}
                />
                <div className="flex items-start justify-between gap-2 pl-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-[var(--text-2)] font-medium">
                        {CATEGORY_LABELS[item.category][locale]}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <button
                        onClick={() => onOpenTicker(item.ticker)}
                        className="text-[15px] font-semibold text-[var(--text-0)] hover:text-[var(--accent)] transition-colors flex items-center gap-1 cursor-pointer tracking-tight"
                      >
                        {item.ticker}
                        <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void refreshOne(item.ticker)}
                      className="p-1 rounded text-[var(--text-2)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer"
                      title="Refresh"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin text-[var(--accent)]" : ""}`} />
                    </button>
                    <button
                      onClick={() => remove(item.ticker)}
                      className="p-1 rounded text-[var(--text-2)] hover:text-[var(--fin-down)] hover:bg-[var(--fin-down-soft)] transition-all cursor-pointer"
                      title={t("watchlist.remove", locale)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Price row */}
                <div className="pl-2 mt-2 flex items-baseline justify-between">
                  <div className="text-[22px] font-semibold mono text-[var(--text-0)] tracking-tight tabular">
                    {q ? (
                      <>
                        <span className="text-[13px] text-[var(--text-2)] mr-0.5">$</span>
                        {q.price.toFixed(2)}
                      </>
                    ) : isLoading ? (
                      <span className="text-[var(--text-3)] text-sm">— —</span>
                    ) : (
                      <span className="text-[var(--text-3)] text-sm">—</span>
                    )}
                  </div>
                  {q && (
                    <div
                      className={`text-xs font-semibold mono px-2 py-0.5 rounded tabular ${
                        up
                          ? "text-[var(--fin-up)] bg-[var(--fin-up-soft)]"
                          : "text-[var(--fin-down)] bg-[var(--fin-down-soft)]"
                      }`}
                    >
                      {up ? "▲" : "▼"} {up ? "+" : ""}
                      {q.changePct.toFixed(2)}%
                    </div>
                  )}
                </div>

                {/* Footer: IV + updated */}
                <div className="pl-2 mt-2 flex items-center justify-between text-[10px] text-[var(--text-2)] uppercase tracking-wider">
                  <span className="tabular">
                    {q?.iv !== undefined
                      ? `IV ${q.iv.toFixed(1)}%`
                      : t("watchlist.noIv", locale)}
                  </span>
                  <span className="tabular">
                    {q?.updatedAt
                      ? new Date(q.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                      : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filter !== "all" && filtered.length === 0 && (
        <div className="panel py-10 text-center text-sm text-[var(--text-2)] flex items-center justify-center gap-2">
          <span>{t("watchlist.emptyFilter", locale)}</span>
          <button
            onClick={() => setFilter("all")}
            className="text-[var(--accent)] hover:text-[var(--accent-hot)] inline-flex items-center gap-1 cursor-pointer font-medium"
          >
            <X className="w-3 h-3" /> {t("watchlist.clearFilter", locale)}
          </button>
        </div>
      )}
    </div>
  );
}
