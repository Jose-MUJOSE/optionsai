// ============================================================
// OptionsAI - API 客户端
// ============================================================

import type { MarketData, StrategyResponse, TrendExpectation, ChatMessage, ChatContext } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Custom error class so the UI can distinguish "ticker is invalid" from
 * "ticker exists but data fetch failed". Carries bilingual messages.
 */
export class InvalidTickerError extends Error {
  readonly code = "INVALID_TICKER" as const;
  readonly messageEn: string;
  readonly messageZh: string;
  constructor(messageEn: string, messageZh: string) {
    super(messageEn);
    this.messageEn = messageEn;
    this.messageZh = messageZh;
  }
}

/** Company profile data shown in the dashboard intro card.
 *  All numeric fields are nullable: Yahoo's quoteSummary returns sparse
 *  data depending on the ticker. The UI handles missing values gracefully. */
export interface CompanyProfile {
  ticker: string;
  is_etf: boolean;
  quote_type: string | null;

  // Identity
  long_name: string | null;
  short_name: string | null;
  exchange: string | null;
  currency: string | null;
  logo_url: string | null;

  // Classification
  sector: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  address1: string | null;
  phone: string | null;
  website: string | null;
  full_time_employees: number | null;

  // Valuation
  market_cap: number | null;
  enterprise_value: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  price_to_book: number | null;
  price_to_sales_ttm: number | null;
  ev_to_ebitda: number | null;
  peg_ratio: number | null;
  dividend_yield: number | null;
  payout_ratio: number | null;

  // Financials
  revenue_ttm: number | null;
  ebitda: number | null;
  net_income_ttm: number | null;
  free_cash_flow: number | null;
  operating_cash_flow: number | null;
  total_cash: number | null;
  total_debt: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  profit_margin: number | null;
  return_on_equity: number | null;
  return_on_assets: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  revenue_growth_yoy: number | null;
  earnings_growth_yoy: number | null;

  // Market metrics
  beta: number | null;
  shares_outstanding: number | null;
  float_shares: number | null;
  current_price: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  fifty_day_avg: number | null;
  two_hundred_day_avg: number | null;

  long_business_summary: string | null;
}

export async function fetchCompanyProfile(ticker: string, lang: "en" | "zh" = "en"): Promise<CompanyProfile> {
  const res = await fetch(`${API_URL}/api/company-profile/${ticker}?lang=${lang}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 422 && err?.detail?.code === "INVALID_TICKER") {
      throw new InvalidTickerError(
        err.detail.message_en || "Invalid ticker",
        err.detail.message_zh || "无效股票代码",
      );
    }
    const detail = typeof err.detail === "string" ? err.detail : (err.detail?.message_en ?? res.statusText);
    throw new Error(detail || "Failed to fetch company profile");
  }
  return res.json();
}

/** Income-statement row (one quarter or one fiscal year) with growth rates. */
export interface FinancialRow {
  period: string;                     // e.g. "2025-09-30"
  revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  net_income: number | null;
  gross_margin: number | null;        // fraction (0.42 = 42%)
  operating_margin: number | null;
  net_margin: number | null;
  revenue_yoy: number | null;         // null when not enough history
  revenue_qoq: number | null;
  net_income_yoy: number | null;
  net_income_qoq: number | null;
}

/** Post-earnings 1-day price move computed by joining announcement date with OHLCV. */
export interface PostEarningsMove {
  prev_close: number;
  earnings_open: number | null;
  earnings_close: number;
  pct_close: number | null;           // close-to-close fractional move
  pct_open: number | null;
}

/** One earnings announcement. */
export interface EarningsHistoryItem {
  date: string | null;                // reported date YYYY-MM-DD
  quarter: string | null;             // e.g. "2Q2026"
  eps_actual: number | null;
  eps_estimate: number | null;
  eps_surprise_pct: number | null;    // fractional surprise (0.05 = 5%)
  post_earnings: PostEarningsMove | null;
}

/** Combined financial-history payload from /api/financials. */
export interface FinancialsResponse {
  ticker: string;
  quarterly: FinancialRow[];
  annual: FinancialRow[];
  earnings_history: EarningsHistoryItem[];
}

export async function fetchFinancials(ticker: string): Promise<FinancialsResponse> {
  const res = await fetch(`${API_URL}/api/financials/${ticker}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = typeof err.detail === "string" ? err.detail : (err.detail?.message_en ?? res.statusText);
    throw new Error(detail || "Failed to fetch financials");
  }
  return res.json();
}

