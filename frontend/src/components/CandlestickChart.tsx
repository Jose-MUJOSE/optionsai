"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { t } from "@/lib/i18n";

export default function CandlestickChart() {
  const { marketData, locale } = useAppStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!marketData?.ticker || !widgetRef.current) return;

    // Clear previous widget
    widgetRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;

    // Map ticker for TradingView (e.g., 0700.HK -> HKEX:700, 600519.SS -> SSE:600519)
    let tvSymbol = marketData.ticker;
    if (tvSymbol.endsWith(".HK")) {
      const code = tvSymbol.replace(".HK", "").replace(/^0+/, "");
      tvSymbol = `HKEX:${code}`;
    } else if (tvSymbol.endsWith(".SS")) {
      tvSymbol = `SSE:${tvSymbol.replace(".SS", "")}`;
    } else if (tvSymbol.endsWith(".SZ")) {
      tvSymbol = `SZSE:${tvSymbol.replace(".SZ", "")}`;
    }
    // US stocks: use NASDAQ: or NYSE: prefix - TradingView auto-resolves plain symbols

    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: "D",
      timezone: "America/New_York",
      theme: "light",
      style: "1",
      locale: locale === "zh" ? "zh_CN" : "en",
      toolbar_bg: "#ffffff",
      enable_publishing: false,
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    });

    widgetRef.current.appendChild(script);

    return () => {
      if (widgetRef.current) widgetRef.current.innerHTML = "";
    };
  }, [marketData?.ticker, locale]);

  if (!marketData) return null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm anim-fade-up">
      <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{t("kline.title", locale)}</h3>
        <span className="text-xs text-gray-400">{locale === "zh" ? "由 TradingView 提供" : "Powered by TradingView"}</span>
      </div>
      <div className="tradingview-widget-container" ref={containerRef} style={{ height: 500 }}>
        <div
          ref={widgetRef}
          className="tradingview-widget-container__widget"
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
}
