"""
OptionsAI - 数据获取模块
使用 Polygon.io (主) + Yahoo Finance REST API (备用) 获取市场数据和期权链
"""
from __future__ import annotations

import os
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import pandas as pd
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"  # backend/.env
load_dotenv(_env_path, override=True)

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")
POLYGON_BASE_URL = "https://api.polygon.io"

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}


class DataFetcher:
    """
    市场数据获取器
    优先使用 Polygon.io，若失败则回退到 Yahoo Finance REST API
    """

    def __init__(self):
        self._http_client: Optional[httpx.AsyncClient] = None
        self._yahoo_crumb: Optional[str] = None
        self._yahoo_cookies: Optional[httpx.Cookies] = None
        # Cache Yahoo expiration timestamps: {ticker: {date_str: unix_ts}}
        self._exp_ts_cache: dict[str, dict[str, int]] = {}

    @property
    def _tradier_api_key(self) -> str:
        from backend.services.config_store import get_config
        return get_config().get("tradier_api_key", os.getenv("TRADIER_API_KEY", ""))

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=15.0)
        return self._http_client

    async def _get_yahoo_crumb(self) -> tuple[str, httpx.Cookies]:
        """
        获取 Yahoo Finance crumb + cookies (v7/v10 API 需要)
        通过访问 Yahoo Finance 主页获取 session cookie，然后请求 crumb
        """
        if self._yahoo_crumb and self._yahoo_cookies:
            return self._yahoo_crumb, self._yahoo_cookies

        client = await self._get_client()

        # Step 1: 获取 session cookies
        consent_resp = await client.get(
            "https://fc.yahoo.com",
            headers=YAHOO_HEADERS,
            follow_redirects=True,
        )
        cookies = consent_resp.cookies

        # Step 2: 获取 crumb
        crumb_resp = await client.get(
            "https://query2.finance.yahoo.com/v1/test/getcrumb",
            headers=YAHOO_HEADERS,
            cookies=cookies,
        )
        crumb_resp.raise_for_status()
        crumb = crumb_resp.text.strip()

        self._yahoo_crumb = crumb
        self._yahoo_cookies = cookies
        return crumb, cookies

    async def _yahoo_request(self, url: str, params: Optional[dict] = None) -> dict:
        """
        带 crumb 认证的 Yahoo API 请求
        如果 crumb 过期，自动刷新并重试一次
        """
        client = await self._get_client()
        crumb, cookies = await self._get_yahoo_crumb()

        if params is None:
            params = {}
        params["crumb"] = crumb

        resp = await client.get(url, params=params, headers=YAHOO_HEADERS, cookies=cookies)

        # 如果 401 (crumb 过期)，刷新后重试
        if resp.status_code == 401:
            self._yahoo_crumb = None
            self._yahoo_cookies = None
            crumb, cookies = await self._get_yahoo_crumb()
            params["crumb"] = crumb
            resp = await client.get(url, params=params, headers=YAHOO_HEADERS, cookies=cookies)

        resp.raise_for_status()
        return resp.json()

    async def close(self):
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()

    # ================================================================
    # 1. 股价 + 基础行情
    # ================================================================

    async def get_spot_price(self, ticker: str) -> dict:
        """
        获取最新股价和涨跌幅
        返回: {"spot_price": float, "change_pct": float, "prev_close": float}
        """
        # 尝试 Polygon.io
        if POLYGON_API_KEY:
            try:
                return await self._polygon_spot_price(ticker)
            except Exception:
                pass
        # 回退 Yahoo Finance REST API
        return await self._yahoo_spot_price(ticker)

    async def _polygon_spot_price(self, ticker: str) -> dict:
        client = await self._get_client()
        # Previous day's agg for price data
        url = f"{POLYGON_BASE_URL}/v2/aggs/ticker/{ticker}/prev"
        resp = await client.get(url, params={"apiKey": POLYGON_API_KEY})
        resp.raise_for_status()
        data = resp.json()
        result = data["results"][0]
        close = result["c"]
        prev_open = result["o"]
        change_pct = ((close - prev_open) / prev_open) * 100
        return {
            "spot_price": close,
            "change_pct": round(change_pct, 2),
            "prev_close": result.get("c", close),
        }

    async def _yahoo_spot_price(self, ticker: str) -> dict:
        try:
            client = await self._get_client()
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
            resp = await client.get(
                url,
                params={"interval": "1d", "range": "5d"},
                headers=YAHOO_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
            result = data["chart"]["result"][0]
            meta = result["meta"]

            price = float(meta.get("regularMarketPrice", 0))
            prev = float(meta.get("previousClose", 0) or meta.get("chartPreviousClose", 0))

            if price <= 0:
                # Fallback: use last close from the timeseries
                closes = result["indicators"]["quote"][0].get("close", [])
                # Filter out None values
                valid_closes = [c for c in closes if c is not None]
                if valid_closes:
                    price = float(valid_closes[-1])
                    if len(valid_closes) >= 2:
                        prev = float(valid_closes[-2])
                    else:
                        prev = price

            change_pct = ((price - prev) / prev * 100) if prev else 0
            return {
                "spot_price": round(price, 2),
                "change_pct": round(change_pct, 2),
                "prev_close": round(prev, 2),
            }
        except Exception:
            return {"spot_price": 0.0, "change_pct": 0.0, "prev_close": 0.0}

    # ================================================================
    # 2. 历史价格 + 波动率计算
    # ================================================================

    async def get_historical_volatility(self, ticker: str, days: int = 252) -> dict:
        """
        获取历史波动率 (HV) - 基于过去 N 个交易日的收盘价
        返回: {"hv_30": float, "hv_60": float, "daily_returns": pd.Series}
        """
        # 尝试 Polygon.io
        if POLYGON_API_KEY:
            try:
                return await self._polygon_hv(ticker, days)
            except Exception:
                pass
        return await self._yahoo_hv(ticker, days)

    async def _polygon_hv(self, ticker: str, days: int) -> dict:
        client = await self._get_client()
        end = datetime.now()
        start = end - timedelta(days=int(days * 1.5))  # 多取一些天数确保交易日够
        url = f"{POLYGON_BASE_URL}/v2/aggs/ticker/{ticker}/range/1/day/{start.strftime('%Y-%m-%d')}/{end.strftime('%Y-%m-%d')}"
        resp = await client.get(url, params={"apiKey": POLYGON_API_KEY, "limit": 500, "sort": "asc"})
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if len(results) < 30:
            raise ValueError("Polygon 历史数据不足")
        closes = pd.Series([r["c"] for r in results])
        return self._calc_hv(closes)

    async def _yahoo_hv(self, ticker: str, days: int) -> dict:
        closes = await self._fetch_closes(ticker, range_="1y")
        if closes is None or len(closes) < 30:
            return {"hv_30": 0.0, "hv_60": 0.0}
        return self._calc_hv(closes)

    async def _fetch_closes(
        self, ticker: str, range_: str = "1y"
    ) -> Optional["pd.Series"]:
        """
        Fetch a clean Series of daily closes from Yahoo Finance (real data).
        Returns None if the response is missing or unusable. Shared by HV and
        HV-rank math so both sides work off the identical price history.
        """
        try:
            client = await self._get_client()
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
            resp = await client.get(
                url,
                params={"interval": "1d", "range": range_},
                headers=YAHOO_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
            result = data["chart"]["result"][0]
            raw_closes = result["indicators"]["quote"][0].get("close", [])
            valid = [c for c in raw_closes if c is not None]
            if len(valid) < 30:
                return None
            return pd.Series(valid)
        except Exception:
            return None

    async def get_ohlcv(self, ticker: str, range: str = "1y", interval: str = "1d") -> dict:
        """
        获取 OHLCV K线数据
        返回: {"ticker": str, "interval": str, "bars": [{"time": int, "open": float, "high": float, "low": float, "close": float, "volume": int}]}
        """
        # 尝试 Polygon.io
        if POLYGON_API_KEY:
            try:
                return await self._polygon_ohlcv(ticker, range, interval)
            except Exception:
                pass
        # 回退 Yahoo Finance
        return await self._yahoo_ohlcv(ticker, range, interval)

    async def _polygon_ohlcv(self, ticker: str, range: str, interval: str) -> dict:
        """从 Polygon.io 获取 OHLCV 数据"""
        client = await self._get_client()
        # Map range to days
        range_days = {"1mo": 35, "3mo": 100, "6mo": 200, "1y": 400, "2y": 800}.get(range, 400)
        end = datetime.now()
        start = end - timedelta(days=range_days)
        # Map interval
        multiplier, timespan = {"1d": (1, "day"), "1wk": (1, "week"), "1mo": (1, "month")}.get(interval, (1, "day"))
        url = f"{POLYGON_BASE_URL}/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{start.strftime('%Y-%m-%d')}/{end.strftime('%Y-%m-%d')}"
        resp = await client.get(url, params={"apiKey": POLYGON_API_KEY, "limit": 1000, "sort": "asc"})
        resp.raise_for_status()
        results = resp.json().get("results", [])
        bars = []
        for r in results:
            if all(k in r for k in ["t", "o", "h", "l", "c", "v"]):
                bars.append({
                    "time": int(r["t"] // 1000),  # ms to seconds
                    "open": round(float(r["o"]), 4),
                    "high": round(float(r["h"]), 4),
                    "low": round(float(r["l"]), 4),
                    "close": round(float(r["c"]), 4),
                    "volume": int(r["v"]),
                })
        return {"ticker": ticker, "interval": interval, "bars": bars}

    async def _yahoo_ohlcv(self, ticker: str, range: str, interval: str) -> dict:
        """从 Yahoo Finance 获取 OHLCV 数据"""
        try:
            client = await self._get_client()
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
            resp = await client.get(
                url,
                params={"interval": interval, "range": range},
                headers=YAHOO_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
            result = data["chart"]["result"][0]
            timestamps = result.get("timestamp", [])
            quote = result["indicators"]["quote"][0]
            opens = quote.get("open", [])
            highs = quote.get("high", [])
            lows = quote.get("low", [])
            closes = quote.get("close", [])
            volumes = quote.get("volume", [])

            bars = []
            for i, ts in enumerate(timestamps):
                try:
                    o = opens[i]
                    h = highs[i]
                    l = lows[i]
                    c = closes[i]
                    v = volumes[i]
                    if None in (o, h, l, c):
                        continue
                    bars.append({
                        "time": int(ts),
                        "open": round(float(o), 4),
                        "high": round(float(h), 4),
                        "low": round(float(l), 4),
                        "close": round(float(c), 4),
                        "volume": int(v) if v is not None else 0,
                    })
                except (IndexError, TypeError):
                    continue
            return {"ticker": ticker, "interval": interval, "bars": bars}
        except Exception:
            return {"ticker": ticker, "interval": interval, "bars": []}

    @staticmethod
    def _calc_hv(closes: pd.Series) -> dict:
        """
        用对数收益率标准差 * sqrt(252) 计算年化历史波动率
        HV = std(ln(S_t / S_{t-1})) * sqrt(252)
        """
        log_returns = np.log(closes / closes.shift(1)).dropna()
        hv_30 = log_returns.tail(30).std() * math.sqrt(252) * 100
        hv_60 = log_returns.tail(60).std() * math.sqrt(252) * 100
        return {
            "hv_30": round(hv_30, 2),
            "hv_60": round(hv_60, 2),
        }

    # ================================================================
    # 3. 隐含波动率 IV + IV Rank / IV Percentile
    # ================================================================

    async def get_iv_metrics(self, ticker: str) -> dict:
        """
        Real-data volatility metrics. No synthetic ranges.

        Returned fields:
          - iv_current       : live ATM IV from today's option chain (%)
          - iv_rank          : rank value; *see* iv_rank_source for what backs it
          - iv_percentile    : percentile value; same note
          - hv_30            : current 30-day realized (historical) volatility (%)
          - hv_rank          : HV Rank from the rolling 30-day HV series over
                                ~1 year \u2014 100% real, computed from price history
          - hv_percentile    : HV Percentile, same basis as hv_rank
          - iv_rank_source   : "historical_iv"   \u2192 iv_rank/iv_percentile come
                                                     from \u22650 stored IV snapshots
                                "hv_proxy"       \u2192 mirrors HV Rank/Percentile
                                                     because we don't have
                                                     enough IV history yet
                                "insufficient_data"
                                                \u2192 couldn't compute either
          - iv_history_days  : number of distinct trading days we have cached
                                IV snapshots for
        """
        from backend.services import iv_snapshot_store

        # Insufficient-data fallback payload \u2014 used when every upstream fails.
        def _insufficient(iv_val: float, hv_val: float) -> dict:
            return {
                "iv_current": round(iv_val, 2),
                "iv_rank": 50.0,
                "iv_percentile": 50.0,
                "hv_30": round(hv_val, 2),
                "hv_rank": 50.0,
                "hv_percentile": 50.0,
                "iv_rank_source": "insufficient_data",
                "iv_history_days": iv_snapshot_store.count_snapshots(ticker),
            }

        try:
            # 获取期权到期日列表 (需要 crumb 认证)
            options_url = f"https://query2.finance.yahoo.com/v7/finance/options/{ticker}"
            options_data = await self._yahoo_request(options_url)
            chain_result = options_data["optionChain"]["result"][0]

            expiration_timestamps = chain_result.get("expirationDates", [])
            if not expiration_timestamps:
                hv_data = await self.get_historical_volatility(ticker)
                hv_30 = hv_data["hv_30"]
                # Without any live option chain we can't report iv_current honestly;
                # fall through to insufficient_data instead of guessing a value.
                return _insufficient(0.0, hv_30)

            # 获取现价
            spot_data = await self._yahoo_spot_price(ticker)
            spot = spot_data["spot_price"]

            # 按优先级排列到期日候选: 20-45d, 45-90d, 14-20d, 90-180d
            today = datetime.now()
            candidate_ranges = [(20, 45), (45, 90), (14, 20), (90, 180)]
            ordered_ts = []
            for lo, hi in candidate_ranges:
                for ts in expiration_timestamps:
                    exp_date = datetime.utcfromtimestamp(ts)
                    dte = (exp_date - today).days
                    if lo <= dte <= hi and ts not in ordered_ts:
                        ordered_ts.append(ts)

            # 最后兜底: 任意 7+ 天的到期日
            for ts in expiration_timestamps:
                exp_date = datetime.utcfromtimestamp(ts)
                if (exp_date - today).days >= 7 and ts not in ordered_ts:
                    ordered_ts.append(ts)

            if not ordered_ts:
                ordered_ts = expiration_timestamps[:3]

            # 逐个尝试到期日直到找到有效 IV
            iv_current = 0.0
            chain_url = f"https://query2.finance.yahoo.com/v7/finance/options/{ticker}"

            for try_ts in ordered_ts[:5]:  # 最多尝试5个到期日
                try:
                    chain_data = await self._yahoo_request(chain_url, {"date": try_ts})
                    chain_options = chain_data["optionChain"]["result"][0].get("options", [])
                    if not chain_options:
                        continue

                    calls_raw = chain_options[0].get("calls", [])
                    puts_raw = chain_options[0].get("puts", [])
                    calls_df = pd.DataFrame(calls_raw) if calls_raw else pd.DataFrame()
                    puts_df = pd.DataFrame(puts_raw) if puts_raw else pd.DataFrame()

                    iv_current = self._calc_atm_iv(calls_df, puts_df, spot)
                    if iv_current > 1.0:  # 有效IV至少>1%
                        break
                except Exception:
                    continue

            # ---- Real HV rank from 1-year closes (always computable) ----
            closes = await self._fetch_closes(ticker, range_="1y")
            hv_30 = 0.0
            hv_rank = 50.0
            hv_percentile = 50.0
            hv_series: Optional[list[float]] = None
            if closes is not None and len(closes) >= 60:
                log_returns = np.log(closes / closes.shift(1)).dropna()
                hv_30 = float(log_returns.tail(30).std() * math.sqrt(252) * 100.0)
                hv_series = self._compute_hv_rank_series(closes)
                if hv_series:
                    hv_rank, hv_percentile = self._rank_from_series(hv_30, hv_series)
            else:
                hv_data = await self.get_historical_volatility(ticker)
                hv_30 = float(hv_data.get("hv_30", 0.0))

            # ---- If no live IV was found, we can't publish one honestly ----
            if iv_current <= 1.0:
                return _insufficient(iv_current, hv_30)

            # ---- Record today's real IV so IV Rank becomes accurate over time ----
            try:
                iv_snapshot_store.record_snapshot(ticker, iv_current, hv_30)
            except Exception:
                # Cache is best-effort; never break the API because of it.
                pass

            # ---- Real IV Rank from stored history when we have \u2265 30 days ----
            iv_history = iv_snapshot_store.get_iv_series(ticker, days=252)
            iv_history_days = len(iv_history)
            if iv_history_days >= 30:
                iv_rank, iv_percentile = self._rank_from_series(iv_current, iv_history)
                iv_rank_source = "historical_iv"
            else:
                # Honest fallback: mirror the (real) HV Rank and label the source.
                iv_rank = hv_rank
                iv_percentile = hv_percentile
                iv_rank_source = "hv_proxy"

            return {
                "iv_current": round(iv_current, 2),
                "iv_rank": round(iv_rank, 1),
                "iv_percentile": round(iv_percentile, 1),
                "hv_30": round(hv_30, 2),
                "hv_rank": round(hv_rank, 1),
                "hv_percentile": round(hv_percentile, 1),
                "iv_rank_source": iv_rank_source,
                "iv_history_days": iv_history_days,
            }
        except Exception:
            # Total failure: return insufficient_data rather than invented numbers.
            return _insufficient(0.0, 0.0)

    @staticmethod
    def _calc_atm_iv(calls_df: pd.DataFrame, puts_df: pd.DataFrame, spot: float) -> float:
        """
        计算 ATM 隐含波动率 — 线性插值法
        对 Call 和 Put 分别找到现价两侧最近的两个 strike，
        用线性插值求出精确 ATM IV，然后取平均。
        这是专业期权平台 (ThinkorSwim, IBKR, Moomoo) 的标准做法。
        """
        if calls_df.empty and puts_df.empty:
            return 0.0

        atm_ivs = []

        for df in [calls_df, puts_df]:
            if df.empty:
                continue
            df = df.copy()

            # 检测 IV 列名 (raw Yahoo 用 impliedVolatility, 清洗后用 implied_volatility)
            iv_col = "impliedVolatility" if "impliedVolatility" in df.columns else "implied_volatility" if "implied_volatility" in df.columns else None
            if not iv_col:
                continue

            # 过滤: bid 和 ask 都为 0 的合约没有市场定价
            has_bid = "bid" in df.columns
            has_ask = "ask" in df.columns
            if has_bid and has_ask:
                df = df[~((df["bid"] == 0) & (df["ask"] == 0))]

            if df.empty:
                continue

            # 过滤: IV 值异常低的合约
            is_pct = iv_col == "implied_volatility"
            min_iv = 1.0 if is_pct else 0.01
            df = df[df[iv_col] > min_iv]
            # 过滤: IV 值异常高的合约 (>500% 或 >5.0 小数)
            max_iv = 500.0 if is_pct else 5.0
            df = df[df[iv_col] < max_iv]

            if df.empty:
                continue

            df = df.sort_values("strike").reset_index(drop=True)

            # 线性插值: 找到 spot 两侧最近的 strike
            below = df[df["strike"] <= spot]
            above = df[df["strike"] >= spot]

            if not below.empty and not above.empty:
                row_below = below.iloc[-1]  # 最近的低于现价的 strike
                row_above = above.iloc[0]   # 最近的高于现价的 strike

                iv_below = row_below[iv_col]
                iv_above = row_above[iv_col]
                s_below = row_below["strike"]
                s_above = row_above["strike"]

                if s_below == s_above:
                    # 现价正好在某个 strike 上
                    atm_iv = iv_below
                else:
                    # 线性插值
                    weight = (spot - s_below) / (s_above - s_below)
                    atm_iv = iv_below * (1 - weight) + iv_above * weight

                atm_ivs.append(float(atm_iv))
            elif not below.empty:
                atm_ivs.append(float(below.iloc[-1][iv_col]))
            elif not above.empty:
                atm_ivs.append(float(above.iloc[0][iv_col]))

        if not atm_ivs:
            return 0.0

        mean_iv = sum(atm_ivs) / len(atm_ivs)
        # 如果是小数格式(raw Yahoo)，转百分比; 如果已是百分比则直接返回
        return mean_iv * 100 if mean_iv < 5.0 else mean_iv

    # NOTE: `_estimate_iv_rank` / `_estimate_iv_percentile` were removed because
    # they fabricated a synthetic [HV*0.7, HV*1.8] range. All volatility-rank
    # math is now done in `_compute_hv_rank_series` (100% real, from closes)
    # and `_rank_from_series` (shared helper). Real IV Rank comes from the
    # SQLite IV snapshot store once it has \u2265 30 days of data.

    @staticmethod
    def _rank_from_series(current: float, series: list[float]) -> tuple[float, float]:
        """
        Compute (rank, percentile) of `current` against an observed `series`.

        rank       = (current - min) / (max - min) * 100   \u2014 IV Rank convention
        percentile = % of observations strictly below `current` (0-100)

        Returns (50.0, 50.0) when the series is empty or degenerate, and the
        caller is responsible for labeling the *source* of `series` honestly.
        """
        if not series:
            return 50.0, 50.0
        lo = min(series)
        hi = max(series)
        rank = 50.0 if hi == lo else (current - lo) / (hi - lo) * 100.0
        rank = max(0.0, min(100.0, rank))
        below = sum(1 for x in series if x < current)
        percentile = (below / len(series)) * 100.0
        return round(rank, 1), round(percentile, 1)

    @staticmethod
    def _compute_hv_rank_series(closes: "pd.Series") -> Optional[list[float]]:
        """
        Build the rolling 30-day annualized HV time series used to rank the
        current HV(30). Each point is a real observed HV value \u2014 no synthetic
        ranges.

        Returns None when fewer than ~60 trading days are available, so the
        caller can fall back to a neutral label rather than a noisy reading.
        """
        import numpy as _np
        if closes is None or len(closes) < 60:
            return None
        log_returns = _np.log(closes / closes.shift(1)).dropna()
        if len(log_returns) < 60:
            return None
        # Rolling 30-day stdev, annualized.
        hv_series = (
            log_returns.rolling(window=30).std() * math.sqrt(252) * 100.0
        ).dropna()
        values = [float(v) for v in hv_series.tolist() if v == v]  # drop NaN
        return values if values else None

    # ================================================================
    # 4. 财报日期
    # ================================================================

    async def get_earnings_date(self, ticker: str) -> Optional[str]:
        """获取下一次财报日期"""
        # 尝试 Yahoo Finance calendarEvents (需要 crumb 认证)
        try:
            url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
            data = await self._yahoo_request(url, {"modules": "calendarEvents"})
            calendar = (
                data.get("quoteSummary", {})
                .get("result", [{}])[0]
                .get("calendarEvents", {})
                .get("earnings", {})
            )
            earnings_dates = calendar.get("earningsDate", [])
            now = datetime.now()
            for ed in earnings_dates:
                # Each entry has {"raw": unix_ts, "fmt": "YYYY-MM-DD"}
                raw_ts = ed.get("raw")
                fmt_str = ed.get("fmt")
                if raw_ts:
                    dt = datetime.utcfromtimestamp(raw_ts)
                    if dt > now:
                        return fmt_str or str(dt.date())
            # If no future date found, return the first one if available
            if earnings_dates:
                return earnings_dates[0].get("fmt") or str(
                    datetime.utcfromtimestamp(earnings_dates[0].get("raw", 0)).date()
                )
        except Exception:
            pass

        # Polygon.io 备用
        if POLYGON_API_KEY:
            try:
                return await self._polygon_earnings_date(ticker)
            except Exception:
                pass
        return None

    async def _polygon_earnings_date(self, ticker: str) -> Optional[str]:
        """从 Polygon.io 获取财报日期"""
        client = await self._get_client()
        today = datetime.now().strftime("%Y-%m-%d")
        url = f"{POLYGON_BASE_URL}/vX/reference/financials"
        resp = await client.get(url, params={
            "ticker": ticker,
            "filing_date.gte": today,
            "limit": 1,
            "apiKey": POLYGON_API_KEY,
        })
        data = resp.json()
        results = data.get("results", [])
        if results:
            return results[0].get("filing_date")
        return None

    # ================================================================
    # 5. 期权到期日列表
    # ================================================================

    async def get_expirations(self, ticker: str) -> list[str]:
        """获取所有可用到期日"""
        # Polygon.io
        if POLYGON_API_KEY:
            try:
                return await self._polygon_expirations(ticker)
            except Exception:
                pass
        # Yahoo Finance REST API
        return await self._yahoo_expirations(ticker)

    async def _polygon_expirations(self, ticker: str) -> list[str]:
        client = await self._get_client()
        url = f"{POLYGON_BASE_URL}/v3/reference/options/contracts"
        resp = await client.get(url, params={
            "underlying_ticker": ticker,
            "expired": "false",
            "limit": 1000,
            "apiKey": POLYGON_API_KEY,
        })
        resp.raise_for_status()
        results = resp.json().get("results", [])
        exps = sorted(set(r["expiration_date"] for r in results))
        return exps

    async def _yahoo_expirations(self, ticker: str) -> list[str]:
        try:
            url = f"https://query2.finance.yahoo.com/v7/finance/options/{ticker}"
            data = await self._yahoo_request(url)
            timestamps = data["optionChain"]["result"][0].get("expirationDates", [])
            # Convert unix timestamps to YYYY-MM-DD strings and cache mapping
            date_strs = []
            ts_map = {}
            for ts in timestamps:
                date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                date_strs.append(date_str)
                ts_map[date_str] = ts
            self._exp_ts_cache[ticker.upper()] = ts_map
            return date_strs
        except Exception:
            return []

    # ================================================================
    # 6. 完整期权链
    # ================================================================

    async def get_options_chain(self, ticker: str, expiration: str) -> dict:
        """
        获取指定到期日的完整期权链
        返回: {"calls": pd.DataFrame, "puts": pd.DataFrame, "dte": int}
        """
        today = datetime.now().date()
        exp_date = datetime.strptime(expiration, "%Y-%m-%d").date()
        dte = (exp_date - today).days

        # 尝试 Tradier (含专业希腊字母)
        if self._tradier_api_key:
            try:
                return await self._tradier_options_chain(ticker, expiration, dte)
            except Exception:
                pass

        # 尝试 Polygon.io
        if POLYGON_API_KEY:
            try:
                return await self._polygon_options_chain(ticker, expiration, dte)
            except Exception:
                pass

        # Yahoo Finance REST API 备用
        return await self._yahoo_options_chain(ticker, expiration, dte)

    async def _polygon_options_chain(self, ticker: str, expiration: str, dte: int) -> dict:
        client = await self._get_client()
        url = f"{POLYGON_BASE_URL}/v3/snapshot/options/{ticker}"
        resp = await client.get(url, params={
            "expiration_date": expiration,
            "limit": 250,
            "apiKey": POLYGON_API_KEY,
        })
        resp.raise_for_status()
        results = resp.json().get("results", [])

        calls_data = []
        puts_data = []

        for r in results:
            details = r.get("details", {})
            greeks = r.get("greeks", {})
            day = r.get("day", {})
            contract = {
                "strike": details.get("strike_price", 0),
                "last_price": day.get("close", 0) or 0,
                "bid": r.get("last_quote", {}).get("bid", 0) or 0,
                "ask": r.get("last_quote", {}).get("ask", 0) or 0,
                "implied_volatility": r.get("implied_volatility", 0) or 0,
                "volume": day.get("volume", 0) or 0,
                "open_interest": r.get("open_interest", 0) or 0,
                "delta": greeks.get("delta"),
                "gamma": greeks.get("gamma"),
                "theta": greeks.get("theta"),
                "vega": greeks.get("vega"),
            }
            contract["mid_price"] = round((contract["bid"] + contract["ask"]) / 2, 2) if (contract["bid"] + contract["ask"]) > 0 else contract["last_price"]

            if details.get("contract_type") == "call":
                calls_data.append(contract)
            else:
                puts_data.append(contract)

        calls_df = pd.DataFrame(calls_data).sort_values("strike").reset_index(drop=True) if calls_data else pd.DataFrame()
        puts_df = pd.DataFrame(puts_data).sort_values("strike").reset_index(drop=True) if puts_data else pd.DataFrame()

        return {"calls": calls_df, "puts": puts_df, "dte": dte}

    async def _tradier_options_chain(self, ticker: str, expiration: str, dte: int) -> dict:
        """
        从 Tradier API 获取期权链（含专业计算的希腊字母）
        Tradier 使用行业标准模型计算 Delta/Gamma/Theta/Vega
        """
        api_key = self._tradier_api_key
        if not api_key:
            raise ValueError("No Tradier API key configured")

        client = await self._get_client()
        # Try production endpoint first, fallback to sandbox (free developer accounts)
        # Sandbox has real market data and is suitable for retail developers
        for base_url in ["https://api.tradier.com", "https://sandbox.tradier.com"]:
            try:
                url = f"{base_url}/v1/markets/options/chains"
                resp = await client.get(
                    url,
                    params={"symbol": ticker, "expiration": expiration, "greeks": "true"},
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/json",
                    },
                    timeout=20.0,
                )
                if resp.status_code == 200:
                    break
                elif resp.status_code in (401, 403):
                    # Try next base URL (prod key might not work on sandbox or vice versa)
                    continue
                else:
                    resp.raise_for_status()
            except Exception as exc:
                if base_url == "https://sandbox.tradier.com":
                    raise exc  # Last option, re-raise
        resp.raise_for_status()
        data = resp.json()

        options_data = data.get("options")
        if not options_data:
            raise ValueError("No options data from Tradier")

        option_list = options_data.get("option")
        if not option_list:
            raise ValueError("Empty options list from Tradier")

        # Handle single option returned as dict (not list)
        if isinstance(option_list, dict):
            option_list = [option_list]

        calls_data = []
        puts_data = []

        for opt in option_list:
            greeks = opt.get("greeks") or {}
            bid = float(opt.get("bid") or 0)
            ask = float(opt.get("ask") or 0)
            last = float(opt.get("last") or 0)
            mid = round((bid + ask) / 2, 2) if (bid + ask) > 0 else last

            # IV: Tradier returns mid_iv as decimal (0.9 = 90%)
            iv_decimal = greeks.get("mid_iv") or greeks.get("smv_vol") or 0
            iv_pct = round(float(iv_decimal) * 100, 2) if iv_decimal else 0

            contract = {
                "strike": float(opt.get("strike") or 0),
                "last_price": last,
                "bid": bid,
                "ask": ask,
                "mid_price": mid,
                "implied_volatility": iv_pct,
                "volume": int(opt.get("volume") or 0),
                "open_interest": int(opt.get("open_interest") or 0),
                "delta": greeks.get("delta"),
                "gamma": greeks.get("gamma"),
                "theta": greeks.get("theta"),
                "vega": greeks.get("vega"),
            }

            opt_type = opt.get("option_type", "").lower()
            if opt_type == "call":
                calls_data.append(contract)
            elif opt_type == "put":
                puts_data.append(contract)

        calls_df = pd.DataFrame(calls_data).sort_values("strike").reset_index(drop=True) if calls_data else pd.DataFrame()
        puts_df = pd.DataFrame(puts_data).sort_values("strike").reset_index(drop=True) if puts_data else pd.DataFrame()

        return {"calls": calls_df, "puts": puts_df, "dte": dte}

    async def _yahoo_options_chain(self, ticker: str, expiration: str, dte: int) -> dict:
        try:
            # Use cached Yahoo timestamp if available (avoids timezone mismatch)
            ticker_upper = ticker.upper()
            cached = self._exp_ts_cache.get(ticker_upper, {})
            if expiration in cached:
                exp_unix = cached[expiration]
            else:
                # Fallback: fetch expirations to populate cache
                await self._yahoo_expirations(ticker)
                cached = self._exp_ts_cache.get(ticker_upper, {})
                if expiration in cached:
                    exp_unix = cached[expiration]
                else:
                    # Last resort: use UTC midnight timestamp
                    exp_date = datetime.strptime(expiration, "%Y-%m-%d")
                    exp_unix = int(exp_date.timestamp())

            url = f"https://query2.finance.yahoo.com/v7/finance/options/{ticker}"
            data = await self._yahoo_request(url, {"date": exp_unix})
            options_list = data["optionChain"]["result"][0].get("options", [])

            if not options_list:
                return {"calls": pd.DataFrame(), "puts": pd.DataFrame(), "dte": dte}

            calls_raw = options_list[0].get("calls", [])
            puts_raw = options_list[0].get("puts", [])

            def clean_yahoo_options(raw_list: list) -> pd.DataFrame:
                if not raw_list:
                    return pd.DataFrame()
                df = pd.DataFrame(raw_list)
                df = df.rename(columns={
                    "strike": "strike",
                    "lastPrice": "last_price",
                    "bid": "bid",
                    "ask": "ask",
                    "impliedVolatility": "implied_volatility",
                    "volume": "volume",
                    "openInterest": "open_interest",
                })
                # 计算 mid_price
                if "bid" in df.columns and "ask" in df.columns:
                    df["mid_price"] = ((df["bid"] + df["ask"]) / 2).round(2)
                    # 用 last_price 替代 0 值 (after-hours bid/ask are often 0)
                    if "last_price" in df.columns:
                        df.loc[df["mid_price"] <= 0, "mid_price"] = df["last_price"]
                else:
                    df["mid_price"] = df.get("last_price", 0)

                # IV 转百分比 (先转，再过滤)
                if "implied_volatility" in df.columns:
                    df["implied_volatility"] = (df["implied_volatility"] * 100).round(2)

                # 过滤 IV 异常低的合约 (Yahoo 返回 ~0 IV 当 bid/ask=0)
                if "implied_volatility" in df.columns and "last_price" in df.columns:
                    # IV < 1% 且 last_price > 0 的合约: 用 NaN 标记 IV 以免污染计算
                    bad_iv = (df["implied_volatility"] < 1.0) & (df["last_price"] > 0.01)
                    df.loc[bad_iv, "implied_volatility"] = np.nan

                # 填充缺失的 Greeks (Yahoo 不提供，后续可用 BSM 计算)
                for col in ["delta", "gamma", "theta", "vega"]:
                    if col not in df.columns:
                        df[col] = None

                # 填充 volume / open_interest
                if "volume" in df.columns:
                    df["volume"] = df["volume"].fillna(0).astype(int)
                if "open_interest" in df.columns:
                    df["open_interest"] = df["open_interest"].fillna(0).astype(int)

                # 保留核心字段
                keep_cols = ["strike", "last_price", "bid", "ask", "mid_price",
                             "implied_volatility", "volume", "open_interest",
                             "delta", "gamma", "theta", "vega"]
                return df[[c for c in keep_cols if c in df.columns]].sort_values("strike").reset_index(drop=True)

            calls_df = clean_yahoo_options(calls_raw)
            puts_df = clean_yahoo_options(puts_raw)

            return {"calls": calls_df, "puts": puts_df, "dte": dte}
        except Exception:
            return {"calls": pd.DataFrame(), "puts": pd.DataFrame(), "dte": dte}

    # ================================================================
    # 8. 新闻资讯 (Polygon.io)
    # ================================================================

    async def get_news(self, ticker: str, limit: int = 5) -> list[dict]:
        """
        获取标的最新新闻
        优先 Polygon.io, 回退 Yahoo Finance
        """
        # 1. 尝试 Polygon.io
        if POLYGON_API_KEY and POLYGON_API_KEY != "your_polygon_api_key_here":
            try:
                client = await self._get_client()
                url = f"{POLYGON_BASE_URL}/v2/reference/news"
                resp = await client.get(url, params={
                    "ticker": ticker,
                    "limit": limit,
                    "order": "desc",
                    "sort": "published_utc",
                    "apiKey": POLYGON_API_KEY,
                })
                resp.raise_for_status()
                results = resp.json().get("results", [])
                if results:
                    news = []
                    for item in results:
                        published = item.get("published_utc", "")[:10]
                        news.append({
                            "date": published,
                            "title": item.get("title", ""),
                            "summary": item.get("description", "")[:200],
                            "source": item.get("publisher", {}).get("name", ""),
                            "url": item.get("article_url", ""),
                        })
                    return news
            except Exception:
                pass

        # 2. 回退: Yahoo Finance search API (不需要 crumb)
        try:
            client = await self._get_client()
            url = f"https://query2.finance.yahoo.com/v1/finance/search"
            resp = await client.get(url, params={
                "q": ticker,
                "newsCount": limit,
                "quotesCount": 0,
                "enableFuzzyQuery": False,
            }, headers=YAHOO_HEADERS)
            resp.raise_for_status()
            data = resp.json()
            news_items = data.get("news", [])
            news = []
            for item in news_items[:limit]:
                # 提取发布时间
                pub_ts = item.get("providerPublishTime", 0)
                pub_date = datetime.utcfromtimestamp(pub_ts).strftime("%Y-%m-%d") if pub_ts else ""
                news.append({
                    "date": pub_date,
                    "title": item.get("title", ""),
                    "summary": "",  # Yahoo search API 不返回摘要
                    "source": item.get("publisher", ""),
                    "url": item.get("link", ""),
                })
            return news
        except Exception:
            pass

        return []

    # ================================================================
    # 9. 分析师目标价 (Yahoo Finance)
    # ================================================================

    async def get_analyst_data(self, ticker: str) -> dict:
        """
        获取分析师共识数据：目标价、评级
        使用 Yahoo Finance quoteSummary API + Finviz 个别机构目标价
        """
        try:
            url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
            data = await self._yahoo_request(url, {"modules": "financialData,recommendationTrend,upgradeDowngradeHistory"})
            result = data.get("quoteSummary", {}).get("result", [{}])[0]

            # 分析师目标价共识
            fin_data = result.get("financialData", {})
            target_high = fin_data.get("targetHighPrice", {}).get("raw")
            target_low = fin_data.get("targetLowPrice", {}).get("raw")
            target_mean = fin_data.get("targetMeanPrice", {}).get("raw")
            target_median = fin_data.get("targetMedianPrice", {}).get("raw")
            num_analysts = fin_data.get("numberOfAnalystOpinions", {}).get("raw", 0)
            recommendation = fin_data.get("recommendationKey", "")  # buy, hold, sell, etc.

            # 最近的评级变更
            upgrades = result.get("upgradeDowngradeHistory", {}).get("history", [])
            recent_changes = []
            for item in upgrades[:10]:  # 最近10条
                epoch = item.get("epochGradeDate", 0)
                if epoch:
                    from datetime import datetime
                    date_str = datetime.utcfromtimestamp(epoch).strftime("%Y-%m-%d")
                else:
                    date_str = ""
                recent_changes.append({
                    "institution": item.get("firm", ""),
                    "action": item.get("action", ""),  # init, upgrade, downgrade, maintain, reiterated
                    "from_grade": item.get("fromGrade", ""),
                    "to_grade": item.get("toGrade", ""),
                    "date": date_str,
                })

            # 尝试获取个别机构目标价 (Finviz)
            individual_targets = await self._get_individual_analyst_targets(ticker)

            return {
                "target_high": target_high,
                "target_low": target_low,
                "target_mean": target_mean,
                "target_median": target_median,
                "num_analysts": num_analysts,
                "recommendation": recommendation,
                "recent_changes": recent_changes,
                "individual_targets": individual_targets,
            }
        except Exception:
            return {
                "target_high": None,
                "target_low": None,
                "target_mean": None,
                "target_median": None,
                "num_analysts": 0,
                "recommendation": "",
                "recent_changes": [],
                "individual_targets": [],
            }

    async def _get_individual_analyst_targets(self, ticker: str) -> list[dict]:
        """
        从 Finviz 获取个别机构的目标价
        返回: [{"institution": str, "date": str, "action": str, "rating": str, "target_price": float}, ...]
        """
        try:
            client = await self._get_client()
            url = f"https://finviz.com/quote.ashx?t={ticker}&p=d"
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            })
            resp.raise_for_status()
            html = resp.text

            # Parse analyst table from Finviz HTML
            import re
            # Finviz analyst table: rows with date, action, institution, rating, price target
            # Look for the analyst ratings table
            targets = []

            # Pattern: analyst table rows in Finviz
            # The table has class "js-table-ratings" or similar
            # Each row: <td>Date</td><td>Action</td><td>Institution</td><td>Rating</td><td>$Price → $Price</td>
            table_match = re.search(r'class="js-table-ratings[^"]*"[^>]*>(.*?)</table>', html, re.DOTALL)
            if not table_match:
                # Alternative: look for analyst rows by pattern
                table_match = re.search(r'Ratings\s*</th>.*?<table[^>]*>(.*?)</table>', html, re.DOTALL | re.IGNORECASE)

            if table_match:
                table_html = table_match.group(1)
                rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL)
                for row in rows[:10]:
                    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                    if len(cells) >= 5:
                        import html as html_mod
                        date_str = html_mod.unescape(re.sub(r'<[^>]+>', '', cells[0]).strip())
                        action = html_mod.unescape(re.sub(r'<[^>]+>', '', cells[1]).strip())
                        institution = html_mod.unescape(re.sub(r'<[^>]+>', '', cells[2]).strip())
                        rating = html_mod.unescape(re.sub(r'<[^>]+>', '', cells[3]).strip())
                        price_text = html_mod.unescape(re.sub(r'<[^>]+>', '', cells[4]).strip())

                        # Extract target price: might be "$300" or "$280 → $300"
                        price_match = re.findall(r'\$?([\d,.]+)', price_text)
                        target_price = None
                        if price_match:
                            target_price = float(price_match[-1].replace(",", ""))

                        targets.append({
                            "institution": institution,
                            "date": date_str,
                            "action": action,
                            "rating": rating,
                            "target_price": target_price,
                        })
            return targets
        except Exception:
            return []

    # ================================================================
    # 7a. 期权快照 (指定到期日的 ATM IV + Greeks)
    # ================================================================

    async def get_options_snapshot(self, ticker: str, expiration: str) -> dict:
        """
        获取指定到期日的 ATM IV 和 Greeks
        用于用户切换到期日时实时更新
        """
        ticker = ticker.upper().strip()
        chain = await self.get_options_chain(ticker, expiration)
        spot_data = await self.get_spot_price(ticker)
        spot = spot_data["spot_price"]
        hv_data = await self.get_historical_volatility(ticker)
        hv_30 = hv_data["hv_30"]

        calls_df = chain["calls"]
        puts_df = chain["puts"]
        dte = chain["dte"]

        # ATM IV for this expiration
        atm_iv = self._calc_atm_iv(calls_df, puts_df, spot)
        if atm_iv <= 1.0:
            atm_iv = hv_30 * 1.2 if hv_30 > 0 else 30.0

        # ATM Greeks (from chain data or BSM calculation)
        atm_call = self._get_atm_contract(calls_df, spot)
        atm_put = self._get_atm_contract(puts_df, spot)

        # If Greeks are missing (Yahoo doesn't provide), calculate via BSM
        T = max(dte / 365.0, 1 / 365.0)
        sigma = atm_iv / 100.0
        r = 0.045  # risk-free rate approx

        call_greeks = self._extract_or_calc_greeks(atm_call, spot, T, sigma, r, "call")
        put_greeks = self._extract_or_calc_greeks(atm_put, spot, T, sigma, r, "put")

        return {
            "ticker": ticker,
            "expiration": expiration,
            "dte": dte,
            "atm_iv": round(atm_iv, 2),
            "hv_30": hv_30,
            "iv_hv_ratio": round(atm_iv / hv_30, 2) if hv_30 > 0 else None,
            "atm_call": call_greeks,
            "atm_put": put_greeks,
        }

    @staticmethod
    def _get_atm_contract(df: pd.DataFrame, spot: float) -> dict | None:
        """找到最接近现价的合约"""
        if df is None or df.empty:
            return None
        df = df.copy()
        df["dist"] = abs(df["strike"] - spot)
        nearest = df.nsmallest(1, "dist").iloc[0]
        return nearest.to_dict()

    @staticmethod
    def _extract_or_calc_greeks(contract: dict | None, spot: float, T: float, sigma: float, r: float, opt_type: str) -> dict:
        """从合约数据提取 Greeks，若缺失则用 Newton-Raphson IV + BSM 精确计算"""
        from scipy.stats import norm as sp_norm

        strike = contract["strike"] if contract else spot
        iv_yahoo = contract.get("implied_volatility", sigma * 100) if contract else sigma * 100

        mid = contract.get("mid_price", 0) if contract else 0
        bid = contract.get("bid", 0) if contract else 0
        ask = contract.get("ask", 0) if contract else 0
        volume = int(contract.get("volume", 0) or 0) if contract else 0
        oi = int(contract.get("open_interest", 0) or 0) if contract else 0

        # Check if contract already has valid Greeks (from Tradier/Polygon)
        def _is_valid_greek_val(v) -> bool:
            try:
                if v is None:
                    return False
                f = float(v)
                return not math.isnan(f) and not math.isinf(f)
            except (TypeError, ValueError):
                return False

        has_greeks = contract and _is_valid_greek_val(contract.get("delta"))

        if has_greeks:
            delta = float(contract["delta"])
            gamma = float(contract.get("gamma", 0) or 0)
            theta = float(contract.get("theta", 0) or 0)
            vega = float(contract.get("vega", 0) or 0)
            sigma_use = (float(iv_yahoo) / 100.0) if (iv_yahoo and float(iv_yahoo) > 1) else sigma
        else:
            # --- Newton-Raphson IV 求解：从实际市价反推隐含波动率 ---
            def _bsm_p(S, K, T, r, sig, ot):
                if sig <= 0 or T <= 0:
                    return max(S - K, 0) if ot == "call" else max(K - S, 0)
                d1 = (math.log(S / K) + (r + 0.5 * sig**2) * T) / (sig * math.sqrt(T))
                d2 = d1 - sig * math.sqrt(T)
                if ot == "call":
                    return S * float(sp_norm.cdf(d1)) - K * math.exp(-r * T) * float(sp_norm.cdf(d2))
                else:
                    return K * math.exp(-r * T) * float(sp_norm.cdf(-d2)) - S * float(sp_norm.cdf(-d1))

            sigma_use = 0.0
            price_candidates = []
            if bid and ask and float(bid) > 0 and float(ask) > 0:
                price_candidates.append((float(bid) + float(ask)) / 2)
            elif mid and float(mid) > 0:
                price_candidates.append(float(mid))
            if ask and float(ask) > 0:
                price_candidates.append(float(ask))

            for mkt_price in price_candidates:
                if mkt_price <= 1e-6:
                    continue
                # Brenner-Subrahmanyam 初始估算
                sig = max(0.02, min(mkt_price * math.sqrt(2 * math.pi / max(T, 1e-6)) / max(spot, 1), 20.0))
                for _ in range(100):
                    try:
                        d1 = (math.log(spot / strike) + (r + 0.5 * sig**2) * T) / (sig * math.sqrt(T))
                        vega_raw = spot * float(sp_norm.pdf(d1)) * math.sqrt(T)
                        if vega_raw < 1e-10:
                            break
                        diff = _bsm_p(spot, strike, T, r, sig, opt_type) - mkt_price
                        if abs(diff) < 1e-7:
                            break
                        sig = sig - diff / vega_raw
                        if sig <= 1e-4:
                            sig = 1e-4
                    except Exception:
                        break
                if 0.005 < sig < 20.0:
                    sigma_use = sig
                    break

            # 回退到 Yahoo 存储 IV
            if sigma_use < 0.005 and iv_yahoo and float(iv_yahoo) > 1.0:
                sigma_use = float(iv_yahoo) / 100.0
            if sigma_use < 0.005:
                sigma_use = sigma  # 最后兜底

            if T <= 0 or sigma_use <= 0.005:
                return {
                    "strike": round(strike, 2), "iv": round(sigma_use * 100, 2),
                    "mid": round(float(mid), 2), "bid": round(float(bid), 2), "ask": round(float(ask), 2),
                    "volume": volume, "open_interest": oi,
                    "delta": 0, "gamma": 0, "theta": 0, "vega": 0,
                }

            d1 = (math.log(spot / strike) + (r + 0.5 * sigma_use ** 2) * T) / (sigma_use * math.sqrt(T))
            d2 = d1 - sigma_use * math.sqrt(T)

            gamma = sp_norm.pdf(d1) / (spot * sigma_use * math.sqrt(T))
            vega = spot * sp_norm.pdf(d1) * math.sqrt(T) / 100  # per 1% IV move

            if opt_type == "call":
                delta = sp_norm.cdf(d1)
                theta = (-(spot * sp_norm.pdf(d1) * sigma_use) / (2 * math.sqrt(T))
                         - r * strike * math.exp(-r * T) * sp_norm.cdf(d2)) / 365
            else:
                delta = sp_norm.cdf(d1) - 1
                theta = (-(spot * sp_norm.pdf(d1) * sigma_use) / (2 * math.sqrt(T))
                         + r * strike * math.exp(-r * T) * sp_norm.cdf(-d2)) / 365

        return {
            "strike": round(strike, 2),
            "iv": round(sigma_use * 100, 2),
            "mid": round(float(mid), 2),
            "bid": round(bid, 2),
            "ask": round(ask, 2),
            "volume": volume,
            "open_interest": oi,
            "delta": round(delta, 4),
            "gamma": round(gamma, 4),
            "theta": round(theta, 4),
            "vega": round(vega, 4),
        }

    # ================================================================
    # 10. 空头持仓 + 筹码分布 + 机构持仓数据
    # ================================================================

    async def get_short_interest(self, ticker: str) -> dict:
        """
        获取空头持仓数据 (来自 Yahoo Finance quoteSummary)
        数据来源: FINRA 双周报告，通过 Yahoo Finance 获取
        """
        try:
            url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
            data = await self._yahoo_request(url, {"modules": "defaultKeyStatistics"})
            stats = data.get("quoteSummary", {}).get("result", [{}])[0].get("defaultKeyStatistics", {})

            shares_short = stats.get("sharesShort", {}).get("raw")
            short_ratio = stats.get("shortRatio", {}).get("raw")
            short_pct_float = stats.get("shortPercentOfFloat", {}).get("raw")
            date_short = stats.get("dateShortInterest", {}).get("raw")
            shares_outstanding = stats.get("sharesOutstanding", {}).get("raw")
            float_shares = stats.get("floatShares", {}).get("raw")

            date_str = None
            if date_short:
                date_str = datetime.utcfromtimestamp(date_short).strftime("%Y-%m-%d")

            return {
                "shares_short": shares_short,
                "short_ratio": round(float(short_ratio), 2) if short_ratio else None,
                "short_pct_float": round(float(short_pct_float) * 100, 2) if short_pct_float else None,
                "date_short_interest": date_str,
                "shares_outstanding": shares_outstanding,
                "float_shares": float_shares,
                "source": "Yahoo Finance (FINRA biweekly)",
            }
        except Exception:
            return {
                "shares_short": None,
                "short_ratio": None,
                "short_pct_float": None,
                "date_short_interest": None,
                "shares_outstanding": None,
                "float_shares": None,
                "source": "Yahoo Finance (FINRA biweekly)",
            }

    async def get_finra_short_volume(self, ticker: str, days: int = 20) -> list:
        """
        从 FINRA RegSHO 获取每日卖空量数据 (真实日线数据)
        来源: https://cdn.finra.org/equity/regsho/daily/CNMSshvol{DATE}.txt
        """
        import asyncio

        # 生成最近 days 个日历日（去掉周末）
        dates = []
        check_date = datetime.now().date()
        for _ in range(days * 2):  # 多检查一些天以覆盖节假日
            check_date -= timedelta(days=1)
            # 跳过周末
            if check_date.weekday() < 5:  # 0=Monday, 4=Friday
                dates.append(check_date.strftime("%Y%m%d"))
            if len(dates) >= days:
                break

        async def fetch_one_day(date_str: str) -> dict | None:
            try:
                client = await self._get_client()
                url = f"https://cdn.finra.org/equity/regsho/daily/CNMSshvol{date_str}.txt"
                resp = await client.get(url, headers=YAHOO_HEADERS, timeout=10.0)
                if resp.status_code != 200:
                    return None
                lines = resp.text.strip().split("\n")
                # Format: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
                for line in lines[1:]:  # skip header
                    parts = line.strip().split("|")
                    if len(parts) >= 5 and parts[1].strip().upper() == ticker.upper():
                        try:
                            short_vol = int(float(parts[2]))
                        except (ValueError, IndexError):
                            short_vol = 0
                        try:
                            total_vol = int(float(parts[4]))
                        except (ValueError, IndexError):
                            total_vol = 0
                        pct = round(short_vol / total_vol * 100, 1) if total_vol > 0 else 0
                        return {
                            "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}",
                            "short_volume": short_vol,
                            "total_volume": total_vol,
                            "short_pct": pct,
                        }
                return None
            except Exception:
                return None

        # 并发获取所有日期
        tasks = [fetch_one_day(d) for d in dates]
        results_raw = await asyncio.gather(*tasks)

        # 过滤 None，反转为时间升序
        results = [r for r in results_raw if r is not None]
        results.reverse()
        return results

    async def get_chip_distribution(self, ticker: str) -> dict:
        """
        基于 OHLCV 数据的 VWAP 加权价格分布估算
        ⚠️ 注意: 这是估算数据，不是真实的持仓成本分布
        """
        try:
            ohlcv = await self.get_ohlcv(ticker, range="1y", interval="1d")
            bars = ohlcv.get("bars", [])
            if len(bars) < 20:
                return {"buckets": [], "data_label": "vwap_approximation", "current_price": 0}

            # 计算典型价格和总成交量
            prices = []
            volumes = []
            for bar in bars:
                tp = (bar["high"] + bar["low"] + bar["close"]) / 3
                prices.append(tp)
                volumes.append(bar["volume"])

            if not prices:
                return {"buckets": [], "data_label": "vwap_approximation", "current_price": 0}

            # 建立价格桶 (50个桶)
            min_price = min(prices) * 0.98
            max_price = max(prices) * 1.02
            num_buckets = 50
            bucket_size = (max_price - min_price) / num_buckets

            weights = [0.0] * num_buckets
            total_vol = sum(volumes)

            for price, vol in zip(prices, volumes):
                idx = int((price - min_price) / bucket_size)
                idx = max(0, min(num_buckets - 1, idx))
                weights[idx] += vol / total_vol * 100

            buckets = []
            for i, w in enumerate(weights):
                bucket_price = min_price + (i + 0.5) * bucket_size
                buckets.append({
                    "price": round(bucket_price, 2),
                    "weight": round(w, 3),
                })

            current_price = bars[-1]["close"] if bars else 0
            return {
                "buckets": buckets,
                "data_label": "vwap_approximation",
                "current_price": round(current_price, 2),
            }
        except Exception:
            return {"buckets": [], "data_label": "vwap_approximation", "current_price": 0}

    async def get_smart_money(self, ticker: str) -> dict:
        """
        获取机构持仓、内部人交易、P/C 比数据
        来源: Yahoo Finance 13F 申报 + SEC Form 4
        """
        try:
            url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
            data = await self._yahoo_request(url, {"modules": "institutionOwnership,insiderTransactions"})
            result = data.get("quoteSummary", {}).get("result", [{}])[0]

            # 机构持仓变化
            inst_ownership = result.get("institutionOwnership", {}).get("ownershipList", [])
            institutions = []
            for inst in inst_ownership[:10]:
                pct_held = inst.get("pctHeld", {}).get("raw")
                pct_change = inst.get("pctChange", {}).get("raw")
                institutions.append({
                    "name": inst.get("organization", ""),
                    "pct_held": round(float(pct_held) * 100, 2) if pct_held else None,
                    "pct_change": round(float(pct_change) * 100, 2) if pct_change else None,
                    "report_date": inst.get("reportDate", {}).get("fmt", ""),
                })

            # 内部人交易
            insider_txns = result.get("insiderTransactions", {}).get("transactions", [])
            insiders = []
            for txn in insider_txns[:10]:
                start_date = txn.get("startDate", {})
                date_str = start_date.get("fmt", "") if isinstance(start_date, dict) else ""
                shares = txn.get("shares", {})
                shares_val = shares.get("raw") if isinstance(shares, dict) else None
                value = txn.get("value", {})
                value_raw = value.get("raw") if isinstance(value, dict) else None
                insiders.append({
                    "name": txn.get("filerName", ""),
                    "relation": txn.get("filerRelation", ""),
                    "transaction_type": txn.get("transactionText", ""),
                    "shares": shares_val,
                    "value": value_raw,
                    "date": date_str,
                    "ownership": txn.get("ownership", ""),
                })

            return {
                "institutions": institutions,
                "insiders": insiders,
                "source_institutions": "SEC 13F filings (quarterly)",
                "source_insiders": "SEC Form 4 filings",
            }
        except Exception:
            return {
                "institutions": [],
                "insiders": [],
                "source_institutions": "SEC 13F filings (quarterly)",
                "source_insiders": "SEC Form 4 filings",
            }

    # ================================================================
    # 6B. 财报实际 vs 隐含涨跌幅
    # ================================================================

    async def get_earnings_moves(
        self, ticker: str, lookback_quarters: int = 8
    ) -> dict:
        """
        财报事件的"实际 vs 隐含"涨跌幅面板数据。

        数据诚实性:
          - past_events[i].actual_move_pct
              100% 真实: 直接来自 Yahoo 1D OHLCV 的收盘价对。
              公式: (close_on_or_after_earnings / close_before_earnings - 1) * 100
          - past_events[i].implied_move_pct = None
              免费 Yahoo 接口不提供历史期权链，无法重建过去财报前的
              ATM straddle 价格。为避免捏造，此字段始终为 null，
              前端会显式展示"历史 implied move 不可用"。
          - current_implied_move_pct
              100% 真实: 当前 ATM 跨式 (call_mid + put_mid) / spot * 100，
              用下一次财报当天或之后的第一个到期日。若当前没有未来
              财报日，或该到期日的期权链缺失，此字段为 None。
          - 日期来源: Yahoo `events=earn` (chart v8)。这是 Yahoo 自己
              记录的"公司披露财报当日"，比 earningsHistory 里的
              fiscal quarter-end 精确。
        """
        ticker = ticker.upper().strip()

        # 1) 拉取 2 年带 earnings events 的 OHLCV (主数据源)
        timestamps: list[int] = []
        closes_raw: list = []
        earnings_events: dict = {}
        try:
            client = await self._get_client()
            url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
            resp = await client.get(
                url,
                params={"interval": "1d", "range": "2y", "events": "earn"},
                headers=YAHOO_HEADERS,
                timeout=20.0,
            )
            resp.raise_for_status()
            payload = resp.json()
            result = payload["chart"]["result"][0]
            timestamps = [int(t) for t in result.get("timestamp", [])]
            quote = result["indicators"]["quote"][0]
            closes_raw = quote.get("close", [])
            earnings_events = (
                result.get("events", {}).get("earnings", {}) or {}
            )
        except Exception:
            pass

        if not timestamps or not closes_raw:
            return {
                "ticker": ticker,
                "past_events": [],
                "next_earnings_date": None,
                "current_implied_move_pct": None,
                "current_implied_source_expiration": None,
                "avg_absolute_actual_move_pct": None,
                "data_notes": {
                    "actual_moves": "OHLCV 数据不可用",
                    "implied_moves_history": "历史期权数据需付费，不可用",
                    "current_implied_move": "暂不可用",
                },
            }

        # 2) 构建 ts → close 映射, 保留 None 以便后续跳过
        closes_by_ts: dict[int, Optional[float]] = {}
        for i, ts in enumerate(timestamps):
            c = closes_raw[i] if i < len(closes_raw) else None
            closes_by_ts[ts] = float(c) if c is not None else None
        sorted_ts: list[int] = sorted(closes_by_ts.keys())
        earliest_ts = sorted_ts[0] if sorted_ts else 0

        def _close_before(target_ts: int) -> Optional[tuple[int, float]]:
            """最近一个 < target_ts 且 close 非 None 的交易日。"""
            for ts in reversed(sorted_ts):
                if ts < target_ts and closes_by_ts.get(ts) is not None:
                    return ts, closes_by_ts[ts]  # type: ignore[return-value]
            return None

        def _nth_close_on_or_after(
            target_ts: int, offset: int = 0
        ) -> Optional[tuple[int, float]]:
            """target_ts 之后 (含当日) 第 offset+1 个 close 非 None 的交易日。"""
            found = 0
            for ts in sorted_ts:
                if ts >= target_ts and closes_by_ts.get(ts) is not None:
                    if found == offset:
                        return ts, closes_by_ts[ts]  # type: ignore[return-value]
                    found += 1
            return None

        # 3) 汇总所有可能的历史财报日期 (多源合并, 去重)
        #    来源优先级:
        #      a) Yahoo chart `events=earn`  — 精确到财报披露当日
        #      b) NASDAQ earnings-surprise   — 精确到披露当日, 覆盖更完整
        #      c) Yahoo quoteSummary earningsHistory — fiscal quarter 近似
        event_ts_set: set[int] = set()
        sources_used: list[str] = []

        # 3a) Yahoo events=earn
        if earnings_events:
            sources_used.append("yahoo_chart_events")
            for key, ev in earnings_events.items():
                try:
                    ev_ts = int(ev.get("date") or key)
                    event_ts_set.add(ev_ts)
                except (TypeError, ValueError):
                    continue

        # 3b) NASDAQ earnings-surprise API (fallback 1)
        try:
            client = await self._get_client()
            nasdaq_url = f"https://api.nasdaq.com/api/company/{ticker}/earnings-surprise"
            nasdaq_resp = await client.get(
                nasdaq_url,
                headers={
                    "User-Agent": YAHOO_HEADERS["User-Agent"],
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Origin": "https://www.nasdaq.com",
                    "Referer": "https://www.nasdaq.com/",
                },
                timeout=10.0,
            )
            if nasdaq_resp.status_code == 200:
                njs = nasdaq_resp.json()
                rows = (
                    (njs.get("data") or {})
                    .get("earningsSurpriseTable", {})
                    .get("rows", [])
                    or []
                )
                added = 0
                for row in rows:
                    date_str = row.get("dateReported") or ""
                    # NASDAQ format is "MM/DD/YYYY"
                    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
                        try:
                            dt = datetime.strptime(date_str, fmt)
                            ev_ts = int(
                                dt.replace(tzinfo=timezone.utc).timestamp()
                            )
                            if ev_ts >= earliest_ts:
                                event_ts_set.add(ev_ts)
                                added += 1
                            break
                        except ValueError:
                            continue
                if added:
                    sources_used.append("nasdaq_earnings_surprise")
        except Exception:
            pass

        # 3c) Yahoo quoteSummary earningsHistory (fallback 2, fiscal quarter-end)
        try:
            ys_url = (
                f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}"
            )
            ys_data = await self._yahoo_request(
                ys_url, {"modules": "earningsHistory"}
            )
            history = (
                ys_data.get("quoteSummary", {})
                .get("result", [{}])[0]
                .get("earningsHistory", {})
                .get("history", [])
                or []
            )
            added = 0
            for item in history:
                q = item.get("quarter", {})
                raw_ts = q.get("raw")
                if raw_ts and int(raw_ts) >= earliest_ts:
                    # Fiscal quarter end is approximate; announcement is usually
                    # 3-6 weeks later. Only use if we have no better source for
                    # this quarter (rough dedup: skip if any existing ts within
                    # ±50 days already represents this quarter).
                    q_ts = int(raw_ts)
                    SIX_WEEKS = 45 * 86400
                    if not any(abs(q_ts - e) < SIX_WEEKS for e in event_ts_set):
                        # Offset by ~30 days (typical announcement lag) so OHLCV
                        # lookup lands on real trading days post-announcement.
                        approx_announce = q_ts + 30 * 86400
                        if approx_announce <= int(datetime.now(timezone.utc).timestamp()):
                            event_ts_set.add(approx_announce)
                            added += 1
            if added:
                sources_used.append("yahoo_earnings_history")
        except Exception:
            pass

        # 4) 解析过去的财报事件, 计算真实涨跌幅
        past_events: list[dict] = []
        event_items = sorted(event_ts_set, reverse=True)

        now_ts = int(datetime.now(timezone.utc).timestamp())
        moves_abs: list[float] = []
        seen_dates: set[str] = set()
        for ev_ts in event_items[: lookback_quarters * 3]:  # over-fetch, dedup below
            if ev_ts > now_ts:
                continue  # 未来事件放在 next_earnings_date 里处理
            before = _close_before(ev_ts)
            # 不知道是 BMO (盘前) 还是 AMC (盘后), 两种窗口都算,
            # 取绝对值较大者作为"财报反应"的真实 move。
            # - BMO: 反应在当日 → close(D-1) vs close(D)
            # - AMC: 反应在次日 → close(D) vs close(D+1), 等价于 close(D-1) vs close(D+1) 包含 D 的噪声
            same_day = _nth_close_on_or_after(ev_ts, offset=0)
            next_day = _nth_close_on_or_after(ev_ts, offset=1)
            if not before or before[1] <= 0 or not same_day:
                continue
            move_same = (same_day[1] / before[1] - 1.0) * 100.0
            move_next = (
                (next_day[1] / before[1] - 1.0) * 100.0 if next_day else move_same
            )
            # 选 |move| 更大的作为 actual move
            if abs(move_next) > abs(move_same) and next_day:
                move_pct = move_next
                after_close = next_day[1]
            else:
                move_pct = move_same
                after_close = same_day[1]
            # 事件日期以"第一个交易日" (same_day) 为准, 防止重复
            event_date = datetime.utcfromtimestamp(same_day[0]).strftime("%Y-%m-%d")
            if event_date in seen_dates:
                continue
            seen_dates.add(event_date)
            past_events.append(
                {
                    "date": event_date,
                    "actual_move_pct": round(move_pct, 2),
                    "implied_move_pct": None,  # 明确不可用
                    "actual_direction": "up" if move_pct >= 0 else "down",
                    "close_before": round(before[1], 2),
                    "close_after": round(after_close, 2),
                }
            )
            moves_abs.append(abs(move_pct))
            if len(past_events) >= lookback_quarters:
                break

        avg_abs_move = (
            round(sum(moves_abs) / len(moves_abs), 2) if moves_abs else None
        )

        # 5) 下一次财报 + 当前 ATM straddle 隐含涨跌幅
        next_earnings_date = await self.get_earnings_date(ticker)
        current_implied_move_pct: Optional[float] = None
        current_implied_source_expiration: Optional[str] = None

        if next_earnings_date:
            try:
                spot_data = await self.get_spot_price(ticker)
                spot = float(spot_data["spot_price"])
                all_exps = await self.get_expirations(ticker)
                # 找到 >= 财报日的第一个到期日
                target_exp: Optional[str] = None
                for exp in all_exps:
                    if exp >= next_earnings_date:
                        target_exp = exp
                        break
                if target_exp and spot > 0:
                    chain = await self.get_options_chain(ticker, target_exp)
                    calls_df = chain.get("calls")
                    puts_df = chain.get("puts")
                    atm_call = self._get_atm_contract(calls_df, spot)
                    atm_put = self._get_atm_contract(puts_df, spot)
                    if atm_call and atm_put:
                        call_mid = float(atm_call.get("mid_price") or 0)
                        put_mid = float(atm_put.get("mid_price") or 0)
                        if call_mid > 0 and put_mid > 0:
                            implied = ((call_mid + put_mid) / spot) * 100.0
                            current_implied_move_pct = round(implied, 2)
                            current_implied_source_expiration = target_exp
            except Exception:
                # 期权链可能不可用 (非 optionable ticker), 静默退化
                pass

        return {
            "ticker": ticker,
            "past_events": past_events,
            "next_earnings_date": next_earnings_date,
            "current_implied_move_pct": current_implied_move_pct,
            "current_implied_source_expiration": current_implied_source_expiration,
            "avg_absolute_actual_move_pct": avg_abs_move,
            "data_notes": {
                "actual_moves": (
                    "Yahoo Finance 1D OHLCV · "
                    "(close_after / close_before - 1) × 100 · "
                    f"日期来源: {', '.join(sources_used) if sources_used else '无'}"
                ),
                "implied_moves_history": (
                    "历史 implied move 需付费历史期权数据，"
                    "此页面不展示以避免捏造"
                ),
                "current_implied_move": (
                    f"基于到期日 {current_implied_source_expiration} 的 "
                    "ATM 跨式 (call_mid + put_mid) / spot × 100"
                    if current_implied_source_expiration
                    else "无可用到期日或期权链"
                ),
            },
        }

    # ================================================================
    # 6C. 经销商 Gamma Exposure (GEX) by strike
    # ================================================================

    async def get_gamma_exposure(
        self, ticker: str, expiration: str
    ) -> dict:
        """
        Compute dealer gamma exposure (GEX) by strike for a single expiration.

        Data honesty:
          - strike, OI, IV, gamma: 100% 真实, 来自期权链 (Tradier/Polygon/Yahoo)
          - 若 gamma 缺失, 用 BSM 公式从 IV 反推: γ = N'(d1) / (S·σ·√T)
          - GEX 的"经销商是 call-short / put-long"假设是业内近似,
            面板上必须明确展示 (不是验证过的 dealer positioning data).

        公式 (每 1% 标的移动的 dollar gamma, 正向=call, 负向=put):
          call_gex_strike = call_gamma × call_OI × 100 × spot² × 0.01
          put_gex_strike  = -put_gamma × put_OI × 100 × spot² × 0.01
          net_gex_strike  = call_gex_strike + put_gex_strike

          total_net_gex  = Σ net_gex_strike (百万美元)
          gamma_flip     = 累积 GEX 从下往上第一次由负转正的 strike
        """
        ticker = ticker.upper().strip()
        chain = await self.get_options_chain(ticker, expiration)
        calls_df = chain.get("calls")
        puts_df = chain.get("puts")
        dte = int(chain.get("dte", 0))

        if calls_df is None or puts_df is None or len(calls_df) == 0 or len(puts_df) == 0:
            return {
                "ticker": ticker,
                "expiration": expiration,
                "dte": dte,
                "spot_price": 0.0,
                "net_gex_millions": 0.0,
                "call_gex_millions": 0.0,
                "put_gex_millions": 0.0,
                "gamma_flip_strike": None,
                "by_strike": [],
                "disclaimer": "期权链不可用",
            }

        spot_data = await self.get_spot_price(ticker)
        spot = float(spot_data.get("spot_price") or 0)
        if spot <= 0:
            return {
                "ticker": ticker,
                "expiration": expiration,
                "dte": dte,
                "spot_price": 0.0,
                "net_gex_millions": 0.0,
                "call_gex_millions": 0.0,
                "put_gex_millions": 0.0,
                "gamma_flip_strike": None,
                "by_strike": [],
                "disclaimer": "现货价格不可用",
            }

        T = max(dte, 1) / 365.0
        r = 0.045

        from scipy.stats import norm as sp_norm
        import math as _math

        def _bsm_gamma(S: float, K: float, T: float, r: float, sigma: float) -> float:
            if sigma <= 0 or T <= 0 or S <= 0 or K <= 0:
                return 0.0
            try:
                d1 = (
                    _math.log(S / K) + (r + 0.5 * sigma ** 2) * T
                ) / (sigma * _math.sqrt(T))
                return float(sp_norm.pdf(d1)) / (S * sigma * _math.sqrt(T))
            except Exception:
                return 0.0

        # Build a strike → {call_gamma, call_oi, put_gamma, put_oi, iv_c, iv_p}
        by_strike: dict[float, dict] = {}

        def _extract(row, opt_type: str) -> tuple[float, float, float]:
            """Returns (strike, gamma_eff, oi)."""
            try:
                K = float(row.get("strike") or 0)
                oi = float(row.get("open_interest") or 0)
                raw_g = row.get("gamma")
                raw_iv = row.get("implied_volatility") or 0
                iv = float(raw_iv) if raw_iv else 0.0
                if (
                    raw_g is not None
                    and not (isinstance(raw_g, float) and (_math.isnan(raw_g) or _math.isinf(raw_g)))
                    and float(raw_g) != 0.0
                ):
                    g = float(raw_g)
                else:
                    g = _bsm_gamma(spot, K, T, r, iv)
                return K, g, oi
            except Exception:
                return 0.0, 0.0, 0.0

        for _, row in calls_df.iterrows():
            K, g, oi = _extract(row, "call")
            if K <= 0 or oi <= 0:
                continue
            entry = by_strike.setdefault(
                K,
                {"call_gamma": 0.0, "call_oi": 0.0, "put_gamma": 0.0, "put_oi": 0.0},
            )
            entry["call_gamma"] = g
            entry["call_oi"] = oi

        for _, row in puts_df.iterrows():
            K, g, oi = _extract(row, "put")
            if K <= 0 or oi <= 0:
                continue
            entry = by_strike.setdefault(
                K,
                {"call_gamma": 0.0, "call_oi": 0.0, "put_gamma": 0.0, "put_oi": 0.0},
            )
            entry["put_gamma"] = g
            entry["put_oi"] = oi

        if not by_strike:
            return {
                "ticker": ticker,
                "expiration": expiration,
                "dte": dte,
                "spot_price": round(spot, 2),
                "net_gex_millions": 0.0,
                "call_gex_millions": 0.0,
                "put_gex_millions": 0.0,
                "gamma_flip_strike": None,
                "by_strike": [],
                "disclaimer": "期权链中无有效 gamma × OI 数据",
            }

        # Scale: dollar gamma per 1% underlying move, then convert to millions.
        # call_gex = γ × OI × 100 (shares/contract) × S² × 0.01
        SHARES_PER_CONTRACT = 100.0
        scale = SHARES_PER_CONTRACT * (spot ** 2) * 0.01 / 1_000_000.0

        rows: list[dict] = []
        for K in sorted(by_strike.keys()):
            e = by_strike[K]
            call_gex = e["call_gamma"] * e["call_oi"] * scale
            put_gex = -e["put_gamma"] * e["put_oi"] * scale  # dealer short put → negative GEX
            net_gex = call_gex + put_gex
            rows.append(
                {
                    "strike": round(K, 2),
                    "call_gex_millions": round(call_gex, 3),
                    "put_gex_millions": round(put_gex, 3),
                    "net_gex_millions": round(net_gex, 3),
                    "call_oi": int(e["call_oi"]),
                    "put_oi": int(e["put_oi"]),
                }
            )

        total_call = sum(r["call_gex_millions"] for r in rows)
        total_put = sum(r["put_gex_millions"] for r in rows)
        total_net = total_call + total_put

        # Gamma flip: lowest strike where cumulative GEX from bottom crosses 0 going positive
        gamma_flip_strike: Optional[float] = None
        cumulative = 0.0
        prev_cum = 0.0
        for r in rows:
            cumulative += r["net_gex_millions"]
            if prev_cum <= 0 and cumulative > 0:
                gamma_flip_strike = r["strike"]
                break
            prev_cum = cumulative

        return {
            "ticker": ticker,
            "expiration": expiration,
            "dte": dte,
            "spot_price": round(spot, 2),
            "net_gex_millions": round(total_net, 2),
            "call_gex_millions": round(total_call, 2),
            "put_gex_millions": round(total_put, 2),
            "gamma_flip_strike": gamma_flip_strike,
            "by_strike": rows,
            "disclaimer": (
                "GEX 基于业内惯例: 假设经销商净空 calls, 净多 puts。"
                "实际 dealer positioning 不公开, 这是估算，不要当作精确值。"
            ),
        }

    # ================================================================
    # 7. 聚合接口：获取完整市场数据
    # ================================================================

    async def get_full_market_data(self, ticker: str) -> dict:
        """
        一次性获取 Ticker 的所有市场数据
        用于 GET /api/market-data/{ticker}
        """
        ticker = ticker.upper().strip()

        # 并行获取各项数据
        spot_data = await self.get_spot_price(ticker)
        hv_data = await self.get_historical_volatility(ticker)
        iv_data = await self.get_iv_metrics(ticker)
        earnings = await self.get_earnings_date(ticker)
        expirations = await self.get_expirations(ticker)

        # Prefer the HV that get_iv_metrics computed alongside the real HV rank
        # (same price series); fall back to the standalone HV reading.
        hv_30 = iv_data.get("hv_30") or hv_data.get("hv_30", 0.0)

        return {
            "ticker": ticker,
            "spot_price": spot_data["spot_price"],
            "change_pct": spot_data["change_pct"],
            "iv_current": iv_data["iv_current"],
            "iv_rank": iv_data["iv_rank"],
            "iv_percentile": iv_data["iv_percentile"],
            "hv_30": hv_30,
            "hv_rank": iv_data.get("hv_rank", 50.0),
            "hv_percentile": iv_data.get("hv_percentile", 50.0),
            "iv_rank_source": iv_data.get("iv_rank_source", "insufficient_data"),
            "iv_history_days": iv_data.get("iv_history_days", 0),
            "next_earnings_date": earnings,
            "expirations": expirations,
            "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
