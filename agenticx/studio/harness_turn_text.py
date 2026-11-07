#!/usr/bin/env python3
"""Single assistant string for an external-harness turn.

Success keeps the adapter result text. Failure is one banner so a streamed
assistant fragment (for example an upstream 401 line) and the harness error
row cannot both land as bubbles.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from agenticx.harness.types import TurnResult

_DETAIL_LIMIT = 500


def format_external_harness_assistant_content(harness_id: str, result: TurnResult) -> str:
    """Text persisted to chat history and sent as the SSE ``final`` body."""
    body = str(result.result_text or "").strip()
    if result.ok:
        return body
    status = str(result.status or "error").strip() or "error"
    prefix = f"[harness {harness_id} turn {status}]"
    detail = body or _failure_detail(result.detail)
    if detail:
        return f"{prefix} {detail[:_DETAIL_LIMIT]}"
    return prefix


def _failure_detail(detail: Any) -> str:
    if not isinstance(detail, dict):
        return ""
    visible = str(detail.get("error_visible_text") or "").strip()
    if visible:
        return visible
    return str(detail.get("terminal_detail") or "").strip()


__all__ = ["format_external_harness_assistant_content"]
