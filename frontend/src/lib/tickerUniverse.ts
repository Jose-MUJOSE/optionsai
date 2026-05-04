/**
 * Shared US-ticker universe for both the Options Strategy Scanner and the
 * Technical Pattern Scanner.
 *
 * Goals:
 *   - Comprehensive: 30+ baskets covering large-cap, mid-cap, sector deep-dives
 *   - Honest: every basket lists real US tickers, no placeholder names
 *   - Curated: each basket caps at ~30 to stay within rate-limit budgets
 *   - Multi-select friendly: caller dedupes the union
 *
 * The frontend caps a single scan at 30 tickers (backend hard-limit) for
 * options-data scans (StrategyScanner) and 60 for OHLCV-only scans
 * (PatternScanner — cheaper requests).
 */

export type CategoryKey =
  // Watchlist + custom
  | "watchlist" | "custom"
  // Mega caps + indices
  | "mag7" | "dow30" | "sp50" | "ndx_top" | "russell_top"
  // Broad ETFs
  | "etf_core" | "sector_etfs" | "leveraged_etfs"
  // Tech sub-sectors
  | "semiconductors" | "ai_software" | "cloud_saas" | "cybersecurity"
  | "fintech" | "social_media"
  // Other sectors
  | "banks" | "insurance" | "asset_managers"
  | "healthcare" | "biotech" | "med_devices" | "pharma_big"
  | "energy_oil" | "renewable_energy"
  | "consumer_staples" | "consumer_disc" | "retail" | "restaurants"
  | "ev_auto" | "auto_legacy"
  | "aerospace_defense" | "industrials" | "logistics"
  | "real_estate" | "reits"
  | "media_entertainment"
  | "travel_leisure"
  | "china_adr" | "emerging_markets"
  // Themes
  | "dividend_aristocrats" | "high_short_interest" | "meme_popular";

interface CategoryMeta {
  zh: { label: string; desc: string };
  en: { label: string; desc: string };
  /** Ticker list — empty for watchlist/custom which resolve at runtime. */
  tickers: string[];
  /** Group used for visual organization on the UI. */
  group: "personal" | "indices" | "sectors" | "themes";
}

