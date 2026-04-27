// ============================================================
// OptionsAI - Zustand 全局状态管理
// ============================================================

import { create } from "zustand";
import type {
  MarketData,
  Strategy,
  TrendExpectation,
  ChatMessage,
} from "@/types";
import { fetchMarketData, fetchStrategies, streamChat, fetchForecast, streamTopPick, fetchMarketIntel, fetchOptionsSnapshot, fetchIVTermStructure, fetchOHLCV, fetchFullOptionsChain, fetchShortData, fetchEarningsMoves, fetchGEX, fetchUnusualFlow } from "./api";
import type { ForecastItem, MarketIntelResponse, OptionsSnapshot, IVTermItem, OHLCVBar, FullOptionsChain, ShortDataResponse, EarningsMovesResponse, GEXResponse, UnusualFlowResponse } from "./api";
import type { Locale } from "./i18n";
import { loadTickerChat, saveTickerChat, clearTickerChat } from "./chatMemory";

interface AppState {
  // 市场数据
  ticker: string;
  marketData: MarketData | null;
  isLoadingMarket: boolean;
  marketError: string | null;

  // 用户输入
  selectedTrend: TrendExpectation | null;
  targetPrice: number | null;
  targetPct: number | null;
  targetPriceUpper: number | null;
  targetPriceLower: number | null;
  priceMode: "single" | "range";
  selectedExpiration: string | null;
  preferenceWeight: number; // 0=高回报, 1=高胜率

  // 策略结果
  strategies: Strategy[];
  selectedStrategyIndex: number;
  isLoadingStrategies: boolean;
  strategyError: string | null;

  // AI 聊天
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  isChatOpen: boolean;

  // AI 价格预测
  forecasts: ForecastItem[];
  isForecastLoading: boolean;
  forecastError: string | null;

  // 市场资讯
  marketIntel: MarketIntelResponse | null;
  isMarketIntelLoading: boolean;
  marketIntelError: string | null;

  // 预算与风险
  budget: number | null;
  maxLoss: number | null;
  maxLossType: "dollar" | "percent";

  // IV 期限结构
  ivTermStructure: IVTermItem[];
  isIVTermLoading: boolean;

  // 期权快照 (到期日联动 IV + Greeks)
  optionsSnapshot: OptionsSnapshot | null;
  isSnapshotLoading: boolean;

  // AI 最佳策略分析
  topPickAnalysis: string;
  isTopPickLoading: boolean;

  // 语言
  locale: Locale;

  // K线图数据
  ohlcvData: OHLCVBar[];
  isOHLCVLoading: boolean;
  ohlcvRange: string;

  // 完整期权链
  fullOptionsChain: FullOptionsChain | null;
  isOptionsChainLoading: boolean;
  optionsChainView: "greeks" | "probability";

  // 卖空数据
  shortData: ShortDataResponse | null;
  isShortDataLoading: boolean;

  // 财报涨跌幅 (实际 vs 隐含)
  earningsMoves: EarningsMovesResponse | null;
  isEarningsMovesLoading: boolean;

  // Gamma Exposure by strike
  gexData: GEXResponse | null;
  isGEXLoading: boolean;

  // 异动期权流
  unusualFlow: UnusualFlowResponse | null;
  isUnusualFlowLoading: boolean;

  // 多Agent状态
  agentStatus: "idle" | "researcher" | "analyst" | "verifier" | "verified" | "retry";

  // Actions
  searchTicker: (ticker: string) => Promise<void>;
  fetchForecast: (ticker: string) => Promise<void>;
  fetchOptionsSnapshot: (ticker: string, expiration: string) => Promise<void>;
  fetchTopPickAnalysis: () => Promise<void>;
  fetchIVTermStructure: (ticker: string) => Promise<void>;
  setBudget: (budget: number | null) => void;
  setMaxLoss: (maxLoss: number | null) => void;
  setMaxLossType: (type: "dollar" | "percent") => void;
  setTrend: (trend: TrendExpectation) => void;
  setTargetPrice: (price: number | null) => void;
  setTargetPct: (pct: number | null) => void;
  setTargetPriceUpper: (price: number | null) => void;
  setTargetPriceLower: (price: number | null) => void;
  setPriceMode: (mode: "single" | "range") => void;
  fetchMarketIntel: (ticker: string) => Promise<void>;
  setExpiration: (exp: string) => void;
  setPreferenceWeight: (w: number) => void;
  setSelectedStrategy: (idx: number) => void;
  calculateStrategies: () => Promise<void>;
  sendChatMessage: (content: string, images?: string[]) => Promise<void>;
  toggleChat: () => void;
  clearChat: () => void;
  clearCurrentTickerMemory: () => void;
  setLocale: (locale: Locale) => void;
  /** Clear current ticker and return to the empty home state. */
  goHome: () => void;
  fetchOHLCV: (ticker: string, range?: string) => Promise<void>;
  setOHLCVRange: (range: string) => void;
  fetchFullOptionsChain: (ticker: string, expiration: string) => Promise<void>;
  setOptionsChainView: (view: "greeks" | "probability") => void;
  fetchShortData: (ticker: string) => Promise<void>;
  fetchEarningsMoves: (ticker: string) => Promise<void>;
  fetchGEX: (ticker: string, expiration: string) => Promise<void>;
  fetchUnusualFlow: (ticker: string, expiration: string) => Promise<void>;
  setAgentStatus: (status: "idle" | "researcher" | "analyst" | "verifier" | "verified" | "retry") => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // 初始状态
  ticker: "",
  marketData: null,
  isLoadingMarket: false,
  marketError: null,

