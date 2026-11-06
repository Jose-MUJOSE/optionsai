import asyncio

import httpx
import pytest

from backend.services.data_fetcher import DataFetcher
from backend.services import config_store


def yahoo_quote(meta, closes, status=200):
    async def run():
        fetcher = DataFetcher()
        fetcher._http_client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(
            status, json={"chart": {"result": [{"meta": meta, "indicators": {"quote": [{"close": closes}]}}]}})))
        try:
            return await fetcher._yahoo_spot_price("AAPL")
        finally:
            await fetcher.close()
    return asyncio.run(run())


def test_daily_change_uses_previous_session_not_range_start():
    quote = yahoo_quote({"regularMarketPrice": 110, "chartPreviousClose": 80}, [85, 90, 100, 110])
    assert quote["prev_close"] == 100
    assert quote["change_pct"] == 10


def test_explicit_previous_close_has_priority():
    quote = yahoo_quote({"regularMarketPrice": 110, "previousClose": 100, "chartPreviousClose": 80}, [85, 90, 110])
    assert quote["change_pct"] == 10


@pytest.mark.parametrize("status,meta,closes", [(429, {}, []), (200, {}, []), (200, {"regularMarketPrice": 0}, [None])])
def test_failed_quotes_never_become_zero_dollar_prices(status, meta, closes):
    with pytest.raises(ValueError, match="Quote unavailable"):
        yahoo_quote(meta, closes, status)


def test_provider_selection_reads_current_config(monkeypatch):
    monkeypatch.setattr(config_store, "_config", dict(config_store._DEFAULT_CONFIG, polygon_api_key="test-only"))
    fetcher = DataFetcher()
    assert fetcher._polygon_api_key == ""
    config_store._config["data_provider"] = "polygon"
    assert fetcher._polygon_api_key == "test-only"


def test_polygon_daily_change_is_close_to_close(monkeypatch):
    monkeypatch.setattr(config_store, "_config", dict(config_store._DEFAULT_CONFIG, data_provider="polygon", polygon_api_key="test-only"))
    def respond(request):
        assert "/range/1/day/" in request.url.path
        assert request.url.params["sort"] == "desc"
        return httpx.Response(200, json={"results": [{"c": 110, "o": 105}, {"c": 100, "o": 90}]})
    async def run():
        fetcher = DataFetcher()
        fetcher._http_client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        try:
            return await fetcher._polygon_spot_price("AAPL")
        finally:
            await fetcher.close()
    quote = asyncio.run(run())
    assert quote["change_pct"] == 10
    assert quote["prev_close"] == 100