// Tickers below were curated from public market caps as of 2024–2026.
// All US-listed; no placeholders. Some appear in multiple baskets — the
// universe resolver dedupes when multi-select is used.
export const CATEGORIES: Record<CategoryKey, CategoryMeta> = {
  // ============================================================
  // PERSONAL
  // ============================================================
  watchlist: {
    zh: { label: "我的自选", desc: "扫描自选列表" },
    en: { label: "My Watchlist", desc: "Scan your saved tickers" },
    tickers: [],
    group: "personal",
  },
  custom: {
    zh: { label: "自定义", desc: "粘贴 ticker (最多 30)" },
    en: { label: "Custom", desc: "Paste your own (max 30)" },
    tickers: [],
    group: "personal",
  },

  // ============================================================
  // INDICES & MEGA CAP
  // ============================================================
  mag7: {
    zh: { label: "科技七雄", desc: "Magnificent 7" },
    en: { label: "Magnificent 7", desc: "Top 7 mega-cap tech" },
    tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
    group: "indices",
  },
  dow30: {
    zh: { label: "道指 30", desc: "道琼斯工业指数成份" },
    en: { label: "Dow 30", desc: "Dow Jones constituents" },
    tickers: [
      "AAPL", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
      "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM",
      "MRK", "MSFT", "NKE", "PG", "TRV", "UNH", "V", "VZ", "WBA", "WMT",
      "NVDA", "AMZN",
    ],
    group: "indices",
  },
  sp50: {
    zh: { label: "标普 50", desc: "S&P 500 头部权重股" },
    en: { label: "S&P Top 50", desc: "Top S&P 500 by weight" },
    tickers: [
      "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "BRK.B",
      "AVGO", "TSLA", "JPM", "LLY", "V", "XOM", "MA", "UNH", "COST",
      "WMT", "PG", "JNJ", "HD", "ABBV", "NFLX", "BAC", "CRM", "MRK",
      "CVX", "ORCL", "AMD", "KO",
    ],
    group: "indices",
  },
  ndx_top: {
    zh: { label: "纳指领头", desc: "纳斯达克 100 主力" },
    en: { label: "Nasdaq Top", desc: "Nasdaq-100 leaders" },
    tickers: [
      "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO",
      "COST", "NFLX", "PEP", "ADBE", "AMD", "CSCO", "TMUS", "CMCSA",
      "QCOM", "INTU", "TXN", "AMGN", "ISRG", "BKNG", "GILD", "MU",
      "PANW", "LRCX", "REGN", "ADP", "VRTX", "KLAC",
    ],
    group: "indices",
  },
  russell_top: {
    zh: { label: "罗素 1000", desc: "罗素 1000 头部权重" },
    en: { label: "Russell 1000", desc: "Top Russell 1000 names" },
    tickers: [
      "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "BRK.B", "TSLA",
      "JPM", "V", "MA", "JNJ", "WMT", "PG", "UNH", "ORCL", "HD", "ABBV",
      "BAC", "AVGO", "ASML", "MRK", "PEP", "CVX", "COST", "TMO", "ADBE",
      "ABT", "DHR", "PFE",
    ],
    group: "indices",
  },

  // ============================================================
  // ETFs
  // ============================================================
  etf_core: {
    zh: { label: "核心 ETF", desc: "宽基 + 主题 ETF" },
    en: { label: "Core ETFs", desc: "Broad + thematic ETFs" },
    tickers: [
      "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "VXUS", "EFA", "EEM",
      "GLD", "SLV", "TLT", "IEF", "HYG", "LQD", "BND", "ARKK", "ARKW",
      "VIG", "VYM", "SCHD", "DGRO",
    ],
    group: "indices",
  },
  sector_etfs: {
    zh: { label: "行业 ETF", desc: "11 个 SPDR 行业 ETF" },
    en: { label: "Sector ETFs", desc: "11 SPDR sector ETFs" },
    tickers: [
      "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "XLP",
      "XLU", "XLRE", "XLB", "XLC", "SMH", "SOXX", "KBE", "KRE", "XME",
    ],
    group: "indices",
  },
  leveraged_etfs: {
    zh: { label: "杠杆 ETF", desc: "3x ETF（高IV）" },
    en: { label: "Leveraged ETFs", desc: "3x ETFs (high IV)" },
    tickers: [
      "TQQQ", "SQQQ", "SPXL", "SPXS", "SOXL", "SOXS",
      "TNA", "TZA", "FAS", "FAZ", "TMF", "TMV", "UVIX", "SVIX",
    ],
    group: "indices",
  },

  // ============================================================
  // TECH SUB-SECTORS
  // ============================================================
  semiconductors: {
    zh: { label: "半导体", desc: "AI / 芯片产业链" },
    en: { label: "Semiconductors", desc: "AI & chip supply chain" },
    tickers: [
      "NVDA", "AVGO", "AMD", "TSM", "QCOM", "INTC", "MU", "AMAT",
      "LRCX", "ASML", "KLAC", "MRVL", "ON", "ARM", "MCHP", "ADI",
      "NXPI", "MPWR", "SWKS", "STX",
    ],
    group: "sectors",
  },
  ai_software: {
    zh: { label: "AI 软件", desc: "云 + AI 软件巨头" },
    en: { label: "AI Software", desc: "Cloud & AI leaders" },
    tickers: [
      "MSFT", "GOOGL", "META", "ORCL", "CRM", "ADBE", "PLTR", "NOW",
      "SNOW", "DDOG", "MDB", "NET", "CRWD", "TEAM", "WDAY", "ZS",
      "OKTA", "DOCU", "AI", "BBAI",
    ],
    group: "sectors",
  },
  cloud_saas: {
    zh: { label: "云 SaaS", desc: "企业 SaaS 服务" },
    en: { label: "Cloud SaaS", desc: "Enterprise SaaS" },
    tickers: [
      "MSFT", "ORCL", "CRM", "ADBE", "NOW", "SNOW", "WDAY", "INTU",
      "ADSK", "TEAM", "MDB", "DDOG", "DOCU", "ZM", "ZI", "BILL",
      "COUP", "S", "GTLB", "MNDY",
    ],
    group: "sectors",
  },
  cybersecurity: {
    zh: { label: "网络安全", desc: "网安龙头" },
    en: { label: "Cybersecurity", desc: "Cyber leaders" },
    tickers: [
      "PANW", "CRWD", "FTNT", "ZS", "OKTA", "S", "CYBR",
      "TENB", "RPD", "QLYS", "VRNS", "NET", "AKAM", "CHKP",
    ],
    group: "sectors",
  },
  fintech: {
    zh: { label: "金融科技", desc: "支付 + Fintech" },
    en: { label: "Fintech", desc: "Payments & fintech" },
    tickers: [
      "V", "MA", "PYPL", "SQ", "FI", "FIS", "GPN", "ADYEY",
      "SOFI", "AFRM", "UPST", "MELI", "PAGS", "STNE", "NU",
    ],
    group: "sectors",
  },
  social_media: {
    zh: { label: "社交媒体", desc: "社交 + 内容平台" },
    en: { label: "Social Media", desc: "Social & content platforms" },
    tickers: [
      "META", "GOOGL", "SNAP", "PINS", "RDDT", "MTCH",
      "SPOT", "NFLX", "DIS", "WBD", "PARA",
    ],
    group: "sectors",
  },

  // ============================================================
  // FINANCIAL
  // ============================================================
  banks: {
    zh: { label: "银行", desc: "大银行 + 区域银行" },
    en: { label: "Banks", desc: "Big & regional banks" },
    tickers: [
      "JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "TFC",
      "COF", "BK", "STT", "FITB", "RF", "CFG", "MTB", "ZION",
    ],
    group: "sectors",
  },
  insurance: {
    zh: { label: "保险", desc: "财险 + 寿险 + 再保" },
    en: { label: "Insurance", desc: "P&C + life + reinsurance" },
    tickers: [
      "BRK.B", "PGR", "TRV", "ALL", "CB", "AIG", "MET", "PRU",
      "AFL", "HIG", "MMC", "AON", "WTW", "AJG", "GL",
    ],
    group: "sectors",
  },
  asset_managers: {
    zh: { label: "资管券商", desc: "资管 + 券商" },
    en: { label: "Asset Mgmt", desc: "Asset mgmt & brokers" },
    tickers: [
      "BLK", "SCHW", "GS", "MS", "AXP", "BX", "KKR", "APO",
      "BEN", "TROW", "STT", "AMG", "IVZ",
    ],
    group: "sectors",
  },

  // ============================================================
  // HEALTHCARE
  // ============================================================
  pharma_big: {
    zh: { label: "大药企", desc: "全球大型制药" },
    en: { label: "Big Pharma", desc: "Major pharma" },
    tickers: [
      "LLY", "JNJ", "PFE", "ABBV", "MRK", "BMY", "AZN", "NVS",
      "GSK", "SNY", "TAK", "BAYRY",
    ],
    group: "sectors",
  },
  biotech: {
    zh: { label: "生物科技", desc: "生物科技龙头" },
    en: { label: "Biotech", desc: "Top biotech" },
    tickers: [
      "AMGN", "GILD", "REGN", "VRTX", "BIIB", "MRNA", "ILMN", "INCY",
      "BMRN", "ALNY", "BNTX", "CRSP", "EDIT", "BLUE",
    ],
    group: "sectors",
  },
  med_devices: {
    zh: { label: "医疗器械", desc: "医疗器械 + 诊断" },
    en: { label: "Med Devices", desc: "Devices & diagnostics" },
    tickers: [
      "ISRG", "MDT", "SYK", "BSX", "BDX", "ZBH", "EW",
      "ABT", "TMO", "DHR", "A", "RMD", "ALGN", "DXCM", "PODD",
    ],
    group: "sectors",
  },
  healthcare: {
    zh: { label: "医疗服务", desc: "保险 + 医院 + 药店" },
    en: { label: "Health Services", desc: "Insurers, hospitals, pharmacies" },
    tickers: [
      "UNH", "CVS", "CI", "HUM", "ELV", "MOH",
      "HCA", "UHS", "DGX", "LH", "WBA",
    ],
    group: "sectors",
  },

  // ============================================================
  // ENERGY
  // ============================================================
  energy_oil: {
    zh: { label: "传统能源", desc: "石油天然气" },
    en: { label: "Oil & Gas", desc: "Traditional energy" },
    tickers: [
      "XOM", "CVX", "COP", "EOG", "OXY", "SLB", "MPC", "PSX", "VLO",
      "PXD", "FANG", "DVN", "HES", "MRO", "APA", "BKR", "HAL", "WMB",
    ],
    group: "sectors",
  },
  renewable_energy: {
    zh: { label: "新能源", desc: "光伏 + 储能 + 氢能" },
    en: { label: "Renewable Energy", desc: "Solar, storage, hydrogen" },
    tickers: [
      "ENPH", "FSLR", "SEDG", "RUN", "PLUG", "BE", "BLDP",
      "NEE", "DTE", "AEP", "DUK", "SO", "ICLN", "TAN",
    ],
    group: "sectors",
  },

  // ============================================================
  // CONSUMER
  // ============================================================
  consumer_staples: {
    zh: { label: "必选消费", desc: "食品 + 日用品" },
    en: { label: "Consumer Staples", desc: "Food & household" },
    tickers: [
      "PG", "KO", "PEP", "WMT", "COST", "PM", "MO", "MDLZ",
      "CL", "GIS", "K", "HSY", "SJM", "CAG", "KHC", "STZ",
    ],
    group: "sectors",
  },
  consumer_disc: {
    zh: { label: "可选消费", desc: "零售 + 奢侈" },
    en: { label: "Consumer Disc.", desc: "Retail & luxury" },
    tickers: [
      "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TJX",
      "BKNG", "CMG", "TGT", "DG", "DLTR", "ROST", "ULTA",
      "LULU", "DPZ", "DECK",
    ],
    group: "sectors",
  },
  retail: {
    zh: { label: "零售", desc: "商超 + 折扣店" },
    en: { label: "Retail", desc: "Big-box & discount" },
    tickers: [
      "WMT", "COST", "TGT", "AMZN", "HD", "LOW", "TJX", "ROST",
      "DG", "DLTR", "BBY", "M", "JWN", "KSS", "GPS", "ANF",
    ],
    group: "sectors",
  },
  restaurants: {
    zh: { label: "餐饮连锁", desc: "快餐 + 咖啡 + 餐厅" },
    en: { label: "Restaurants", desc: "QSR + coffee + casual" },
    tickers: [
      "MCD", "SBUX", "CMG", "DPZ", "QSR", "YUM", "WEN", "JACK",
      "WING", "TXRH", "DRI", "EAT", "SHAK", "CAVA",
    ],
    group: "sectors",
  },
  ev_auto: {
    zh: { label: "电车汽车", desc: "EV + 新势力" },
    en: { label: "EV & Auto", desc: "EVs & emerging" },
    tickers: [
      "TSLA", "RIVN", "LCID", "NIO", "XPEV", "LI",
      "BYDDY", "QS", "CHPT", "EVGO", "BLNK",
    ],
    group: "sectors",
  },
  auto_legacy: {
    zh: { label: "传统汽车", desc: "整车 + 零部件" },
    en: { label: "Legacy Auto", desc: "OEMs & parts" },
    tickers: [
      "F", "GM", "TM", "STLA", "HMC", "LEA", "BWA",
      "MGA", "ALV", "GPC", "DORM", "LKQ",
    ],
    group: "sectors",
  },

  // ============================================================
  // INDUSTRIAL
  // ============================================================
  aerospace_defense: {
    zh: { label: "航空航天", desc: "航空 + 国防" },
    en: { label: "Aerospace & Defense", desc: "Aerospace + defense" },
    tickers: [
      "BA", "LMT", "RTX", "NOC", "GD", "TXT", "HII", "LDOS",
      "TDG", "HEI", "AXON", "PLTR", "KTOS",
    ],
    group: "sectors",
  },
  industrials: {
    zh: { label: "工业制造", desc: "重型设备 + 机械" },
    en: { label: "Industrials", desc: "Heavy machinery" },
    tickers: [
      "CAT", "DE", "EMR", "ETN", "ITW", "PH", "ROK", "DOV",
      "HON", "MMM", "GE", "PCAR", "CMI", "URI", "OTIS",
    ],
    group: "sectors",
  },
  logistics: {
    zh: { label: "物流运输", desc: "快递 + 铁路 + 航运" },
    en: { label: "Logistics", desc: "Shipping, rail, air" },
    tickers: [
      "UPS", "FDX", "UNP", "CSX", "NSC", "ODFL", "JBHT",
      "CHRW", "EXPD", "XPO", "KNX", "WERN", "ZIM",
    ],
    group: "sectors",
  },

  // ============================================================
  // REAL ESTATE
  // ============================================================
  real_estate: {
    zh: { label: "房地产", desc: "建筑商 + 中介" },
    en: { label: "Real Estate", desc: "Builders & brokers" },
    tickers: [
      "DHI", "LEN", "PHM", "TOL", "NVR", "KBH", "MTH",
      "Z", "RDFN", "OPEN", "CBRE", "JLL",
    ],
    group: "sectors",
  },
  reits: {
    zh: { label: "REITs", desc: "房地产信托基金" },
    en: { label: "REITs", desc: "Real-estate trusts" },
    tickers: [
      "PLD", "AMT", "CCI", "EQIX", "PSA", "O", "WELL", "DLR",
      "SPG", "VICI", "IRM", "EXR", "AVB", "EQR", "VTR",
    ],
    group: "sectors",
  },

  // ============================================================
  // MEDIA / TRAVEL
  // ============================================================
  media_entertainment: {
    zh: { label: "媒体娱乐", desc: "影视 + 流媒体" },
    en: { label: "Media", desc: "Film, streaming, gaming" },
    tickers: [
      "DIS", "NFLX", "WBD", "PARA", "CMCSA", "T", "VZ",
      "FOX", "FOXA", "EA", "TTWO", "RBLX",
    ],
    group: "sectors",
  },
  travel_leisure: {
    zh: { label: "旅游休闲", desc: "航空 + 酒店 + 邮轮" },
    en: { label: "Travel & Leisure", desc: "Airlines, hotels, cruises" },
    tickers: [
      "BKNG", "ABNB", "EXPE", "MAR", "HLT", "H",
      "AAL", "DAL", "UAL", "LUV", "ALK", "SAVE",
      "CCL", "RCL", "NCLH",
    ],
    group: "sectors",
  },

  // ============================================================
  // INTERNATIONAL
  // ============================================================
  china_adr: {
    zh: { label: "中概股", desc: "美股上市中国公司" },
    en: { label: "China ADRs", desc: "US-listed Chinese cos" },
    tickers: [
      "BABA", "PDD", "JD", "NIO", "BIDU", "TME", "BILI", "TCOM",
      "XPEV", "LI", "NTES", "VIPS", "YMM", "ZTO", "EDU", "TAL",
    ],
    group: "sectors",
  },
  emerging_markets: {
    zh: { label: "新兴市场", desc: "印度+巴西+南美" },
    en: { label: "EM", desc: "India, Brazil, LATAM" },
    tickers: [
      "INFY", "WIT", "HDB", "IBN", "TTM",
      "VALE", "PBR", "ITUB", "BBD", "MELI", "STNE",
    ],
    group: "sectors",
  },

  // ============================================================
  // THEMES
  // ============================================================
  dividend_aristocrats: {
    zh: { label: "股息贵族", desc: "25+ 年连续派息" },
    en: { label: "Dividend Aristocrats", desc: "25+ years of dividend hikes" },
    tickers: [
      "JNJ", "PG", "KO", "MMM", "CAT", "MCD", "WMT", "T",
      "ED", "SO", "DUK", "CL", "ITW", "PEP", "TGT",
      "EMR", "CINF", "AFL", "CB", "PPG", "GD",
    ],
    group: "themes",
  },
  high_short_interest: {
    zh: { label: "高空头股", desc: "已知高空头持仓" },
    en: { label: "High Short Interest", desc: "Known high-short names" },
    tickers: [
      "BYND", "CVNA", "FUBO", "GME", "AMC", "BBBY", "MMAT",
      "AI", "IONQ", "RIVN", "LCID", "PTON",
    ],
    group: "themes",
  },
  meme_popular: {
    zh: { label: "热门 Meme", desc: "散户高度关注" },
    en: { label: "Meme Stocks", desc: "Retail-driven names" },
    tickers: [
      "GME", "AMC", "BBBY", "PLTR", "RIVN", "LCID", "RBLX",
      "HOOD", "SOFI", "AFRM", "BB", "DJT", "MSTR",
    ],
    group: "themes",
  },
};

