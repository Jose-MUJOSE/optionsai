"use client";

/**
 * EarningsMovePanel — "财报隐含 vs 实际" 面板
 *
 * 数据诚实性 (对应功能 #3 + #10 数据透明度):
 *   - 过去 N 次财报次日 actual_move_pct       → 100% 真实 (Yahoo 1D OHLCV)
 *   - 当前下一次财报 implied_move_pct         → 100% 真实 (当前 ATM 跨式)
 *   - 历史 implied_move_pct (每根柱子上)       → null, 前端明确标注 "不可用"
 *     (重建历史 implied move 需付费历史期权数据, 我们绝不捏造)
 */

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import { CalendarRange, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import FeatureGuide from "./FeatureGuide";

type Locale = "zh" | "en";

export default function EarningsMovePanel() {
  const { marketData, earningsMoves, isEarningsMovesLoading, locale } = useAppStore();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  // Sort past events ascending by date so the bar chart reads left-to-right oldest → newest.
  const chartData = useMemo(() => {
    if (!earningsMoves?.past_events?.length) return [];
    return [...earningsMoves.past_events]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((ev) => ({
        date: ev.date.slice(5), // MM-DD, keeps bars readable
        fullDate: ev.date,
        move: ev.actual_move_pct,
        direction: ev.actual_direction,
        closeBefore: ev.close_before,
        closeAfter: ev.close_after,
      }));
  }, [earningsMoves]);

  if (!marketData) return null;

  if (isEarningsMovesLoading) {
    return (
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
        <HeaderRow locale={locale} />
        <div className="flex items-center justify-center py-10 text-[var(--text-2)] text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {lang === "zh" ? "正在加载财报数据..." : "Loading earnings data..."}
        </div>
      </div>
    );
  }

  if (!earningsMoves || chartData.length === 0) {
    return (
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
        <HeaderRow locale={locale} />
        <div className="flex items-center justify-center py-10 text-[var(--text-2)] text-sm">
          {t("earn.noData", locale)}
        </div>
      </div>
    );
  }

  const impliedNow = earningsMoves.current_implied_move_pct;
  const avgAbs = earningsMoves.avg_absolute_actual_move_pct;
  const nextDate = earningsMoves.next_earnings_date;
  const impliedExp = earningsMoves.current_implied_source_expiration;

  // "市场是否通常高估移动" — impliedNow vs avg_absolute_actual_move
  let impliedVsAvgDelta: number | null = null;
  if (impliedNow != null && avgAbs != null && avgAbs > 0) {
    impliedVsAvgDelta = impliedNow - avgAbs;
  }

  return (
    <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
      <HeaderRow locale={locale} />

      {/* Top row: three stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <StatCard
          label={t("earn.impliedNow", locale)}
          value={impliedNow != null ? `±${impliedNow.toFixed(2)}%` : "—"}
          hint={
            impliedNow != null && impliedExp
              ? `${t("earn.usingExp", locale)}: ${impliedExp}`
              : t("earn.notAvailable", locale)
          }
          accent="violet"
          badge={
            impliedNow != null
              ? { label: locale === "zh" ? "真实期权链" : "real chain", tone: "emerald" }
              : { label: locale === "zh" ? "无数据" : "no data", tone: "gray" }
          }
        />
        <StatCard
          label={t("earn.avgAbs", locale)}
          value={avgAbs != null ? `±${avgAbs.toFixed(2)}%` : "—"}
          hint={
            locale === "zh"
              ? `过去 ${chartData.length} 次财报次日绝对值均值`
              : `Avg of last ${chartData.length} earnings-day-after moves`
          }
          accent="blue"
          badge={{ label: locale === "zh" ? "100% 真实" : "100% real", tone: "emerald" }}
        />
        <StatCard
          label={t("earn.nextEarnings", locale)}
          value={nextDate ?? "—"}
          hint={
            impliedVsAvgDelta != null
              ? locale === "zh"
                ? `隐含 ${impliedVsAvgDelta >= 0 ? "高于" : "低于"}历史均值 ${Math.abs(impliedVsAvgDelta).toFixed(2)}%`
                : `Implied is ${impliedVsAvgDelta >= 0 ? "above" : "below"} history by ${Math.abs(impliedVsAvgDelta).toFixed(2)}%`
              : locale === "zh"
              ? "比对需要当前隐含 + 历史均值"
              : "Comparison needs both implied & history"
          }
          accent="indigo"
          badge={{ label: locale === "zh" ? "Yahoo" : "Yahoo", tone: "blue" }}
        />
      </div>

      {/* Bar chart of past moves */}
      <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-1)] p-3">
        <div className="flex items-center justify-between mb-1 px-1">
          <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
            {t("earn.historyLabel", locale)}
          </div>
          {avgAbs != null && (
            <div className="text-[11px] text-[var(--text-2)] mono">
              {locale === "zh" ? "绝对值均值" : "|avg|"}:{" "}
              <span className="font-bold text-[var(--text-1)]">±{avgAbs.toFixed(2)}%</span>
            </div>
          )}
        </div>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 6, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--text-2)", fontSize: 10 }}
                axisLine={{ stroke: "var(--line-soft)" }}
              />
              <YAxis
                unit="%"
                tick={{ fill: "var(--text-2)", fontSize: 10 }}
                axisLine={{ stroke: "var(--line-soft)" }}
              />
              <ReferenceLine y={0} stroke="var(--line-mid)" />
              {impliedNow != null && (
                <>
                  <ReferenceLine
                    y={impliedNow}
                    stroke="var(--accent-violet)"
                    strokeDasharray="4 3"
                    label={{
                      value:
                        locale === "zh"
                          ? `当前隐含 +${impliedNow.toFixed(2)}%`
                          : `Implied +${impliedNow.toFixed(2)}%`,
                      fill: "var(--accent-violet)",
                      fontSize: 10,
                      position: "insideTopRight",
                    }}
                  />
                  <ReferenceLine
                    y={-impliedNow}
                    stroke="var(--accent-violet)"
                    strokeDasharray="4 3"
                    label={{
                      value:
                        locale === "zh"
                          ? `当前隐含 -${impliedNow.toFixed(2)}%`
                          : `Implied -${impliedNow.toFixed(2)}%`,
                      fill: "var(--accent-violet)",
                      fontSize: 10,
                      position: "insideBottomRight",
                    }}
                  />
                </>
              )}
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as {
                    fullDate: string;
                    move: number;
                    closeBefore: number;
                    closeAfter: number;
                  };
                  return (
                    <div className="bg-white border border-[var(--line-mid)] rounded-lg px-3 py-2 shadow-lg text-xs">
                      <div className="font-bold text-[var(--text-0)] mb-1">{p.fullDate}</div>
                      <div className="text-[var(--text-1)]">
                        {locale === "zh" ? "实际" : "Actual"}:{" "}
                        <span
                          className={`mono font-bold ${
                            p.move >= 0 ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]"
                          }`}
                        >
                          {p.move >= 0 ? "+" : ""}
                          {p.move.toFixed(2)}%
                        </span>
                      </div>
                      <div className="text-[var(--text-2)] text-[10px] mt-1">
                        {p.closeBefore.toFixed(2)} → {p.closeAfter.toFixed(2)}
                      </div>
                      <div className="text-[var(--text-2)] text-[10px] mt-1 italic">
                        {locale === "zh"
                          ? "当日隐含值: 不可用 (需付费数据)"
                          : "Implied that day: not available (paid data)"}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="move" radius={[4, 4, 0, 0]}>
                {chartData.map((row, idx) => (
                  <Cell
                    key={`bar-${idx}`}
                    fill={row.move >= 0 ? "var(--fin-up)" : "var(--fin-down)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px] text-[var(--text-2)] mt-2 px-1 leading-relaxed">
          {locale === "zh"
            ? "紫色虚线 = 当前期权市场为下一次财报定价的隐含幅度 (±)。柱子 = 历史每次财报次日实际收盘涨跌幅。"
            : "Violet dashed lines = current market's implied move for the next earnings (±). Bars = each past earnings' day-after realized move."}
        </div>
      </div>

      {/* Embedded teaching */}
      <FeatureGuide
        title={t("earn.title", locale)}
        locale={lang}
        dataSource={
          locale === "zh"
            ? "过去涨跌幅: Yahoo Finance 1D 真实收盘价; 当前 implied move: 当前 ATM 跨式 (call_mid + put_mid) / spot × 100; 历史 implied move 不展示 — 需付费历史期权数据，本产品不捏造。"
            : "Past moves: Yahoo Finance 1D real closes; current implied: ATM straddle (call_mid + put_mid) / spot × 100; historical implieds are intentionally omitted — would require paid options history and we never fabricate."
        }
        howToRead={[
          locale === "zh"
            ? "绿色柱 = 财报次日上涨，红色柱 = 下跌；柱子高度 = 涨跌幅绝对值"
            : "Green bar = up after earnings, red = down; bar height = absolute move",
          locale === "zh"
            ? "紫色虚线 = 当前市场为下一次财报 '定价' 的隐含波动 (±)"
            : "Violet dashed line = current market's priced-in move for next earnings (±)",
          locale === "zh"
            ? "柱子频繁超过紫线 = 市场过去低估波动；柱子常低于紫线 = 市场高估"
            : "Bars often beyond dashed lines → market has under-priced; bars short of it → over-priced",
        ]}
        whatItMeans={[
          locale === "zh"
            ? "学术和实盘数据普遍显示: ATM 跨式平均 '高估' 实际移动约 10-20%，这是期权卖方的长期 edge"
            : "Academic and broker data consistently show ATM straddles over-estimate actual moves by ~10-20% — the long-term edge of premium sellers",
          locale === "zh"
            ? "如果此标的的柱子长期比紫线高，卖跨式将持续亏损 — 这是 NVDA/TSLA 等高 beta 个股常见情况"
            : "If this ticker's bars are consistently larger than the dashed line, selling straddles will bleed — typical for high-beta names like NVDA/TSLA",
          locale === "zh"
            ? "财报后 IV 骤降 (IV crush) 是真实存在的，只要实际移动小于隐含，卖方就赚钱"
            : "Post-earnings IV crush is real — short-premium wins whenever actual move < implied",
        ]}
        actions={[
          locale === "zh"
            ? "当前隐含 > 历史均值 → 考虑短跨式 / 铁鹰，吃 IV crush"
            : "Implied > historical avg → consider short straddle / iron condor to harvest IV crush",
          locale === "zh"
            ? "当前隐含 < 历史均值 且标的有大消息 (AI/财报指引) → 考虑 long straddle，赌突破"
            : "Implied < historical avg and big catalyst present → consider long straddle to catch outsized move",
          locale === "zh"
            ? "柱子长期两边都很小 → 该股 '财报不跳' → 卖方优势最大"
            : "If bars are consistently small both ways → this ticker's earnings are mild → strongest short-premium edge",
          locale === "zh"
            ? "把本图与左边 IV Rank 结合看: 高 IV Rank + 历史不跳 = 教科书级的卖方机会"
            : "Cross-check with IV Rank: high rank + historically mild moves = textbook short-premium setup",
        ]}
        caveat={
          locale === "zh"
            ? "过去表现不保证未来。指引/新品发布等会显著改变一次财报的实际幅度；务必叠加基本面判断。"
            : "Past performance does not predict the future. Guidance updates and product launches can blow out a single earnings — always layer in fundamentals."
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------

function HeaderRow({ locale }: { locale: "zh" | "en" }) {
  return (
    <div className="flex items-start gap-2.5 mb-4">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
        <CalendarRange className="w-4 h-4 text-[var(--accent)]" strokeWidth={2} />
      </div>
      <div>
        <h3 className="text-sm font-bold text-[var(--text-0)] tracking-tight">
          {t("earn.title", locale)}
        </h3>
        <p className="text-[11px] text-[var(--text-2)] mt-0.5">
          {t("earn.subtitle", locale)}
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent,
  badge,
}: {
  label: string;
  value: string;
  hint: string;
  accent: "violet" | "blue" | "indigo";
  badge: { label: string; tone: "emerald" | "blue" | "gray" };
}) {
  const accentClass = {
    violet: "text-[var(--accent-violet)]",
    blue: "text-[var(--accent)]",
    indigo: "text-indigo-600",
  }[accent];
  const badgeClass = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    gray: "bg-gray-50 text-gray-600 border-gray-200",
  }[badge.tone];

  return (
    <div className="rounded-xl border border-[var(--line-soft)] bg-gradient-to-br from-white to-[var(--bg-1)] p-3.5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--text-2)]">
          {label}
        </div>
        <span
          className={`text-[9.5px] px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${badgeClass}`}
        >
          {badge.label}
        </span>
      </div>
      <div className={`text-2xl font-bold mono tracking-tight mb-1 ${accentClass}`}>{value}</div>
      <div className="text-[10px] text-[var(--text-2)] leading-snug">{hint}</div>
    </div>
  );
}
