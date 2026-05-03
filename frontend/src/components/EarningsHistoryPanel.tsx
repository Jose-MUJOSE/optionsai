"use client";

/**
 * EarningsHistoryPanel — historical earnings announcements with EPS surprise
 * and 1-day post-announcement price move.
 *
 * Data: financials.earnings_history (Yahoo `earnings.earningsChart.quarterly`)
 * Yahoo's free tier caps this at 4 quarters. We surface that limit in the
 * subtitle so users aren't confused why they can't see "the last 6".
 *
 * The 1-day move is computed by joining `reportedDate` with our own daily
 * OHLCV bars: pct_close = (close[t] - close[t-1]) / close[t-1].
 *
 * Color-coding:
 *   - Surprise % → green if positive, red if negative
 *   - 1-day move → green if positive, red if negative
 *   - When EPS missed estimate: red surprise badge.
 */

import { useMemo } from "react";
import { CalendarClock, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { EarningsHistoryItem } from "@/lib/api";

function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function formatEps(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export default function EarningsHistoryPanel() {
  const { financials, isFinancialsLoading, locale } = useAppStore();

  const items = useMemo<EarningsHistoryItem[]>(() => {
    return financials?.earnings_history ?? [];
  }, [financials]);

  if (isFinancialsLoading && !financials) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-6 flex items-center justify-center min-h-[160px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (!financials || items.length === 0) {
    return null;
  }

  // Aggregate stats — beat rate, average post-earnings move
  const beatCount = items.filter((i) => i.eps_surprise_pct !== null && i.eps_surprise_pct > 0).length;
  const totalWithSurprise = items.filter((i) => i.eps_surprise_pct !== null).length;
  const beatRate = totalWithSurprise > 0 ? (beatCount / totalWithSurprise) : null;

  const movesAvail = items.filter((i) => i.post_earnings?.pct_close !== null && i.post_earnings?.pct_close !== undefined);
  const avgMove = movesAvail.length > 0
    ? movesAvail.reduce((s, i) => s + (i.post_earnings?.pct_close ?? 0), 0) / movesAvail.length
    : null;
  const upMoves = movesAvail.filter((i) => (i.post_earnings?.pct_close ?? 0) > 0).length;
  const upRate = movesAvail.length > 0 ? upMoves / movesAvail.length : null;

  return (
    <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-5 anim-fade-up">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.12)] flex items-center justify-center">
            <CalendarClock className="w-4 h-4 text-[var(--accent)]" strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
              {locale === "zh" ? "财报公告历史" : "Earnings History"}
            </h3>
            <div className="text-[10px] text-[var(--text-2)] tracking-wide">
              {locale === "zh"
                ? "EPS 超预期 + 财报次日涨跌（Yahoo 限制：最多 4 期）"
                : "EPS surprise + next-day price move (Yahoo limit: 4 quarters)"}
            </div>
          </div>
        </div>

        {/* Aggregate stats */}
        <div className="flex items-center gap-3">
          {beatRate !== null && (
            <div className="text-right">
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-2)] font-semibold">
                {locale === "zh" ? "超预期率" : "Beat Rate"}
              </div>
              <div className={`mono font-bold text-sm ${beatRate >= 0.5 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"}`}>
                {(beatRate * 100).toFixed(0)}%
              </div>
            </div>
          )}
          {upRate !== null && (
            <div className="text-right">
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-2)] font-semibold">
                {locale === "zh" ? "次日上涨率" : "Up-Day Rate"}
              </div>
              <div className={`mono font-bold text-sm ${upRate >= 0.5 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"}`}>
                {(upRate * 100).toFixed(0)}%
              </div>
            </div>
          )}
          {avgMove !== null && (
            <div className="text-right">
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-2)] font-semibold">
                {locale === "zh" ? "平均涨幅" : "Avg Move"}
              </div>
              <div className={`mono font-bold text-sm ${avgMove >= 0 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"}`}>
                {formatPct(avgMove)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Card grid — one card per earnings event */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item, idx) => {
          const surprise = item.eps_surprise_pct;
          const move = item.post_earnings?.pct_close ?? null;
          const isUp = move !== null && move >= 0;
          return (
            <div
              key={`${item.date}-${idx}`}
              className="rounded-xl bg-[var(--bg-1)] border border-[var(--line-soft)] p-3.5 hover:border-[var(--line-mid)] transition-all"
            >
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="mono text-xs font-bold text-[var(--text-0)]">
                    {formatDate(item.date)}
                  </span>
                  {item.quarter && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--accent-soft)] text-[var(--accent-hot)] font-semibold tracking-wide">
                      {item.quarter}
                    </span>
                  )}
                </div>
                {move !== null && (
                  <div className={`flex items-center gap-1 mono font-bold text-sm ${
                    isUp ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"
                  }`}>
                    {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {formatPct(move)}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[var(--text-2)] font-semibold mb-0.5">
                    {locale === "zh" ? "实际 EPS" : "EPS Actual"}
                  </div>
                  <div className="mono font-bold text-[var(--text-0)]">{formatEps(item.eps_actual)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[var(--text-2)] font-semibold mb-0.5">
                    {locale === "zh" ? "预期 EPS" : "EPS Estimate"}
                  </div>
                  <div className="mono font-bold text-[var(--text-1)]">{formatEps(item.eps_estimate)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[var(--text-2)] font-semibold mb-0.5">
                    {locale === "zh" ? "超预期" : "Surprise"}
                  </div>
                  <div className={`mono font-bold ${
                    surprise === null
                      ? "text-[var(--text-3)]"
                      : surprise >= 0
                      ? "text-[var(--fin-up)]"
                      : "text-[var(--fin-down)]"
                  }`}>
                    {formatPct(surprise)}
                  </div>
                </div>
              </div>

              {item.post_earnings && item.post_earnings.pct_open !== null && (
                <div className="mt-2 pt-2 border-t border-[var(--line-soft)] text-[10px] text-[var(--text-2)] flex items-center gap-3">
                  <span>
                    {locale === "zh" ? "跳空" : "Gap"}:{" "}
                    <span className={`mono font-semibold ${
                      (item.post_earnings.pct_open ?? 0) >= 0 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"
                    }`}>
                      {formatPct(item.post_earnings.pct_open)}
                    </span>
                  </span>
                  <span>
                    {locale === "zh" ? "前收" : "Prev Close"}:{" "}
                    <span className="mono font-semibold text-[var(--text-1)]">
                      ${item.post_earnings.prev_close.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    {locale === "zh" ? "收盘" : "Close"}:{" "}
                    <span className="mono font-semibold text-[var(--text-1)]">
                      ${item.post_earnings.earnings_close.toFixed(2)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
