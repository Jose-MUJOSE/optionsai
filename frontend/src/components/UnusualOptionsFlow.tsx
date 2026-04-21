"use client";

/**
 * UnusualOptionsFlow (Phase 5)
 *
 * Data honesty:
 *   - Volume, OI, mid price all come from the real options chain
 *     (Tradier / Polygon / Yahoo).
 *   - "Unusual" is a transparent formula based on published thresholds
 *     (vol/OI > 2.0, notional > $500k, etc.), NOT a 3rd-party sentiment
 *     score. Every threshold is surfaced to the user.
 *   - call_put_bias is aggregated notional share — still an imperfect
 *     proxy for "institutional positioning", so we label it as such.
 */

import { Loader2, Zap, AlertCircle } from "lucide-react";
import { useAppStore } from "@/lib/store";
import FeatureGuide from "./FeatureGuide";

type Locale = "zh" | "en";

const BIAS_COPY: Record<
  "bullish" | "neutral" | "bearish",
  { zh: string; en: string; tone: string }
> = {
  bullish: {
    zh: "看涨资金占优",
    en: "Bullish flow dominant",
    tone: "text-[var(--fin-up)] bg-[var(--fin-up-soft)] border-[rgba(10,143,90,0.28)]",
  },
  bearish: {
    zh: "看跌资金占优",
    en: "Bearish flow dominant",
    tone: "text-[var(--fin-down)] bg-[var(--fin-down-soft)] border-[rgba(207,40,71,0.28)]",
  },
  neutral: {
    zh: "多空资金均衡",
    en: "Flow is balanced",
    tone: "text-[var(--text-1)] bg-[var(--bg-2)] border-[var(--line-soft)]",
  },
};

