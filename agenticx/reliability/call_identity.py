#!/usr/bin/env python3
"""Canonical identity for a single tool call.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _norm(value: Any, path: str) -> Any:
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"non-finite float at {path}")
        return 0.0 if value == 0.0 else value
    if isinstance(value, dict):
        return {str(k): _norm(v, f"{path}.{k}") for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_norm(v, f"{path}[{i}]") for i, v in enumerate(value)]
    if isinstance(value, (set, frozenset)):
        items = [_norm(v, f"{path}{{}}") for v in value]
        try:
            return sorted(items)
        except TypeError:
            return sorted(items, key=repr)
    raise TypeError(f"unsupported type {type(value).__name__} at {path}")


def canonical_payload(arguments: Any) -> str:
    """Return the canonical JSON text for ``arguments``.

    Raises ValueError on NaN/Inf, TypeError on unsupported types.
    """
    return json.dumps(
        _norm(arguments, "$"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def canonical_call_key(tool_name: str, arguments: Any) -> str:
    """Return ``"<tool_name>:<sha256-of-canonical-payload>"``."""
    digest = hashlib.sha256(canonical_payload(arguments).encode("utf-8")).hexdigest()
    return f"{tool_name}:{digest}"


def _diff_maps(a: dict[str, Any], b: dict[str, Any], prefix: str) -> list[str]:
    names: list[str] = []
    keys = sorted(set(a) | set(b))
    for key in keys:
        path = f"{prefix}.{key}" if prefix else str(key)
        if key not in a or key not in b:
            names.append(path)
            continue
        left, right = a[key], b[key]
        if isinstance(left, dict) and isinstance(right, dict):
            names.extend(_diff_maps(left, right, path))
            continue
        if left != right:
            names.append(path)
    return names


def diff_canonical_fields(a: Any, b: Any) -> tuple[str, ...]:
    """Top-level + dotted nested field names whose canonical form differs.

    Used only to make ToolCallIdentityError messages actionable. Best effort:
    if either side is not a mapping, returns ``("<root>",)``.
    """
    left = _norm(a, "$")
    right = _norm(b, "$")
    if not isinstance(left, dict) or not isinstance(right, dict):
        return ("<root>",)
    return tuple(_diff_maps(left, right, ""))


def stable_call_id(
    raw_id: Any,
    *,
    tool_name: str,
    iteration: int,
    position: int,
) -> str:
    """Normalize a provider tool_call id into a non-empty stable id.

    Some providers emit empty or missing ids. Falls back to a deterministic
    synthetic id so ledger lookups never key on the empty string. The fallback
    is deterministic across a resume of the same run, which is why it uses
    (tool_name, iteration, position) rather than uuid4.

    Fallback format: ``"synth-{tool_name}-{iteration}-{position}"``.
    """
    text = str(raw_id or "").strip()
    if text:
        return text
    return f"synth-{tool_name}-{iteration}-{position}"
