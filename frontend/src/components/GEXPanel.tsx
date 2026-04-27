"use client";

/**
 * GEXPanel — Dealer Gamma Exposure by strike (feature #5)
 *
 * Data honesty:
 *   - OI × gamma × 100 × spot² × 0.01  → computed from the real option chain.
 *   - Gamma values: Tradier/Polygon professional greeks when available,
 *     fall back to BSM γ = N'(d1)/(S σ √T) from real IV.
 *   - The "dealers are net-short calls, net-long puts" sign convention is
 *     an industry approximation — real dealer positioning is not public.
 *     FeatureGuide surfaces this caveat prominently.
 *
 * Reading guide:
 *   - Positive NET GEX regime → dealers must BUY as price drops and SELL
 *     as price rises → volatility compresses, moves fade.
 *   - Negative NET GEX regime → dealers must SELL as price drops and BUY
 *     as price rises → volatility amplifies, moves trend.
 *   - Gamma Flip Strike: level where cumulative GEX crosses 0 going up.
 *     Below it, the market behaves "short gamma" (trending).
 *     Above it, the market behaves "long gamma" (mean-reverting).
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
import { Activity, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import FeatureGuide from "./FeatureGuide";

type Locale = "zh" | "en";

export default function GEXPanel() {
  const { marketData, gexData, isGEXLoading, locale, selectedExpiration } = useAppStore();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  // Trim extreme tails for chart readability: keep strikes within ±25% of spot
  const chartData = useMemo(() => {
    if (!gexData?.by_strike?.length || !gexData.spot_price) return [];
    const spot = gexData.spot_price;
    const lo = spot * 0.75;
    const hi = spot * 1.25;
    return gexData.by_strike
      .filter((r) => r.strike >= lo && r.strike <= hi)
      .map((r) => ({
        strike: r.strike,
        net: r.net_gex_millions,
        call: r.call_gex_millions,
        put: r.put_gex_millions,
        callOI: r.call_oi,
        putOI: r.put_oi,
      }));
  }, [gexData]);

  if (!marketData || !selectedExpiration) return null;

  if (isGEXLoading) {
    return (
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
        <HeaderRow locale={locale} expiration={selectedExpiration} />
        <div className="flex items-center justify-center py-10 text-[var(--text-2)] text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {lang === "zh" ? "正在计算 Gamma 敞口..." : "Calculating gamma exposure..."}
        </div>
      </div>
    );
  }

  if (!gexData || chartData.length === 0) {
    return (
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
        <HeaderRow locale={locale} expiration={selectedExpiration} />
        <div className="text-center py-10 text-sm text-[var(--text-2)]">
          {lang === "zh"
            ? "该到期日的期权链不足以计算 GEX"
            : "Option chain insufficient to compute GEX for this expiration"}
        </div>
      </div>
    );
  }

  const netSign = gexData.net_gex_millions >= 0 ? "positive" : "negative";
  // Two-line regime: short label + sub-label, so the stat card never wraps awkwardly
  const regimeLabel = netSign === "positive"
    ? (lang === "zh" ? "正 Gamma" : "Positive")
    : (lang === "zh" ? "负 Gamma" : "Negative");
  const regimeSubLabel = netSign === "positive"
    ? (lang === "zh" ? "波动压缩" : "Vol compression")
    : (lang === "zh" ? "波动放大" : "Vol amplification");
  const regimeColor =
    netSign === "positive" ? "text-[var(--fin-up)]" : "text-[var(--fin-down)]";
  const regimeBg = netSign === "positive"
    ? "bg-emerald-50 border-emerald-200"
    : "bg-red-50 border-red-200";

  return (
    <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
      <HeaderRow locale={locale} expiration={selectedExpiration} />

      {/* Summary stats — uniform min-height prevents the regime card from breaking the row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label={lang === "zh" ? "总 NET GEX" : "Total Net GEX"}
          value={formatMillions(gexData.net_gex_millions)}
          hint={lang === "zh" ? "百万美元 / 1% 移动" : "$M per 1% move"}
          valueClass={regimeColor}
        />
        <div className={`rounded-xl px-3 py-2.5 border ${regimeBg} min-h-[88px] flex flex-col justify-center`}>
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-2)]">
            {lang === "zh" ? "机制" : "Regime"}
          </div>
          <div className={`text-base font-bold mt-1 leading-tight ${regimeColor}`}>{regimeLabel}</div>
          <div className={`text-[11px] font-medium mt-0.5 ${regimeColor} opacity-80`}>{regimeSubLabel}</div>
        </div>
        <StatCard
          label={lang === "zh" ? "Gamma 翻转位" : "Gamma Flip"}
          value={
            gexData.gamma_flip_strike !== null
              ? `$${gexData.gamma_flip_strike.toFixed(2)}`
              : "—"
          }
          hint={
            gexData.spot_price
              ? `${lang === "zh" ? "现价" : "Spot"} $${gexData.spot_price.toFixed(2)}`
              : ""
          }
        />
        <StatCard
          label={lang === "zh" ? "Call / Put GEX" : "Call / Put GEX"}
          value={`${formatMillions(gexData.call_gex_millions)} / ${formatMillions(
            gexData.put_gex_millions,
          )}`}
          hint={lang === "zh" ? "正=看涨, 负=看跌" : "Positive=calls, Negative=puts"}
        />
      </div>

      {/* Chart — extra top padding so reference-line labels don't get clipped */}
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 28, right: 18, left: 4, bottom: 18 }}
            barCategoryGap="6%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" />
            <XAxis
              dataKey="strike"
              tick={{ fontSize: 10, fill: "var(--text-2)" }}
              tickFormatter={(v: number) => `${v}`}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-2)" }}
              tickFormatter={(v: number) => `${v.toFixed(1)}M`}
              width={54}
            />
            <ReferenceLine y={0} stroke="var(--text-2)" strokeDasharray="2 2" />
            {gexData.spot_price && (
              <ReferenceLine
                x={nearestStrike(chartData, gexData.spot_price)}
                stroke="var(--accent)"
                strokeDasharray="3 3"
                label={{
                  value: lang === "zh" ? "现价" : "Spot",
                  position: "insideTopRight",
                  fill: "var(--accent)",
                  fontSize: 11,
                  fontWeight: 600,
                  offset: 8,
                }}
              />
            )}
            {gexData.gamma_flip_strike !== null && (
              <ReferenceLine
                x={gexData.gamma_flip_strike}
                stroke="var(--accent-violet)"
                strokeDasharray="4 2"
                label={{
                  value: lang === "zh" ? "翻转" : "Flip",
                  position: "insideTopLeft",
                  fill: "var(--accent-violet)",
                  fontSize: 11,
                  fontWeight: 600,
                  offset: 8,
                }}
              />
            )}
            <Tooltip
              cursor={{ fill: "rgba(109,78,224,0.06)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-white border border-[var(--line-soft)] rounded-lg shadow-md p-2.5 text-xs">
                    <div className="font-semibold mb-1">
                      {lang === "zh" ? "行权价" : "Strike"}: ${d.strike.toFixed(2)}
                    </div>
                    <div className="text-[var(--fin-up)]">
                      Call GEX: {formatMillions(d.call)} · OI {d.callOI.toLocaleString()}
                    </div>
                    <div className="text-[var(--fin-down)]">
                      Put GEX: {formatMillions(d.put)} · OI {d.putOI.toLocaleString()}
                    </div>
                    <div className="mt-1 pt-1 border-t border-[var(--line-soft)] font-semibold">
                      NET: {formatMillions(d.net)}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="net" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.net >= 0 ? "var(--fin-up)" : "var(--fin-down)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <FeatureGuide
        title={lang === "zh" ? "经销商 Gamma 敞口 (GEX)" : "Dealer Gamma Exposure (GEX)"}
        dataSource={
          lang === "zh"
            ? `期权链 (OI × γ) 直接计算 · 单位: 百万美元 / 每 1% 标的移动 · 到期日: ${selectedExpiration}`
            : `Option chain OI × γ · Units: $M per 1% underlying move · Expiration: ${selectedExpiration}`
        }
        howToRead={
          lang === "zh"
            ? [
                "每一根柱子是该行权价的 NET GEX (call 正, put 负)。绿柱=看涨持仓主导, 红柱=看跌持仓主导。",
                "紫色虚线是 Gamma 翻转位: 累计 GEX 从负转正的临界 strike。现货若在它之下, 市场处于\u201c负 gamma\u201d。",
                "顶部 NET GEX 总和: 正值越大, 波动压缩越强; 负值越大, 涨跌会越剧烈。",
              ]
            : [
                "Each bar is the strike's net GEX (calls +, puts −). Green = call-dominated, red = put-dominated.",
                "The dashed purple line is the Gamma Flip — where cumulative GEX crosses zero going up. Below it, the tape is 'short gamma' (trending).",
                "Top NET GEX total: larger positive = stronger vol compression; larger negative = larger, trendier moves.",
              ]
        }
        whatItMeans={
          lang === "zh"
            ? [
                "正 Gamma 机制: 经销商被动对冲 → 下跌时买入, 上涨时卖出 → 压制波动, 易出现区间震荡。",
                "负 Gamma 机制: 经销商被动对冲方向相反 → 下跌时卖出, 上涨时买入 → 放大波动, 易出现单边行情。",
                "最高 |GEX| 堆积的行权价往往是\u201c磁吸价\u201d, 现货会被拉向该位置 (pin effect), 尤其在到期前几天。",
              ]
            : [
                "Positive GEX regime: dealer hedging dampens moves — chop / mean-reversion / vol compression.",
                "Negative GEX regime: dealer hedging amplifies moves — trends, gap risk, vol expansion.",
                "The strike with largest |GEX| often acts as a 'magnet' pinning price near expiration.",
              ]
        }
        actions={
          lang === "zh"
            ? [
                "正 gamma + 现价在翻转位之上 → 倾向卖方策略 (iron condor, short straddle), 收时间价值。",
                "负 gamma + 现价在翻转位之下 → 倾向买方策略 (long straddle, long calls/puts), 博波动放大。",
                "若现货接近高 |GEX| 堆积位, 临近到期时可做 pin 交易: 卖 ATM iron butterfly 捕捉钉住效应。",
                "⚠ GEX 是估算, 不是信号。结合 IV Rank + 财报窗口 + 宏观事件共同判断, 不要单独用。",
              ]
            : [
                "Positive GEX & spot above flip → lean seller (iron condor, short straddle) to harvest compressed vol.",
                "Negative GEX & spot below flip → lean buyer (long straddle, long calls/puts) to ride amplified moves.",
                "If spot is near a high-|GEX| cluster into expiry, a short iron butterfly at that strike captures the pin.",
                "⚠ GEX is an estimate, not a signal. Combine with IV Rank, earnings windows and macro events.",
              ]
        }
        caveat={gexData.disclaimer}
        locale={lang}
      />
    </div>
  );
}