const FLAG_COPY: Record<string, { zh: string; en: string }> = {
  high_vol_oi: { zh: "高 vol/OI", en: "High vol/OI" },
  large_block: { zh: "大单", en: "Large block" },
  large_notional: { zh: "重金下注", en: "Large notional" },
};

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default function UnusualOptionsFlow() {
  const { marketData, unusualFlow, isUnusualFlowLoading, locale, selectedExpiration } =
    useAppStore();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  if (!marketData || !selectedExpiration) return null;

  if (isUnusualFlowLoading) {
    return (
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
        <Header lang={lang} expiration={selectedExpiration} />
        <div className="flex items-center justify-center py-10 text-[var(--text-2)] text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {lang === "zh" ? "扫描异动期权流..." : "Scanning unusual options flow..."}
        </div>
      </div>
    );
  }

  if (!unusualFlow) {
    return (
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
        <Header lang={lang} expiration={selectedExpiration} />
        <p className="text-xs text-[var(--text-2)] mt-3">
          {lang === "zh"
            ? "暂无异动期权数据。这可能是流动性较低, 或当前到期日没有触发阈值的合约。"
            : "No unusual activity detected yet for this expiration."}
        </p>
      </div>
    );
  }

  const bias = BIAS_COPY[unusualFlow.call_put_bias] ?? BIAS_COPY.neutral;
  const total = unusualFlow.call_notional_usd + unusualFlow.put_notional_usd;
  const callShare = total > 0 ? unusualFlow.call_notional_usd / total : 0;
  const putShare = total > 0 ? unusualFlow.put_notional_usd / total : 0;
  const top = unusualFlow.contracts;

  return (
    <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 shadow-sm anim-fade-up">
      <Header lang={lang} expiration={selectedExpiration} />

      {/* Bias banner */}
      <div className={`mt-4 rounded-xl border px-4 py-3 flex items-center justify-between ${bias.tone}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Zap className="w-4 h-4" />
          {bias[lang]}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span>
            {lang === "zh" ? "看涨" : "Calls"}: {formatUsd(unusualFlow.call_notional_usd)}
            <span className="text-[var(--text-2)] ml-1">({(callShare * 100).toFixed(0)}%)</span>
          </span>
          <span className="text-[var(--line-mid)]">|</span>
          <span>
            {lang === "zh" ? "看跌" : "Puts"}: {formatUsd(unusualFlow.put_notional_usd)}
            <span className="text-[var(--text-2)] ml-1">({(putShare * 100).toFixed(0)}%)</span>
          </span>
        </div>
      </div>

      {/* Thresholds transparency */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <ThresholdCell
          label={lang === "zh" ? "Vol/OI 阈值" : "Vol/OI threshold"}
          value={`> ${unusualFlow.thresholds.vol_oi_ratio.toFixed(1)}`}
        />
        <ThresholdCell
          label={lang === "zh" ? "大单成交量" : "Large block"}
          value={`≥ ${unusualFlow.thresholds.large_block_volume}`}
        />
        <ThresholdCell
          label={lang === "zh" ? "大单 vol/OI" : "Block vol/OI"}
          value={`> ${unusualFlow.thresholds.large_block_vol_oi.toFixed(1)}`}
        />
        <ThresholdCell
          label={lang === "zh" ? "重金门槛" : "Large notional"}
          value={formatUsd(unusualFlow.thresholds.large_notional_usd)}
        />
      </div>

      {/* Contracts table */}
      {top.length === 0 ? (
        <p className="mt-4 text-xs text-[var(--text-2)] italic">
          {lang === "zh"
            ? "当前到期日暂无超过阈值的合约。"
            : "No contracts cross thresholds for this expiration."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[var(--text-2)] border-b border-[var(--line-soft)]">
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider">
                  {lang === "zh" ? "类型" : "Type"}
                </th>
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider">
                  {lang === "zh" ? "行权价" : "Strike"}
                </th>
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider text-right">
                  {lang === "zh" ? "成交量" : "Volume"}
                </th>
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider text-right">OI</th>
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider text-right">Vol/OI</th>
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider text-right">
                  {lang === "zh" ? "名义金额" : "Notional"}
                </th>
                <th className="py-2 pr-3 font-semibold uppercase tracking-wider">
                  {lang === "zh" ? "标记" : "Flags"}
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((c, i) => {
                const isCall = c.option_type === "call";
                const moneynessLabel =
                  c.status === "ITM"
                    ? "ITM"
                    : `${c.moneyness_pct >= 0 ? "+" : ""}${c.moneyness_pct.toFixed(1)}%`;
                return (
                  <tr
                    key={`${c.option_type}-${c.strike}-${i}`}
                    className="border-b border-[var(--line-soft)] hover:bg-[var(--bg-2)] transition-colors"
                  >
                    <td className="py-1.5 pr-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isCall
                            ? "bg-[var(--fin-up-soft)] text-[var(--fin-up)]"
                            : "bg-[var(--fin-down-soft)] text-[var(--fin-down)]"
                        }`}
                      >
                        {isCall ? "CALL" : "PUT"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 mono font-semibold text-[var(--text-0)]">
                      ${c.strike.toFixed(2)}
                      <span className="text-[var(--text-2)] text-[10px] ml-1">{moneynessLabel}</span>
                    </td>
                    <td className="py-1.5 pr-3 mono text-right">{c.volume.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 mono text-right text-[var(--text-1)]">
                      {c.open_interest.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 mono text-right font-semibold text-[var(--accent)]">
                      {c.vol_oi_ratio === null ? "∞" : c.vol_oi_ratio.toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-3 mono text-right font-semibold">
                      {formatUsd(c.notional_usd)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {c.flags.map((f) => (
                          <span
                            key={f}
                            className="px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent-hot)] text-[9.5px] font-semibold uppercase tracking-wider"
                          >
                            {FLAG_COPY[f]?.[lang] ?? f}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {unusualFlow.total_unusual_count > top.length && (
            <p className="mt-2 text-[10px] text-[var(--text-2)] italic">
              {lang === "zh"
                ? `共 ${unusualFlow.total_unusual_count} 条异动合约, 仅显示前 ${top.length} 条。`
                : `Showing top ${top.length} of ${unusualFlow.total_unusual_count} unusual contracts.`}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 text-[10px] text-[var(--text-2)] leading-relaxed">
        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
        <span>{unusualFlow.data_source}</span>
      </div>

      <FeatureGuide
        locale={lang}
        title={lang === "zh" ? "异动期权流" : "Unusual options flow"}
        dataSource={
          lang === "zh"
            ? "真实期权链 volume + OI (Tradier/Polygon/Yahoo)。异动判定为公开公式, 非第三方情绪评分。"
            : "Real chain volume + OI (Tradier/Polygon/Yahoo). Classifications are transparent formulas, not 3rd-party sentiment."
        }
        howToRead={
          lang === "zh"
            ? [
                "Vol/OI 比率 > 2: 当日成交量远超原有持仓, 多为新开仓",
                "大单: 单合约 ≥ 1000 张且 vol/OI > 3, 通常是机构动作",
                "名义金额: volume × mid × 100, 超过 $500K 视为重金",
                "看涨/看跌倾向基于总名义金额份额",
              ]
            : [
                "Vol/OI > 2: today's volume far exceeds prior OI → likely new positions",
                "Large block: ≥1000 contracts AND vol/OI > 3 → often institutional",
                "Notional: volume × mid × 100; > $500K flagged as large bet",
                "Call/put bias is share of total notional",
              ]
        }
        whatItMeans={
          lang === "zh"
            ? [
                "集中的看涨异动 + OTM call 扎堆 → 可能有预期利好催化",
                "看跌异动 + ATM put 放量 → 可能是机构对冲而非纯粹看空",
                "vol/OI 极高但金额小 → 多为散户投机, 信号质量较低",
              ]
            : [
                "Concentrated bullish flow + OTM calls → possible positive catalyst expected",
                "Put flow + ATM puts → could be hedging, not pure bearishness",
                "High vol/OI but small notional → retail speculation, weaker signal",
              ]
        }
        actions={
          lang === "zh"
            ? [
                "异动信号仅作为参考, 不可单独用于开仓依据",
                "结合 GEX、IV Rank、新闻事件综合研判",
                "若看到与自己方向一致的异动, 可考虑缩小行权价间距",
              ]
            : [
                "Use as one input, not a standalone entry signal",
                "Combine with GEX, IV Rank, and news catalysts",
                "If unusual flow confirms your thesis, consider tighter strikes",
              ]
        }
        caveat={
          lang === "zh"
            ? "我们无法从公开数据判断异动是开仓还是平仓, 也无法识别买方/卖方。call_put_bias 是名义金额比, 非真实净敞口。"
            : "Public data cannot tell us whether a trade opened or closed, nor buyer vs seller. Call/put bias is a notional-share proxy, not net exposure."
        }
      />
    </div>
  );
}

function Header({ lang, expiration }: { lang: Locale; expiration: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
          <Zap className="w-4.5 h-4.5 text-[var(--accent)]" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-[var(--text-0)]">
            {lang === "zh" ? "异动期权流" : "Unusual Options Flow"}
          </h2>
          <p className="text-[11px] text-[var(--text-2)]">
            {lang === "zh"
              ? `透明阈值分类 · 到期日 ${expiration}`
              : `Transparent thresholds · Expiration ${expiration}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function ThresholdCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-2)] px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold">
        {label}
      </div>
      <div className="mt-0.5 mono font-semibold text-[var(--text-0)] text-sm">{value}</div>
    </div>
  );
}
