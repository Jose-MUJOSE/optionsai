// ============================================================
// OptionsAI - Internationalization (i18n)
// ============================================================

export type Locale = "en" | "zh";

const translations = {
  // Header
  "app.subtitle": { en: "Smart Options Strategy Platform", zh: "智能期权策略平台" },

  // Ticker Search
  "search.placeholder": { en: "Search ticker (e.g. AAPL, 0700.HK, 600519.SS)", zh: "搜索股票代码 (如 AAPL, 0700.HK, 600519.SS)" },

  // Market labels
  "market.us":      { en: "US Stocks", zh: "美股" },
  "market.etf":     { en: "ETFs",      zh: "ETF" },
  "market.crypto":  { en: "Crypto",    zh: "加密" },
  "market.futures": { en: "Futures",   zh: "期货" },
  "market.forex":   { en: "Forex",     zh: "外汇" },
  "market.hk":      { en: "HK Stocks", zh: "港股" },
  "market.cn":      { en: "A-Shares",  zh: "A股" },
  "market.index":   { en: "Indices",   zh: "指数" },

  "search.more": { en: "More markets", zh: "更多市场" },
  "search.less": { en: "Collapse",     zh: "收起" },

  // Sidebar nav
  "nav.dashboard":  { en: "Dashboard",  zh: "仪表盘" },
  "nav.watchlist":  { en: "Watchlist",  zh: "自选" },
  "nav.news":       { en: "News",       zh: "资讯" },
  "nav.strategies": { en: "Strategies", zh: "策略" },
  "nav.live":       { en: "Live Data",  zh: "实时数据" },

  // Watchlist
  "watchlist.title":          { en: "My Watchlist",                                           zh: "我的自选" },
  "watchlist.subtitle":       { en: "Track any asset across categories — auto-classified, real-time.", zh: "跨品类追踪任意资产 — AI 自动分类，实时价格" },
  "watchlist.add":            { en: "Add",                                                    zh: "添加" },
  "watchlist.remove":         { en: "Remove",                                                 zh: "删除" },
  "watchlist.addPlaceholder": { en: "Enter ticker (AAPL, BTC-USD, GC=F, 0700.HK...)",         zh: "输入代码 (AAPL, BTC-USD, GC=F, 0700.HK...)" },
  "watchlist.refresh":        { en: "Refresh",                                                zh: "刷新" },
  "watchlist.autoClassify":   { en: "AI Auto-Classify",                                       zh: "AI 自动分类" },
  "watchlist.all":            { en: "All",                                                    zh: "全部" },
  "watchlist.emptyTitle":     { en: "Your watchlist is empty",                                zh: "自选列表为空" },
  "watchlist.emptyDesc":      { en: "Add any ticker to start tracking live prices.",          zh: "添加任意代码即可开始实时追踪价格" },
  "watchlist.emptyFilter":    { en: "No items in this category.",                             zh: "此分类下无项目" },
  "watchlist.clearFilter":    { en: "Show all",                                               zh: "显示全部" },
  "watchlist.noIv":           { en: "No IV",                                                  zh: "无 IV" },

  // News panel
  "news.title":          { en: "News & Intelligence",                                  zh: "新闻与市场资讯" },
  "news.subtitle":       { en: "Aggregated across your watchlist — news, events, analyst targets.", zh: "聚合你的自选 — 新闻、事项、分析师目标" },
  "news.tab.news":       { en: "News",          zh: "新闻" },
  "news.tab.events":     { en: "Events",        zh: "事项" },
  "news.tab.analysts":   { en: "Analyst Calls", zh: "分析师" },
  "news.loading":        { en: "Loading feeds...",              zh: "正在加载资讯..." },
  "news.loadingMore":    { en: "Loading more stories...",       zh: "加载更多新闻…" },
  "news.endOfFeed":      { en: "— end of feed —",               zh: "— 已到底部 —" },
  "news.refreshCurrent": { en: "Refresh current",               zh: "刷新当前" },
  "news.openSource":     { en: "Open source article",           zh: "打开原文" },
  "news.empty":          { en: "No news available for current filter.", zh: "当前筛选下暂无新闻" },
  "news.emptyEvents":    { en: "No upcoming events.",           zh: "暂无未来事项" },
  "news.emptyAnalysts":  { en: "No analyst targets available.", zh: "暂无分析师目标" },
  "news.target":         { en: "Target",                        zh: "目标价" },
  "news.featured":       { en: "Featured",                      zh: "头条" },
  "news.readMore":       { en: "Read full article",             zh: "阅读全文" },
  "news.justNow":        { en: "just now",                      zh: "刚刚" },
  "news.minutesAgo":     { en: "m ago",                         zh: "分钟前" },
  "news.hoursAgo":       { en: "h ago",                         zh: "小时前" },
  "news.daysAgo":        { en: "d ago",                         zh: "天前" },
  "news.sources":        { en: "sources",                       zh: "条信息" },
  "news.stories":        { en: "stories",                       zh: "条新闻" },
  "news.upcoming":       { en: "Upcoming",                      zh: "即将发生" },
  "news.addToWatchlist": { en: "Add to watchlist",              zh: "加入自选" },
  "news.inWatchlist":    { en: "In watchlist",                  zh: "已在自选" },

  // Empty-state prompts
  "dashboard.emptyTitle": { en: "Search an asset to begin",                                    zh: "搜索资产开始使用" },
  "dashboard.emptyDesc":  { en: "Pick a ticker — we handle stocks, ETFs, crypto, futures, indices, HK & A-shares.", zh: "选择代码 — 支持美股、ETF、加密、期货、指数、港股与 A 股" },

  // Market Dashboard
  "dashboard.iv30": { en: "IV (30D)", zh: "隐含波动率(30D)" },
  "dashboard.ivRank": { en: "IV Rank", zh: "IV排名" },
  "dashboard.hv30": { en: "HV (30D)", zh: "历史波动率(30D)" },
  "dashboard.earnings": { en: "Next Earnings", zh: "下次财报" },
  "dashboard.atmIv": { en: "ATM IV", zh: "ATM隐含波动率" },
  "dashboard.ivHvRatio": { en: "IV/HV", zh: "IV/HV比" },
  "dashboard.greeks": { en: "ATM Greeks", zh: "ATM希腊字母" },
  "dashboard.call": { en: "Call", zh: "看涨" },
  "dashboard.put": { en: "Put", zh: "看跌" },
  "dashboard.strike": { en: "Strike", zh: "行权价" },
  "dashboard.mid": { en: "Mid", zh: "中间价" },
  "dashboard.vol": { en: "Volume", zh: "成交量" },
  "dashboard.oi": { en: "OI", zh: "持仓量" },
  "dashboard.dte": { en: "DTE", zh: "剩余天数" },

  // IV Environment
  "iv.high": { en: "High IV", zh: "高波动率" },
  "iv.mid": { en: "Mid IV", zh: "中等波动率" },
  "iv.low": { en: "Low IV", zh: "低波动率" },
  "iv.ratio": { en: "IV/HV Ratio", zh: "IV/HV比率" },
  "iv.highAdvice": { en: "Sell premium strategies preferred (Iron Condor, Credit Spreads)", zh: "建议卖权策略 (铁鹰、信用价差)" },
  "iv.midAdvice": { en: "Balanced strategies work well (Spreads, Butterflies)", zh: "平衡型策略适用 (价差、蝶式)" },
  "iv.lowAdvice": { en: "Buy premium strategies preferred (Long Calls/Puts, Straddles)", zh: "建议买权策略 (买入看涨/看跌、跨式)" },

  // Trend Selector
  "trend.title": { en: "Trend Expectation", zh: "趋势预期" },
  "trend.slight_up": { en: "Slight Up", zh: "微涨" },
  "trend.up": { en: "Bullish", zh: "看涨" },
  "trend.strong_up": { en: "Strong Up", zh: "强涨" },
  "trend.volatile_up": { en: "Vol. Up", zh: "震荡涨" },
  "trend.neutral": { en: "Neutral", zh: "中性" },
  "trend.slight_down": { en: "Slight Down", zh: "微跌" },
  "trend.down": { en: "Bearish", zh: "看跌" },
  "trend.strong_down": { en: "Strong Down", zh: "强跌" },
  "trend.volatile_down": { en: "Vol. Down", zh: "震荡跌" },
  "trend.high_volatile": { en: "High Vol.", zh: "高波动" },

  // Control Panel
  "ctrl.targetPct": { en: "Target Change (%)", zh: "目标涨跌幅 (%)" },
  "ctrl.targetPrice": { en: "Target Price ($)", zh: "目标价格" },
  "ctrl.expiration": { en: "Expiration Date", zh: "到期日" },
  "ctrl.preference": { en: "Strategy Preference", zh: "策略偏好" },
  "ctrl.highReturn": { en: "High Return", zh: "高回报" },
  "ctrl.highWin": { en: "High Win%", zh: "高胜率" },
  "ctrl.calculating": { en: "Calculating strategies...", zh: "正在计算策略..." },
  "pref.aggressive": { en: "Aggressive", zh: "激进" },
  "pref.aggressiveDesc": { en: "High leverage, maximize profit potential", zh: "高杠杆，最大化盈利潜力" },
  "pref.growth": { en: "Growth", zh: "成长" },
  "pref.growthDesc": { en: "Favor high return with moderate risk", zh: "偏重高回报，风险适中" },
  "pref.balanced": { en: "Balanced", zh: "平衡" },
  "pref.balancedDesc": { en: "Balance between return and win rate", zh: "回报与胜率均衡" },
  "pref.conservative": { en: "Conservative", zh: "稳健" },
  "pref.conservativeDesc": { en: "Favor high probability of profit", zh: "偏重高胜率" },
  "pref.safe": { en: "Safe", zh: "安全" },
  "pref.safeDesc": { en: "Maximize win rate, lower returns", zh: "最大化胜率，降低回报" },

  // Strategy Cards
  "strategy.recommended": { en: "Recommended Strategies", zh: "推荐策略" },
  "strategy.winRate": { en: "Win Rate", zh: "胜率" },
  "strategy.maxReturn": { en: "Max Return", zh: "最大回报" },
  "strategy.maxLoss": { en: "Max Loss", zh: "最大亏损" },
  "strategy.riskReward": { en: "Risk/Reward", zh: "风险/收益" },
  "strategy.capital": { en: "Capital", zh: "所需资金" },
  "strategy.breakeven": { en: "Breakeven", zh: "盈亏平衡" },
  "strategy.legs": { en: "Legs", zh: "腿数" },
  "strategy.positionSizing": { en: "Position Sizing (2% risk rule)", zh: "仓位管理 (2%风险规则)" },

  // Strategy Comparison
  "compare.title": { en: "Strategy Comparison", zh: "策略对比" },
  "compare.metric": { en: "Metric", zh: "指标" },

  // Payoff Chart
  "chart.title": { en: "P&L at Expiration", zh: "到期盈亏图" },
  "chart.currentPrice": { en: "Current Price", zh: "当前价格" },
  "chart.breakeven": { en: "Breakeven", zh: "盈亏平衡" },
  "chart.target": { en: "Target", zh: "目标价" },

  // AI Chat
  "chat.title": { en: "OptionsAI Strategist", zh: "OptionsAI 策略师" },
  "chat.placeholder": { en: "Ask about strategies, risk, position sizing...", zh: "询问策略、风险、仓位管理..." },
  "chat.searchFirst": { en: "Search a ticker first, then ask me about options strategies.", zh: "请先搜索股票代码，然后向我咨询期权策略。" },
  "chat.askAnything": { en: "Ask me anything about {ticker} options strategies.", zh: "请问我关于 {ticker} 期权策略的任何问题。" },
  "chat.q1": { en: "Analyze risk and reward of current strategy", zh: "分析当前策略的风险和收益" },
  "chat.q2": { en: "Position sizing recommendation", zh: "帮我做仓位管理建议" },
  "chat.q3": { en: "What if stock drops 10%?", zh: "如果股价下跌10%会怎样？" },
  "chat.q4": { en: "Compare recommended strategies", zh: "比较推荐的几个策略优劣" },
  "chat.q5": { en: "Is IV high or low? Should I buy or sell?", zh: "IV目前处于什么水平？适合买还是卖？" },
  // Phase 7b — multimodal image input
  "chat.attachImage": { en: "Attach chart image", zh: "上传图表截图" },
  "chat.imageTooLarge": { en: "Image too large — 8MB max per file.", zh: "图片过大 — 单张最多 8MB。" },
  "chat.imageUnsupported": { en: "Only image files are supported.", zh: "只支持图片文件。" },
  "chat.imageTooMany": { en: "Up to 4 images per message.", zh: "一条消息最多 4 张图片。" },
  "chat.imageProcessFailed": { en: "Failed to process image.", zh: "图片处理失败。" },
  "chat.dropImagesHere": { en: "Drop chart screenshots here", zh: "把图表截图拖到这里" },
  "chat.visionModelNote": {
    en: "Images require a vision-capable model (gpt-4o / qwen-vl / claude-3.5). The default DeepSeek-chat does not accept images.",
    zh: "图像输入需要视觉模型（gpt-4o / qwen-vl / claude-3.5）。默认的 DeepSeek-chat 不支持图片。"
  },
  "chat.removeImage": { en: "Remove", zh: "移除" },

  // Welcome
  "welcome.title": { en: "Welcome to OptionsAI", zh: "欢迎使用 OptionsAI" },
  "welcome.desc": {
    en: "Search a stock ticker to get started. We will analyze the market environment, recommend optimal options strategies, and provide AI-powered trading guidance.",
    zh: "搜索股票代码开始使用。我们将分析市场环境，推荐最优期权策略，并提供AI驱动的交易建议。"
  },

  // Forecast
  "forecast.title": { en: "AI Price Forecast", zh: "AI 价格预测" },
  "forecast.loading": { en: "AI is analyzing market data...", zh: "AI 正在分析市场数据..." },
  "forecast.confidence": { en: "Confidence", zh: "置信度" },
  "forecast.confHigh": { en: "High", zh: "高" },
  "forecast.confMed": { en: "Medium", zh: "中" },
  "forecast.confLow": { en: "Low", zh: "低" },

  // Top Pick
  "topPick.badge": { en: "Top Pick", zh: "首选" },
  "topPick.analysis": { en: "AI Analysis", zh: "AI 推荐理由" },

  // Common
  "common.na": { en: "N/A", zh: "暂无" },

  // Market Intelligence
  "intel.title": { en: "Market Intelligence", zh: "市场资讯" },
  "intel.news": { en: "Latest News", zh: "最新资讯" },
  "intel.events": { en: "Upcoming Events", zh: "重大事项" },
  "intel.analysts": { en: "Analyst Targets", zh: "机构目标价" },
  "intel.loading": { en: "Loading market intelligence...", zh: "正在加载市场资讯..." },

  // Control Panel - Range Mode
  "ctrl.singleMode": { en: "Single Target", zh: "单价模式" },
  "ctrl.rangeMode": { en: "Price Range", zh: "区间模式" },
  "ctrl.upperPrice": { en: "Upper Bound ($)", zh: "预期上限" },
  "ctrl.lowerPrice": { en: "Lower Bound ($)", zh: "预期下限" },
  "ctrl.budget": { en: "Trading Budget ($)", zh: "交易预算 ($)" },
  "ctrl.budgetPlaceholder": { en: "e.g. 5000", zh: "如 5000" },
  "ctrl.maxLoss": { en: "Max Loss Tolerance", zh: "最大可接受亏损" },
  "ctrl.maxLossPlaceholder": { en: "e.g. 500", zh: "如 500" },
  "ctrl.maxLossDollar": { en: "Dollar ($)", zh: "金额 ($)" },
  "ctrl.maxLossPercent": { en: "Percent (%)", zh: "百分比 (%)" },

  // IV Term Structure
  "ivTerm.title": { en: "IV Term Structure", zh: "IV期限结构" },
  "ivTerm.expiration": { en: "Expiration", zh: "到期日" },
  "ivTerm.atmIv": { en: "ATM IV", zh: "ATM IV" },
  "ivTerm.dte": { en: "DTE", zh: "天数" },
  "ivTerm.loading": { en: "Loading IV term structure...", zh: "正在加载IV期限结构..." },

  // Settings
  "settings.title": { en: "Settings", zh: "设置" },
  "settings.dataProvider": { en: "Data Provider", zh: "数据源" },
  "settings.llmProvider": { en: "LLM Provider", zh: "AI模型" },
  "settings.apiKey": { en: "API Key", zh: "API密钥" },
  "settings.baseUrl": { en: "Base URL", zh: "接口地址" },
  "settings.model": { en: "Model", zh: "模型名称" },
  "settings.save": { en: "Save Settings", zh: "保存设置" },
  "settings.saving": { en: "Saving...", zh: "保存中..." },
  "settings.saved": { en: "Saved!", zh: "已保存!" },
  "settings.polygonKey": { en: "Polygon.io API Key", zh: "Polygon.io API密钥" },

  // K线图
  "kline.title": { en: "Price Chart (K-Line)", zh: "K线图" },
  "kline.volume": { en: "Volume", zh: "成交量" },
  "kline.drawLine": { en: "Draw Line", zh: "画线" },
  "kline.clearLines": { en: "Clear Lines", zh: "清除画线" },
  "kline.ma": { en: "MA", zh: "均线" },
  "kline.loading": { en: "Loading chart data...", zh: "正在加载K线数据..." },

  // 期权链
  "chain.title": { en: "Options Chain", zh: "期权链" },
  "chain.greeksView": { en: "Greeks View", zh: "希腊字母" },
  "chain.probView": { en: "Probability View", zh: "概率视图" },
  "chain.winPct": { en: "Win%", zh: "胜率" },
  "chain.breakeven": { en: "BE", zh: "平衡点" },
  "chain.atm": { en: "ATM", zh: "平值" },
  "chain.loading": { en: "Loading options chain...", zh: "正在加载期权链..." },

  // 卖空/筹码/资金
  "short.title": { en: "Market Data Analysis", zh: "市场数据分析" },
  "short.tab1": { en: "Short Selling", zh: "卖空数据" },
  "short.tab2": { en: "Cost Distribution", zh: "筹码分布" },
  "short.tab3": { en: "Smart Money", zh: "聪明钱" },
  "short.pctFloat": { en: "Short % of Float", zh: "空头占流通股%" },
  "short.ratio": { en: "Days to Cover", zh: "回补天数" },
  "short.sharesShort": { en: "Shares Short", zh: "空头股数" },
  "short.disclaimer": { en: "⚠️ Estimated distribution based on VWAP approximation. Not actual shareholder cost basis data.", zh: "⚠️ 估算数据：基于历史成交量加权（VWAP近似），非实际持仓成本数据" },
  "short.loading": { en: "Loading market data...", zh: "正在加载市场数据..." },
  "short.finraSource": { en: "Source: FINRA RegSHO Daily Data", zh: "来源：FINRA RegSHO 每日数据" },
  "short.yahooSource": { en: "FINRA biweekly via Yahoo Finance", zh: "FINRA 双周报告（Yahoo Finance）" },
  "short.noData": { en: "No data available", zh: "暂无数据" },

  // GEX (Gamma Exposure panel)
  "gex.title":    { en: "Dealer Gamma Exposure (GEX)", zh: "经销商 Gamma 敞口 (GEX)" },
  "gex.subtitle": { en: "Option chain OI × γ · $M per 1% move", zh: "期权链 (OI × γ) · 百万美元/1% 移动" },

  // 多Agent
  "agent.researcher": { en: "Gathering market data...", zh: "正在收集市场数据..." },
  "agent.analyst": { en: "Analyzing options strategies...", zh: "正在分析期权策略..." },
  "agent.verifier": { en: "Verifying analysis accuracy...", zh: "正在核实分析准确性..." },
  "agent.verified": { en: "✓ Verified", zh: "✓ 已核实" },
  "agent.retry": { en: "Refining analysis...", zh: "正在优化分析..." },

  // Volatility rank panel (功能2 + 功能10 数据透明度)
  "volrank.title":      { en: "Volatility regime",                                                     zh: "波动率环境" },
  "volrank.subtitle":   { en: "Options environment thermometer · drives long vs short premium",        zh: "期权环境温度计 · 决定买方 vs 卖方策略" },
  "volrank.hvRank":     { en: "HV Rank",                                                               zh: "HV Rank" },
  "volrank.hvSubtitle": { en: "Based on 1Y realized volatility",                                       zh: "基于 1 年真实已实现波动率" },
  "volrank.ivRank":     { en: "IV Rank",                                                               zh: "IV Rank" },
  "volrank.ivSubtitle": { en: "Based on real options-chain IV snapshots",                              zh: "基于真实期权链 IV 快照" },

  // Earnings implied vs actual (功能3)
  "earn.title":         { en: "Earnings: implied vs actual",                                           zh: "财报隐含 vs 实际" },
  "earn.subtitle":      { en: "How much the market priced in — and how much it actually moved",        zh: "市场提前定价 vs 实际波动的复盘" },
  "earn.impliedNow":    { en: "Next earnings implied move",                                            zh: "下一次财报 · 隐含涨跌幅" },
  "earn.avgAbs":        { en: "Avg absolute past move",                                                zh: "历史绝对涨跌幅均值" },
  "earn.noData":        { en: "No earnings data available for this ticker",                            zh: "该标的暂无可用财报数据" },
  "earn.nextEarnings":  { en: "Next earnings",                                                         zh: "下一次财报" },
  "earn.historyLabel":  { en: "Past earnings day-after moves (real)",                                  zh: "过去财报次日实际涨跌幅 (真实)" },
  "earn.notAvailable":  { en: "Not available — would require paid historical options data",           zh: "暂不可用 — 需付费历史期权数据" },
  "earn.usingExp":      { en: "Using expiration",                                                      zh: "基于到期日" },
} as const;

type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, locale: Locale): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[locale] || entry["en"];
}

export default translations;
