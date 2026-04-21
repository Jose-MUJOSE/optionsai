// ============================================================
// OptionsAI - TypeScript 类型定义 (对应后端 Pydantic Models)
// ============================================================

export type TrendExpectation =
  | "slight_up" | "up" | "strong_up" | "volatile_up"
  | "neutral" | "high_volatile"
  | "slight_down" | "down" | "strong_down" | "volatile_down";

export interface TrendOption {
  value: TrendExpectation;
  label: string;
  icon: string;
  color: string;
}

/**
 * `iv_rank_source` tells you what `iv_rank` / `iv_percentile` are actually
 * computed from — so the UI can label the data honestly.
 *
 *  - "historical_iv"      → rank computed from ≥30 days of real cached ATM IV
 *  - "hv_proxy"           → IV history is still accumulating; the values here
 *                           mirror the (real) HV Rank / HV Percentile
 *  - "insufficient_data"  → couldn't compute rank honestly this request
 */
export type IvRankSource = "historical_iv" | "hv_proxy" | "insufficient_data";

export interface MarketData {
  ticker: string;
  spot_price: number;
  change_pct: number;
  iv_current: number;
  iv_rank: number;
  iv_percentile: number;
  hv_30: number;
  /** 100% real: current HV(30) rank in the 1y rolling-HV series. */
  hv_rank: number;
  /** 100% real: share of past days where HV(30) was below current. */
  hv_percentile: number;
  iv_rank_source: IvRankSource;
  /** Days of cached real IV snapshots used for IV Rank. */
  iv_history_days: number;
  next_earnings_date: string | null;
  expirations: string[];
  /** ISO 8601 UTC timestamp of when the backend gathered this snapshot. */
  as_of: string | null;
}

export interface OptionLeg {
  action: "BUY" | "SELL";
  option_type: "CALL" | "PUT";
  strike: number;
  expiration: string;
  premium: number;
  quantity: number;
  description: string;
}

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export interface Strategy {
  strategy_type: string;
  name: string;
  name_en: string;
  tag: string;
  legs: OptionLeg[];
  net_debit_credit: number;
  max_profit: number;
  max_profit_pct: number;
  max_loss: number;
  breakevens: number[];
  win_probability: number;
  required_capital: number;
  payoff_data: PayoffPoint[];
}

export interface StrategyResponse {
  ticker: string;
  spot_price: number;
  iv_current: number;
  iv_rank: number;
  expiration: string;
  strategies: Strategy[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Optional base64 data-URL images attached to this user message (chart screenshots, etc.). */
  images?: string[];
}

export interface ChatContext {
  ticker: string;
  market_data?: MarketData;
  selected_strategy?: Strategy;
  user_trend?: string;
  target_price?: number;
}