/** Wall Street consensus block from /api/analyst-ratings. */
export interface AnalystConsensus {
  label: string;                          // "Strong Buy" / "Buy" / "Hold" / "Sell"
  target_mean: number | null;
  target_median: number | null;
  target_high: number | null;
  target_low: number | null;
  current_price: number | null;
  upside_pct: number | null;              // (target_mean - current) / current
  analyst_count: number | null;
  distribution: {
    strong_buy: number;
    buy: number;
    hold: number;
    sell: number;
    strong_sell: number;
    total: number;
  };
}

/** One firm-level rating action with its price target. */
export interface RatingChange {
  date: string | null;
  firm: string | null;
  from_grade: string | null;
  to_grade: string | null;
  action_code: string | null;             // "init" / "main" / "reit" / "up" / "down"
  action_label: string | null;            // "Initiate" / "Maintain" / "Reiterate" / "Upgrade" / "Downgrade"
  price_target: number | null;
  prior_price_target: number | null;
  price_target_delta_pct: number | null;
  price_target_action: string | null;     // "Raises" / "Lowers" / "Maintains"
}

export interface AnalystRatingsResponse {
  ticker: string;
  consensus: AnalystConsensus | null;
  rating_changes: RatingChange[];
}

/** One detected technical pattern on the latest bar of a ticker. */
export interface PatternHit {
  code: string;
  name_en: string;
  name_zh: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  description_en: string;
  description_zh: string;
  triggered_at_index: number;
}

/** One ticker's scan result with all its detected patterns. */
export interface PatternScanResult {
  ticker: string;
  last_close: number;
  last_date: number | null;
  hits: PatternHit[];
}

export interface PatternScanResponse {
  results: PatternScanResult[];
  scanned: number;
  matched: number;
}

/** Pattern catalog entry for the filter UI. */
export interface PatternCatalogItem {
  code: string;
  name_en: string;
  name_zh: string;
  direction: "bullish" | "bearish" | "neutral";
}

export async function fetchPatternCatalog(): Promise<{ patterns: PatternCatalogItem[] }> {
  const res = await fetch(`${API_URL}/api/pattern-catalog`);
  if (!res.ok) throw new Error("Failed to fetch pattern catalog");
  return res.json();
}

export async function runPatternScanner(
  tickers: string[],
  patterns: string[] | null = null,
  directions: ("bullish" | "bearish" | "neutral")[] | null = null,
): Promise<PatternScanResponse> {
  const res = await fetch(`${API_URL}/api/pattern-scanner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tickers,
      patterns: patterns && patterns.length > 0 ? patterns : null,
      directions: directions && directions.length > 0 ? directions : null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = typeof err.detail === "string" ? err.detail : res.statusText;
    throw new Error(detail || "Failed to scan patterns");
  }
  return res.json();
}

export async function fetchAnalystRatings(ticker: string, limit = 25): Promise<AnalystRatingsResponse> {
  const res = await fetch(`${API_URL}/api/analyst-ratings/${ticker}?limit=${limit}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = typeof err.detail === "string" ? err.detail : (err.detail?.message_en ?? res.statusText);
    throw new Error(detail || "Failed to fetch analyst ratings");
  }
  return res.json();
}

export async function fetchMarketData(ticker: string): Promise<MarketData> {
  const res = await fetch(`${API_URL}/api/market-data/${ticker}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    // Backend returns HTTP 422 with structured payload for invalid tickers.
    if (res.status === 422 && err?.detail?.code === "INVALID_TICKER") {
      throw new InvalidTickerError(
        err.detail.message_en || "Invalid ticker",
        err.detail.message_zh || "无效股票代码",
      );
    }
    const detail = typeof err.detail === "string" ? err.detail : (err.detail?.message_en ?? res.statusText);
    throw new Error(detail || "Failed to fetch market data");
  }
  return res.json();
}

export async function fetchStrategies(params: {
  ticker: string;
  trend: TrendExpectation;
  target_price?: number;
  target_pct?: number;
  target_price_upper?: number;
  target_price_lower?: number;
  expiration: string;
  preference_weight: number;
  budget?: number;
  max_loss?: number;
  max_loss_type?: string;
}): Promise<StrategyResponse> {
  const res = await fetch(`${API_URL}/api/strategies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to calculate strategies");
  }
  return res.json();
}

