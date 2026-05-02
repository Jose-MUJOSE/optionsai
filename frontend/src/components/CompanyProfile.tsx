"use client";

/**
 * CompanyProfile — dashboard intro card.
 *
 * Goal: in 5 seconds, the user understands "who is this company?"
 *   - Logo, name, sector, country, employees
 *   - Size: market cap, employees
 *   - Valuation: P/E, Fwd P/E, P/B, dividend, P/S
 *   - Profitability: revenue TTM, margins, ROE, growth YoY
 *   - 52-week range with current position
 *   - Long business summary (collapsible)
 *
 * Data shape comes from /api/company-profile/{ticker} (backend file:
 * backend/services/company_profile.py).
 *
 * Hidden entirely if:
 *   - ticker is an ETF / mutual fund (is_etf flag from backend)
 *   - profile fetch failed (companyProfile is null)
 *
 * All numeric fields are nullable — Yahoo's quoteSummary is sparse for
 * smaller-cap / foreign-listed names, so the UI shows "—" for missing.
 */

import { useState } from "react";
import { Building2, ExternalLink, ChevronDown, MapPin, Users, Globe2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { CompanyProfile as CompanyProfileType } from "@/lib/api";

const SUMMARY_PREVIEW_CHARS = 280;

export default function CompanyProfile() {
  const profile = useAppStore((s) => s.companyProfile);
  const isLoading = useAppStore((s) => s.isCompanyProfileLoading);
  const locale = useAppStore((s) => s.locale);

  if (isLoading) return <CompanyProfileSkeleton />;
  if (!profile) return null;
  // ETFs have no business profile to show — collapse the card
  if (profile.is_etf) return null;
  // No identifying info at all → also skip (e.g. very obscure tickers)
  if (!profile.long_name && !profile.sector && !profile.long_business_summary) return null;

  return <CompanyProfileCard profile={profile} locale={locale} />;
}

function CompanyProfileCard({ profile, locale }: { profile: CompanyProfileType; locale: "zh" | "en" }) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const isZh = locale === "zh";

  const displayName = profile.long_name || profile.short_name || profile.ticker;
  const summary = profile.long_business_summary || "";
  const summaryNeedsTruncation = summary.length > SUMMARY_PREVIEW_CHARS;
  const visibleSummary = summaryExpanded || !summaryNeedsTruncation
    ? summary
    : summary.slice(0, SUMMARY_PREVIEW_CHARS).trimEnd() + "…";

  // Address line — pieces shown only if present
  const locationParts = [profile.city, profile.state, profile.country].filter(Boolean);

  return (
    <div className="card-elevated overflow-hidden anim-fade-up">
      {/* Decorative top accent — colored band keyed off sector for variety */}
      <div className="h-1 bg-gradient-to-r from-[var(--accent)] via-[var(--accent-bright)] to-[var(--accent-violet)]" />

      <div className="p-5 md:p-6 space-y-5">
        {/* Header row: logo + name + sector chips + ticker */}
        <div className="flex items-start gap-4 flex-wrap">
          <CompanyLogo
            url={!logoFailed ? profile.logo_url : null}
            fallbackChar={(displayName?.[0] ?? "?").toUpperCase()}
            onError={() => setLogoFailed(true)}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-xl md:text-2xl font-bold tracking-tight text-[var(--text-0)] truncate">
                {displayName}
              </h2>
              <span className="text-[11px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded-md bg-[var(--accent-soft)] text-[var(--accent-hot)] border border-[rgba(45,76,221,0.18)]">
                {profile.ticker}
              </span>
              {profile.exchange && (
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-2)]">
                  {profile.exchange}
                </span>
              )}
            </div>

            {/* Sector / industry chips */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {profile.sector && <Chip color="blue">{profile.sector}</Chip>}
              {profile.industry && <Chip color="violet">{profile.industry}</Chip>}
            </div>

            {/* Identity meta row */}
            <div className="flex items-center gap-3 flex-wrap mt-2 text-[12px] text-[var(--text-2)]">
              {locationParts.length > 0 && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {locationParts.join(", ")}
                </span>
              )}
              {profile.full_time_employees != null && (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {isZh
                    ? `${formatLargeInt(profile.full_time_employees)} 员工`
                    : `${formatLargeInt(profile.full_time_employees)} employees`}
                </span>
              )}
              {profile.website && (
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--accent)] hover:text-[var(--accent-hot)] transition-colors"
                >
                  <Globe2 className="w-3 h-3" />
                  {isZh ? "官网" : "Website"}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Valuation tiles (P0) */}
        <div>
          <SectionLabel>{isZh ? "估值与规模" : "Valuation & Size"}</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-2">
            <Tile label={isZh ? "市值" : "Market Cap"} value={formatLargeMoney(profile.market_cap)} highlight />
            <Tile label="P/E (TTM)" value={formatRatio(profile.trailing_pe)} />
            <Tile label="Fwd P/E" value={formatRatio(profile.forward_pe)} />
            <Tile label="P/B" value={formatRatio(profile.price_to_book)} />
            <Tile label={isZh ? "股息率" : "Div Yield"} value={formatPercent(profile.dividend_yield)} />
            <Tile label="Beta" value={formatRatio(profile.beta)} />
          </div>
        </div>

        {/* Financial tiles (P1) */}
        <div>
          <SectionLabel>{isZh ? "盈利与增长" : "Profitability & Growth"}</SectionLabel>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-2">
            <Tile label={isZh ? "营收 (TTM)" : "Revenue TTM"} value={formatLargeMoney(profile.revenue_ttm)} />
            <Tile label={isZh ? "毛利率" : "Gross Margin"} value={formatPercent(profile.gross_margin)} />
            <Tile label={isZh ? "净利率" : "Net Margin"} value={formatPercent(profile.profit_margin)} />
            <Tile label={isZh ? "营收增速" : "Rev Growth"} value={formatPercent(profile.revenue_growth_yoy)} />
            <Tile label="ROE" value={formatPercent(profile.return_on_equity)} />
            <Tile label="P/S" value={formatRatio(profile.price_to_sales_ttm)} />
          </div>
        </div>

        {/* Optional second-line valuation (PEG / EV / Debt) — collapsible-ish but keep simple */}
        {(profile.peg_ratio != null || profile.ev_to_ebitda != null || profile.debt_to_equity != null || profile.free_cash_flow != null) && (
          <div>
            <SectionLabel>{isZh ? "进阶指标" : "Advanced Metrics"}</SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-2">
              <Tile label="PEG Ratio" value={formatRatio(profile.peg_ratio)} hint={isZh ? "增长调整 P/E" : "growth-adj P/E"} />
              <Tile label="EV/EBITDA" value={formatRatio(profile.ev_to_ebitda)} hint={isZh ? "杠杆调整估值" : "leverage-adj"} />
              <Tile
                label={isZh ? "负债权益比" : "Debt/Equity"}
                value={formatRatio(profile.debt_to_equity, 2)}
                hint={isZh ? "杠杆水平" : "leverage level"}
              />
              <Tile
                label={isZh ? "自由现金流" : "Free Cash Flow"}
                value={formatLargeMoney(profile.free_cash_flow)}
                hint={isZh ? "现金流质量" : "cash generation"}
              />
            </div>
          </div>
        )}

        {/* 52-week range bar */}
        {profile.fifty_two_week_low != null && profile.fifty_two_week_high != null && profile.current_price != null && (
          <FiftyTwoWeekRange
            low={profile.fifty_two_week_low}
            high={profile.fifty_two_week_high}
            current={profile.current_price}
            locale={locale}
          />
        )}

        {/* Business description */}
        {summary && (
          <div className="rounded-xl bg-gradient-to-br from-[var(--bg-1)] to-[var(--bg-2)]/50 border border-[var(--line-soft)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-2)]">
                {isZh ? "主营业务" : "Business Summary"}
              </span>
            </div>
            <p className="text-[13px] text-[var(--text-1)] leading-relaxed whitespace-pre-line">
              {visibleSummary}
            </p>
            {summaryNeedsTruncation && (
              <button
                onClick={() => setSummaryExpanded((v) => !v)}
                className="mt-2 text-[11px] font-semibold text-[var(--accent)] hover:text-[var(--accent-hot)] flex items-center gap-1 cursor-pointer"
              >
                {summaryExpanded
                  ? (isZh ? "收起" : "Show less")
                  : (isZh ? "展开全文" : "Read more")}
                <ChevronDown className={`w-3 h-3 transition-transform ${summaryExpanded ? "rotate-180" : ""}`} />
              </button>
            )}
            <p className="text-[10px] text-[var(--text-2)] italic mt-3">
              {isZh
                ? "数据来源：Yahoo Finance · 仅供学习参考"
                : "Source: Yahoo Finance · Educational reference only"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function CompanyLogo({
  url,
  fallbackChar,
  onError,
}: {
  url: string | null;
  fallbackChar: string;
  onError: () => void;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={56}
        height={56}
        onError={onError}
        className="w-14 h-14 rounded-xl object-contain bg-white border border-[var(--line-soft)] shadow-sm shrink-0"
      />
    );
  }
  return (
    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-violet)] flex items-center justify-center shadow-sm shrink-0">
      <span className="text-2xl font-bold text-white">{fallbackChar}</span>
    </div>
  );
}