  selectedTrend: null,
  targetPrice: null,
  targetPct: null,
  targetPriceUpper: null,
  targetPriceLower: null,
  priceMode: "single" as "single" | "range",
  selectedExpiration: null,
  preferenceWeight: 0.5,

  strategies: [],
  selectedStrategyIndex: 0,
  isLoadingStrategies: false,
  strategyError: null,

  chatMessages: [],
  isChatLoading: false,
  isChatOpen: true,

  forecasts: [],
  isForecastLoading: false,
  forecastError: null,

  marketIntel: null,
  isMarketIntelLoading: false,
  marketIntelError: null,

  budget: null,
  maxLoss: null,
  maxLossType: "dollar" as "dollar" | "percent",

  ivTermStructure: [],
  isIVTermLoading: false,

  optionsSnapshot: null,
  isSnapshotLoading: false,

  topPickAnalysis: "",
  isTopPickLoading: false,

  locale: "zh" as Locale,

  ohlcvData: [],
  isOHLCVLoading: false,
  ohlcvRange: "1y",

  fullOptionsChain: null,
  isOptionsChainLoading: false,
  optionsChainView: "greeks" as "greeks" | "probability",

  shortData: null,
  isShortDataLoading: false,

  earningsMoves: null,
  isEarningsMovesLoading: false,

  gexData: null,
  isGEXLoading: false,

  unusualFlow: null,
  isUnusualFlowLoading: false,

  agentStatus: "idle" as "idle" | "researcher" | "analyst" | "verifier" | "verified" | "retry",

  // ---- Actions ----

  searchTicker: async (ticker: string) => {
    const upper = ticker.toUpperCase();
    // Restore any saved chat memory for this ticker.
    // If the previous ticker's chat was in progress it already got saved on each
    // flushAssistantMsg, so switching is safe.
    const savedChat = loadTickerChat(upper);
    set({
      ticker: upper,
      isLoadingMarket: true,
      marketError: null,
      strategies: [],
      selectedStrategyIndex: 0,
      chatMessages: savedChat,
    });
    try {
      const data = await fetchMarketData(ticker);
      set({
        marketData: data,
        isLoadingMarket: false,
        // 自动选第一个到期日（约 30 天后的）
        selectedExpiration:
          data.expirations.find((exp) => {
            const dte = Math.floor(
              (new Date(exp).getTime() - Date.now()) / 86400000
            );
            return dte >= 25 && dte <= 45;
          }) || data.expirations[3] || data.expirations[0] || null,
      });
      // 自动获取 AI 价格预测 + 期权快照 + IV 期限结构
      get().fetchForecast(ticker);
      get().fetchMarketIntel(ticker);
      get().fetchIVTermStructure(ticker);
      get().fetchOHLCV(ticker, "1y");
      get().fetchShortData(ticker);
      get().fetchEarningsMoves(ticker);
      const selectedExp = get().selectedExpiration;
      if (selectedExp) {
        get().fetchOptionsSnapshot(ticker, selectedExp);
        get().fetchFullOptionsChain(ticker, selectedExp);
        get().fetchGEX(ticker, selectedExp);
        get().fetchUnusualFlow(ticker, selectedExp);
      }
    } catch (e) {
      set({
        isLoadingMarket: false,
        marketError: e instanceof Error ? e.message : "Unknown error",
      });
    }
  },

