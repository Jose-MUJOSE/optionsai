"""Tests for backend.services.llm_schemas — LLM output extraction + validation.

These tests encode the exact failure modes that previously shipped bugs:
  - fenced JSON stripped to an empty string ("UNDEFINED / /10" PM badge)
  - missing `stance` crashing React on `stance.charAt(0)`
  - prose around the JSON object confusing brace clipping
"""
import pytest

from backend.services.llm_schemas import (
    ManagerOutput,
    RebuttalOutput,
    ResearcherOutput,
    extract_json,
    parse_validated,
)


# ------------------------------------------------------------------
# extract_json
# ------------------------------------------------------------------

class TestExtractJson:
    def test_bare_object(self):
        assert extract_json('{"a": 1, "b": "x"}') == {"a": 1, "b": "x"}

    def test_fenced_json(self):
        text = '```json\n{"stance": "bullish", "confidence": 8}\n```'
        assert extract_json(text) == {"stance": "bullish", "confidence": 8}

    def test_fenced_no_language_tag(self):
        text = '```\n{"a": 1}\n```'
        assert extract_json(text) == {"a": 1}

    def test_prose_preamble_and_suffix(self):
        text = 'Here is my answer: {"decision": "buy"} — hope this helps!'
        assert extract_json(text) == {"decision": "buy"}

    def test_braces_in_trailing_prose(self):
        # rfind("}") clipping would grab the prose brace and fail; the
        # balanced scanner must stop at the real object end.
        text = 'Answer: {"a": 1} and note that {curly braces} can appear later'
        assert extract_json(text) == {"a": 1}

    def test_braces_inside_string_values(self):
        text = '{"note": "uses {placeholders} inside", "n": 2}'
        assert extract_json(text) == {"note": "uses {placeholders} inside", "n": 2}

    def test_trailing_comma_repaired(self):
        text = '{"a": 1, "b": [1, 2,],}'
        assert extract_json(text) == {"a": 1, "b": [1, 2]}

    def test_nested_objects(self):
        text = '{"synthesis": {"quant": "ok", "risk": "warn"}, "conviction": 7}'
        parsed = extract_json(text)
        assert parsed["synthesis"]["risk"] == "warn"

    def test_empty_and_garbage(self):
        assert extract_json("") is None
        assert extract_json("no json here at all") is None
        assert extract_json("{broken: json,,,") is None

    def test_json_array_rejected(self):
        # We require an object, not a bare array.
        assert extract_json("[1, 2, 3]") is None

    def test_unicode_chinese(self):
        text = '```json\n{"headline": "建议买入看涨期权", "stance": "bullish"}\n```'
        assert extract_json(text)["headline"] == "建议买入看涨期权"


# ------------------------------------------------------------------
# ResearcherOutput
# ------------------------------------------------------------------

class TestResearcherOutput:
    def test_happy_path(self):
        out = parse_validated(
            '{"stance": "bullish", "confidence": 8, "headline": "h",'
            ' "key_points": ["a", "b"], "evidence": "e", "risks": "r"}',
            ResearcherOutput,
        )
        assert out["stance"] == "bullish"
        assert out["confidence"] == 8
        assert out["key_points"] == ["a", "b"]

    def test_stance_case_and_whitespace_coerced(self):
        out = parse_validated('{"stance": " BULLISH "}', ResearcherOutput)
        assert out["stance"] == "bullish"

    def test_invalid_stance_coerced_to_neutral(self):
        out = parse_validated('{"stance": "long"}', ResearcherOutput)
        assert out["stance"] == "neutral"

    def test_confidence_string_coerced(self):
        out = parse_validated('{"confidence": "8"}', ResearcherOutput)
        assert out["confidence"] == 8

    def test_confidence_clamped(self):
        assert parse_validated('{"confidence": 15}', ResearcherOutput)["confidence"] == 10
        assert parse_validated('{"confidence": -3}', ResearcherOutput)["confidence"] == 1
        assert parse_validated('{"confidence": "high"}', ResearcherOutput)["confidence"] == 5

    def test_missing_fields_get_defaults(self):
        out = parse_validated("{}", ResearcherOutput)
        assert out["stance"] == "neutral"
        assert out["confidence"] == 5
        assert out["key_points"] == []

    def test_key_points_string_wrapped(self):
        out = parse_validated('{"key_points": "single point"}', ResearcherOutput)
        assert out["key_points"] == ["single point"]

    def test_key_points_filters_nulls(self):
        out = parse_validated('{"key_points": ["a", null, "", "b"]}', ResearcherOutput)
        assert out["key_points"] == ["a", "b"]

    def test_extra_fields_preserved(self):
        out = parse_validated('{"stance": "bearish", "custom_metric": 1.5}', ResearcherOutput)
        assert out["custom_metric"] == 1.5

    def test_unparsable_returns_none(self):
        assert parse_validated("total garbage", ResearcherOutput) is None


# ------------------------------------------------------------------
# ManagerOutput — decision/conviction are hard requirements
# ------------------------------------------------------------------

class TestManagerOutput:
    def test_happy_path_with_extras(self):
        out = parse_validated(
            '{"decision": "BUY", "conviction": 7, "thesis": "t",'
            ' "option_legs": [{"type": "call", "side": "buy", "strike": 100}],'
            ' "underlying_price": 99.5}',
            ManagerOutput,
        )
        assert out["decision"] == "BUY"
        assert out["conviction"] == 7
        # Mode-specific extras must round-trip for the payoff chart.
        assert out["option_legs"][0]["strike"] == 100
        assert out["underlying_price"] == 99.5

    def test_missing_decision_fails(self):
        assert parse_validated('{"conviction": 7}', ManagerOutput) is None

    def test_empty_decision_fails(self):
        assert parse_validated('{"decision": "", "conviction": 7}', ManagerOutput) is None

    def test_missing_conviction_fails(self):
        assert parse_validated('{"decision": "buy"}', ManagerOutput) is None

    def test_conviction_string_coerced_and_clamped(self):
        out = parse_validated('{"decision": "hold", "conviction": "12"}', ManagerOutput)
        assert out["conviction"] == 10

    def test_null_optional_fields_defaulted(self):
        out = parse_validated(
            '{"decision": "sell", "conviction": 6, "thesis": null,'
            ' "key_catalysts": null, "synthesis": null}',
            ManagerOutput,
        )
        assert out["thesis"] == ""
        assert out["key_catalysts"] == []
        assert out["synthesis"] == {}

    def test_fenced_manager_response(self):
        # The exact bug from commit 71b7212: fenced PM JSON parsed to {}.
        text = '```json\n{"decision": "BUY", "conviction": 8, "thesis": "ok"}\n```'
        out = parse_validated(text, ManagerOutput)
        assert out is not None
        assert out["decision"] == "BUY"


# ------------------------------------------------------------------
# RebuttalOutput
# ------------------------------------------------------------------

class TestRebuttalOutput:
    def test_happy_path(self):
        out = parse_validated(
            '{"rebuttal": "r", "reinforced_evidence": "e", "concession": "c"}',
            RebuttalOutput,
        )
        assert out == {"rebuttal": "r", "reinforced_evidence": "e", "concession": "c"}

    def test_partial_fills_defaults(self):
        out = parse_validated('{"rebuttal": "only this"}', RebuttalOutput)
        assert out["reinforced_evidence"] == ""
        assert out["concession"] == ""

    def test_null_coerced(self):
        out = parse_validated('{"rebuttal": null}', RebuttalOutput)
        assert out["rebuttal"] == ""
