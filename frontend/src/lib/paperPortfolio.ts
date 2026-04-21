/**
 * PaperPortfolio — 模拟仓位 (Phase 3)
 *
 * 数据诚实性:
 *   - 仓位仅保存在 localStorage, 不向任何真实券商推送
 *   - 估值方式: 跟踪当前 spot 变化 → BSM 重算, 明确标注"理论价"
 *   - 用户须自行理解这是假想仓位
 */

import type { BacktestLeg, BacktestStrategy } from "./api";

const STORAGE_KEY = "optionsai.paperPortfolio.v1";

export interface PaperPosition {
  id: string;
  ticker: string;
  strategy_type: BacktestStrategy;
  entry_date: string;
  entry_spot: number;
  entry_price: number;       // 理论价 per share
  dte_days: number;
  hold_days: number;
  legs: BacktestLeg[];
  created_at: string;
}

function readAll(): PaperPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PaperPosition[];
  } catch {
    return [];
  }
}

function writeAll(items: PaperPosition[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listPaperPositions(): PaperPosition[] {
  return readAll();
}

export function addPaperPosition(pos: PaperPosition): PaperPosition[] {
  const items = readAll();
  items.unshift(pos);
  writeAll(items);
  return items;
}

export function removePaperPosition(id: string): PaperPosition[] {
  const items = readAll().filter((p) => p.id !== id);
  writeAll(items);
  return items;
}

export function clearPaperPositions(): void {
  writeAll([]);
}
