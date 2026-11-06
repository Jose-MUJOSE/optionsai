"""
Process-wide TTL cache with single-flight request coalescing.

Why this exists:
  - Every router holds its own DataFetcher instance, so before this module
    each panel refresh re-hit Yahoo/Polygon for identical data (spot, chain,
    fundamentals...). A 10-analyst Trader Agent run plus an open dashboard
    could issue the same request dozens of times per minute -> rate limits.
  - The cache is keyed on (function name + arguments), deliberately ignoring
    `self`, so all DataFetcher instances share one cache.

Behavior:
  - TTL per decorated function (different data types have different staleness
    budgets — spot 30s, chain 60s, fundamentals 1h, ...).
  - Single-flight: concurrent callers of the same key await ONE in-flight
    request instead of stampeding the upstream API.
  - Errors are never cached; raised exceptions propagate to every waiter.
  - `None` results are not cached by default (treated as "no data, retry
    next time"); pass cache_none=True where None is a meaningful answer.
  - Bounded size with expired-first then oldest-first eviction.
"""
from __future__ import annotations

import asyncio
import functools
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Hashable, Optional


class TTLCache:
    """Async-friendly TTL cache. Not thread-safe; designed for one event loop."""

    def __init__(
        self,
        maxsize: int = 2048,
        time_func: Callable[[], float] = time.monotonic,
    ):
        self._store: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._maxsize = maxsize
        self._time = time_func
        self.hits = 0
        self.misses = 0

    def get(self, key: Hashable) -> tuple[bool, Any]:
        """Returns (found, value). Expired entries count as misses."""
        entry = self._store.get(key)
        if entry is None:
            self.misses += 1
            return False, None
        expires_at, value = entry
        if self._time() >= expires_at:
            del self._store[key]
            self.misses += 1
            return False, None
        self._store.move_to_end(key)  # LRU touch
        self.hits += 1
        return True, value

    def set(self, key: Hashable, value: Any, ttl: float) -> None:
        if ttl <= 0:
            return
        if key in self._store:
            del self._store[key]
        elif len(self._store) >= self._maxsize:
            self._evict_one()
        self._store[key] = (self._time() + ttl, value)

    def _evict_one(self) -> None:
        now = self._time()
        # Prefer evicting an already-expired entry.
        for k, (expires_at, _) in self._store.items():
            if now >= expires_at:
                del self._store[k]
                return
        # Otherwise evict the least-recently-used (front of OrderedDict).
        self._store.popitem(last=False)

    def invalidate(self, key: Hashable) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)

    def stats(self) -> dict:
        total = self.hits + self.misses
        return {
            "entries": len(self._store),
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate_pct": round(self.hits / total * 100, 1) if total else 0.0,
        }


# Shared process-wide cache for market data.
shared_cache = TTLCache(maxsize=4096)

# In-flight single-flight futures: key -> Future
_inflight: dict[Hashable, asyncio.Future] = {}


def _make_key(func_name: str, args: tuple, kwargs: dict, skip_first: bool) -> Hashable:
    """Build a hashable cache key; `self` (first positional arg) is skipped
    for methods so every instance shares the same cache entries."""
    positional = args[1:] if skip_first else args
    return (
        func_name,
        tuple(positional),
        tuple(sorted(kwargs.items())),
    )


def async_ttl_cache(
    ttl: float,
    *,
    cache: Optional[TTLCache] = None,
    method: bool = True,
    cache_none: bool = False,
    cache_if: Optional[Callable[[Any], bool]] = None,
) -> Callable:
    """Decorator: cache an async function's result for `ttl` seconds.

    Args:
        ttl:        seconds the result stays fresh.
        cache:      TTLCache to use (defaults to the shared process cache).
        method:     True if decorating an instance method (skips `self` in key).
        cache_none: cache None results too (default: treat None as a miss so
                    transient upstream failures are retried).
        cache_if:   optional predicate on the result; return False to skip
                    caching (e.g. error-shaped fallback dicts that should be
                    retried on the next call instead of pinned for the TTL).
    """

    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        target_cache = cache if cache is not None else shared_cache
        qualname = func.__qualname__

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            key = _make_key(qualname, args, kwargs, skip_first=method)

            found, value = target_cache.get(key)
            if found:
                return value

            # Single-flight: if an identical request is already running,
            # await its result instead of issuing a duplicate upstream call.
            existing = _inflight.get(key)
            if existing is not None:
                return await asyncio.shield(existing)

            loop = asyncio.get_running_loop()
            future: asyncio.Future = loop.create_future()
            _inflight[key] = future
            try:
                result = await func(*args, **kwargs)
            except BaseException as exc:
                if not future.done():
                    future.set_exception(exc)
                    # Mark retrieved so "exception was never retrieved"
                    # warnings don't fire when there are no waiters.
                    future.exception()
                raise
            else:
                cacheable = (result is not None or cache_none)
                if cacheable and cache_if is not None:
                    try:
                        cacheable = bool(cache_if(result))
                    except Exception:
                        cacheable = False
                if cacheable:
                    target_cache.set(key, result, ttl)
                if not future.done():
                    future.set_result(result)
                return result
            finally:
                _inflight.pop(key, None)

        wrapper.__wrapped__ = func          # for tests / introspection
        wrapper._cache = target_cache       # type: ignore[attr-defined]
        wrapper._ttl = ttl                  # type: ignore[attr-defined]
        return wrapper

    return decorator
