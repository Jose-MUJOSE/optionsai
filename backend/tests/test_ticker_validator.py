"""Tests for backend.services.ticker_validator — market detection + rejections."""
import pytest

from backend.services.ticker_validator import validate_us_ticker


class TestUsTickers:
    @pytest.mark.parametrize("ticker", ["AAPL", "TSLA", "SPY", "QQQ", "F", "BRK.A", "BRK.B"])
    def test_valid_us(self, ticker):
        r = validate_us_ticker(ticker)
        assert r.valid
        assert r.market == "us"
        assert r.has_options

    def test_lowercase_normalized(self):
        r = validate_us_ticker("aapl")
        assert r.valid and r.market == "us"

    def test_whitespace_stripped(self):
        assert validate_us_ticker("  NVDA  ").valid


class TestCnHkTickers:
    @pytest.mark.parametrize("ticker", ["600519.SS", "601318.SS", "000858.SZ", "300750.SZ"])
    def test_a_shares_valid_no_options(self, ticker):
        r = validate_us_ticker(ticker)
        assert r.valid
        assert r.market == "cn_a"
        assert not r.has_options

    @pytest.mark.parametrize("ticker", ["0700.HK", "9988.HK", "1810.HK"])
    def test_hk_valid_no_options(self, ticker):
        r = validate_us_ticker(ticker)
        assert r.valid
        assert r.market == "hk"
        assert not r.has_options


class TestRejections:
    def test_empty(self):
        r = validate_us_ticker("")
        assert not r.valid
        assert r.reason_en and r.reason_zh     # bilingual error required

    @pytest.mark.parametrize("ticker", ["^GSPC", "^DJI", "^IXIC"])
    def test_indices_rejected_with_etf_hint(self, ticker):
        r = validate_us_ticker(ticker)
        assert not r.valid
        assert "ETF" in r.reason_en

    @pytest.mark.parametrize("ticker", ["BTC-USD", "ETH-USD"])
    def test_crypto_rejected(self, ticker):
        assert not validate_us_ticker(ticker).valid

    @pytest.mark.parametrize("ticker", ["EURUSD=X", "ES=F"])
    def test_forex_futures_rejected(self, ticker):
        assert not validate_us_ticker(ticker).valid

    @pytest.mark.parametrize("ticker", ["VOD.L", "7203.T", "SHOP.TO", "BMW.DE", "AIR.PA"])
    def test_other_international_rejected(self, ticker):
        assert not validate_us_ticker(ticker).valid

    @pytest.mark.parametrize("ticker", ["TOOLONG1", "123ABC", "AAPL.X"])
    def test_malformed_rejected(self, ticker):
        assert not validate_us_ticker(ticker).valid

    def test_all_rejections_bilingual(self):
        for bad in ["", "BTC-USD", "EURUSD=X", "^GSPC", "VOD.L", "AAPL.X"]:
            r = validate_us_ticker(bad)
            if not r.valid:
                assert r.reason_en, f"missing EN reason for {bad!r}"
                assert r.reason_zh, f"missing ZH reason for {bad!r}"