  fetchForecast: async (ticker: string) => {
    const { locale } = get();
    set({ isForecastLoading: true, forecastError: null, forecasts: [] });
    try {
      const data = await fetchForecast(ticker, locale);
      set({ forecasts: data.forecasts, isForecastLoading: false });
    } catch (e) {
      set({
        isForecastLoading: false,
        forecastError: e instanceof Error ? e.message : "Forecast error",
      });
    }
  },

  fetchTopPickAnalysis: async () => {
    const { strategies, marketData, selectedTrend, targetPrice, locale } = get();
    if (!strategies.length || !marketData) return;

    const top = strategies[0];
    set({ isTopPickLoading: true, topPickAnalysis: "" });

    try {
      const params = {
        ticker: marketData.ticker,
        spot_price: marketData.spot_price,
        iv_current: marketData.iv_current,
        iv_rank: marketData.iv_rank,
        strategy_name: top.name,
        strategy_name_en: top.name_en,
        strategy_tag: top.tag,
        legs_description: top.legs.map((l) => l.description).join("; "),
        max_profit: top.max_profit,
        max_profit_pct: top.max_profit_pct,
        max_loss: top.max_loss,
        breakevens: top.breakevens.map((b) => `$${b.toFixed(2)}`).join(", ") || "N/A",
        win_probability: top.win_probability,
        required_capital: top.required_capital,
        trend: selectedTrend || "neutral",
        target_price: targetPrice,
        locale,
      };

      let analysis = "";
      for await (const chunk of streamTopPick(params)) {
        analysis += chunk;
        set({ topPickAnalysis: analysis });
      }
      set({ isTopPickLoading: false });
    } catch {
      set({ topPickAnalysis: "", isTopPickLoading: false });
    }
  },

  fetchOptionsSnapshot: async (ticker: string, expiration: string) => {
    set({ isSnapshotLoading: true });
    try {
      const data = await fetchOptionsSnapshot(ticker, expiration);
      set({ optionsSnapshot: data, isSnapshotLoading: false });
    } catch {
      set({ isSnapshotLoading: false });
    }
  },

  fetchIVTermStructure: async (ticker: string) => {
    set({ isIVTermLoading: true });
    try {
      const data = await fetchIVTermStructure(ticker);
      set({ ivTermStructure: data.term_structure, isIVTermLoading: false });
    } catch {
      set({ isIVTermLoading: false });
    }
  },

  fetchOHLCV: async (ticker: string, range = "1y") => {
    set({ isOHLCVLoading: true, ohlcvRange: range });
    try {
      const data = await fetchOHLCV(ticker, range);
      set({ ohlcvData: data.bars, isOHLCVLoading: false });
    } catch {
      set({ isOHLCVLoading: false });
    }
  },

  setOHLCVRange: (range) => {
    const { ticker } = get();
    set({ ohlcvRange: range });
    if (ticker) get().fetchOHLCV(ticker, range);
  },

  fetchFullOptionsChain: async (ticker: string, expiration: string) => {
    set({ isOptionsChainLoading: true });
    try {
      const data = await fetchFullOptionsChain(ticker, expiration);
      set({ fullOptionsChain: data, isOptionsChainLoading: false });
    } catch {
      set({ isOptionsChainLoading: false });
    }
  },

  setOptionsChainView: (view) => set({ optionsChainView: view }),

  fetchShortData: async (ticker: string) => {
    set({ isShortDataLoading: true });
    try {
      const data = await fetchShortData(ticker);
      set({ shortData: data, isShortDataLoading: false });
    } catch {
      set({ isShortDataLoading: false });
    }
  },

  fetchEarningsMoves: async (ticker: string) => {
    set({ isEarningsMovesLoading: true });
    try {
      const data = await fetchEarningsMoves(ticker);
      set({ earningsMoves: data, isEarningsMovesLoading: false });
    } catch {
      // Quietly leave stale state; UI renders a "no earnings data" slot
      set({ isEarningsMovesLoading: false });
    }
  },

  fetchGEX: async (ticker: string, expiration: string) => {
    set({ isGEXLoading: true });
    try {
      const data = await fetchGEX(ticker, expiration);
      set({ gexData: data, isGEXLoading: false });
    } catch {
      set({ isGEXLoading: false });
    }
  },

  fetchUnusualFlow: async (ticker: string, expiration: string) => {
    set({ isUnusualFlowLoading: true });
    try {
      const data = await fetchUnusualFlow(ticker, expiration);
      set({ unusualFlow: data, isUnusualFlowLoading: false });
    } catch {
      set({ isUnusualFlowLoading: false });
    }
  },

