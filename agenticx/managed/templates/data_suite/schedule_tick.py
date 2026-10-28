"""Thin schedule tick helper for deterministic tests."""

from __future__ import annotations

from typing import Callable, TypeVar

T = TypeVar("T")


def run_scheduled(fn: Callable[[], T], *, tick_id: str) -> T:
    """Run ``fn`` once and tag result metadata when it is a dict."""
    result = fn()
    if isinstance(result, dict) and "tick_id" not in result:
        out = dict(result)
        out["tick_id"] = tick_id
        return out  # type: ignore[return-value]
    return result
