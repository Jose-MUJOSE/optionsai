// ============================================================
// OptionsAI - Event Alerts (localStorage-backed, client-side monitor)
// ============================================================
// Phase 6b. Purely client-side:
//   - Rules stored in localStorage
//   - Polling uses the same real /api/market-data endpoint
//   - Triggers use the browser Notification API (opt-in)
// No server-side cron — everything runs while the tab is open.
// ============================================================

"use client";

export type AlertKind =
  | "price_above"        // spot crosses UP through price
  | "price_below"        // spot crosses DOWN through price
  | "change_pct_above"   // daily change % >= threshold
  | "iv_rank_above"      // IV rank >= threshold
  | "iv_rank_below"      // IV rank <= threshold
  | "earnings_within";   // earnings date within N days

export interface AlertRule {
  id: string;
  ticker: string;
  kind: AlertKind;
  threshold: number;
  createdAt: number;
  enabled: boolean;
  lastFiredAt: number | null;
  lastValue: number | null;
}

const STORAGE_KEY = "optionsai.eventAlerts.v1";

export function loadAlertRules(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AlertRule[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is AlertRule =>
        !!r && typeof r.id === "string" && typeof r.ticker === "string" && typeof r.threshold === "number"
    );
  } catch {
    return [];
  }
}

export function saveAlertRules(rules: AlertRule[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* quota / private mode — silently ignore */
  }
}

export function addAlertRule(rule: Omit<AlertRule, "id" | "createdAt" | "lastFiredAt" | "lastValue" | "enabled">): AlertRule {
  const newRule: AlertRule = {
    ...rule,
    id: `${rule.ticker}-${rule.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    enabled: true,
    lastFiredAt: null,
    lastValue: null,
  };
  const rules = loadAlertRules();
  saveAlertRules([...rules, newRule]);
  return newRule;
}

export function removeAlertRule(id: string): void {
  saveAlertRules(loadAlertRules().filter((r) => r.id !== id));
}

export function toggleAlertRule(id: string): void {
  saveAlertRules(loadAlertRules().map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
}

export function updateAlertRule(id: string, updates: Partial<AlertRule>): void {
  saveAlertRules(loadAlertRules().map((r) => (r.id === id ? { ...r, ...updates } : r)));
}

/**
 * Evaluate a rule against a fresh market data snapshot.
 * Returns the "current value" used to decide + whether it should fire.
 * Uses edge-triggered logic for price crossings so we don't spam on every poll.
 */
export interface RuleEvaluation {
  currentValue: number | null;
  shouldFire: boolean;
  message: string;
}

export interface TickerSnapshot {
  ticker: string;
  spot_price: number;
  change_pct: number;
  iv_rank: number;
  earnings_date: string | null;
}

export function evaluateRule(rule: AlertRule, snap: TickerSnapshot): RuleEvaluation {
  if (!rule.enabled) {
    return { currentValue: null, shouldFire: false, message: "" };
  }
  switch (rule.kind) {
    case "price_above": {
      const prev = rule.lastValue;
      const crossed = prev !== null && prev < rule.threshold && snap.spot_price >= rule.threshold;
      return {
        currentValue: snap.spot_price,
        shouldFire: crossed,
        message: `${rule.ticker} crossed ABOVE $${rule.threshold.toFixed(2)} (now $${snap.spot_price.toFixed(2)})`,
      };
    }
    case "price_below": {
      const prev = rule.lastValue;
      const crossed = prev !== null && prev > rule.threshold && snap.spot_price <= rule.threshold;
      return {
        currentValue: snap.spot_price,
        shouldFire: crossed,
        message: `${rule.ticker} crossed BELOW $${rule.threshold.toFixed(2)} (now $${snap.spot_price.toFixed(2)})`,
      };
    }
    case "change_pct_above": {
      const abs = Math.abs(snap.change_pct);
      return {
        currentValue: abs,
        shouldFire: abs >= rule.threshold && !_firedRecently(rule),
        message: `${rule.ticker} moved ${snap.change_pct >= 0 ? "+" : ""}${snap.change_pct.toFixed(2)}% today`,
      };
    }
    case "iv_rank_above": {
      return {
        currentValue: snap.iv_rank,
        shouldFire: snap.iv_rank >= rule.threshold && !_firedRecently(rule),
        message: `${rule.ticker} IV Rank = ${snap.iv_rank.toFixed(1)} (≥ ${rule.threshold})`,
      };
    }
    case "iv_rank_below": {
      return {
        currentValue: snap.iv_rank,
        shouldFire: snap.iv_rank <= rule.threshold && !_firedRecently(rule),
        message: `${rule.ticker} IV Rank = ${snap.iv_rank.toFixed(1)} (≤ ${rule.threshold})`,
      };
    }
    case "earnings_within": {
      if (!snap.earnings_date) {
        return { currentValue: null, shouldFire: false, message: "" };
      }
      const days = Math.floor((new Date(snap.earnings_date).getTime() - Date.now()) / 86400000);
      return {
        currentValue: days,
        shouldFire: days >= 0 && days <= rule.threshold && !_firedRecently(rule),
        message: `${rule.ticker} earnings in ${days} day${days === 1 ? "" : "s"} (${snap.earnings_date})`,
      };
    }
    default:
      return { currentValue: null, shouldFire: false, message: "" };
  }
}

// Silent period to prevent re-firing slow-moving alerts every 30s.
// For price crossings we use edge-triggered logic above; for threshold alerts
// we require ≥ 4 hours between fires per rule.
const FIRE_COOLDOWN_MS = 4 * 60 * 60 * 1000;

function _firedRecently(rule: AlertRule): boolean {
  return !!rule.lastFiredAt && Date.now() - rule.lastFiredAt < FIRE_COOLDOWN_MS;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "denied";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function showBrowserNotification(title: string, body: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico", tag: title });
  } catch {
    /* some browsers throw if the tab is in background — non-fatal */
  }
}
