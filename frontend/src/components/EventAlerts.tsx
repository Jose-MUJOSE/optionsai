"use client";

/**
 * EventAlerts (Phase 6b)
 *
 * Data honesty:
 *   - Polls real /api/market-data every 60s for each unique ticker in rules.
 *   - No server-side notification pipeline: alerts only fire while the tab
 *     is open. UI tells the user this explicitly.
 *   - Browser Notification permission is opt-in.
 *   - Rules persist in localStorage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Plus, Trash2, AlertCircle, Check, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { fetchMarketData } from "@/lib/api";
import type { MarketData } from "@/types";
import {
  type AlertKind,
  type AlertRule,
  type TickerSnapshot,
  addAlertRule,
  evaluateRule,
  loadAlertRules,
  removeAlertRule,
  requestNotificationPermission,
  showBrowserNotification,
  toggleAlertRule,
  updateAlertRule,
} from "@/lib/eventAlerts";
import FeatureGuide from "./FeatureGuide";

type Locale = "zh" | "en";

const KIND_COPY: Record<AlertKind, { zh: string; en: string; unit: string }> = {
  price_above: { zh: "价格向上突破", en: "Price crosses above", unit: "$" },
  price_below: { zh: "价格向下跌破", en: "Price crosses below", unit: "$" },
  change_pct_above: { zh: "日内涨跌幅超过", en: "Daily change % ≥", unit: "%" },
  iv_rank_above: { zh: "IV Rank 高于", en: "IV Rank ≥", unit: "" },
  iv_rank_below: { zh: "IV Rank 低于", en: "IV Rank ≤", unit: "" },
  earnings_within: { zh: "财报日 N 天内", en: "Earnings within (days)", unit: "d" },
};

const ALL_KINDS: AlertKind[] = [
  "price_above",
  "price_below",
  "change_pct_above",
  "iv_rank_above",
  "iv_rank_below",
  "earnings_within",
];

const POLL_MS = 60_000;

export default function EventAlerts() {
  const { locale } = useAppStore();
  const lang: Locale = locale === "zh" ? "zh" : "en";

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");
  const [firedLog, setFiredLog] = useState<{ id: string; at: number; message: string }[]>([]);
  const [newRule, setNewRule] = useState<{
    ticker: string;
    kind: AlertKind;
    threshold: string;
  }>({ ticker: "", kind: "price_above", threshold: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const refresh = useCallback(() => {
    setRules(loadAlertRules());
  }, []);

  // Hydrate on mount
  useEffect(() => {
    refresh();
    if (typeof Notification !== "undefined") {
      setNotifPerm(Notification.permission);
    }
  }, [refresh]);

  // Polling loop: for each unique ticker with enabled rules, fetch market data once
  useEffect(() => {
    const tick = async () => {
      const enabled = rulesRef.current.filter((r) => r.enabled);
      if (enabled.length === 0) return;

      const uniqueTickers = Array.from(new Set(enabled.map((r) => r.ticker)));
      const snapshots: Record<string, TickerSnapshot> = {};

      // Fetch in parallel; ignore individual failures
      await Promise.all(
        uniqueTickers.map(async (ticker) => {
          try {
            const md: MarketData = await fetchMarketData(ticker);
            snapshots[ticker] = {
              ticker,
              spot_price: md.spot_price,
              change_pct: md.change_pct,
              iv_rank: md.iv_rank,
              earnings_date: md.next_earnings_date ?? null,
            };
          } catch {
            /* ignore per-ticker failure */
          }
        })
      );

      // Evaluate every rule, persist updates
      const current = loadAlertRules();
      const next = current.map((rule) => {
        const snap = snapshots[rule.ticker];
        if (!snap) return rule;
        const evalResult = evaluateRule(rule, snap);
        if (evalResult.shouldFire) {
          const title = lang === "zh" ? "⚡ OptionsAI 提醒" : "⚡ OptionsAI Alert";
          showBrowserNotification(title, evalResult.message);
          setFiredLog((prev) =>
            [
              { id: rule.id, at: Date.now(), message: evalResult.message },
              ...prev,
            ].slice(0, 20)
          );
          return {
            ...rule,
            lastFiredAt: Date.now(),
            lastValue: evalResult.currentValue ?? rule.lastValue,
          };
        }
        if (evalResult.currentValue !== null) {
          return { ...rule, lastValue: evalResult.currentValue };
        }
        return rule;
      });
      // Only persist if something changed
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        localStorage.setItem("optionsai.eventAlerts.v1", JSON.stringify(next));
        setRules(next);
      }
    };

    // Fire once immediately, then on interval
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [lang]);

  const onAddRule = useCallback(() => {
    setFormError(null);
    const ticker = newRule.ticker.trim().toUpperCase();
    if (!ticker) {
      setFormError(lang === "zh" ? "请输入股票代码" : "Ticker required");
      return;
    }
    const threshold = parseFloat(newRule.threshold);
    if (!Number.isFinite(threshold)) {
      setFormError(lang === "zh" ? "请输入有效数字" : "Threshold must be a number");
      return;
    }
    addAlertRule({ ticker, kind: newRule.kind, threshold });
    setNewRule({ ticker: "", kind: "price_above", threshold: "" });
    refresh();
  }, [newRule, lang, refresh]);

  const onRequestPermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setNotifPerm(result);
  }, []);

  const onToggle = useCallback(
    (id: string) => {
      toggleAlertRule(id);
      refresh();
    },
    [refresh]
  );

  const onRemove = useCallback(
    (id: string) => {
      removeAlertRule(id);
      refresh();
    },
    [refresh]
  );

  const onResetLastValue = useCallback(
    (id: string) => {
      updateAlertRule(id, { lastValue: null, lastFiredAt: null });
      refresh();
    },
    [refresh]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[rgba(109,78,224,0.15)] flex items-center justify-center">
            <Bell className="w-4.5 h-4.5 text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--text-0)]">
              {lang === "zh" ? "事件提醒" : "Event Alerts"}
            </h2>
            <p className="text-[11px] text-[var(--text-2)]">
              {lang === "zh"
                ? "本地保存 · 仅在标签页打开时触发 · 真实市场数据"
                : "Local storage · Tab must be open · Real market data"}
            </p>
          </div>
        </div>
        <PermissionBadge lang={lang} permission={notifPerm} onRequest={onRequestPermission} />
      </div>

      {/* Add rule form */}
      <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            value={newRule.ticker}
            onChange={(e) => setNewRule({ ...newRule, ticker: e.target.value })}
            placeholder={lang === "zh" ? "代码, 例: AAPL" : "Ticker, e.g. AAPL"}
            className="md:col-span-3 px-3 py-2 text-sm border border-[var(--line-soft)] rounded-lg bg-[var(--bg-2)] mono focus:outline-none focus:border-[var(--accent)]"
          />
          <select
            value={newRule.kind}
            onChange={(e) => setNewRule({ ...newRule, kind: e.target.value as AlertKind })}
            className="md:col-span-5 px-3 py-2 text-sm border border-[var(--line-soft)] rounded-lg bg-[var(--bg-2)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_COPY[k][lang]}
              </option>
            ))}
          </select>
          <input
            value={newRule.threshold}
            onChange={(e) => setNewRule({ ...newRule, threshold: e.target.value })}
            placeholder={lang === "zh" ? "阈值" : "Threshold"}
            type="number"
            step="0.01"
            className="md:col-span-2 px-3 py-2 text-sm border border-[var(--line-soft)] rounded-lg bg-[var(--bg-2)] mono focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={onAddRule}
            className="md:col-span-2 h-10 rounded-lg bg-gradient-to-r from-[var(--accent)] to-[var(--accent-violet)] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:shadow-[var(--shadow-blue)] hover:-translate-y-px transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {lang === "zh" ? "添加" : "Add"}
          </button>
        </div>
        {formError && (
          <div className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {formError}
          </div>
        )}
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-10 text-center">
          <p className="text-sm text-[var(--text-2)]">
            {lang === "zh"
              ? "还没有提醒规则。添加一条上面, 我会每 60 秒检查一次。"
              : "No alert rules yet. Add one above — we'll check every 60 seconds."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-white border rounded-xl p-3 flex items-center gap-3 ${
                rule.enabled ? "border-[var(--line-soft)]" : "border-[var(--line-soft)] opacity-60"
              }`}
            >
              <button
                onClick={() => onToggle(rule.id)}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                  rule.enabled
                    ? "text-[var(--fin-up)] hover:bg-[var(--fin-up-soft)]"
                    : "text-[var(--text-2)] hover:bg-[var(--bg-2)]"
                }`}
                title={rule.enabled ? "Disable" : "Enable"}
              >
                {rule.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="mono font-bold text-sm text-[var(--text-0)]">{rule.ticker}</span>
                  <span className="text-xs text-[var(--text-1)]">
                    {KIND_COPY[rule.kind][lang]}
                  </span>
                  <span className="mono text-xs font-semibold text-[var(--accent)]">
                    {rule.threshold}
                    {KIND_COPY[rule.kind].unit}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-2)] mt-0.5">
                  {lang === "zh" ? "上次值" : "Last value"}:{" "}
                  <span className="mono">
                    {rule.lastValue === null ? "-" : rule.lastValue.toFixed(2)}
                  </span>
                  {rule.lastFiredAt && (
                    <>
                      {" · "}
                      {lang === "zh" ? "最近触发" : "Last fired"}:{" "}
                      {new Date(rule.lastFiredAt).toLocaleString()}
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => onResetLastValue(rule.id)}
                className="p-2 rounded-lg hover:bg-[var(--bg-2)] text-[var(--text-2)] hover:text-[var(--accent)] transition cursor-pointer"
                title={lang === "zh" ? "重置" : "Reset state"}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onRemove(rule.id)}
                className="p-2 rounded-lg hover:bg-red-50 text-[var(--text-2)] hover:text-red-600 transition cursor-pointer"
                title={lang === "zh" ? "删除" : "Remove"}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Fired log */}
      {firedLog.length > 0 && (
        <div className="bg-white border border-[var(--line-soft)] rounded-2xl p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold mb-2">
            {lang === "zh" ? "本次会话已触发" : "Fired this session"}
          </div>
          <ul className="space-y-1.5">
            {firedLog.map((entry, i) => (
              <li
                key={`${entry.id}-${i}`}
                className="text-xs text-[var(--text-1)] flex items-start gap-2"
              >
                <Check className="w-3 h-3 mt-0.5 text-[var(--fin-up)] shrink-0" />
                <span className="flex-1">{entry.message}</span>
                <span className="text-[10px] text-[var(--text-2)] shrink-0">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FeatureGuide
        locale={lang}
        title={lang === "zh" ? "事件提醒" : "Event Alerts"}
        dataSource={
          lang === "zh"
            ? "本地 localStorage 保存规则 · 每 60 秒调用真实 /api/market-data · 浏览器 Notification API"
            : "Rules in localStorage · Real /api/market-data polled every 60s · Browser Notification API"
        }
        howToRead={
          lang === "zh"
            ? [
                "价格突破: 边沿触发, 只在跨越阈值时通知一次",
                "IV Rank / 涨跌幅: 阈值触发, 同一规则 4 小时冷却一次",
                "财报临近: 每日检查, 符合条件的当天通知",
                "提醒仅在标签页开着时运行, 关标签页则暂停",
              ]
            : [
                "Price cross: edge-triggered, fires only on the crossing",
                "IV Rank / change %: level-triggered, 4h cooldown per rule",
                "Earnings: daily check, fires on qualifying day",
                "Only runs while this tab is open",
              ]
        }
        whatItMeans={
          lang === "zh"
            ? [
                "边沿触发可防止价格在阈值附近震荡时重复通知",
                "4 小时冷却避免 IV Rank 一直在 > 60 时不停打扰",
                "浏览器通知需要明确授权, 默认状态不会弹窗",
              ]
            : [
                "Edge triggers avoid spamming when price oscillates near threshold",
                "4h cooldown stops repeat alerts when IV stays > 60 for hours",
                "Browser notifications require explicit permission",
              ]
        }
        actions={
          lang === "zh"
            ? [
                "给关注的股票设置 IV Rank ≥ 60 和 ≤ 30 各一条, 自动捕捉卖方/买方机会",
                "财报临近提醒搭配日历, 避免错过 IV 压缩",
                "若想 24/7 提醒, 需要另外部署服务端 cron (本功能不提供)",
              ]
            : [
                "Set IV Rank ≥60 and ≤30 rules for watchlist → auto-spot seller/buyer setups",
                "Earnings alerts help you avoid missing the IV crush window",
                "For 24/7 server-side alerts, deploy a cron yourself — out of scope here",
              ]
        }
        caveat={
          lang === "zh"
            ? "本功能 100% 在浏览器端运行。若标签页关闭或电脑休眠, 不会触发通知。如需全天候提醒请自行接入服务端 cron。"
            : "100% browser-side. No alerts if the tab is closed or machine sleeps. For 24/7 delivery, wire up a server-side cron yourself."
        }
      />
    </div>
  );
}

function PermissionBadge({
  lang,
  permission,
  onRequest,
}: {
  lang: Locale;
  permission: NotificationPermission;
  onRequest: () => void;
}) {
  if (permission === "granted") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--fin-up-soft)] text-[var(--fin-up)] text-[11px] font-semibold">
        <Check className="w-3 h-3" />
        {lang === "zh" ? "通知已授权" : "Notifications on"}
      </span>
    );
  }
  if (permission === "denied") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--fin-down-soft)] text-[var(--fin-down)] text-[11px] font-semibold">
        <X className="w-3 h-3" />
        {lang === "zh" ? "通知被拒绝" : "Notifications blocked"}
      </span>
    );
  }
  return (
    <button
      onClick={onRequest}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--accent-soft)] text-[var(--accent-hot)] text-[11px] font-semibold hover:bg-[rgba(45,76,221,0.18)] transition cursor-pointer"
    >
      <Bell className="w-3 h-3" />
      {lang === "zh" ? "启用浏览器通知" : "Enable notifications"}
    </button>
  );
}