  setAgentStatus: (status) => set({ agentStatus: status }),

  fetchMarketIntel: async (ticker: string) => {
    const { locale } = get();
    set({ isMarketIntelLoading: true, marketIntelError: null });
    try {
      const data = await fetchMarketIntel(ticker, locale);
      set({ marketIntel: data, isMarketIntelLoading: false });
    } catch (e) {
      set({
        isMarketIntelLoading: false,
        marketIntelError: e instanceof Error ? e.message : "Market intel error",
      });
    }
  },

  setBudget: (budget) => set({ budget }),
  setMaxLoss: (maxLoss) => set({ maxLoss }),
  setMaxLossType: (type) => set({ maxLossType: type }),
  setTrend: (trend) => set({ selectedTrend: trend }),
  setTargetPriceUpper: (price) => set({ targetPriceUpper: price }),
  setTargetPriceLower: (price) => set({ targetPriceLower: price }),
  setPriceMode: (mode) => set({ priceMode: mode }),
  setTargetPrice: (price) => {
    const spot = get().marketData?.spot_price;
    set({
      targetPrice: price,
      targetPct: price && spot ? Math.round(((price - spot) / spot) * 100 * 10) / 10 : null,
    });
  },
  setTargetPct: (pct) => {
    const spot = get().marketData?.spot_price;
    set({
      targetPct: pct,
      targetPrice: pct !== null && spot ? Math.round(spot * (1 + pct / 100) * 100) / 100 : null,
    });
  },
  setExpiration: (exp) => {
    set({ selectedExpiration: exp });
    const { ticker } = get();
    if (ticker && exp) {
      get().fetchOptionsSnapshot(ticker, exp);
      get().fetchFullOptionsChain(ticker, exp);
      get().fetchGEX(ticker, exp);
      get().fetchUnusualFlow(ticker, exp);
    }
  },
  setPreferenceWeight: (w) => set({ preferenceWeight: w }),
  setSelectedStrategy: (idx) => set({ selectedStrategyIndex: idx }),

  calculateStrategies: async () => {
    const { ticker, selectedTrend, targetPrice, targetPct, selectedExpiration, preferenceWeight, budget, maxLoss, maxLossType } = get();
    if (!ticker || !selectedTrend || !selectedExpiration) return;

    set({ isLoadingStrategies: true, strategyError: null });
    try {
      const data = await fetchStrategies({
        ticker,
        trend: selectedTrend,
        target_price: targetPrice ?? undefined,
        target_pct: targetPct ?? undefined,
        target_price_upper: get().priceMode === "range" ? get().targetPriceUpper ?? undefined : undefined,
        target_price_lower: get().priceMode === "range" ? get().targetPriceLower ?? undefined : undefined,
        expiration: selectedExpiration,
        preference_weight: preferenceWeight,
        budget: budget ?? undefined,
        max_loss: maxLoss ?? undefined,
        max_loss_type: maxLoss ? maxLossType : undefined,
      });
      set({
        strategies: data.strategies,
        selectedStrategyIndex: 0,
        isLoadingStrategies: false,
      });
      // 自动获取最佳策略 AI 分析
      get().fetchTopPickAnalysis();
    } catch (e) {
      set({
        isLoadingStrategies: false,
        strategyError: e instanceof Error ? e.message : "Unknown error",
      });
    }
  },

