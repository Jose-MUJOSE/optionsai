"""Tests for backend.services.ttl_cache — TTL expiry, eviction, single-flight."""
import asyncio

import pytest

from backend.services import ttl_cache as tc
from backend.services.ttl_cache import TTLCache, async_ttl_cache, shared_cache


@pytest.fixture(autouse=True)
def _clean_shared_state():
    shared_cache.clear()
    tc._inflight.clear()
    yield
    shared_cache.clear()
    tc._inflight.clear()


# ------------------------------------------------------------------
# TTLCache core
# ------------------------------------------------------------------

class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class TestTTLCache:
    def test_set_get_roundtrip(self):
        c = TTLCache()
        c.set("k", {"v": 1}, ttl=10)
        found, value = c.get("k")
        assert found and value == {"v": 1}

    def test_expiry(self):
        clock = FakeClock()
        c = TTLCache(time_func=clock)
        c.set("k", "v", ttl=30)
        clock.now += 29
        assert c.get("k") == (True, "v")
        clock.now += 2
        found, _ = c.get("k")
        assert not found

    def test_zero_ttl_not_stored(self):
        c = TTLCache()
        c.set("k", "v", ttl=0)
        assert len(c) == 0

    def test_maxsize_lru_eviction(self):
        c = TTLCache(maxsize=3)
        for i in range(3):
            c.set(f"k{i}", i, ttl=100)
        c.get("k0")               # touch k0 -> k1 becomes LRU
        c.set("k3", 3, ttl=100)   # evicts k1
        assert c.get("k0")[0]
        assert not c.get("k1")[0]
        assert c.get("k3")[0]

    def test_expired_evicted_before_lru(self):
        clock = FakeClock()
        c = TTLCache(maxsize=2, time_func=clock)
        c.set("short", 1, ttl=5)
        c.set("long", 2, ttl=100)
        clock.now += 10           # "short" now expired
        c.set("new", 3, ttl=100)  # must evict "short", not LRU "long"
        assert c.get("long")[0]
        assert c.get("new")[0]

    def test_invalidate_and_clear(self):
        c = TTLCache()
        c.set("a", 1, ttl=100)
        c.set("b", 2, ttl=100)
        c.invalidate("a")
        assert not c.get("a")[0]
        c.clear()
        assert len(c) == 0

    def test_stats(self):
        c = TTLCache()
        c.set("a", 1, ttl=100)
        c.get("a")
        c.get("missing")
        s = c.stats()
        assert s["hits"] == 1 and s["misses"] == 1
        assert s["hit_rate_pct"] == 50.0


# ------------------------------------------------------------------
# async_ttl_cache decorator
# ------------------------------------------------------------------

