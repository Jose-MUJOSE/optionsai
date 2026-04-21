"use client";

/**
 * VolatilityRankPanel — 期权环境的"温度计"
 *
 * 显示：
 *   - HV Rank  (100% real, 来自 1Y 真实价格)
 *   - IV Rank  (real if iv_rank_source = "historical_iv", 否则明确标注"HV 代理")
 *   - 每个数据点的来源与置信度
 *
 * 所有 "高 / 中 / 低" 阈值沿用 tastytrade 社区惯例 (30 / 50 百分位)，
 * 数据本身不捏造：分位落在哪里就显示哪里。
 */

import { useMemo } from "react";
import { Activity, Info } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import FeatureGuide from "./FeatureGuide";
import type { IvRankSource } from "@/types";

type Locale = "zh" | "en";

type Regime = "low" | "mid" | "high";

function rankRegime(rank: number): Regime {
  if (rank >= 50) return "high";
  if (rank >= 30) return "mid";
  return "low";
}

const REGIME_COPY: Record<
  Regime,
  { zh: { label: string; desc: string }; en: { label: string; desc: string }; tone: string }
> = {
  low: {
    zh: {
      label: "\u4f4e\u6ce2\u52a8\u73af\u5883",
      desc: "\u6743\u5229\u91d1\u504f\u5b9c\uff0c\u4e70\u65b9\u7b56\u7565 (long call/put/straddle) \u66f4\u5212\u7b97",
    },
    en: {
      label: "Low volatility",
      desc: "Premiums are cheap; long-premium plays (long call/put/straddle) have the edge",
    },
    tone: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  mid: {
    zh: {
      label: "\u4e2d\u7b49\u6ce2\u52a8",
      desc: "\u4e70\u5356\u65b9\u5404\u6709\u4f18\u52bf\uff0c\u4f18\u5148\u8003\u8651\u65b9\u5411\u6027\u4ef7\u5dee (spread)",
    },
    en: {
      label: "Medium volatility",
      desc: "Neither side has a clean edge; prefer defined-risk spreads",
    },
    tone: "text-amber-600 bg-amber-50 border-amber-200",
  },
  high: {
    zh: {
      label: "\u9ad8\u6ce2\u52a8\u73af\u5883",
      desc: "\u6743\u5229\u91d1\u6602\u8d35\uff0c\u5356\u65b9\u7b56\u7565 (credit spread/iron condor/short strangle) \u66f4\u5212\u7b97",
    },
    en: {
      label: "High volatility",
      desc: "Premiums are rich; short-premium plays (credit spread/iron condor/short strangle) have the edge",
    },
    tone: "text-red-600 bg-red-50 border-red-200",
  },
};

function sourceLabel(src: IvRankSource, days: number, locale: Locale): string {
  if (src === "historical_iv") {
    return locale === "zh"
      ? `\u771f\u5b9e IV \u5386\u53f2 (${days} \u5929\u5feb\u7167)`
      : `Real IV history (${days} daily snapshots)`;
  }
  if (src === "hv_proxy") {
    return locale === "zh"
      ? `IV \u5386\u53f2\u79ef\u7d2f\u4e2d (${days}/30 \u5929)\u2014\u6682\u7528 HV Rank \u4f5c\u4ee3\u7406`
      : `IV history warming up (${days}/30 days) — using HV Rank as proxy`;
  }
  return locale === "zh" ? "\u6570\u636e\u4e0d\u8db3" : "Insufficient data";
}

export default function VolatilityRankPanel() {
  const { marketData, locale } = useAppStore();

  const content = useMemo(() => {
    if (!marketData) return null;
    const {
      iv_current,
      iv_rank,
      iv_percentile,
      hv_30,
      hv_rank,
      hv_percentile,
      iv_rank_source,
      iv_history_days,
    } = marketData;

    const hvRegime = rankRegime(hv_rank);
    const ivRegime = rankRegime(iv_rank);
    const isIvReal = iv_rank_source === "historical_iv";

    return {
      iv_current,
      iv_rank,
      iv_percentile,
      hv_30,
      hv_rank,
      hv_percentile,
      hvRegime,
      ivRegime,
      isIvReal,
      iv_rank_source,
      iv_history_days,
    };
  }, [marketData]);

  if (!marketData || !content) return null;

  const lang = locale === "zh" ? "zh" : "en";
  const srcHint = sourceLabel(content.iv_rank_source, content.iv_history_days, lang);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 anim-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
            <Activity className="w-4 h-4 text-[var(--accent)]" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
              {t("volrank.title", locale)}
            </h3>
            <p className="text-[11px] text-[var(--text-2)] mt-0.5">
              {t("volrank.subtitle", locale)}
            </p>
          </div>
        </div>
      </div>

      {/* Two rank bars side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <RankCard
          label={t("volrank.hvRank", locale)}
          sublabel={t("volrank.hvSubtitle", locale)}
          currentValue={content.hv_30}
          unit="%"
          rank={content.hv_rank}
          percentile={content.hv_percentile}
          regime={content.hvRegime}
          locale={locale}
          sourceBadge={{
            label: locale === "zh" ? "100% \u771f\u5b9e" : "100% real",
            tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
          }}
        />
        <RankCard
          label={t("volrank.ivRank", locale)}
          sublabel={t("volrank.ivSubtitle", locale)}
          currentValue={content.iv_current}
          unit="%"
          rank={content.iv_rank}
          percentile={content.iv_percentile}
          regime={content.ivRegime}
          locale={locale}
          sourceBadge={
            content.isIvReal
              ? {
                  label: locale === "zh" ? "\u771f\u5b9e\u5386\u53f2" : "Real history",
                  tone: "bg-blue-50 text-blue-700 border-blue-200",
                }
              : {
                  label: locale === "zh" ? "HV \u4ee3\u7406" : "HV proxy",
                  tone: "bg-amber-50 text-amber-700 border-amber-200",
                }
          }
          sourceHint={srcHint}
        />
      </div>

      {/* Regime headline */}
      <RegimeBanner regime={content.hvRegime} locale={lang} />

      {/* Embedded teaching */}
      <FeatureGuide
        title={t("volrank.title", locale)}
        locale={lang}
        dataSource={
          locale === "zh"
            ? `HV Rank: Yahoo Finance 1\u5e74\u6536\u76d8\u4ef7 \u2192 \u6ec1\u52a8 30-\u65e5 HV \u5e8f\u5217 (\u5e74\u5316 \u00d7\u221a252) \u2192 \u5bf9\u4eca\u65e5\u503c\u6253\u5206\u3002IV Rank: \u5f53\u524d ATM IV \u76f8\u5bf9\u672c\u5730\u5feb\u7167\u5e93 (SQLite) \u7684\u6392\u540d\uff1b\u79ef\u7d2f\u672a\u6ee1 30 \u5929\u65f6\u81ea\u52a8\u56de\u843d\u5230 HV Rank\u3002`
            : `HV Rank: Yahoo Finance 1Y closes \u2192 rolling 30-day HV (\u00d7\u221a252) \u2192 rank today's reading. IV Rank: current ATM IV vs the local SQLite snapshot series; while <30 days of snapshots exist we fall back to HV Rank with this label.`
        }
        howToRead={[
          locale === "zh"
            ? "HV/IV Rank = \u5f53\u524d\u503c\u5728\u8fc7\u53bb 1 \u5e74\u6700\u9ad8/\u6700\u4f4e\u4e4b\u95f4\u7684\u767e\u5206\u4f4d\u7f6e (0\u2013100)"
            : "HV/IV Rank = where today sits between the past year's min and max, expressed 0–100",
          locale === "zh"
            ? "Percentile = \u8fc7\u53bb 1 \u5e74\u4e2d\u6709\u591a\u5c11 % \u7684\u5929\u6bd4\u4eca\u5929\u6ce2\u52a8\u7387\u66f4\u4f4e"
            : "Percentile = share of past year when volatility was lower than today",
          locale === "zh"
            ? "\u9605\u8bfb\u9610\u503c\uff1a30 \u4ee5\u4e0b\u2192\u4f4e\uff0c30\u201350\u2192\u4e2d\uff0c50 \u4ee5\u4e0a\u2192\u9ad8 (tastytrade \u60ef\u4f8b)"
            : "Thresholds: <30 = low, 30–50 = mid, 50+ = high (tastytrade convention)",
        ]}
        whatItMeans={[
          locale === "zh"
            ? "\u9ad8 Rank \u2192 \u6743\u5229\u91d1\u6602\u8d35\uff0c\u5e02\u573a\u9884\u8ba1\u672a\u6765\u6ce2\u52a8\u6bd4\u8fc7\u53bb\u5927"
            : "High rank → options premium is rich; market expects more motion ahead than in the past",
          locale === "zh"
            ? "\u4f4e Rank \u2192 \u6743\u5229\u91d1\u4fbf\u5b9c\uff0c\u5e02\u573a\u9884\u8ba1\u672a\u6765\u5e73\u9759"
            : "Low rank → premium is cheap; market expects calmer conditions",
          locale === "zh"
            ? "IV > HV \u9ad8\u5f88\u591a \u2192 \u5e02\u573a\u4e3a\u4e0d\u786e\u5b9a\u6027\u591a\u4ed8\u8d39\u7528\uff08\u8d22\u62a5\u524d\u5178\u578b\uff09"
            : "IV \u226b HV → market is paying up for uncertainty (classic pre-earnings pattern)",
        ]}
        actions={[
          locale === "zh"
            ? "Rank \u2265 50 \u2192 \u8003\u8651\u5356\u65b9\uff1a\u4fe1\u7528\u4ef7\u5dee / \u94c1\u9e70 / \u77ed\u8de8\u5f0f\uff0c\u6536\u53d6\u9ad8\u6743\u5229\u91d1"
            : "Rank ≥ 50 → lean short-premium: credit spreads, iron condors, short strangles",
          locale === "zh"
            ? "Rank \u2264 30 \u2192 \u8003\u8651\u4e70\u65b9\uff1a\u5355\u817f call/put \u6216 long straddle\uff0c\u8d5a\u6ce2\u52a8\u6269\u5f20"
            : "Rank ≤ 30 → lean long-premium: single-leg calls/puts or long straddle to catch volatility expansion",
          locale === "zh"
            ? "\u8d22\u62a5\u524d IV Rank \u5e38\u9aa4\u5347\uff0c\u8d22\u62a5\u540e IV crush\uff0c\u5356\u8de8\u5f0f\u7684\u5178\u578b\u7a97\u53e3"
            : "IV Rank usually spikes before earnings and crushes after — classic short-straddle window",
          locale === "zh"
            ? "\u5c06\u672c\u6307\u6807\u4e0e AI \u7b56\u7565\u5361\u76f4\u63a5\u5bf9\u7167\uff1a\u5356\u65b9\u7b56\u7565\u5728\u4f4e Rank \u73af\u5883\u4e0b\u80dc\u7387\u4f1a\u865a\u9ad8"
            : "Cross-check against the AI strategy cards — short-premium edges look inflated in low-rank regimes",
        ]}
        caveat={
          content.isIvReal
            ? undefined
            : locale === "zh"
            ? `IV Rank \u5f53\u524d\u4ec5\u5df2\u7f13\u5b58 ${content.iv_history_days} \u5929\u771f\u5b9e\u5feb\u7167\u3002\u79ef\u7d2f\u81f3 30 \u5929\u540e\u4f1a\u81ea\u52a8\u5207\u6362\u4e3a\u4e0d\u4f9d\u8d56 HV \u7684\u771f\u5b9e IV Rank\u3002`
            : `Only ${content.iv_history_days} real IV snapshots cached so far. IV Rank auto-upgrades to a real-history reading once 30+ days are collected.`
        }
      />
    </div>
  );
}