function Chip({ color, children }: { color: "blue" | "violet"; children: React.ReactNode }) {
  const cls = color === "blue"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : "bg-violet-50 text-violet-700 border-violet-200";
  return (
    <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-2)]">
        {children}
      </span>
      <div className="flex-1 h-px bg-[var(--line-soft)]" />
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  const containerClass = highlight
    ? "bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.08)] border-[rgba(45,76,221,0.22)]"
    : "bg-white border-[var(--line-soft)]";
  return (
    <div className={`rounded-xl border p-2.5 ${containerClass}`}>
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-2)]">{label}</div>
      <div className={`text-sm font-bold mono mt-0.5 ${highlight ? "text-[var(--accent-hot)]" : "text-[var(--text-0)]"}`}>
        {value}
      </div>
      {hint && <div className="text-[9.5px] text-[var(--text-2)] mt-0.5 leading-tight">{hint}</div>}
    </div>
  );
}

function FiftyTwoWeekRange({
  low,
  high,
  current,
  locale,
}: {
  low: number;
  high: number;
  current: number;
  locale: "zh" | "en";
}) {
  const isZh = locale === "zh";
  const range = high - low;
  // Clamp to [0, 100] in case of bad data (e.g. current outside the range)
  const positionPct = range > 0 ? Math.max(0, Math.min(100, ((current - low) / range) * 100)) : 50;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>{isZh ? "52 周区间" : "52-Week Range"}</SectionLabel>
        <span className="text-[10.5px] font-semibold text-[var(--text-2)] mono ml-3 shrink-0">
          {isZh ? "当前位置" : "position"}: <span className="text-[var(--accent)]">{positionPct.toFixed(0)}%</span>
        </span>
      </div>
      <div className="relative h-2 bg-gradient-to-r from-red-100 via-amber-100 to-emerald-100 rounded-full">
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[var(--accent)] ring-2 ring-white shadow-md"
          style={{ left: `${positionPct}%` }}
          aria-label={`Current price ${current}`}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--text-2)] mono">
        <span>${low.toFixed(2)}</span>
        <span className="font-bold text-[var(--text-0)]">${current.toFixed(2)}</span>
        <span>${high.toFixed(2)}</span>
      </div>
    </div>
  );
}

function CompanyProfileSkeleton() {
  return (
    <div className="card-elevated overflow-hidden anim-fade-up">
      <div className="h-1 bg-gradient-to-r from-[var(--accent-soft)] to-[rgba(109,78,224,0.18)]" />
      <div className="p-5 md:p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-[var(--bg-2)] shimmer shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-1/2 bg-[var(--bg-2)] rounded shimmer" />
            <div className="h-3 w-1/3 bg-[var(--bg-2)] rounded shimmer" />
            <div className="h-3 w-1/4 bg-[var(--bg-2)] rounded shimmer" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[var(--bg-2)] shimmer" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Formatters — kept here so the component is self-contained
// ============================================================

function formatLargeMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

function formatLargeInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

function formatPercent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  // Yahoo returns most percentages as decimals (0.25 = 25%). Some
  // already-percent fields slip through (e.g. dividend yields > 1) — that's
  // a known noise source on Yahoo's side; we trust the schema for now.
  return `${(v * 100).toFixed(2)}%`;
}

function formatRatio(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}
