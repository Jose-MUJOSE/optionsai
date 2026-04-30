"use client";

/**
 * PaperPortfolio — 模拟仓位列表 (Phase 3)
 *
 * 数据诚实性:
 *   - 仓位保存在 localStorage (用户本地), 不推向券商
 *   - 当前 P&L = 用最新 spot + BSM 理论价, 明确标注"理论 P&L"
 *   - 不鼓励将理论 P&L 当作真实盈亏
 */

import { useEffect, useState } from "react";
import { FolderOpen, Trash2, RefreshCw, AlertCircle } from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  listPaperPositions,
  removePaperPosition,
  type PaperPosition,
} from "@/lib/paperPortfolio";
import { runBacktest } from "@/lib/api";
import PortfolioGreeks from "./PortfolioGreeks";

interface PositionWithPnl extends PaperPosition {
  current_spot: number | null;
  current_price: number | null;
  pnl_per_contract: number | null;
  pnl_pct: number | null;
  loading: boolean;
  error: string | null;
}

export default function PaperPortfolio() {
  const { locale } = useAppStore();
  const [items, setItems] = useState<PositionWithPnl[]>([]);

  const reload = () => {
    setItems(
      listPaperPositions().map((p) => ({
        ...p,
        current_spot: null,
        current_price: null,
        pnl_per_contract: null,
        pnl_pct: null,
        loading: false,
        error: null,
      }))
    );
  };

  useEffect(() => {
    reload();
  }, []);

  const refreshOne = async (pos: PositionWithPnl) => {
    setItems((prev) =>
      prev.map((p) => (p.id === pos.id ? { ...p, loading: true, error: null } : p))
    );
    try {
      // Run a 1-day backtest from the original entry to today-ish to get current theoretical price
      const r = await runBacktest(pos.ticker, {
        strategy_type: pos.strategy_type,
        entry_date: pos.entry_date,
        dte_days: pos.dte_days,
        hold_days: Math.max(1, pos.hold_days),
      });
      const lastBar = r.bars[r.bars.length - 1];
      setItems((prev) =>
        prev.map((p) =>
          p.id === pos.id
            ? {
                ...p,
                current_spot: lastBar.spot,
                current_price: lastBar.theoretical_price,
                pnl_per_contract: lastBar.pnl_per_contract,
                pnl_pct: lastBar.pnl_pct,
                loading: false,
              }
            : p
        )
      );
    } catch (e) {
      setItems((prev) =>
        prev.map((p) =>
          p.id === pos.id
            ? { ...p, loading: false, error: e instanceof Error ? e.message : String(e) }
            : p
        )
      );
    }
  };

  const refreshAll = () => {
    items.forEach((p) => refreshOne(p));
  };

  const remove = (id: string) => {
    removePaperPosition(id);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
            <FolderOpen className="w-4.5 h-4.5 text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--text-0)]">
              {locale === "zh" ? "模拟仓位 (Paper)" : "Paper Portfolio"}
            </h2>
            <p className="text-[11px] text-[var(--text-2)]">
              {locale === "zh"
                ? "本地保存 · BSM 理论 P&L · 不连接券商"
                : "Local storage · BSM theoretical P&L · Broker-free"}
            </p>
          </div>
        </div>
        <button
          onClick={refreshAll}
          disabled={items.length === 0}
          className="h-9 px-3 rounded-lg border border-[var(--line-soft)] text-xs font-semibold flex items-center gap-2 hover:bg-[var(--bg-2)] transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {locale === "zh" ? "刷新全部" : "Refresh All"}
        </button>
      </div>

      {/* Portfolio Greeks panel — appears between header and position list when positions exist */}
      <PortfolioGreeks />

      {items.length === 0 ? (
        <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-10 text-center">
          <p className="text-sm text-[var(--text-2)]">
            {locale === "zh"
              ? "还没有模拟仓位. 去策略回测里添加."
              : "No paper positions yet. Add from strategy backtest."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => {
            const isWin = p.pnl_per_contract != null && p.pnl_per_contract > 0;
            const isLoss = p.pnl_per_contract != null && p.pnl_per_contract < 0;
            return (
              <div
                key={p.id}
                className="bg-white border border-[var(--line-soft)] rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-[var(--text-0)] mono">{p.ticker}</span>
                    <span className="text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent-hot)] font-semibold">
                      {p.strategy_type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--text-2)]">
                    {locale === "zh" ? "进场" : "Entry"}: {p.entry_date} @ ${p.entry_spot.toFixed(2)} ·{" "}
                    {locale === "zh" ? "权利金" : "Premium"} ${p.entry_price.toFixed(2)} · DTE {p.dte_days}d
                  </div>
                  <div className="text-[11px] text-[var(--text-2)] mt-0.5">
                    {p.legs.map((l, i) => (
                      <span key={i}>
                        {i > 0 && " + "}
                        {l.action === "buy" ? "+" : "-"}
                        {l.quantity} {l.opt_type.toUpperCase()} @ ${l.strike}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="text-right min-w-[120px]">
                  {p.loading ? (
                    <span className="text-xs text-[var(--text-2)]">
                      {locale === "zh" ? "计算中..." : "Computing..."}
                    </span>
                  ) : p.pnl_per_contract != null ? (
                    <>
                      <div
                        className={`text-sm font-bold mono ${
                          isWin
                            ? "text-[var(--fin-up)]"
                            : isLoss
                            ? "text-[var(--fin-down)]"
                            : "text-[var(--text-0)]"
                        }`}
                      >
                        ${p.pnl_per_contract.toFixed(0)}
                      </div>
                      <div className="text-[10px] text-[var(--text-2)]">
                        {p.pnl_pct != null ? `${p.pnl_pct.toFixed(1)}%` : ""}{" "}
                        · {locale === "zh" ? "理论" : "theory"}
                      </div>
                    </>
                  ) : p.error ? (
                    <span className="text-xs text-red-600">{p.error}</span>
                  ) : (
                    <span className="text-xs text-[var(--text-2)]">
                      {locale === "zh" ? "未刷新" : "Not refreshed"}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => refreshOne(p)}
                    disabled={p.loading}
                    className="p-2 rounded-lg hover:bg-[var(--bg-2)] text-[var(--text-2)] hover:text-[var(--accent)] transition cursor-pointer disabled:opacity-50"
                    title={locale === "zh" ? "刷新 P&L" : "Refresh P&L"}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${p.loading ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-[var(--text-2)] hover:text-red-600 transition cursor-pointer"
                    title={locale === "zh" ? "删除" : "Delete"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 text-xs">
        <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-amber-900 leading-relaxed">
          <span className="font-semibold">
            {locale === "zh" ? "重要声明: " : "Important: "}
          </span>
          {locale === "zh"
            ? "本页面的 P&L 使用 Black-Scholes 理论价计算, 仅供参考。真实交易的成交价会受买卖价差、流动性与事件风险影响, 可能显著不同。本平台不提供实际交易功能。"
            : "P&L shown here is computed via Black-Scholes theoretical pricing for illustration only. Real trade fills differ due to bid-ask spreads, liquidity, and event risk. This platform does not execute real trades."}
        </div>
      </div>
    </div>
  );
}
