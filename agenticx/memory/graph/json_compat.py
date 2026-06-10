#!/usr/bin/env python3
"""JSON parsing helpers for memory graph LLM extraction.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from typing import Any, get_args, get_origin

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)

_ENTITY_ITEM_KEYS = frozenset({"name", "entity", "entity_name", "entity_type_id", "entity_type"})
_ENTITY_NAME_KEYS = ("name", "entity_name", "entity")
_EDGE_ITEM_KEYS = frozenset(
    {
        "source_entity_name",
        "target_entity_name",
        "relation_type",
        "fact",
        "source",
        "target",
        "relationship",
        "relation",
    }
)

# Explicit list-field aliases when fuzzy key matching fails (e.g. bailian/qwen uses ``facts``).
_EXPLICIT_LIST_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "edges": ("facts", "extracted_facts", "relationships", "relations", "extracted_edges"),
}


def _norm_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def _normalize_entity_name_field(item: dict[str, Any]) -> dict[str, Any]:
    """Map ``entity`` / ``entity_name`` string values onto Graphiti's ``name`` field."""
    if "name" in item:
        return item
    normalized = dict(item)
    for key in ("entity_name", "entity"):
        value = normalized.get(key)
        if isinstance(value, str) and value.strip():
            normalized["name"] = value.strip()
            if key != "name":
                normalized.pop(key, None)
            break
    return normalized


def _normalize_edge_item(item: dict[str, Any]) -> dict[str, Any]:
    """Map common edge field aliases onto Graphiti's Edge schema."""
    normalized = dict(item)
    if "source_entity_name" not in normalized:
        for key in ("source", "source_name", "from_entity", "from"):
            value = normalized.get(key)
            if isinstance(value, str) and value.strip():
                normalized["source_entity_name"] = value.strip()
                if key != "source_entity_name":
                    normalized.pop(key, None)
                break
    if "target_entity_name" not in normalized:
        for key in ("target", "target_name", "to_entity", "to"):
            value = normalized.get(key)
            if isinstance(value, str) and value.strip():
                normalized["target_entity_name"] = value.strip()
                if key != "target_entity_name":
                    normalized.pop(key, None)
                break
    if "relation_type" not in normalized:
        for key in ("relationship", "relation", "type"):
            value = normalized.get(key)
            if isinstance(value, str) and value.strip():
                normalized["relation_type"] = value.strip()
                if key != "relation_type":
                    normalized.pop(key, None)
                break
    return normalized


def _normalize_item_for_model(item: dict[str, Any], inner_model: Any) -> dict[str, Any]:
    fields = getattr(inner_model, "model_fields", None) or {}
    if "source_entity_name" in fields:
        return _normalize_edge_item(item)
    if "name" in fields:
        return _normalize_entity_name_field(item)
    return item


def _list_inner_model(field: Any) -> Any | None:
    ann = getattr(field, "annotation", None)
    origin = get_origin(ann)
    if origin not in (list,):
        return None
    args = get_args(ann)
    if not args:
        return None
    inner = args[0]
    if isinstance(inner, type):
        return inner
    return None


def _coerce_item_dict(item: Any, inner_model: Any) -> Any:
    if not isinstance(item, dict):
        return item
    item = _normalize_item_for_model(item, inner_model)
    return coerce_to_response_model(item, inner_model)


def _looks_like_entity_item(data: dict[str, Any]) -> bool:
    keys = set(data.keys())
    if not keys:
        return False
    if keys & set(_ENTITY_NAME_KEYS):
        return True
    return bool(keys & _ENTITY_ITEM_KEYS) and len(keys) <= 4


def _looks_like_edge_item(data: dict[str, Any]) -> bool:
    keys = set(data.keys())
    if not keys:
        return False
    if "source_entity_name" in keys and "target_entity_name" in keys:
        return True
    if {"source", "target"} <= keys:
        return True
    return bool(keys & _EDGE_ITEM_KEYS) and "fact" in keys


