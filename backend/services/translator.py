"""
LLM-backed translator for short pieces of business prose.

Used by the company-profile endpoint to translate Yahoo Finance's English
`longBusinessSummary` into Chinese on demand. The result is cached in-memory
keyed by (text-hash, target-language) so the same ticker only pays the LLM
cost once per process lifetime.

Notes:
  - DeepSeek (the default LLM) handles EN→ZH translation cleanly. The system
    prompt is intentionally minimal: we want a faithful translation, not a
    summarization or paraphrase.
  - Falls back to returning the original text on any error — translation is
    a "nice to have" and should never break the dashboard.
"""
from __future__ import annotations

import hashlib
from typing import Literal, Optional

from backend.services import ai_assistant

Lang = Literal["zh", "en"]


# Process-wide cache. {(sha1(text)[:16], target): translated}
# Bound the size so repeated profile fetches across many tickers don't grow
# memory unboundedly. 256 entries is plenty for a single user session.
_CACHE: dict[tuple[str, Lang], str] = {}
_CACHE_MAX = 256


def _key(text: str, target: Lang) -> tuple[str, Lang]:
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
    return (h, target)


async def translate_business_summary(text: Optional[str], target: Lang) -> Optional[str]:
    """Translate a company business summary into the target language.

    Returns the original text unchanged when:
      - text is empty / None
      - target language already matches the text's likely language (heuristic)
      - the LLM call fails

    Cached per (text, target) so repeated calls for the same company are free.
    """
    if not text or not text.strip():
        return text

    # Cheap heuristic: if the text already contains a substantial run of CJK
    # characters and the target is zh, assume it's already Chinese. Symmetric
    # check for en target is unreliable (English business summaries can include
    # company names with non-ASCII characters), so we just trust the caller.
    if target == "zh":
        cjk_count = sum(1 for ch in text if "一" <= ch <= "鿿")
        if cjk_count > 30:
            return text

    cache_key = _key(text, target)
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return cached

    target_name = "Simplified Chinese" if target == "zh" else "English"
    system_prompt = (
        f"You are a professional financial translator. Translate the following "
        f"company business description into {target_name}. Preserve all proper "
        f"nouns (company names, product names, geographic names) in their "
        f"standard form. Do not add commentary. Do not summarize. Output only "
        f"the translation."
    )

    try:
        response = await ai_assistant.client.chat.completions.create(
            model=ai_assistant.MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            temperature=0.2,   # low temp — translation should be deterministic
            max_tokens=2048,
        )
        translated = (response.choices[0].message.content or "").strip()
        if not translated:
            return text
    except Exception:
        # Any LLM error — return the original. The dashboard will show English
        # to a Chinese-locale user, which is much better than crashing.
        return text

    # Bound the cache.
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[cache_key] = translated
    return translated
