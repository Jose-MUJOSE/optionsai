"use client";

/**
 * FeatureGuide — reusable collapsible "如何使用" teaching panel.
 *
 * Every new feature panel embeds one of these so the user isn't stuck with
 * a chart they don't know how to read. Keep copy in the caller's locale
 * and structured around three beats:
 *
 *   1. 怎么看   (how to read the number / chart)
 *   2. 意味着什么 (what that reading implies about the market)
 *   3. 实战决策 (what strategies or actions line up with it)
 *
 * Props are deliberately simple (three string arrays) so callers can't
 * over-customize it and break layout consistency.
 */

import { useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";

export type Locale = "zh" | "en";

export interface FeatureGuideProps {
  title: string;
  /** Where the data comes from, e.g. "Yahoo Finance 1Y OHLCV · 计算: 滚动 30-日 HV". */
  dataSource: string;
  /** "怎么看" — objective reading rules, 2–4 bullet points. */
  howToRead: string[];
  /** "意味着什么" — the interpretation, 2–4 bullet points. */
  whatItMeans: string[];
  /** "实战决策" — concrete strategy guidance, 2–4 bullet points. */
  actions: string[];
  /** Optional caveat surfaced prominently (e.g. "估算数据"). */
  caveat?: string;
  locale: Locale;
  /** Starts open? Default closed to keep panels compact. */
  defaultOpen?: boolean;
}

const COPY = {
  zh: {
    label: "\u5982\u4f55\u4f7f\u7528",
    source: "\u6570\u636e\u6e90",
    read: "\u600e\u4e48\u770b",
    meaning: "\u610f\u5473\u7740\u4ec0\u4e48",
    actions: "\u5b9e\u6218\u51b3\u7b56",
    caveatLabel: "\u8bf7\u6ce8\u610f",
  },
  en: {
    label: "How to use",
    source: "Data source",
    read: "What to read",
    meaning: "What it means",
    actions: "How to act",
    caveatLabel: "Heads up",
  },
} as const;

export default function FeatureGuide({
  title,
  dataSource,
  howToRead,
  whatItMeans,
  actions,
  caveat,
  locale,
  defaultOpen = false,
}: FeatureGuideProps) {
  const [open, setOpen] = useState(defaultOpen);
  const copy = COPY[locale];

  return (
    <div className="mt-3 rounded-xl border border-[var(--line-soft)] bg-white/70 backdrop-blur-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left cursor-pointer hover:bg-[var(--bg-2)] transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--text-1)]">
          <BookOpen className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>{copy.label}</span>
          <span className="text-[var(--text-2)] font-normal">· {title}</span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--text-2)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-xs leading-relaxed anim-fade-up">
          {caveat && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 font-medium">
              <span className="font-bold">{copy.caveatLabel}:</span> {caveat}
            </div>
          )}

          <Section label={copy.read} color="text-[var(--accent-hot)]" items={howToRead} />
          <Section label={copy.meaning} color="text-[var(--accent-violet)]" items={whatItMeans} />
          <Section label={copy.actions} color="text-[var(--fin-up)]" items={actions} />

          <div className="pt-2 border-t border-[var(--line-soft)] flex items-start gap-2 text-[10px] text-[var(--text-2)]">
            <span className="font-semibold uppercase tracking-[0.14em] shrink-0">
              {copy.source}:
            </span>
            <span className="leading-snug">{dataSource}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5 ${color}`}>
        {label}
      </div>
      <ul className="space-y-1 text-[var(--text-1)]">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[var(--text-2)] shrink-0 select-none">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