/** Order in which categories are displayed in the picker grid. */
export const CATEGORY_ORDER: CategoryKey[] = [
  // Personal
  "watchlist", "custom",
  // Indices
  "mag7", "ndx_top", "sp50", "dow30", "russell_top",
  "etf_core", "sector_etfs", "leveraged_etfs",
  // Tech
  "semiconductors", "ai_software", "cloud_saas", "cybersecurity", "fintech", "social_media",
  // Financial
  "banks", "insurance", "asset_managers",
  // Healthcare
  "pharma_big", "biotech", "med_devices", "healthcare",
  // Energy
  "energy_oil", "renewable_energy",
  // Consumer
  "consumer_staples", "consumer_disc", "retail", "restaurants",
  "ev_auto", "auto_legacy",
  // Industrial
  "aerospace_defense", "industrials", "logistics",
  // Real estate
  "real_estate", "reits",
  // Media + travel
  "media_entertainment", "travel_leisure",
  // International
  "china_adr", "emerging_markets",
  // Themes
  "dividend_aristocrats", "high_short_interest", "meme_popular",
];

/** Resolve a multi-select Set<CategoryKey> into a deduplicated ticker list. */
export function resolveUniverse(
  selected: Set<CategoryKey>,
  watchlistTickers: string[],
  customRaw: string,
  cap: number = 30,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (t: string) => {
    const u = t.trim().toUpperCase();
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const key of CATEGORY_ORDER) {
    if (!selected.has(key)) continue;
    if (key === "watchlist") {
      watchlistTickers.forEach(add);
    } else if (key === "custom") {
      customRaw.split(/[,\s]+/).filter(Boolean).forEach(add);
    } else {
      CATEGORIES[key].tickers.forEach(add);
    }
  }
  return out.slice(0, cap);
}