// -------------------------------------------------------------

function RankCard({
  label,
  sublabel,
  currentValue,
  unit,
  rank,
  percentile,
  regime,
  locale,
  sourceBadge,
  sourceHint,
}: {
  label: string;
  sublabel: string;
  currentValue: number;
  unit: string;
  rank: number;
  percentile: number;
  regime: Regime;
  locale: "zh" | "en";
  sourceBadge: { label: string; tone: string };
  sourceHint?: string;
}) {
  const tone = REGIME_COPY[regime].tone;
  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-gradient-to-br from-white to-[var(--bg-1)] p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
            {label}
          </div>
          <div className="text-[10px] text-[var(--text-2)] mt-0.5">{sublabel}</div>
        </div>
        <span
          className={`text-[9.5px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${sourceBadge.tone}`}
          title={sourceHint}
        >
          {sourceBadge.label}
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold text-[var(--text-0)] mono tracking-tight">
          {currentValue.toFixed(1)}
          <span className="text-sm font-normal text-[var(--text-2)] ml-0.5">{unit}</span>
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${tone}`}
          aria-label="regime"
        >
          {REGIME_COPY[regime][locale].label}
        </span>
      </div>

      {/* Rank bar */}
      <div className="mb-2">
        <div className="flex items-baseline justify-between text-[10px] mb-1">
          <span className="text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">
            Rank
          </span>
          <span className="font-mono font-bold text-[var(--text-0)]">
            {rank.toFixed(0)} / 100
          </span>
        </div>
        <div className="relative h-1.5 bg-[var(--bg-3)] rounded-full overflow-hidden">
          {/* threshold markers */}
          <span
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-[var(--line-mid)]/60"
            style={{ left: "30%" }}
          />
          <span
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-[var(--line-mid)]/60"
            style={{ left: "50%" }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, rank))}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-[var(--text-2)] mt-1 uppercase tracking-[0.14em]">
          <span>
            {locale === "zh" ? "\u4f4e" : "Low"}
          </span>
          <span className="relative" style={{ left: "-14%" }}>
            30
          </span>
          <span className="relative" style={{ left: "-4%" }}>
            50
          </span>
          <span>
            {locale === "zh" ? "\u9ad8" : "High"}
          </span>
        </div>
      </div>

      {/* Percentile line */}
      <div className="flex items-baseline justify-between text-[10px] pt-1.5 border-t border-[var(--line-soft)]">
        <span className="text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">
          {locale === "zh" ? "\u5206\u4f4d (Percentile)" : "Percentile"}
        </span>
        <span className="font-mono font-bold text-[var(--text-1)]">
          {percentile.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function RegimeBanner({ regime, locale }: { regime: Regime; locale: "zh" | "en" }) {
  const copy = REGIME_COPY[regime];
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${copy.tone}`}>
      <Info className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
      <div className="text-xs leading-relaxed">
        <span className="font-bold">{copy[locale].label}:</span>{" "}
        <span>{copy[locale].desc}</span>
      </div>
    </div>
  );
}