class TestAsyncTtlCache:
    def test_second_call_served_from_cache(self):
        calls = []

        @async_ttl_cache(60, method=False)
        async def fetch(ticker: str):
            calls.append(ticker)
            return {"price": 100}

        async def run():
            a = await fetch("AAPL")
            b = await fetch("AAPL")
            return a, b

        a, b = asyncio.run(run())
        assert a == b == {"price": 100}
        assert calls == ["AAPL"]      # upstream hit exactly once

    def test_different_args_different_entries(self):
        calls = []

        @async_ttl_cache(60, method=False)
        async def fetch(ticker: str):
            calls.append(ticker)
            return ticker

        async def run():
            await fetch("AAPL")
            await fetch("TSLA")
            await fetch("AAPL")

        asyncio.run(run())
        assert calls == ["AAPL", "TSLA"]

    def test_expiry_triggers_refetch(self):
        clock = FakeClock()
        cache = TTLCache(time_func=clock)
        calls = []

        @async_ttl_cache(30, cache=cache, method=False)
        async def fetch(t: str):
            calls.append(t)
            return t

        asyncio.run(fetch("A"))
        clock.now += 31
        asyncio.run(fetch("A"))
        assert calls == ["A", "A"]

    def test_method_instances_share_cache(self):
        calls = []

        class Fetcher:
            @async_ttl_cache(60)
            async def get(self, ticker: str):
                calls.append(ticker)
                return ticker

        async def run():
            await Fetcher().get("AAPL")
            await Fetcher().get("AAPL")   # different instance, same key

        asyncio.run(run())
        assert calls == ["AAPL"]

    def test_none_not_cached_by_default(self):
        calls = []

        @async_ttl_cache(60, method=False)
        async def fetch(t: str):
            calls.append(t)
            return None

        async def run():
            await fetch("A")
            await fetch("A")

        asyncio.run(run())
        assert calls == ["A", "A"]        # retried because None isn't cached

    def test_cache_none_opt_in(self):
        calls = []

        @async_ttl_cache(60, method=False, cache_none=True)
        async def fetch(t: str):
            calls.append(t)
            return None

        async def run():
            await fetch("A")
            await fetch("A")

        asyncio.run(run())
        assert calls == ["A"]

    def test_exception_not_cached(self):
        attempts = []

        @async_ttl_cache(60, method=False)
        async def fetch(t: str):
            attempts.append(t)
            if len(attempts) == 1:
                raise RuntimeError("upstream down")
            return "recovered"

        async def run():
            with pytest.raises(RuntimeError):
                await fetch("A")
            return await fetch("A")

        assert asyncio.run(run()) == "recovered"
        assert len(attempts) == 2

    def test_single_flight_coalesces_concurrent_calls(self):
        calls = []

        @async_ttl_cache(60, method=False)
        async def slow_fetch(t: str):
            calls.append(t)
            await asyncio.sleep(0.05)
            return {"data": t}

        async def run():
            results = await asyncio.gather(*[slow_fetch("AAPL") for _ in range(8)])
            return results

        results = asyncio.run(run())
        assert calls == ["AAPL"]          # 8 concurrent callers, 1 upstream call
        assert all(r == {"data": "AAPL"} for r in results)

    def test_single_flight_propagates_error_to_all_waiters(self):
        calls = []

        @async_ttl_cache(60, method=False)
        async def failing(t: str):
            calls.append(t)
            await asyncio.sleep(0.02)
            raise ValueError("boom")

        async def run():
            results = await asyncio.gather(
                *[failing("A") for _ in range(4)], return_exceptions=True)
            return results

        results = asyncio.run(run())
        assert calls == ["A"]
        assert all(isinstance(r, ValueError) for r in results)


# ------------------------------------------------------------------
# DataFetcher integration — cache short-circuits the upstream fetch
# ------------------------------------------------------------------

class TestDataFetcherCaching:
    def test_spot_price_cached_across_instances(self, monkeypatch):
        from backend.services.data_fetcher import DataFetcher

        calls = []

        async def fake_yahoo(self, ticker):
            calls.append(ticker)
            return {"spot_price": 123.0, "change_pct": 1.0, "prev_close": 121.8}

        monkeypatch.setattr(DataFetcher, "_yahoo_spot_price", fake_yahoo)
        monkeypatch.setattr("backend.services.data_fetcher.POLYGON_API_KEY", "")

        async def run():
            a = await DataFetcher().get_spot_price("NVDA")
            b = await DataFetcher().get_spot_price("NVDA")   # second instance
            return a, b

        a, b = asyncio.run(run())
        assert a["spot_price"] == 123.0 and b["spot_price"] == 123.0
        assert calls == ["NVDA"]          # one upstream call total

    def test_ttl_tiers_configured(self):
        from backend.services import data_fetcher as df

        assert df.TTL_SPOT <= df.TTL_CHAIN <= df.TTL_OHLCV <= df.TTL_FUNDAMENTALS
        # Spot quotes must stay fresh; fundamentals can be stale for an hour.
        assert df.TTL_SPOT <= 60
        assert df.TTL_FUNDAMENTALS >= 1800
        # Decorated entry points expose their TTL for introspection.
        assert df.DataFetcher.get_spot_price._ttl == df.TTL_SPOT
        assert df.DataFetcher.get_options_chain._ttl == df.TTL_CHAIN