export interface ForecastItem {
  timeframe: string;
  timeframe_label: string;
  direction: "up" | "down" | "neutral";
  price_low: number;
  price_high: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface ForecastResponse {
  ticker: string;
  spot_price: number;
  forecasts: ForecastItem[];
}

export async function fetchForecast(ticker: string, locale: string): Promise<ForecastResponse> {
  const res = await fetch(`${API_URL}/api/forecast/${ticker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch forecast");
  }
  return res.json();
}

export interface NewsItem {
  date: string;
  title: string;
  summary: string;
  source?: string;
  url?: string;
}

export interface EventItem {
  date: string;
  type: string;
  description: string;
}

export interface AnalystTarget {
  institution: string;
  target_price: number | null;
  target_high?: number | null;
  target_low?: number | null;
  rating: string;
  date: string;
  timeframe?: string;
  num_analysts?: number;
}

export interface MarketIntelResponse {
  ticker: string;
  spot_price?: number;
  news: NewsItem[];
  events: EventItem[];
  analyst_targets: AnalystTarget[];
}

// Options Snapshot (expiration-specific ATM IV + Greeks)
export interface GreeksData {
  strike: number;
  iv: number;
  mid: number;
  bid: number;
  ask: number;
  volume: number;
  open_interest: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionsSnapshot {
  ticker: string;
  expiration: string;
  dte: number;
  atm_iv: number;
  hv_30: number;
  iv_hv_ratio: number | null;
  atm_call: GreeksData;
  atm_put: GreeksData;
}

export async function fetchOptionsSnapshot(ticker: string, expiration: string): Promise<OptionsSnapshot> {
  const res = await fetch(`${API_URL}/api/options-snapshot/${ticker}?expiration=${expiration}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch options snapshot");
  }
  return res.json();
}

export async function fetchMarketIntel(ticker: string, locale: string): Promise<MarketIntelResponse> {
  const res = await fetch(`${API_URL}/api/market-intel/${ticker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch market intel");
  }
  return res.json();
}

export async function* streamTopPick(params: Record<string, unknown>): AsyncGenerator<string> {
  const res = await fetch(`${API_URL}/api/top-pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Top pick request failed");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        if (data.startsWith("[ERROR]")) throw new Error(data);
        yield data;
      }
    }
  }
}

// IV Term Structure
export interface IVTermItem {
  expiration: string;
  dte: number;
  atm_iv: number;
}

export interface IVTermStructureResponse {
  ticker: string;
  term_structure: IVTermItem[];
}

