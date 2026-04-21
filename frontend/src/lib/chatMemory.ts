// ============================================================
// OptionsAI - Per-Ticker Chat Memory (Phase 7a, localStorage)
// ============================================================
// Stores the full message history for each ticker separately so that
// when the user switches back to AAPL they see their prior analysis
// conversation restored. No server-side persistence — 100% local.
//
// Storage layout:
//   optionsai.chatMemory.v1 → { [TICKER]: { messages: ChatMessage[], updatedAt: number } }
//
// Caps:
//   - Per-ticker: last 40 messages kept (avoid quota blow-up)
//   - Total tickers retained: 20 most recently used (LRU eviction)
// ============================================================

"use client";

import type { ChatMessage } from "@/types";

const STORAGE_KEY = "optionsai.chatMemory.v1";
const MAX_MESSAGES_PER_TICKER = 40;
const MAX_TICKERS = 20;

interface TickerChatRecord {
  messages: ChatMessage[];
  updatedAt: number;
}

interface ChatMemoryStore {
  [ticker: string]: TickerChatRecord;
}

function readStore(): ChatMemoryStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChatMemoryStore;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeStore(store: ChatMemoryStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota — silently ignore */
  }
}

/** Return saved messages for a ticker, or an empty array. */
export function loadTickerChat(ticker: string): ChatMessage[] {
  if (!ticker) return [];
  const store = readStore();
  const rec = store[ticker.toUpperCase()];
  if (!rec || !Array.isArray(rec.messages)) return [];
  return rec.messages;
}

/**
 * Save messages for a ticker. Caps at MAX_MESSAGES_PER_TICKER (keeps tail).
 * Evicts least-recently-used tickers beyond MAX_TICKERS.
 */
export function saveTickerChat(ticker: string, messages: ChatMessage[]): void {
  if (!ticker) return;
  const key = ticker.toUpperCase();
  const store = readStore();
  const trimmed =
    messages.length > MAX_MESSAGES_PER_TICKER
      ? messages.slice(messages.length - MAX_MESSAGES_PER_TICKER)
      : messages;
  store[key] = { messages: trimmed, updatedAt: Date.now() };

  const entries = Object.entries(store);
  if (entries.length > MAX_TICKERS) {
    entries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    const kept: ChatMemoryStore = {};
    for (const [k, v] of entries.slice(0, MAX_TICKERS)) kept[k] = v;
    writeStore(kept);
  } else {
    writeStore(store);
  }
}

/** Remove the chat record for a single ticker. */
export function clearTickerChat(ticker: string): void {
  if (!ticker) return;
  const key = ticker.toUpperCase();
  const store = readStore();
  if (store[key]) {
    delete store[key];
    writeStore(store);
  }
}

/** Remove all saved chat memory. */
export function clearAllChatMemory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** List tickers with saved chat, most-recently-updated first. */
export function listSavedTickers(): { ticker: string; messageCount: number; updatedAt: number }[] {
  const store = readStore();
  return Object.entries(store)
    .map(([ticker, rec]) => ({
      ticker,
      messageCount: rec.messages.length,
      updatedAt: rec.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
