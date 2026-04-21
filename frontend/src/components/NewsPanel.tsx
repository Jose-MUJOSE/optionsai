"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Newspaper, Calendar, Target, Loader2, Search, ArrowUpRight, Clock } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t, type Locale } from "@/lib/i18n";
import { useWatchlist } from "@/lib/watchlist";
import { fetchMarketIntel, type MarketIntelResponse } from "@/lib/api";

type Tab = "news" | "events" | "analysts";

interface FeedEntry {
  intel: MarketIntelResponse;
  fetchedAt: number;
}

// Default market-pulse tickers so the News page is never empty even when
// the user has no watchlist and hasn't picked a ticker yet.
const MARKET_PULSE: readonly string[] = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"];

/**
 * Format an ISO-like date string as a relative timestamp
 * (e.g. "2h ago", "3d ago"). Falls back to the raw date on failure.
 */
function formatRelative(dateStr: string, locale: Locale): string {
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) return dateStr;
  const delta = Date.now() - parsed;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return t("news.justNow", locale);
  if (minutes < 60) return `${minutes}${t("news.minutesAgo", locale)}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t("news.hoursAgo", locale)}`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}${t("news.daysAgo", locale)}`;
  // Fall back to short absolute date for older items
  const d = new Date(parsed);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Extract hostname from a URL for a tiny source-domain badge. */
function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function NewsPanel() {
  const { locale, marketIntel, ticker, isMarketIntelLoading, fetchMarketIntel: refetchCurrent } = useAppStore();
  const { items } = useWatchlist();

  const [tab, setTab] = useState<Tab>("news");
  const [feedFilter, setFeedFilter] = useState<string>("all"); // ticker filter
  const [feedData, setFeedData] = useState<Record<string, FeedEntry>>({});
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());
  // Infinite-scroll: show N items at a time, grow with IntersectionObserver
  const NEWS_PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState<number>(NEWS_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Build a roster: watchlist + currently viewed ticker + market pulse tickers
  // so the News page always has content to show.
  const roster = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => s.add(i.ticker));
    if (ticker) s.add(ticker);
    MARKET_PULSE.forEach((p) => s.add(p));
    return Array.from(s);
  }, [items, ticker]);

  // Load news for each ticker in roster (lazy, cached in-memory)
  useEffect(() => {
    if (roster.length === 0) return;
    const missing = roster.filter((x) => !feedData[x]);
    if (missing.length === 0) return;

    setLoadingSet((prev) => {
      const next = new Set(prev);
      missing.forEach((x) => next.add(x));
      return next;
    });

    // Fetch sequentially throttled to avoid hammering the backend
    (async () => {
      for (const tk of missing) {
        try {
          const intel = await fetchMarketIntel(tk, locale);
          setFeedData((prev) => ({ ...prev, [tk]: { intel, fetchedAt: Date.now() } }));
        } catch {
          // skip; UI falls back to current-ticker intel
        } finally {
          setLoadingSet((prev) => {
            const next = new Set(prev);
            next.delete(tk);
            return next;
          });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.join(","), locale]);

  // Aggregate feed items across all (or filtered) tickers
  const aggregated = useMemo(() => {
    const source: Array<{ tk: string; intel: MarketIntelResponse }> = [];
    const pool: Record<string, MarketIntelResponse | undefined> = {};
    Object.entries(feedData).forEach(([k, v]) => (pool[k] = v.intel));
    if (ticker && marketIntel) pool[ticker] = marketIntel;

    for (const [tk, intel] of Object.entries(pool)) {
      if (!intel) continue;
      if (feedFilter !== "all" && tk !== feedFilter) continue;
      source.push({ tk, intel });
    }
    return source;
  }, [feedData, marketIntel, ticker, feedFilter]);

  const allNews = useMemo(() => {
    const rows = aggregated.flatMap(({ tk, intel }) =>
      intel.news.map((n) => ({ ...n, tk }))
    );
    // De-duplicate by URL or title (same article may appear on multiple tickers)
    const seen = new Set<string>();
    const unique = rows.filter((n) => {
      const key = (n.url || n.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => (a.date < b.date ? 1 : -1));
    return unique;
  }, [aggregated]);

  const allEvents = useMemo(() => {
    const rows = aggregated.flatMap(({ tk, intel }) =>
      intel.events.map((e) => ({ ...e, tk }))
    );
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    return rows;
  }, [aggregated]);

  const allAnalysts = useMemo(() => {
    return aggregated.flatMap(({ tk, intel }) =>
      intel.analyst_targets.map((a) => ({ ...a, tk }))
    );
  }, [aggregated]);

  const tickerOptions = useMemo(() => {
    const s = new Set<string>();
    aggregated.forEach(({ tk }) => s.add(tk));
    return ["all", ...Array.from(s).sort()];
  }, [aggregated]);

  // Reset pagination when the filter or tab changes
  useEffect(() => {
    setVisibleCount(NEWS_PAGE_SIZE);
  }, [feedFilter, tab]);

  // Infinite scroll: grow visibleCount when sentinel enters viewport
  useEffect(() => {
    if (tab !== "news") return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisibleCount((prev) => {
              // Only grow if there's more to show
              const total = allNews.length;
              if (prev >= total) return prev;
              return Math.min(prev + NEWS_PAGE_SIZE, total);
            });
          }
        }
      },
      { rootMargin: "400px 0px 400px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, allNews.length]);

  const tabs: Array<{ id: Tab; icon: typeof Newspaper; label: string; count: number }> = [
    { id: "news",     icon: Newspaper, label: t("news.tab.news",     locale), count: allNews.length },
    { id: "events",   icon: Calendar,  label: t("news.tab.events",   locale), count: allEvents.length },
    { id: "analysts", icon: Target,    label: t("news.tab.analysts", locale), count: allAnalysts.length },
  ];

  const anyLoading = loadingSet.size > 0 || isMarketIntelLoading;

  // Hero = first news item, Rest = remaining (capped by visibleCount)
  const hero = allNews[0];
  const restAll = allNews.slice(1);
  // visibleCount includes the hero; "rest" gets visibleCount - 1 items
  const visibleRest = restAll.slice(0, Math.max(0, visibleCount - 1));
  const hasMore = visibleRest.length < restAll.length;

  return (
    <div className="anim-fade-up space-y-6">
      {/* Editorial masthead */}
      <div className="flex items-end justify-between border-b border-[var(--line-soft)] pb-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[var(--text-2)] font-medium">
            <span className="w-1 h-1 rounded-full bg-[var(--accent)]" />
            {t("news.subtitle", locale)}
          </div>
          <h2 className="text-[28px] font-semibold tracking-tight text-[var(--text-0)] mt-2 leading-none">
            {t("news.title", locale)}
          </h2>
          <div className="mt-2 text-xs text-[var(--text-2)] flex items-center gap-3">
            <span className="tabular">
              {allNews.length} {t("news.stories", locale)}
            </span>
            <span className="text-[var(--line-mid)]">·</span>
            <span className="tabular">
              {aggregated.length} {t("news.sources", locale)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {anyLoading && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
              <Loader2 className="w-3 h-3 animate-spin text-[var(--accent)]" />
              {t("news.loading", locale)}
            </span>
          )}
          {ticker && (
            <button
              onClick={() => refetchCurrent(ticker)}
              className="px-3 py-1.5 text-xs flex items-center gap-1.5 rounded-lg accent-border bg-white text-[var(--text-1)] hover:text-[var(--accent-hot)] transition-all cursor-pointer"
            >
              {t("news.refreshCurrent", locale)}
            </button>
          )}
        </div>
      </div>

      {/* Tabs + filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-[var(--bg-2)] rounded-xl p-1 border border-[var(--line-soft)]">
          {tabs.map(({ id, icon: Icon, label, count }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  active
                    ? "bg-white text-[var(--text-0)] shadow-[var(--shadow-sm)]"
                    : "text-[var(--text-2)] hover:text-[var(--text-0)]"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? "text-[var(--accent)]" : ""}`} />
                {label}
                <span className="text-[var(--text-3)] tabular">{count}</span>
              </button>
            );
          })}
        </div>

        {tickerOptions.length > 2 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Search className="w-3.5 h-3.5 text-[var(--text-2)]" />
            {tickerOptions.map((tk) => (
              <button
                key={tk}
                onClick={() => setFeedFilter(tk)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all cursor-pointer ${
                  feedFilter === tk
                    ? "border-[var(--accent)] text-[var(--accent-hot)] bg-[var(--accent-soft)]"
                    : "border-[var(--line-soft)] bg-white text-[var(--text-2)] hover:text-[var(--text-0)] hover:border-[var(--line-mid)]"
                }`}
              >
                {tk === "all" ? t("watchlist.all", locale) : tk}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* NEWS TAB */}
      {tab === "news" && (
        <div className="space-y-5">
          {allNews.length === 0 && !anyLoading && (
            <div className="panel py-14 text-center text-sm text-[var(--text-2)]">
              {t("news.empty", locale)}
            </div>
          )}

          {/* Hero card */}
          {hero && (
            <a
              href={hero.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="panel-raised block overflow-hidden group cursor-pointer transition-all hover:shadow-[var(--shadow-lg)] hover:-translate-y-px"
            >
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 p-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest rounded-md bg-[var(--accent-soft)] text-[var(--accent-hot)]">
                      {t("news.featured", locale)}
                    </span>
                    <span className="chip chip-accent mono">{hero.tk}</span>
                    <span className="text-[11px] text-[var(--text-2)] flex items-center gap-1 tabular">
                      <Clock className="w-3 h-3" />
                      {formatRelative(hero.date, locale)}
                    </span>
                    {hostOf(hero.url) && (
                      <>
                        <span className="text-[var(--line-mid)]">·</span>
                        <span className="text-[11px] text-[var(--text-2)] truncate">
                          {hero.source || hostOf(hero.url)}
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="text-[22px] leading-[1.25] font-semibold text-[var(--text-0)] tracking-tight group-hover:text-[var(--accent-hot)] transition-colors">
                    {hero.title}
                  </h3>
                  {hero.summary && (
                    <p className="text-sm text-[var(--text-1)] leading-relaxed mt-3 line-clamp-3">
                      {hero.summary}
                    </p>
                  )}
                  {hero.url && (
                    <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] group-hover:text-[var(--accent-hot)]">
                      {t("news.readMore", locale)}
                      <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </div>
                  )}
                </div>
                {/* Decorative gradient marker */}
                <div className="hidden md:flex items-center">
                  <div className="w-[92px] h-full min-h-[140px] rounded-xl bg-gradient-to-br from-[var(--accent-soft)] via-white to-[rgba(109,78,224,0.10)] border border-[var(--line-soft)] relative overflow-hidden">
                    <div className="absolute inset-0 grid-paper opacity-60" />
                    <Newspaper className="absolute inset-0 m-auto w-8 h-8 text-[var(--accent)] opacity-70" />
                  </div>
                </div>
              </div>
            </a>
          )}

          {/* Secondary story grid */}
          {visibleRest.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleRest.map((n, idx) => {
                const domain = hostOf(n.url);
                return (
                  <a
                    key={`${n.tk}-${n.date}-${idx}`}
                    href={n.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="panel px-4 py-3.5 group cursor-pointer hover:shadow-[var(--shadow-md)] hover:border-[var(--line-mid)] transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="chip chip-accent mono text-[10px] py-[1px]">{n.tk}</span>
                      <span className="text-[10px] text-[var(--text-2)] tabular flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatRelative(n.date, locale)}
                      </span>
                      {(n.source || domain) && (
                        <span className="text-[10px] text-[var(--text-3)] truncate">
                          · {n.source || domain}
                        </span>
                      )}
                      {n.url && (
                        <ExternalLink className="w-3 h-3 ml-auto text-[var(--text-3)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--text-0)] leading-snug line-clamp-2 group-hover:text-[var(--accent-hot)] transition-colors">
                      {n.title}
                    </h3>
                    {n.summary && (
                      <p className="text-xs text-[var(--text-2)] leading-relaxed mt-1.5 line-clamp-2">
                        {n.summary}
                      </p>
                    )}
                  </a>
                );
              })}
            </div>
          )}

          {/* Infinite-scroll sentinel + loading indicator */}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-6 text-xs text-[var(--text-2)]"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)] mr-1.5" />
              {t("news.loadingMore", locale)}
            </div>
          )}
          {!hasMore && allNews.length > NEWS_PAGE_SIZE && (
            <div className="text-center py-6 text-[11px] text-[var(--text-3)] tracking-widest uppercase">
              {t("news.endOfFeed", locale)}
            </div>
          )}
        </div>
      )}

      {/* EVENTS TAB */}
      {tab === "events" && (
        <div className="space-y-2">
          {allEvents.length === 0 && !anyLoading && (
            <div className="panel py-14 text-center text-sm text-[var(--text-2)]">
              {t("news.emptyEvents", locale)}
            </div>
          )}
          {allEvents.map((e, idx) => (
            <div
              key={`${e.tk}-${e.date}-${idx}`}
              className="panel px-4 py-3 flex items-center gap-4 hover:border-[var(--line-mid)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="shrink-0 w-14 text-center py-1 rounded-lg bg-[var(--bg-2)] border border-[var(--line-soft)]">
                <div className="text-[9px] uppercase tracking-widest text-[var(--text-2)] font-semibold">
                  {new Date(e.date).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "short" })}
                </div>
                <div className="text-lg font-semibold text-[var(--text-0)] mono leading-none mt-0.5 tabular">
                  {e.date.slice(8, 10)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-[var(--accent)] uppercase tracking-widest">
                    {e.type}
                  </span>
                  <span className="chip chip-accent mono text-[10px] py-[1px]">{e.tk}</span>
                </div>
                <div className="text-sm text-[var(--text-0)] mt-0.5">{e.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ANALYSTS TAB */}
      {tab === "analysts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {allAnalysts.length === 0 && !anyLoading && (
            <div className="col-span-full panel py-14 text-center text-sm text-[var(--text-2)]">
              {t("news.emptyAnalysts", locale)}
            </div>
          )}
          {allAnalysts.map((a, idx) => (
            <div
              key={`${a.tk}-${a.institution}-${idx}`}
              className="panel px-4 py-3 hover:border-[var(--line-mid)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="chip chip-accent mono text-[10px] py-[1px]">{a.tk}</span>
                    <span className="text-[10px] uppercase tracking-widest text-[var(--text-2)] tabular">
                      {a.date}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-0)] mt-1 truncate tracking-tight">
                    {a.institution}
                  </div>
                  <div className="text-[11px] text-[var(--text-2)] mt-0.5">
                    {a.rating}
                    {a.num_analysts ? ` · ${a.num_analysts} analysts` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {a.target_price !== null && a.target_price !== undefined ? (
                    <>
                      <div className="text-[10px] text-[var(--text-2)] uppercase tracking-widest">
                        {t("news.target", locale)}
                      </div>
                      <div className="text-lg font-semibold mono text-[var(--accent-hot)] tabular">
                        ${a.target_price.toFixed(2)}
                      </div>
                      {(a.target_low != null || a.target_high != null) && (
                        <div className="text-[10px] text-[var(--text-2)] mono tabular">
                          {a.target_low?.toFixed(0)}–{a.target_high?.toFixed(0)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-[var(--text-3)]">—</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
