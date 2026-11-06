"""
Structured LLM-output parsing and validation.

Replaces hand-rolled JSON parsing in trader_agent.py with a single,
well-tested pipeline:

    raw LLM text --> extract_json() --> Pydantic model --> safe dict

Design rules (all preserve the existing SSE contract with the frontend):
  - Extraction is best-effort: markdown fences, prose preambles/suffixes
    and trailing commas are all tolerated.
  - Validation is LENIENT for optional fields (coerce / default) but
    STRICT for fields the frontend cannot render without
    (e.g. the PM's `decision` + `conviction`).
  - Unknown extra fields are PRESERVED (`extra="allow"`) — the manager
    schema carries mode-specific fields (option_legs, entry_zone, ...)
    that must round-trip untouched.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional, Type, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ==================================================================
# JSON extraction
# ==================================================================

_FENCE_OPEN_RE = re.compile(r"```(?:json|JSON)?\s*\n?")
_FENCE_CLOSE_RE = re.compile(r"\n?\s*```\s*$")
_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def _balanced_object_span(text: str) -> Optional[tuple[int, int]]:
    """Find the first balanced top-level {...} span, string-aware.

    Unlike `find("{") .. rfind("}")`, this does not get confused by prose
    after the object that happens to contain a `}`.
    """
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return (start, i + 1)
    return None


def extract_json(text: str) -> Optional[dict]:
    """Best-effort extraction of a single JSON object from LLM output.

    Handles, in order of increasing messiness:
      1. Bare JSON object
      2. Fenced JSON  (```json ... ```)
      3. JSON embedded in prose ("Here is my answer: {...} hope it helps")
      4. Trailing commas (a common LLM artifact)

    Returns the parsed dict, or None if no valid object can be recovered.
    """
    if not text:
        return None
    cleaned = text.strip()

    # Strip markdown fences anywhere they wrap the payload.
    if "```" in cleaned:
        cleaned = _FENCE_OPEN_RE.sub("", cleaned, count=1)
        cleaned = _FENCE_CLOSE_RE.sub("", cleaned)
        cleaned = cleaned.replace("```", " ")
        cleaned = cleaned.strip()

    span = _balanced_object_span(cleaned)
    if span is None:
        return None
    candidate = cleaned[span[0]: span[1]]

    for attempt in (candidate, _TRAILING_COMMA_RE.sub(r"\1", candidate)):
        try:
            parsed = json.loads(attempt)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


# ==================================================================
# Pydantic schemas (lenient coercion, frontend-safe invariants)
# ==================================================================

_VALID_STANCES = {"bullish", "bearish", "neutral"}


def _clamp_confidence(v: Any, default: int = 5) -> int:
    try:
        return max(1, min(10, int(v)))
    except (ValueError, TypeError):
        return default


class ResearcherOutput(BaseModel):
    """One analyst's first-round output.

    All fields default-fill so a partially-valid response still renders;
    `stance` / `confidence` are coerced to frontend-safe values
    (the React grid calls `stance.charAt(0)` and renders `confidence/10`).
    """

    model_config = ConfigDict(extra="allow")

    stance: str = "neutral"
    confidence: int = 5
    headline: str = ""
    key_points: list[str] = Field(default_factory=list)
    evidence: str = ""
    risks: str = ""

    @field_validator("stance", mode="before")
    @classmethod
    def _coerce_stance(cls, v: Any) -> str:
        s = str(v).strip().lower() if v is not None else ""
        return s if s in _VALID_STANCES else "neutral"

    @field_validator("confidence", mode="before")
    @classmethod
    def _coerce_confidence(cls, v: Any) -> int:
        return _clamp_confidence(v)

    @field_validator("headline", "evidence", "risks", mode="before")
    @classmethod
    def _coerce_str(cls, v: Any) -> str:
        return "" if v is None else str(v)

    @field_validator("key_points", mode="before")
    @classmethod
    def _coerce_key_points(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            return [v] if v.strip() else []
        if isinstance(v, list):
            return [str(x) for x in v if x not in (None, "")]
        return [str(v)]


class RebuttalOutput(BaseModel):
    """One debate-phase rebuttal turn."""

    model_config = ConfigDict(extra="allow")

    rebuttal: str = ""
    reinforced_evidence: str = ""
    concession: str = ""

    @field_validator("rebuttal", "reinforced_evidence", "concession", mode="before")
    @classmethod
    def _coerce_str(cls, v: Any) -> str:
        return "" if v is None else str(v)


class ManagerOutput(BaseModel):
    """Portfolio Manager final decision.

    `decision` and `conviction` are REQUIRED — without them the frontend
    decision badge renders "UNDEFINED / /10". A response missing either
    fails validation, which triggers the caller's retry/fallback path.

    Everything else (option_legs, entry_zone, target_price, ...) is
    mode-specific and flows through untouched via extra="allow".
    """

    model_config = ConfigDict(extra="allow")

    decision: str
    conviction: int
    thesis: str = ""
    debate_summary: str = ""
    key_catalysts: list = Field(default_factory=list)
    main_risks: list = Field(default_factory=list)
    synthesis: dict = Field(default_factory=dict)
    actionable_steps: list = Field(default_factory=list)
    consensus_score: str = ""

    @field_validator("decision", mode="before")
    @classmethod
    def _require_decision(cls, v: Any) -> str:
        s = str(v).strip() if v is not None else ""
        if not s:
            raise ValueError("decision must be a non-empty string")
        return s

    @field_validator("conviction", mode="before")
    @classmethod
    def _coerce_conviction(cls, v: Any) -> int:
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError("conviction is required")
        return _clamp_confidence(v)

    @field_validator("thesis", "debate_summary", "consensus_score", mode="before")
    @classmethod
    def _coerce_str(cls, v: Any) -> str:
        return "" if v is None else str(v)

    @field_validator("key_catalysts", "main_risks", "actionable_steps", mode="before")
    @classmethod
    def _coerce_list(cls, v: Any) -> list:
        if v is None:
            return []
        if isinstance(v, list):
            return v
        return [v]

    @field_validator("synthesis", mode="before")
    @classmethod
    def _coerce_dict(cls, v: Any) -> dict:
        return v if isinstance(v, dict) else {}


# ==================================================================
# Parse + validate entry point
# ==================================================================

T = TypeVar("T", bound=BaseModel)


def parse_validated(text: str, model_cls: Type[T]) -> Optional[dict]:
    """Extract JSON from `text` and validate against `model_cls`.

    Returns the validated dict (including extra fields the schema does
    not declare), or None if extraction or validation failed — the
    caller decides whether to retry the LLM call or substitute a
    safe fallback.
    """
    raw = extract_json(text)
    if raw is None:
        return None
    try:
        model = model_cls.model_validate(raw)
    except Exception:
        return None
    return model.model_dump()
