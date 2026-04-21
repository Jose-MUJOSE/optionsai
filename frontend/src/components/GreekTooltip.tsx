"use client";

import { Info } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { useState } from "react";

type GreekName = "delta" | "gamma" | "theta" | "vega";

const GREEK_EXPLANATIONS: Record<GreekName, { zh: string; en: string; formula: string }> = {
  delta: {
    zh: "股价每涨 $1，期权价格的变化量。\n看涨期权 Delta：0~+1（正数）\n看跌期权 Delta：-1~0（负数）\n💡 Delta≈0.5 = 约50%概率收益",
    en: "Option price change per $1 stock move.\nCall delta: 0 to +1  |  Put delta: -1 to 0\n💡 Delta≈0.5 means ~50% probability ITM",
    formula: "Δ = ∂V/∂S",
  },
  gamma: {
    zh: "Delta 本身的变化速度（Delta 的 Delta）。\nGamma 越大 = 期权价格对股价变动越敏感。\n💡 越靠近到期日，ATM 期权 Gamma 越大",
    en: "Rate of change of Delta per $1 stock move.\nHigh gamma = option becomes more sensitive.\n💡 Gamma peaks near expiration for ATM options",
    formula: "Γ = ∂²V/∂S²",
  },
  theta: {
    zh: "每天时间流逝损耗的期权价值（通常为负）。\n买方每天亏损时间价值（Theta 是你的敌人）。\n卖方每天收获 Theta（Theta 是你的朋友）。",
    en: "Daily time decay cost. Usually negative for buyers.\nBuyers lose time value each day (Theta enemy).\nSellers collect Theta daily (Theta friend).",
    formula: "Θ = ∂V/∂t",
  },
  vega: {
    zh: "隐含波动率 (IV) 每变动 1%，期权价格的变化量。\n财报前 IV 升高对买方有利（Vega 正）。\n财报后 IV 崩塌（IV Crush）对卖方有利。",
    en: "Option price change per 1% change in IV.\nHigh IV before earnings benefits buyers.\nIV crush after earnings benefits sellers.",
    formula: "ν = ∂V/∂σ",
  },
};

interface Props {
  greek: GreekName;
  locale: Locale;
}

export default function GreekTooltip({ greek, locale }: Props) {
  const [show, setShow] = useState(false);
  const info = GREEK_EXPLANATIONS[greek];
  const text = locale === "zh" ? info.zh : info.en;

  return (
    <span className="relative inline-flex items-center">
      <Info
        className="w-3.5 h-3.5 text-gray-400 hover:text-blue-500 cursor-help ml-0.5 transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[9999]
          w-64 bg-gray-900 text-white text-xs rounded-xl p-3 shadow-xl
          whitespace-pre-line pointer-events-none
        ">
          <span className="block font-bold text-blue-300 mb-1 uppercase text-[10px] tracking-wider">
            {greek.toUpperCase()} · {info.formula}
          </span>
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-px border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}