function HeaderRow({ locale, expiration }: { locale: Locale; expiration: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-[var(--accent-violet)]" />
        <h2 className="text-base font-semibold text-[var(--text-0)]">
          {t("gex.title", locale)}
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-2)] mono">
          {expiration}
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-2)]">
        {t("gex.subtitle", locale)}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-[var(--bg-2)] border border-[var(--line-soft)] rounded-xl px-3 py-2.5 min-h-[88px] flex flex-col justify-center">
      <div className="text-[10px] uppercase tracking-widest text-[var(--text-2)]">
        {label}
      </div>
      <div
        className={`text-base font-semibold mt-1 tabular tracking-tight leading-tight ${
          valueClass ?? "text-[var(--text-0)]"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-[var(--text-2)] mt-0.5 leading-tight">{hint}</div>}
    </div>
  );
}

function formatMillions(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(2)}B`;
  return `${v.toFixed(2)}M`;
}

function nearestStrike(
  rows: { strike: number }[],
  spot: number,
): number | undefined {
  if (!rows.length) return undefined;
  let best = rows[0].strike;
  let bestDiff = Math.abs(best - spot);
  for (const r of rows) {
    const d = Math.abs(r.strike - spot);
    if (d < bestDiff) {
      bestDiff = d;
      best = r.strike;
    }
  }
  return best;
}
