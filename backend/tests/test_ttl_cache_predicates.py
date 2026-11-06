"""Tests for the cache_if predicate — error-shaped results must not be pinned."""
import asyncio

import pytest

from backend.services import ttl_cache as tc
from backend.services.ttl_cache import async_ttl_cache, shared_cache


@pytest.fixture(autouse=True)
def _clean_shared_state():
    shared_cache.clear()
    tc._inflight.clear()
    yield
    shared_cache.clear()
    tc._inflight.clear()


def test_cache_if_false_skips_caching():
    calls = []

    @async_ttl_cache(3600, method=False, cache_if=lambda r: "fetch_error" not in r)
    async def fetch(t: str):
        calls.append(t)
        if len(calls) == 1:
            return {"fetch_error": "timeout"}      # failure shape -> not cached
        return {"name": "Apple Inc."}

    async def run():
        first = await fetch("AAPL")
        second = await fetch("AAPL")               # retries, doesn't serve error
        third = await fetch("AAPL")                # now served from cache
        return first, second, third

    first, second, third = asyncio.run(run())
    assert "fetch_error" in first
    assert second == third == {"name": "Apple Inc."}
    assert len(calls) == 2


def test_cache_if_empty_dict_not_pinned():
    calls = []

    @async_ttl_cache(3600, method=False, cache_if=lambda r: bool(r))
    async def fundamentals(t: str):
        calls.append(t)
        return {} if len(calls) == 1 else {"pe_ratio": 30.5}

    async def run():
        await fundamentals("NVDA")
        return await fundamentals("NVDA")

    result = asyncio.run(run())
    assert result == {"pe_ratio": 30.5}
    assert len(calls) == 2


def test_cache_if_exception_in_predicate_means_no_cache():
    calls = []

    @async_ttl_cache(3600, method=False, cache_if=lambda r: r["missing_key"])
    async def fetch(t: str):
        calls.append(t)
        return {"ok": True}

    async def run():
        await fetch("X")
        await fetch("X")

    asyncio.run(run())
    assert len(calls) == 2     # predicate raised -> treated as "don't cache"


def test_cached_wrappers_on_context_fetchers():
    """fetch_fundamental_metrics / fetch_company_profile carry the decorator."""
    from backend.services.company_profile import fetch_company_profile
    from backend.services.researcher_context import fetch_fundamental_metrics

    assert hasattr(fetch_fundamental_metrics, "_ttl")
    assert hasattr(fetch_company_profile, "_ttl")
    assert fetch_fundamental_metrics._ttl >= 1800
    assert fetch_company_profile._ttl >= 1800
