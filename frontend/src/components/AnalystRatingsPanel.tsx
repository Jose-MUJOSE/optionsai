"use client";

/**
 * AnalystRatingsPanel — Wall Street consensus + per-firm rating changes.
 *
 * Layout follows the user's reference (moomoo / Snowball style):
 *   - Top: consensus card with mean target, upside %, analyst count, target range
 *   - Below: rating distribution bar (Strong Buy → Strong Sell)
 *   - Then: a feed of recent firm-level rating actions, each with date,
 *           firm name, rating change, action label, and price target with delta.
 *
 * Data source: Yahoo Finance `upgradeDowngradeHistory` exposes per-firm price
 * targets in the free tier — see analyst_ratings.py service.
 */

import { useState } from "react";
import { Users, ArrowUpRight, ArrowDownRight, Minus, Loader2, ChevronDown } from "lucide-react";
import { useAppStore } from "@/lib/store";

const INITIAL_DISPLAY_COUNT = 8;

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toFixed(2)}`;
}

function formatCurrencyCompact(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toFixed(0)}`;
}

function formatPctSigned(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function consensusBadgeClass(label: string): string {
  // Pure presentational mapping. Defensive lower-case match for Yahoo variants.
  const l = label.toLowerCase();
  if (l.includes("strong buy")) return "bg-[var(--fin-up)] text-white";
  if (l === "buy" || l.includes("buy")) return "bg-[var(--fin-up-soft)] text-[var(--fin-up)] border border-[rgba(10,143,90,0.28)]";
  if (l.includes("hold") || l.includes("neutral")) return "bg-[var(--bg-2)] text-[var(--text-1)] border border-[var(--line-mid)]";
  if (l.includes("sell")) return "bg-[var(--fin-down-soft)] text-[var(--fin-down)] border border-[rgba(211,59,77,0.28)]";
  return "bg-[var(--bg-2)] text-[var(--text-1)] border border-[var(--line-mid)]";
}

function consensusLabel(label: string, locale: "en" | "zh"): string {
  if (locale !== "zh") return label;
  const l = label.toLowerCase();
  if (l.includes("strong buy")) return "强力买入";
  if (l === "buy") return "买入";
  if (l === "hold") return "持有";
  if (l === "sell") return "卖出";
  if (l === "strong sell") return "强力卖出";
  return label;
}

function actionLabel(code: string | null, locale: "en" | "zh"): string {
  if (!code) return "—";
  const map: Record<string, [string, string]> = {
    init: ["首次覆盖", "Initiate"],
    main: ["维持", "Maintain"],
    reit: ["重申", "Reiterate"],
    up:   ["上调", "Upgrade"],
    down: ["下调", "Downgrade"],
  };
  const pair = map[code.toLowerCase()];
  if (!pair) return code;
  return locale === "zh" ? pair[0] : pair[1];
}

function actionColor(code: string | null): string {
  if (!code) return "bg-[var(--bg-2)] text-[var(--text-1)] border border-[var(--line-mid)]";
  const c = code.toLowerCase();
  if (c === "up" || c === "init") return "bg-[var(--fin-up-soft)] text-[var(--fin-up)] border border-[rgba(10,143,90,0.28)]";
  if (c === "down") return "bg-[var(--fin-down-soft)] text-[var(--fin-down)] border border-[rgba(211,59,77,0.28)]";
  if (c === "main" || c === "reit") return "bg-[var(--bg-2)] text-[var(--text-1)] border border-[var(--line-mid)]";
  return "bg-[var(--bg-2)] text-[var(--text-1)] border border-[var(--line-mid)]";
}

/** Distribution bar showing 5 segments (SB/B/H/S/SS) sized proportionally. */
function DistributionBar({ d, locale }: {
  d: { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number; total: number };
  locale: "en" | "zh";
}) {
  if (d.total === 0) return null;
  const pct = (n: number) => (n / d.total) * 100;
  const segments = [
    { label: locale === "zh" ? "强买" : "Strong Buy", value: d.strong_buy, color: "var(--fin-up)" },
    { label: locale === "zh" ? "买入" : "Buy", value: d.buy, color: "rgba(10,143,90,0.55)" },
    { label: locale === "zh" ? "持有" : "Hold", value: d.hold, color: "var(--text-3)" },
    { label: locale === "zh" ? "卖出" : "Sell", value: d.sell, color: "rgba(211,59,77,0.55)" },
    { label: locale === "zh" ? "强卖" : "Strong Sell", value: d.strong_sell, color: "var(--fin-down)" },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden">
        {segments.map((s) => s.value > 0 && (
          <div
            key={s.label}
            style={{ width: `${pct(s.value)}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px]">
        {segments.map((s) => s.value > 0 && (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            <span className="text-[var(--text-2)]">{s.label}</span>
            <span className="mono font-semibold text-[var(--text-0)]">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalystRatingsPanel() {
  const { analystRatings, isAnalystRatingsLoading, locale } = useAppStore();
  const [showAll, setShowAll] = useState(false);

  if (isAnalystRatingsLoading && !analystRatings) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-6 flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (!analystRatings || (!analystRatings.consensus && analystRatings.rating_changes.length === 0)) {
    return null;
  }

  const c = analystRatings.consensus;
  const changes = analystRatings.rating_changes;
  const visible = showAll ? changes : changes.slice(0, INITIAL_DISPLAY_COUNT);

  return (
    <div className="rounded-2xl bg-white border border-[var(--line-soft)] p-5 anim-fade-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.12)] flex items-center justify-center">
          <Users className="w-4 h-4 text-[var(--accent)]" strokeWidth={2.2} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
            {locale === "zh" ? "机构目标价" : "Analyst Ratings"}
          </h3>
          <div className="text-[10px] text-[var(--text-2)] tracking-wide">
            {locale === "zh" ? "华尔街共识 + 每家机构的目标价与评级变动" : "Wall Street consensus + per-firm rating actions"}
          </div>
        </div>
      </div>

      {/* Consensus card */}
      {c && (
        <div className="rounded-xl bg-gradient-to-br from-[var(--bg-1)] via-[var(--accent-soft)]/30 to-[var(--bg-1)] border border-[var(--line-soft)] p-4 mb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2.5">
              <div className="text-base font-bold text-[var(--text-0)] tracking-tight">
                {locale === "zh" ? "华尔街共识" : "Wall Street Consensus"}
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${consensusBadgeClass(c.label)}`}>
                {consensusLabel(c.label, locale)}
              </span>
            </div>
            <div className="text-right">
              <div className="mono text-2xl font-bold text-[var(--text-0)] tracking-tight">
                {formatCurrency(c.target_mean)}
              </div>
              {c.upside_pct !== null && (
                <div className={`mono text-xs font-bold ${c.upside_pct >= 0 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"}`}>
                  {formatPctSigned(c.upside_pct)}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-[11px] mb-3">
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-2)] font-semibold mb-0.5">
                {locale === "zh" ? "目标区间" : "Target Range"}
              </div>
              <div className="mono font-bold text-[var(--text-1)]">
                {formatCurrencyCompact(c.target_low)} – {formatCurrencyCompact(c.target_high)}
              </div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-2)] font-semibold mb-0.5">
                {locale === "zh" ? "中位数" : "Median"}
              </div>
              <div className="mono font-bold text-[var(--text-1)]">
                {formatCurrency(c.target_median)}
              </div>
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-2)] font-semibold mb-0.5">
                {locale === "zh" ? "分析师数" : "Analysts"}
              </div>
              <div className="mono font-bold text-[var(--text-1)]">
                {c.analyst_count ?? "—"}
              </div>
            </div>
          </div>

          <DistributionBar d={c.distribution} locale={locale} />
        </div>
      )}

      {/* Rating changes feed */}
      {changes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[var(--text-0)] uppercase tracking-wider">
              {locale === "zh" ? "近期评级变动" : "Recent Rating Actions"}
            </h4>
            <span className="text-[10px] text-[var(--text-2)]">
              {locale === "zh" ? `共 ${changes.length} 条` : `${changes.length} entries`}
            </span>
          </div>

          <div className="divide-y divide-[var(--line-soft)]">
            {visible.map((r, idx) => {
              const ratingChanged =
                r.from_grade && r.to_grade && r.from_grade.toLowerCase() !== r.to_grade.toLowerCase();
              return (
                <div key={`${r.date}-${r.firm}-${idx}`} className="py-2.5 flex items-center gap-3 flex-wrap">
                  <div className="flex flex-col min-w-[110px]">
                    <span className="text-sm font-bold text-[var(--text-0)]">{r.firm ?? "—"}</span>
                    <span className="mono text-[10.5px] text-[var(--text-2)]">{r.date ?? "—"}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${actionColor(r.action_code)}`}>
                      {actionLabel(r.action_code, locale)}
                    </span>
                    <span className={`text-[10.5px] mono px-1.5 py-0.5 rounded ${
                      ratingChanged ? "bg-[var(--accent-soft)] text-[var(--accent-hot)] font-semibold" : "text-[var(--text-1)]"
                    }`}>
                      {r.from_grade ?? "—"}
                      {ratingChanged && <span className="mx-1">→</span>}
                      {ratingChanged ? <span className="font-bold">{r.to_grade}</span> : (r.to_grade && r.from_grade?.toLowerCase() !== r.to_grade.toLowerCase() ? r.to_grade : "")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 min-w-[110px] justify-end">
                    {r.price_target !== null && (
                      <div className="text-right">
                        <div className="mono text-sm font-bold text-[var(--text-0)]">
                          {formatCurrencyCompact(r.price_target)}
                        </div>
                        {r.price_target_delta_pct !== null && r.price_target_delta_pct !== 0 && (
                          <div className={`flex items-center justify-end gap-0.5 mono text-[10.5px] font-semibold ${
                            r.price_target_delta_pct > 0 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"
                          }`}>
                            {r.price_target_delta_pct > 0 ? (
                              <ArrowUpRight className="w-3 h-3" />
                            ) : (
                              <ArrowDownRight className="w-3 h-3" />
                            )}
                            {formatPctSigned(r.price_target_delta_pct)}
                          </div>
                        )}
                        {r.price_target_delta_pct === 0 && (
                          <div className="flex items-center justify-end gap-0.5 mono text-[10.5px] font-semibold text-[var(--text-3)]">
                            <Minus className="w-3 h-3" />
                            {locale === "zh" ? "持平" : "Flat"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {changes.length > INITIAL_DISPLAY_COUNT && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full py-2 text-xs font-semibold text-[var(--accent-hot)] hover:bg-[var(--bg-2)] rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {showAll
                ? (locale === "zh" ? "收起" : "Show less")
                : (locale === "zh" ? `查看全部 ${changes.length} 条` : `Show all ${changes.length}`)
              }
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
