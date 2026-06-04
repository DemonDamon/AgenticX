#!/usr/bin/env python3
"""JSON parsing helpers for memory graph LLM extraction.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from typing import Any

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _norm_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def coerce_to_response_model(data: Any, response_model: Any) -> Any:
    """Rename aliased keys so a third-party LLM dict satisfies a Graphiti pydantic model.

    Weaker models often shorten field names (e.g. ``extracted_entities`` -> ``entities``).
    For every required field missing from ``data`` we look for a normalized exact match
    first, then a containment match, and rename the offending key in place.
    """
    if not isinstance(data, dict) or response_model is None:
        return data
    fields = getattr(response_model, "model_fields", None)
    if not isinstance(fields, dict):
        return data

    result = dict(data)
    for name, field in fields.items():
        if name in result:
            continue
        try:
            required = field.is_required()
        except Exception:
            required = True
        if not required:
            continue

        target = _norm_key(name)
        candidates = [k for k in result if k not in fields]

        match = next((k for k in candidates if _norm_key(k) == target), None)
        if match is None:
            match = next(
                (k for k in candidates if target and (target in _norm_key(k) or _norm_key(k) in target)),
                None,
            )
        if match is not None:
            result[name] = result.pop(match)
    return result


def provider_supports_json_response_format(provider_name: str, base_url: str | None) -> bool:
    """Only official OpenAI chat.completions reliably honor response_format=json_object."""
    provider = (provider_name or "").strip().lower()
    if provider != "openai":
        return False
    if not base_url:
        return True
    return "api.openai.com" in base_url.lower()


def parse_llm_json(text: str) -> dict[str, Any]:
    """Parse structured extraction output from LLM text (plain JSON or fenced)."""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("LLM returned empty response; expected a JSON object")

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fence = _JSON_FENCE_RE.search(raw)
    if fence:
        inner = fence.group(1).strip()
        parsed = json.loads(inner)
        if isinstance(parsed, dict):
            return parsed

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        parsed = json.loads(raw[start : end + 1])
        if isinstance(parsed, dict):
            return parsed

    raise json.JSONDecodeError("No JSON object found in LLM response", raw, 0)