export async function fetchIVTermStructure(ticker: string): Promise<IVTermStructureResponse> {
  const res = await fetch(`${API_URL}/api/iv-term-structure/${ticker}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch IV term structure");
  }
  return res.json();
}

// Settings
export interface SettingsConfig {
  data_provider: string;
  polygon_api_key: string;
  tradier_api_key: string;
  llm_provider: string;
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
  llm_presets?: Record<string, { base_url: string; model: string }>;
}

export async function fetchSettings(): Promise<SettingsConfig> {
  const res = await fetch(`${API_URL}/api/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(updates: Partial<SettingsConfig>): Promise<SettingsConfig> {
  const res = await fetch(`${API_URL}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  const data = await res.json();
  return data.config;
}

// OHLCV / K-line data
export interface OHLCVBar {
  time: number;     // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCVResponse {
  ticker: string;
  interval: string;
  bars: OHLCVBar[];
}

export async function fetchOHLCV(ticker: string, range = "1y", interval = "1d"): Promise<OHLCVResponse> {
  const res = await fetch(`${API_URL}/api/ohlcv/${ticker}?range=${range}&interval=${interval}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch OHLCV data");
  }
  return res.json();
}

// Short data
export interface ShortInterestData {
  shares_short: number | null;
  short_ratio: number | null;
  short_pct_float: number | null;
  date_short_interest: string | null;
  source: string;
}

export interface FinraShortVolumeItem {
  date: string;
  short_volume: number;
  total_volume: number;
  short_pct: number;
}

export interface ChipDistribution {
  buckets: { price: number; weight: number }[];
  data_label: string;
  current_price: number;
}

export interface InstitutionHolder {
  name: string;
  pct_held: number | null;
  pct_change: number | null;
  report_date: string;
}

export interface InsiderTransaction {
  name: string;
  relation: string;
  transaction_type: string;
  shares: number | null;
  value: number | null;
  date: string;
}

export interface SmartMoneyData {
  institutions: InstitutionHolder[];
  insiders: InsiderTransaction[];
  source_institutions: string;
  source_insiders: string;
}

export interface ShortDataResponse {
  ticker: string;
  short_interest: ShortInterestData;
  daily_short_volume: FinraShortVolumeItem[];
  chip_distribution: ChipDistribution;
  smart_money: SmartMoneyData;
}

export async function fetchShortData(ticker: string): Promise<ShortDataResponse> {
  const res = await fetch(`${API_URL}/api/short-data/${ticker}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch short data");
  }
  return res.json();
}

// Earnings implied vs actual moves
export interface EarningsMoveEvent {
  date: string;
  actual_move_pct: number;
  implied_move_pct: number | null; // Intentionally null — historical implied moves require paid data
  actual_direction: "up" | "down";
  close_before: number;
  close_after: number;
}

export interface EarningsMovesResponse {
  ticker: string;
  past_events: EarningsMoveEvent[];
  next_earnings_date: string | null;
  current_implied_move_pct: number | null;
  current_implied_source_expiration: string | null;
  avg_absolute_actual_move_pct: number | null;
  data_notes: {
    actual_moves: string;
    implied_moves_history: string;
    current_implied_move: string;
  };
}

export async function fetchEarningsMoves(ticker: string): Promise<EarningsMovesResponse> {
  const res = await fetch(`${API_URL}/api/earnings-moves/${ticker}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch earnings moves");
  }
  return res.json();
}

// Full options chain (with win_probability, breakeven)
export interface FullOptionContract {
  strike: number;
  last_price: number;
  bid: number;
  ask: number;
  mid_price: number;
  implied_volatility: number;
  volume: number;
  open_interest: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  option_type: "CALL" | "PUT";
  win_probability: number | null;
  breakeven: number | null;
}

export interface FullOptionsChain {
  ticker: string;
  expiration: string;
  dte: number;
  calls: FullOptionContract[];
  puts: FullOptionContract[];
}

export async function fetchFullOptionsChain(ticker: string, expiration: string): Promise<FullOptionsChain> {
  const res = await fetch(`${API_URL}/api/options-chain/${ticker}?expiration=${expiration}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch options chain");
  }
  return res.json();
}

// Gamma Exposure (GEX) by strike
export interface GEXStrikeRow {
  strike: number;
  call_gex_millions: number;
  put_gex_millions: number;
  net_gex_millions: number;
  call_oi: number;
  put_oi: number;
}

export interface GEXResponse {
  ticker: string;
  expiration: string;
  dte: number;
  spot_price: number;
  net_gex_millions: number;
  call_gex_millions: number;
  put_gex_millions: number;
  gamma_flip_strike: number | null;
  by_strike: GEXStrikeRow[];
  disclaimer: string;
}

export async function fetchGEX(ticker: string, expiration: string): Promise<GEXResponse> {
  const res = await fetch(`${API_URL}/api/gex/${ticker}?expiration=${expiration}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch gamma exposure");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Strategy Backtest (Phase 3) — OHLCV replay + BSM theoretical pricing
// ------------------------------------------------------------------
export type BacktestStrategy =
  | "long_call"
  | "long_put"
  | "short_call"
  | "short_put"
  | "bull_call_spread"
  | "bear_put_spread"
  | "long_straddle"
  | "short_strangle";

export interface BacktestLeg {
  action: "buy" | "sell";
  opt_type: "call" | "put";
  strike: number;
  quantity: number;
}

export interface BacktestBar {
  date: string;
  spot: number;
  theoretical_price: number;
  pnl_per_contract: number;
  pnl_pct: number;
  days_to_expiry: number;
  sigma: number;
}

/** Scientific performance metrics from backtest (Sharpe, MDD, etc.). */
export interface BacktestMetrics {
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  calmar_ratio: number | null;
  max_drawdown_dollars: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  profit_factor: number | null;
  avg_win: number;
  avg_loss: number;
  final_pnl_after_costs: number;
  transaction_cost_total: number;
  return_volatility_annual_pct: number;
}

export interface BacktestResponse {
  ticker: string;
  strategy_type: BacktestStrategy;
  entry_date: string;
  exit_date: string;
  initial_spot: number;
  exit_spot: number;
  dte_at_entry: number;
  legs: BacktestLeg[];
  initial_price_per_share: number;
  exit_price_per_share: number;
  max_pnl_per_contract: number;
  min_pnl_per_contract: number;
  final_pnl_per_contract: number;
  final_pnl_pct: number;
  bars: BacktestBar[];
  metrics?: BacktestMetrics;          // ★ NEW: scientific performance metrics
  assumptions: Record<string, unknown>;
  data_sources: Record<string, string>;
}

export async function runBacktest(
  ticker: string,
  body: {
    strategy_type: BacktestStrategy;
    entry_date?: string | null;
    dte_days?: number;
    hold_days?: number | null;
  }
): Promise<BacktestResponse> {
  const res = await fetch(`${API_URL}/api/backtest/${ticker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Backtest failed");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Unusual Options Flow (Phase 5) — transparent classification, no 3rd-party sentiment
// ------------------------------------------------------------------
export interface UnusualContract {
  option_type: "call" | "put";
  strike: number;
  volume: number;
  open_interest: number;
  vol_oi_ratio: number | null;
  mid_price: number;
  notional_usd: number;
  iv_pct: number | null;
  moneyness_pct: number;
  status: "ITM" | "OTM";
  flags: string[];
}

export interface UnusualFlowResponse {
  ticker: string;
  expiration: string;
  dte: number;
  spot_price: number;
  contracts: UnusualContract[];
  total_unusual_count: number;
  call_notional_usd: number;
  put_notional_usd: number;
  call_put_bias: "bullish" | "neutral" | "bearish";
  thresholds: {
    vol_oi_ratio: number;
    large_block_volume: number;
    large_block_vol_oi: number;
    large_notional_usd: number;
  };
  data_source: string;
}

export async function fetchUnusualFlow(ticker: string, expiration = ""): Promise<UnusualFlowResponse> {
  const q = expiration ? `?expiration=${expiration}` : "";
  const res = await fetch(`${API_URL}/api/unusual-flow/${ticker}${q}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Failed to fetch unusual flow");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Strategy Scanner (Phase 6a) — scan multiple tickers for setups
// ------------------------------------------------------------------
export type ScannerPreset =
  | "high_iv_rank"           // IV Rank > 60 → good for premium sellers
  | "low_iv_rank"            // IV Rank < 30 → good for premium buyers
  | "bullish_flow"           // unusual call bias
  | "bearish_flow"           // unusual put bias
  | "earnings_week";         // earnings within 7 days

export interface ScannerHit {
  ticker: string;
  reason: string;
  signal_value: number | string | null;
  signal_label: string;
  spot_price: number | null;
}

export interface ScannerResponse {
  preset: ScannerPreset;
  scanned: number;
  hits: ScannerHit[];
  data_sources: Record<string, string>;
}

export async function runScanner(
  preset: ScannerPreset,
  tickers: string[]
): Promise<ScannerResponse> {
  const res = await fetch(`${API_URL}/api/scanner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, tickers }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Scanner failed");
  }
  return res.json();
}

export async function* streamChat(
  messages: ChatMessage[],
  context?: ChatContext,
): AsyncGenerator<string> {
  const res = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Chat request failed");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        if (data.startsWith("[ERROR]")) throw new Error(data);
        yield data;
      }
    }
  }
}

// ============================================================
// Professional Trader Agent — multi-perspective analysis
// ============================================================

export type TraderMode = "stock" | "options";
export type ResearcherStance = "bullish" | "bearish" | "neutral";

/** Cross-examination response from a debate phase. Currently only Bull and
 *  Bear participate in debate, but the type is keyed by string for forward
 *  compatibility (e.g. Technical vs Fundamental debate later). */
export interface ResearcherRebuttal {
  rebuttal: string;
  reinforced_evidence?: string;
  concession?: string;
}

export interface ResearcherResult {
  id: string;
  name_en: string;
  name_zh: string;
  icon: string;
  color: string;
  stance: ResearcherStance;
  confidence: number;
  headline: string;
  key_points: string[];
  evidence: string;
  risks: string;
  /** Present after the debate phase for Bull/Bear researchers. */
  rebuttal?: ResearcherRebuttal;
}

/** Per-researcher synthesis written by the PM. Keys mirror researcher IDs. */
export interface ManagerSynthesis {
  bull?: string;
  bear?: string;
  technical?: string;
  fundamental?: string;
  market?: string;
  industry?: string;
  financial?: string;
  news?: string;
  options?: string;
}

export interface ManagerStockDecision {
  decision: "buy" | "hold" | "sell" | string;
  conviction: number;
  time_horizon?: string;
  thesis?: string;
  entry_zone?: string;
  target_price?: string;
  stop_loss?: string;
  position_sizing?: string;
  key_catalysts?: string[];
  main_risks?: string[];
  debate_summary?: string;
  synthesis?: ManagerSynthesis;
  consensus_score?: string;
  actionable_steps?: string[];
}

export interface ManagerOptionsDecision {
  decision: string;
  conviction: number;
  direction?: "bullish" | "bearish" | "neutral" | string;
  thesis?: string;
  structure?: string;
  expiration?: string;
  max_loss?: string;
  max_profit?: string;
  breakeven?: string;
  win_probability?: string;
  key_catalysts?: string[];
  main_risks?: string[];
  debate_summary?: string;
  synthesis?: ManagerSynthesis;
  consensus_score?: string;
  actionable_steps?: string[];
}

export type ManagerDecision = ManagerStockDecision | ManagerOptionsDecision;

export type TraderEvent =
  | { type: "phase"; phase: "gathering_data" | "research_start" | "debate_start" | "manager_start" }
  | { type: "selected"; ids: string[]; count: number }
  | { type: "researcher"; result: ResearcherResult }
  | { type: "rebuttal"; id: string; rebuttal: ResearcherRebuttal }
  | { type: "manager"; result: ManagerDecision & { mode: TraderMode; ticker: string } }
  | { type: "done"; researchers: ResearcherResult[]; manager: ManagerDecision }
  | { type: "error"; message: string };

/** Stream the trader pipeline via SSE; yields parsed event objects. */
export async function* streamTraderAgent(params: {
  ticker: string;
  mode: TraderMode;
  locale: "zh" | "en";
  /** Optional subset of researcher IDs to run; omit for all 9. */
  selected_researchers?: string[];
}): AsyncGenerator<TraderEvent> {
  const res = await fetch(`${API_URL}/api/trader/analyze/${params.ticker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: params.mode,
      locale: params.locale,
      selected_researchers: params.selected_researchers,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 422 && err?.detail?.code === "INVALID_TICKER") {
      throw new InvalidTickerError(
        err.detail.message_en || "Invalid ticker",
        err.detail.message_zh || "无效股票代码",
      );
    }
    throw new Error(typeof err.detail === "string" ? err.detail : "Trader agent failed");
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      if (!chunk.startsWith("data: ")) continue;
      const payload = chunk.slice(6).trim();
      if (!payload) continue;
      try {
        yield JSON.parse(payload) as TraderEvent;
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

/** Generate and download a Word .docx report from completed trader analysis. */
export async function downloadTraderReport(params: {
  ticker: string;
  mode: TraderMode;
  locale: "zh" | "en";
  researchers: ResearcherResult[];
  manager: ManagerDecision;
}): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/trader/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Report generation failed");
  }
  return res.blob();
}

// ============================================================
// Portfolio Greeks Aggregation
// ============================================================

export interface PortfolioGreeksLeg {
  action: "buy" | "sell";
  opt_type: "call" | "put";
  strike: number;
  quantity: number;
}

export interface PortfolioGreeksPositionRequest {
  ticker: string;
  legs: PortfolioGreeksLeg[];
  dte_days: number;
  entry_date?: string;
}

export interface PortfolioGreeksPosition {
  ticker: string;
  spot_price: number;
  sigma_pct: number;
  dte_remaining: number;
  raw_delta: number;
  raw_gamma: number;
  raw_theta: number;
  raw_vega: number;
  delta_dollars: number;
  gamma_dollars: number;
  theta_dollars: number;
  vega_dollars: number;
}

export interface PortfolioGreeksResponse {
  position_count: number;
  ticker_count: number;
  totals: {
    delta_dollars: number;
    gamma_dollars: number;
    theta_dollars: number;
    vega_dollars: number;
  };
  positions: PortfolioGreeksPosition[];
  scenarios: Record<string, number>;
  fetch_errors: string[];
  assumptions: Record<string, unknown>;
}

export async function fetchPortfolioGreeks(
  positions: PortfolioGreeksPositionRequest[],
): Promise<PortfolioGreeksResponse> {
  const res = await fetch(`${API_URL}/api/portfolio/greeks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Portfolio Greeks failed");
  }
  return res.json();
}