  sendChatMessage: async (content: string, images?: string[]) => {
    const { chatMessages, marketData, strategies, selectedStrategyIndex, ticker, selectedTrend, targetPrice } = get();

    const userMsg: ChatMessage =
      images && images.length > 0
        ? { role: "user", content, images }
        : { role: "user", content };
    const newMessages: ChatMessage[] = [...chatMessages, userMsg];
    set({ chatMessages: newMessages, isChatLoading: true });

    // 构建上下文 - 只有在 ticker 存在时才传递 context，避免 422 错误
    const context = ticker ? {
      ticker,
      market_data: marketData ?? undefined,
      selected_strategy: strategies[selectedStrategyIndex] ?? undefined,
      user_trend: selectedTrend ?? undefined,
      target_price: targetPrice ?? undefined,
    } : undefined;

    try {
      let assistantMsg = "";
      // Add empty assistant placeholder
      set((state) => ({
        chatMessages: [
          ...state.chatMessages,
          { role: "assistant" as const, content: "" },
        ],
      }));

      // Schedule UI updates via setTimeout to break out of React's synchronous
      // update detection, which causes "Maximum update depth exceeded" errors.
      // We always update with the latest accumulated text (no stale closures).
      let pendingText = "";
      let updateScheduled = false;

      const scheduleUIUpdate = (text: string) => {
        pendingText = text;
        if (!updateScheduled) {
          updateScheduled = true;
          setTimeout(() => {
            updateScheduled = false;
            const t = pendingText;
            set((state) => {
              const msgs = state.chatMessages;
              const last = msgs[msgs.length - 1];
              if (last?.role === "assistant") {
                return {
                  chatMessages: [
                    ...msgs.slice(0, -1),
                    { role: "assistant" as const, content: t },
                  ],
                };
              }
              return {};
            });
          }, 40);
        }
      };

      const flushAssistantMsg = (text: string) => {
        // Synchronous final flush — safe to call outside the streaming loop
        set((state) => {
          const msgs = state.chatMessages;
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            return {
              chatMessages: [
                ...msgs.slice(0, -1),
                { role: "assistant" as const, content: text },
              ],
            };
          }
          return {};
        });
      };

      for await (const chunk of streamChat(newMessages, context)) {
        // Handle agent status events
        if (chunk.startsWith("[AGENT:")) {
          const agentName = chunk.replace("[AGENT:", "").replace("]", "");
          const statusMap: Record<string, "researcher" | "analyst" | "verifier"> = {
            "researcher": "researcher",
            "analyst": "analyst",
            "verifier": "verifier",
          };
          const status = statusMap[agentName];
          if (status) set({ agentStatus: status });
          continue;
        }
        if (chunk === "[VERIFIED]") {
          set({ agentStatus: "verified" });
          continue;
        }
        if (chunk.startsWith("[RETRY:")) {
          set({ agentStatus: "retry" });
          continue;
        }
        if (chunk === "[VERIFY_FAILED]") {
          continue;
        }
        if (chunk === "[VISION_UNSUPPORTED]") {
          // Backend signaled that the configured LLM can't accept images.
          // We still render the following text chunk as an assistant message
          // (it carries the Chinese/English explanation + instructions).
          set({ agentStatus: "idle" });
          continue;
        }
        // Accumulate text and schedule a deferred (async) UI update
        assistantMsg += chunk.replace(/\\n/g, "\n");
        scheduleUIUpdate(assistantMsg);
      }
      // Wait for any pending scheduled update to complete, then do final flush
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      flushAssistantMsg(assistantMsg);
      set({ isChatLoading: false, agentStatus: "idle" });
      // Phase 7a — persist to per-ticker memory
      const currentTicker = get().ticker;
      if (currentTicker) {
        saveTickerChat(currentTicker, get().chatMessages);
      }
    } catch (e) {
      console.error("[sendChatMessage] error:", e);
      const errorMessages: ChatMessage[] = [
        ...newMessages,
        { role: "assistant", content: "Sorry, an error occurred. Please try again." },
      ];
      set({
        chatMessages: errorMessages,
        isChatLoading: false,
      });
      const currentTicker = get().ticker;
      if (currentTicker) {
        saveTickerChat(currentTicker, errorMessages);
      }
    }
  },

  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  clearChat: () => {
    const currentTicker = get().ticker;
    set({ chatMessages: [], isChatLoading: false });
    if (currentTicker) {
      clearTickerChat(currentTicker);
    }
  },
  clearCurrentTickerMemory: () => {
    const currentTicker = get().ticker;
    if (currentTicker) {
      clearTickerChat(currentTicker);
      set({ chatMessages: [] });
    }
  },
  goHome: () => {
    set({
      ticker: "",
      marketData: null,
      marketError: null,
      strategies: [],
      forecasts: [],
      forecastError: null,
      marketIntel: null,
      marketIntelError: null,
      ivTermStructure: [],
      optionsSnapshot: null,
      ohlcvData: [],
      shortData: null,
      earningsMoves: null,
      gexData: null,
      unusualFlow: null,
      topPickAnalysis: "",
      selectedExpiration: null,
      selectedTrend: null,
      chatMessages: [],
    });
  },
  setLocale: (locale: Locale) => {
    set({ locale });
    // 切换语言后重新获取 AI 内容
    const { ticker, marketData, strategies } = get();
    if (ticker && marketData) {
      // 需要等一个 tick 让 locale 更新到 state
      setTimeout(() => {
        get().fetchForecast(ticker);
        get().fetchMarketIntel(ticker);
        if (strategies.length > 0) {
          get().fetchTopPickAnalysis();
        }
      }, 50);
    }
  },
}));