def _looks_like_inner_item(data: dict[str, Any], inner_model: Any | None = None) -> bool:
    if _looks_like_entity_item(data) or _looks_like_edge_item(data):
        return True
    if inner_model is None:
        return False
    fields = getattr(inner_model, "model_fields", None)
    if not isinstance(fields, dict):
        return False
    required = []
    for name, field in fields.items():
        try:
            if field.is_required():
                required.append(name)
        except Exception:
            required.append(name)
    if not required:
        return False
    present = sum(1 for name in required if name in data)
    return present >= max(1, len(required) // 2)


def _wrap_list_field(data: dict[str, Any], list_field: str, inner_model: Any) -> dict[str, Any]:
    wrapped_item = _coerce_item_dict(data, inner_model)
    return {list_field: [wrapped_item]}


def _normalize_list_values(result: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(result)
    for name, field in fields.items():
        if name not in normalized:
            continue
        inner = _list_inner_model(field)
        value = normalized[name]
        if inner and isinstance(value, list):
            normalized[name] = [_coerce_item_dict(item, inner) for item in value]
    return normalized


def _wrap_top_level_list(data: list[Any], fields: dict[str, Any]) -> dict[str, Any] | None:
    if not data or not all(isinstance(item, dict) for item in data):
        return None
    for name, field in fields.items():
        inner = _list_inner_model(field)
        if inner is None:
            continue
        try:
            required = field.is_required()
        except Exception:
            required = True
        if not required:
            continue
        return {name: [_coerce_item_dict(item, inner) for item in data]}
    return None


def coerce_to_response_model(data: Any, response_model: Any) -> Any:
    """Rename aliased keys so a third-party LLM dict satisfies a Graphiti pydantic model.

    Weaker models often shorten field names (e.g. ``extracted_entities`` -> ``entities``),
    return a bare entity/edge object instead of the wrapper, or use alternate field names.
    We normalize those shapes before Graphiti validates the payload.
    """
    if response_model is None:
        return data

    fields = getattr(response_model, "model_fields", None)
    if not isinstance(fields, dict):
        return data

    if isinstance(data, list):
        wrapped = _wrap_top_level_list(data, fields)
        if wrapped is None:
            return data
        data = wrapped

    if not isinstance(data, dict):
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
        if match is None:
            for alias in _EXPLICIT_LIST_FIELD_ALIASES.get(name, ()):
                if alias in result:
                    match = alias
                    break
        if match is not None:
            result[name] = result.pop(match)

    for name, field in fields.items():
        if name in result:
            continue
        inner = _list_inner_model(field)
        if inner is None:
            continue
        try:
            required = field.is_required()
        except Exception:
            required = True
        if not required:
            continue
        extra_keys = [k for k in result if k not in fields]
        if extra_keys and not _looks_like_inner_item(result, inner):
            continue
        result = _wrap_list_field(result, name, inner)
        break

    return _normalize_list_values(result, fields)


def provider_supports_json_response_format(provider_name: str, base_url: str | None) -> bool:
    """Providers that accept OpenAI-style response_format=json_object on chat.completions."""
    provider = (provider_name or "").strip().lower()
    base = (base_url or "").lower()
    if provider == "openai":
        if not base_url:
            return True
        return "api.openai.com" in base
    if provider in {"bailian", "dashscope", "aliyun"}:
        return True
    if "dashscope.aliyuncs.com" in base:
        return True
    return False


def provider_requires_disable_thinking(provider_name: str, base_url: str | None, model: str) -> bool:
    """Thinking/reasoning models may return empty ``content`` and break JSON extraction."""
    provider = (provider_name or "").strip().lower()
    base = (base_url or "").lower()
    model_l = (model or "").strip().lower()
    if provider in {"bailian", "dashscope", "aliyun"} or "dashscope.aliyuncs.com" in base:
        if "qwen" in model_l or "qvq" in model_l:
            return True
    if provider == "kimi" or "moonshot" in base:
        return True
    if "thinking" in model_l or model_l.startswith(("o1", "o3", "o4")):
        return True
    return False


def memory_graph_chat_request_extras(
    provider_name: str,
    base_url: str | None,
    model: str,
) -> dict[str, Any]:
    """Provider-specific chat.completions kwargs for Graphiti extraction calls."""
    provider = (provider_name or "").strip().lower()
    base = (base_url or "").lower()
    extras: dict[str, Any] = {}
    body: dict[str, Any] = {}
    if provider_requires_disable_thinking(provider_name, base_url, model):
        extras["enable_thinking"] = False
        body["enable_thinking"] = False
    if provider == "kimi" or "moonshot" in base:
        body["thinking"] = {"type": "disabled"}
    if body:
        extras["extra_body"] = body
    return extras


def extract_chat_message_text(message: Any) -> str:
    """Collect assistant text from content and provider-specific reasoning fields."""
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    parts: list[str] = []
    if isinstance(content, str):
        stripped = content.strip()
        if stripped:
            parts.append(stripped)
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            elif isinstance(block, str) and block.strip():
                parts.append(block.strip())
    for attr in ("reasoning_content", "reasoning"):
        value = getattr(message, attr, None)
        if value is None and isinstance(message, dict):
            value = message.get(attr)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    return "\n".join(parts).strip()


def empty_payload_for_response_model(response_model: Any) -> dict[str, Any] | None:
    """Best-effort empty payload when an extractor model returns no parseable JSON."""
    if response_model is None:
        return None
    fields = getattr(response_model, "model_fields", None)
    if not isinstance(fields, dict):
        return None
    payload: dict[str, Any] = {}
    for name, field in fields.items():
        inner = _list_inner_model(field)
        if inner is not None:
            payload[name] = []
            continue
        try:
            required = field.is_required()
        except Exception:
            required = True
        if not required:
            continue
        ann = getattr(field, "annotation", None)
        if ann is str:
            payload[name] = ""
        else:
            return None
    try:
        response_model(**payload)
    except Exception:
        return None
    return payload


def _decode_first_object(text: str) -> dict[str, Any] | None:
    """Return the first standalone JSON object in ``text``.

    Weaker models often append trailing tokens after the JSON (``Extra data``),
    prefix it with prose, or stream duplicate objects. ``raw_decode`` lets us
    accept the first valid object and ignore whatever follows.
    """
    decoder = json.JSONDecoder()
    idx = 0
    length = len(text)
    while idx < length:
        brace = text.find("{", idx)
        if brace < 0:
            return None
        try:
            obj, _ = decoder.raw_decode(text, brace)
        except json.JSONDecodeError:
            idx = brace + 1
            continue
        if isinstance(obj, dict):
            return obj
        idx = brace + 1
    return None


def parse_llm_json(text: str) -> dict[str, Any]:
    """Parse structured extraction output from LLM text (plain JSON or fenced)."""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("LLM returned empty response; expected a JSON object")

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list) and parsed and all(isinstance(item, dict) for item in parsed):
            return parsed
    except json.JSONDecodeError:
        pass

    fence = _JSON_FENCE_RE.search(raw)
    if fence:
        obj = _decode_first_object(fence.group(1))
        if obj is not None:
            return obj

    obj = _decode_first_object(raw)
    if obj is not None:
        return obj

    raise json.JSONDecodeError("No JSON object found in LLM response", raw, 0)
