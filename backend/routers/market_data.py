"""
OptionsAI - 市场数据 API 路由
GET /api/market-data/{ticker} — 实时行情+环境感知
GET /api/expirations/{ticker} — 可用到期日列表
GET /api/options-chain/{ticker} — 指定到期日的完整期权链
"""
from fastapi import APIRouter, HTTPException
from backend.models.schemas import MarketData, OptionsChain, OptionContract, OptionType
from backend.services.data_fetcher import DataFetcher

router = APIRouter(tags=["Market Data"])

# 全局 DataFetcher 实例
_fetcher = DataFetcher()


@router.get("/market-data/{ticker}", response_model=MarketData)
async def get_market_data(ticker: str):
    """
    获取 Ticker 的完整市场数据
    包含：股价、IV、IV Rank/Percentile、HV、财报日、到期日列表
    """
    ticker = ticker.upper().strip()
    try:
        data = await _fetcher.get_full_market_data(ticker)
        return MarketData(**data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch data for {ticker}: {str(e)}")


@router.get("/expirations/{ticker}")
async def get_expirations(ticker: str):
    """获取所有可用到期日"""
    ticker = ticker.upper().strip()
    try:
        expirations = await _fetcher.get_expirations(ticker)
        return {"ticker": ticker, "expirations": expirations}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/iv-term-structure/{ticker}")
async def get_iv_term_structure(ticker: str):
    """获取所有到期日的 ATM IV，用于 IV 期限结构展示"""
    ticker = ticker.upper().strip()
    try:
        spot_data = await _fetcher.get_spot_price(ticker)
        spot = spot_data["spot_price"]
        expirations = await _fetcher.get_expirations(ticker)

        from datetime import datetime
        today = datetime.now().date()
        term_structure = []

        for exp in expirations[:15]:
            exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
            dte = (exp_date - today).days
            if dte < 1:
                continue
            try:
                chain = await _fetcher.get_options_chain(ticker, exp)
                iv = _fetcher._calc_atm_iv(chain["calls"], chain["puts"], spot)
                if iv > 0:
                    term_structure.append({"expiration": exp, "dte": dte, "atm_iv": round(iv, 2)})
            except Exception:
                continue

        return {"ticker": ticker, "spot_price": spot, "term_structure": term_structure}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/options-snapshot/{ticker}")
async def get_options_snapshot(ticker: str, expiration: str):
    """
    获取指定到期日的 ATM IV + Greeks 快照
    当用户切换到期日时前端调用此接口更新仪表盘
    Query params: ?expiration=2026-05-22
    """
    ticker = ticker.upper().strip()
    try:
        snapshot = await _fetcher.get_options_snapshot(ticker, expiration)
        return snapshot
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[OPTIONS-SNAPSHOT ERROR] {tb}")
        raise HTTPException(status_code=400, detail=f"Failed to get snapshot: {str(e)}")


@router.get("/options-chain/{ticker}", response_model=OptionsChain)
async def get_options_chain(ticker: str, expiration: str):
    """
    获取指定到期日的完整期权链 (含胜率和盈亏平衡点)
    """
    ticker = ticker.upper().strip()
    try:
        chain = await _fetcher.get_options_chain(ticker, expiration)
        calls_df = chain["calls"]
        puts_df = chain["puts"]
        dte = chain["dte"]

        # Get spot price for win probability calculation
        spot_data = await _fetcher.get_spot_price(ticker)
        spot = spot_data.get("spot_price", 0)

        T = max(dte, 1) / 365.0
        r = 0.045  # risk-free rate

        from scipy.stats import norm as sp_norm
        import math

        def _bsm_price(S: float, K: float, T: float, r: float, sigma: float, opt_type: str) -> float:
            """BSM theoretical option price"""
            if sigma <= 0 or T <= 0:
                intrinsic = max(S - K, 0) if opt_type == "call" else max(K - S, 0)
                return float(intrinsic)
            d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
            d2 = d1 - sigma * math.sqrt(T)
            if opt_type == "call":
                return S * float(sp_norm.cdf(d1)) - K * math.exp(-r * T) * float(sp_norm.cdf(d2))
            else:
                return K * math.exp(-r * T) * float(sp_norm.cdf(-d2)) - S * float(sp_norm.cdf(-d1))

        def _newton_iv(market_price: float, S: float, K: float, T: float, r: float, opt_type: str) -> float:
            """
            Newton-Raphson implied volatility solver.
            专业平台标准做法：从期权市价反推隐含波动率，精度远高于直接使用 Yahoo Finance 存储的 IV 字段
            返回年化 IV (小数，如 0.9 = 90%)，失败返回 0
            """
            if market_price <= 1e-6 or S <= 0 or K <= 0 or T <= 0:
                return 0.0

            # Brenner-Subrahmanyam 初始估算: σ ≈ market_price * sqrt(2π/T) / S
            sigma = max(0.02, min(market_price * math.sqrt(2 * math.pi / T) / S, 20.0))

            for _ in range(100):
                try:
                    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
                    vega_raw = S * float(sp_norm.pdf(d1)) * math.sqrt(T)
                    if vega_raw < 1e-10:
                        break
                    price_diff = _bsm_price(S, K, T, r, sigma, opt_type) - market_price
                    if abs(price_diff) < 1e-7:
                        break
                    sigma = sigma - price_diff / vega_raw
                    if sigma <= 1e-4:
                        sigma = 1e-4
                except Exception:
                    break

            return max(0.0, sigma) if sigma < 20.0 else 0.0

        def calc_win_prob_and_be(row, opt_type: OptionType):
            """
            计算 BSM 胜率、盈亏平衡和全部希腊字母
            IV 优先从期权实际市价通过 Newton-Raphson 反推，与 Moomoo/TOS 等专业平台做法一致
            """
            strike = row.get("strike", 0)
            mid = row.get("mid_price", 0)
            bid = row.get("bid", 0)
            ask = row.get("ask", 0)
            yahoo_iv = row.get("implied_volatility", 0)

            # Breakeven
            if opt_type == OptionType.CALL:
                be = round(float(strike) + float(mid), 2) if mid else None
            else:
                be = round(float(strike) - float(mid), 2) if mid else None

            win_prob = None
            delta = gamma = theta = vega = None
            try:
                S = float(spot)
                K = float(strike)
                if S <= 0 or K <= 0 or T <= 0:
                    return win_prob, be, delta, gamma, theta, vega

                # --- IV 求解策略 ---
                # 优先使用 bid/ask 中价反推 IV (最准确)
                # 中价无效时用 ask 反推，再退化到 Yahoo 存储 IV
                opt_str = "call" if opt_type == OptionType.CALL else "put"
                sigma = 0.0

                price_candidates = []
                if bid and ask and bid > 0 and ask > 0:
                    price_candidates.append((bid + ask) / 2)  # mid 最准
                elif mid and float(mid) > 0:
                    price_candidates.append(float(mid))
                if ask and float(ask) > 0:
                    price_candidates.append(float(ask))

                for price_guess in price_candidates:
                    iv_candidate = _newton_iv(float(price_guess), S, K, T, r, opt_str)
                    if iv_candidate > 0.005:  # 至少 0.5% IV 才算有效
                        sigma = iv_candidate
                        break

                # 如果市价反推失败，回退到 Yahoo 存储 IV
                if sigma < 0.005 and yahoo_iv and float(yahoo_iv) > 1.0:
                    sigma = float(yahoo_iv) / 100.0

                if sigma <= 0.005:
                    return win_prob, be, delta, gamma, theta, vega

                # --- BSM 希腊字母计算 ---
                d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
                d2 = d1 - sigma * math.sqrt(T)

                if opt_type == OptionType.CALL:
                    win_prob = round(float(sp_norm.cdf(d2)) * 100, 1)
                    delta = round(float(sp_norm.cdf(d1)), 4)
                else:
                    win_prob = round(float(sp_norm.cdf(-d2)) * 100, 1)
                    delta = round(float(sp_norm.cdf(d1)) - 1, 4)

                gamma = round(float(sp_norm.pdf(d1)) / (S * sigma * math.sqrt(T)), 4)
                common_theta = -(S * float(sp_norm.pdf(d1)) * sigma) / (2 * math.sqrt(T))
                if opt_type == OptionType.CALL:
                    theta_annual = common_theta - r * K * math.exp(-r * T) * float(sp_norm.cdf(d2))
                else:
                    theta_annual = common_theta + r * K * math.exp(-r * T) * float(sp_norm.cdf(-d2))
                theta = round(theta_annual / 365, 4)
                vega = round(float(S * float(sp_norm.pdf(d1)) * math.sqrt(T)) / 100, 4)
            except Exception:
                pass

            return win_prob, be, delta, gamma, theta, vega

        def df_to_contracts(df, opt_type: OptionType):
            if df.empty:
                return []
            contracts = []
            for _, row in df.iterrows():
                win_prob, be, bsm_delta, bsm_gamma, bsm_theta, bsm_vega = calc_win_prob_and_be(row, opt_type)

                # Prefer pre-calculated Greeks (Tradier/Polygon) over BSM
                raw_delta = row.get("delta")
                raw_gamma = row.get("gamma")
                raw_theta = row.get("theta")
                raw_vega = row.get("vega")

                def _valid_greek(v):
                    """Return True if v is a usable non-null, non-NaN numeric value"""
                    try:
                        if v is None:
                            return False
                        f = float(v)
                        return not math.isnan(f) and not math.isinf(f)
                    except (TypeError, ValueError):
                        return False

                final_delta = float(raw_delta) if _valid_greek(raw_delta) else bsm_delta
                final_gamma = float(raw_gamma) if _valid_greek(raw_gamma) else bsm_gamma
                final_theta = float(raw_theta) if _valid_greek(raw_theta) else bsm_theta
                final_vega = float(raw_vega) if _valid_greek(raw_vega) else bsm_vega

                contracts.append(OptionContract(
                    strike=row["strike"],
                    last_price=row.get("last_price", 0),
                    bid=row.get("bid", 0),
                    ask=row.get("ask", 0),
                    mid_price=row.get("mid_price", 0),
                    implied_volatility=row.get("implied_volatility", 0) or 0,
                    volume=int(row.get("volume", 0)),
                    open_interest=int(row.get("open_interest", 0)),
                    delta=final_delta,
                    gamma=final_gamma,
                    theta=final_theta,
                    vega=final_vega,
                    option_type=opt_type,
                    win_probability=win_prob,
                    breakeven=be,
                ))
            return contracts

        return OptionsChain(
            ticker=ticker,
            expiration=expiration,
            dte=dte,
            calls=df_to_contracts(calls_df, OptionType.CALL),
            puts=df_to_contracts(puts_df, OptionType.PUT),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/ohlcv/{ticker}")
async def get_ohlcv(ticker: str, range: str = "1y", interval: str = "1d"):
    """
    获取K线数据 (OHLCV)
    range: 1mo, 3mo, 6mo, 1y, 2y
    interval: 1d, 1wk, 1mo
    """
    ticker = ticker.upper().strip()
    try:
        data = await _fetcher.get_ohlcv(ticker, range, interval)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/gex/{ticker}")
async def get_gex(ticker: str, expiration: str):
    """
    经销商 Gamma Exposure (GEX) by strike for a given expiration.
    真实: OI × gamma × 100 × spot² × 0.01 (百万美元) 直接从期权链计算。
    估算: "经销商净空 calls, 净多 puts" 是业内惯例, 真实 dealer positioning 不公开。
    """
    ticker = ticker.upper().strip()
    try:
        return await _fetcher.get_gamma_exposure(ticker, expiration)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/earnings-moves/{ticker}")
async def get_earnings_moves(ticker: str, lookback_quarters: int = 8):
    """
    财报事件的"实际 vs 隐含"涨跌幅
    数据来源:
      - 过去 actual move: Yahoo Finance 1D 真实收盘价
      - 当前 implied move: 当前 ATM 跨式 / spot (真实期权链)
      - 历史 implied move: 需付费历史期权数据，明确不展示
    """
    ticker = ticker.upper().strip()
    try:
        return await _fetcher.get_earnings_moves(ticker, lookback_quarters)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/unusual-flow/{ticker}")
async def get_unusual_flow(ticker: str, expiration: str = ""):
    """
    异动期权流 (Phase 5).

    数据来源 (100% 真实):
      - 完整期权链的实时 volume + OI (Tradier / Polygon / Yahoo)
      - 现货价 (spot) 用于分类 ITM/OTM

    异动判定规则 (公开算法, 非第三方推断):
      - volume / OI > 2.0  → 异常放量 (通常暗示新开仓而非平仓)
      - volume >= 1000 且 vol/OI > 3.0 → 可疑大单
      - 单合约 notional = volume * mid_price * 100 > 50万美元 → 重金下注
      - 看涨/看跌分类 + OTM 程度 (%越高越 speculative)

    返回: 按 vol/OI 倒序的异动合约列表
    """
    ticker = ticker.upper().strip()
    try:
        # 若未指定 expiration, 选最近的 30-45 DTE
        if not expiration:
            exps = await _fetcher.get_expirations(ticker)
            import time
            now = time.time()
            target = None
            for e in exps:
                from datetime import datetime as _dt
                dte = int((_dt.fromisoformat(e).timestamp() - now) / 86400)
                if 25 <= dte <= 60:
                    target = e
                    break
            expiration = target or (exps[0] if exps else "")
            if not expiration:
                raise HTTPException(status_code=400, detail="No expirations available")

        chain = await _fetcher.get_options_chain(ticker, expiration)
        calls_df = chain.get("calls")
        puts_df = chain.get("puts")
        if calls_df is None or puts_df is None:
            raise HTTPException(status_code=400, detail="Options chain unavailable")

        spot_data = await _fetcher.get_spot_price(ticker)
        spot = float(spot_data.get("spot_price") or 0)
        dte = int(chain.get("dte", 0))

        def _classify(row, opt_type: str):
            try:
                vol = int(row.get("volume") or 0)
                oi = int(row.get("open_interest") or 0)
                strike = float(row.get("strike") or 0)
                mid = float(row.get("mid_price") or 0) or float(row.get("last_price") or 0)
                iv = float(row.get("implied_volatility") or 0)
                if vol <= 0 or strike <= 0:
                    return None
                vol_oi_ratio = vol / oi if oi > 0 else float("inf")
                notional = vol * mid * 100.0  # 1 contract = 100 shares
                moneyness_pct = (strike / spot - 1.0) * 100.0 if spot > 0 else 0.0
                # OTM/ITM classification
                if opt_type == "call":
                    status = "ITM" if strike < spot else "OTM"
                else:
                    status = "ITM" if strike > spot else "OTM"
                # Flags
                flags = []
                if vol_oi_ratio > 2.0:
                    flags.append("high_vol_oi")
                if vol >= 1000 and vol_oi_ratio > 3.0:
                    flags.append("large_block")
                if notional > 500_000:
                    flags.append("large_notional")
                if not flags:
                    return None
                return {
                    "option_type": opt_type,
                    "strike": round(strike, 2),
                    "volume": vol,
                    "open_interest": oi,
                    "vol_oi_ratio": round(vol_oi_ratio, 2) if vol_oi_ratio != float("inf") else None,
                    "mid_price": round(mid, 3),
                    "notional_usd": round(notional, 0),
                    "iv_pct": round(iv, 1) if iv else None,
                    "moneyness_pct": round(moneyness_pct, 2),
                    "status": status,
                    "flags": flags,
                }
            except Exception:
                return None

        results = []
        for _, row in calls_df.iterrows():
            item = _classify(row, "call")
            if item:
                results.append(item)
        for _, row in puts_df.iterrows():
            item = _classify(row, "put")
            if item:
                results.append(item)

        # Sort by vol/OI desc, then by notional desc
        def _sort_key(it):
            r = it.get("vol_oi_ratio")
            return (-(r if r is not None else 1e9), -(it.get("notional_usd") or 0))

        results.sort(key=_sort_key)

        # Aggregate call vs put flow for bias
        total_call_notional = sum(r["notional_usd"] for r in results if r["option_type"] == "call")
        total_put_notional = sum(r["notional_usd"] for r in results if r["option_type"] == "put")
        total = total_call_notional + total_put_notional
        bias = "neutral"
        if total > 0:
            call_share = total_call_notional / total
            if call_share > 0.65:
                bias = "bullish"
            elif call_share < 0.35:
                bias = "bearish"

        return {
            "ticker": ticker,
            "expiration": expiration,
            "dte": dte,
            "spot_price": round(spot, 2),
            "contracts": results[:50],  # top 50
            "total_unusual_count": len(results),
            "call_notional_usd": round(total_call_notional, 0),
            "put_notional_usd": round(total_put_notional, 0),
            "call_put_bias": bias,
            "thresholds": {
                "vol_oi_ratio": 2.0,
                "large_block_volume": 1000,
                "large_block_vol_oi": 3.0,
                "large_notional_usd": 500_000,
            },
            "data_source": "Real options chain volume + OI (Tradier/Polygon/Yahoo). Classifications are transparent formulas, not 3rd-party sentiment.",
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Unusual flow error: {e}")


@router.post("/scanner")
async def run_scanner(body: dict):
    """
    策略扫描器 (Phase 6a).

    按预设条件扫描多只股票, 找出符合策略开仓条件的标的。

    Request body:
      {
        "preset": "high_iv_rank" | "low_iv_rank" | "bullish_flow" |
                  "bearish_flow" | "earnings_week",
        "tickers": ["AAPL", "TSLA", ...]
      }

    数据诚实性:
      - 所有信号都基于真实数据 (IV Rank、异动合约、财报日).
      - 并发扫描, 单个 ticker 失败不会影响其它 ticker.
      - 返回命中理由 + 信号数值, 用户能复核我们为什么给出这个建议。
    """
    import asyncio

    preset = str(body.get("preset", "")).strip()
    tickers_raw = body.get("tickers") or []
    tickers = [str(t).upper().strip() for t in tickers_raw if t]
    tickers = [t for t in tickers if t]
    if not preset or not tickers:
        raise HTTPException(status_code=400, detail="preset and tickers are required")
    if preset not in {"high_iv_rank", "low_iv_rank", "bullish_flow", "bearish_flow", "earnings_week"}:
        raise HTTPException(status_code=400, detail=f"Unknown preset: {preset}")
    tickers = tickers[:30]  # safety cap

    async def _eval_iv_rank(ticker: str) -> dict | None:
        try:
            iv = await _fetcher.get_iv_metrics(ticker)
            rank = iv.get("iv_rank")
            rank_source = iv.get("iv_rank_source", "insufficient_data")
            if rank is None:
                return None
            if preset == "high_iv_rank" and rank >= 60:
                spot = await _fetcher.get_spot_price(ticker)
                return {
                    "ticker": ticker,
                    "reason": f"IV Rank {rank:.1f} (source: {rank_source})",
                    "signal_value": round(rank, 1),
                    "signal_label": "IV Rank",
                    "spot_price": float(spot.get("spot_price") or 0),
                }
            if preset == "low_iv_rank" and rank <= 30:
                spot = await _fetcher.get_spot_price(ticker)
                return {
                    "ticker": ticker,
                    "reason": f"IV Rank {rank:.1f} (source: {rank_source})",
                    "signal_value": round(rank, 1),
                    "signal_label": "IV Rank",
                    "spot_price": float(spot.get("spot_price") or 0),
                }
        except Exception:
            return None
        return None

    async def _eval_flow(ticker: str, want_bias: str) -> dict | None:
        try:
            # Pick nearest 30-45 DTE expiration
            exps = await _fetcher.get_expirations(ticker)
            if not exps:
                return None
            import time
            from datetime import datetime as _dt
            now = time.time()
            chosen = None
            for e in exps:
                dte = int((_dt.fromisoformat(e).timestamp() - now) / 86400)
                if 25 <= dte <= 60:
                    chosen = e
                    break
            if not chosen:
                chosen = exps[0]
            chain = await _fetcher.get_options_chain(ticker, chosen)
            calls_df = chain.get("calls")
            puts_df = chain.get("puts")
            if calls_df is None or puts_df is None:
                return None

            def _sum_notional(df, only_unusual: bool) -> float:
                total = 0.0
                for _, row in df.iterrows():
                    vol = int(row.get("volume") or 0)
                    oi = int(row.get("open_interest") or 0)
                    mid = float(row.get("mid_price") or 0) or float(row.get("last_price") or 0)
                    if vol <= 0 or mid <= 0:
                        continue
                    vol_oi = vol / oi if oi > 0 else 999.0
                    if only_unusual and vol_oi < 2.0 and (vol * mid * 100.0) < 500_000:
                        continue
                    total += vol * mid * 100.0
                return total

            call_n = _sum_notional(calls_df, only_unusual=True)
            put_n = _sum_notional(puts_df, only_unusual=True)
            total = call_n + put_n
            if total < 100_000:  # too little activity to be meaningful
                return None
            call_share = call_n / total
            if want_bias == "bullish" and call_share > 0.65:
                spot = await _fetcher.get_spot_price(ticker)
                return {
                    "ticker": ticker,
                    "reason": f"Unusual call notional {call_share*100:.0f}% of total (${total/1e6:.1f}M)",
                    "signal_value": round(call_share * 100, 1),
                    "signal_label": "Call share %",
                    "spot_price": float(spot.get("spot_price") or 0),
                }
            if want_bias == "bearish" and call_share < 0.35:
                spot = await _fetcher.get_spot_price(ticker)
                put_share = 1.0 - call_share
                return {
                    "ticker": ticker,
                    "reason": f"Unusual put notional {put_share*100:.0f}% of total (${total/1e6:.1f}M)",
                    "signal_value": round(put_share * 100, 1),
                    "signal_label": "Put share %",
                    "spot_price": float(spot.get("spot_price") or 0),
                }
        except Exception:
            return None
        return None

    async def _eval_earnings(ticker: str) -> dict | None:
        try:
            date = await _fetcher.get_earnings_date(ticker)
            if not date:
                return None
            from datetime import datetime as _dt, timezone
            try:
                target = _dt.fromisoformat(date)
            except ValueError:
                return None
            if target.tzinfo is None:
                target = target.replace(tzinfo=timezone.utc)
            days = (target - _dt.now(timezone.utc)).days
            if 0 <= days <= 7:
                spot = await _fetcher.get_spot_price(ticker)
                return {
                    "ticker": ticker,
                    "reason": f"Earnings in {days} days ({date})",
                    "signal_value": days,
                    "signal_label": "Days to earnings",
                    "spot_price": float(spot.get("spot_price") or 0),
                }
        except Exception:
            return None
        return None

    async def _eval_ticker(ticker: str) -> dict | None:
        if preset in ("high_iv_rank", "low_iv_rank"):
            return await _eval_iv_rank(ticker)
        if preset == "bullish_flow":
            return await _eval_flow(ticker, "bullish")
        if preset == "bearish_flow":
            return await _eval_flow(ticker, "bearish")
        if preset == "earnings_week":
            return await _eval_earnings(ticker)
        return None

    results = await asyncio.gather(*[_eval_ticker(t) for t in tickers], return_exceptions=True)
    hits = [r for r in results if isinstance(r, dict)]

    # Sort hits: best-signal first
    def _sort_key(h: dict):
        v = h.get("signal_value")
        if isinstance(v, (int, float)):
            # For low_iv_rank / earnings_week: smaller = better
            if preset in ("low_iv_rank", "earnings_week"):
                return v
            return -v
        return 0

    hits.sort(key=_sort_key)

    return {
        "preset": preset,
        "scanned": len(tickers),
        "hits": hits,
        "data_sources": {
            "iv_rank": "DataFetcher.get_iv_metrics (real chain + rolling HV history)",
            "flow": "DataFetcher.get_options_chain (real volume + OI)",
            "earnings": "DataFetcher.get_earnings_date (Yahoo/Polygon)",
            "disclaimer": "All signals derived from public market data with transparent thresholds; no 3rd-party sentiment scores.",
        },
    }


@router.post("/backtest/{ticker}")
async def run_backtest_endpoint(ticker: str, body: dict):
    """
    策略回测端点 (Phase 3).

    请求体:
      {
        "strategy_type": "long_call" | "long_put" | "short_call" | "short_put" |
                         "bull_call_spread" | "bear_put_spread" |
                         "long_straddle" | "short_strangle",
        "entry_date": "YYYY-MM-DD" | null (null = 6 个月前),
        "dte_days": 30 (期权剩余天数),
        "hold_days": 30 (持仓天数, 可选)
      }

    数据诚实性:
      - 股价回放 100% 真实 (Yahoo OHLCV)
      - 期权定价为 BSM 理论价, 明确标注 "theoretical" 而非历史成交价
      - σ 使用滚动 30-day 真实已实现波动率
    """
    from backend.services.backtest_engine import run_backtest
    import pandas as pd
    from dataclasses import asdict

    ticker = ticker.upper().strip()
    strategy_type = body.get("strategy_type", "long_call")
    entry_date = body.get("entry_date")
    dte_days = int(body.get("dte_days", 30))
    hold_days = body.get("hold_days")
    if hold_days is not None:
        hold_days = int(hold_days)

    # 1) 拉 2 年 OHLCV (足够 30+entry 前置 HV 计算)
    try:
        ohlcv = await _fetcher.get_ohlcv(ticker, range="2y", interval="1d")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OHLCV fetch failed: {e}")

    bars = ohlcv.get("bars", [])
    if len(bars) < 60:
        raise HTTPException(status_code=400, detail="Insufficient price history (need >=60 days)")

    closes = pd.Series([float(b["close"]) for b in bars])
    from datetime import datetime
    dates = [datetime.utcfromtimestamp(int(b["time"])).strftime("%Y-%m-%d") for b in bars]

    # 2) 若未提供 entry_date, 默认 6 个月前第一个交易日 (等于索引 len-126 左右)
    if not entry_date:
        target_idx = max(31, len(dates) - 126)
        entry_date = dates[target_idx]

    try:
        result = run_backtest(
            ticker=ticker,
            strategy_type=strategy_type,
            closes=closes,
            dates=dates,
            entry_date=entry_date,
            dte_days=dte_days,
            hold_days=hold_days,
        )
        return asdict(result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Backtest error: {e}")


@router.get("/short-data/{ticker}")
async def get_short_data(ticker: str):
    """
    获取卖空数据 + 筹码分布估算 + 机构持仓 + 内部人交易
    数据来源: FINRA RegSHO + Yahoo Finance + SEC filings
    """
    ticker = ticker.upper().strip()
    try:
        import asyncio
        short_interest, finra_volume, chip_dist, smart_money = await asyncio.gather(
            _fetcher.get_short_interest(ticker),
            _fetcher.get_finra_short_volume(ticker, days=20),
            _fetcher.get_chip_distribution(ticker),
            _fetcher.get_smart_money(ticker),
            return_exceptions=True
        )

        return {
            "ticker": ticker,
            "short_interest": short_interest if not isinstance(short_interest, Exception) else {},
            "daily_short_volume": finra_volume if not isinstance(finra_volume, Exception) else [],
            "chip_distribution": chip_dist if not isinstance(chip_dist, Exception) else {"buckets": [], "data_label": "vwap_approximation"},
            "smart_money": smart_money if not isinstance(smart_money, Exception) else {"institutions": [], "insiders": []},
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
