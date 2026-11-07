#!/usr/bin/env python3
"""Detect CodeBuddy turns that should prompt an in-app login.

The CLI still owns Tencent / Copilot credentials. Near only recognizes a
failed turn (WebSearch 401 Authorization Required, or an error that mentions
401 / Authorization / login / apiKeySource on copilot.tencent.com) so the
desktop can open its own terminal and run ``codebuddy login``.

A session init frame that only reports ``apiKeySource`` is not a failure:
custom-local chat can succeed while tool calls still use that source.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Any, Iterable, List

from agenticx.harness.stream_json_text import parse_stream_json_object

_PROBE_LIMIT = 2000

_HARNESS_ERROR_RE = re.compile(
    r"\[harness\s+\S+\s+turn\s+(?:error|failed|exited|timeout|blocked)\]",
    re.IGNORECASE,
)

_EXPLICIT_LOGIN_PHRASES = (
    "codebuddy login",
    "please login",
    "please log in",
    "not logged in",
    "login required",
    "login failed",
    "sign in to",
    "登录已失效",
    "请重新登录",
    "请先登录",
)


def is_codebuddy_auth_failure_text(text: str) -> bool:
    """True when ``text`` itself is a CodeBuddy auth failure the user can fix by logging in."""
    raw = str(text or "")
    lowered = raw.lower()
    if not lowered.strip():
        return False
    if _is_system_init(raw) and not _has_auth_status(lowered):
        return False
    if "authorization required" in lowered and _has_auth_status(lowered):
        return True
    if "web search api request failed" in lowered and "401" in lowered:
        return True
    if "copilot.tencent.com" in lowered and _has_auth_status(lowered):
        return True
    if any(phrase in lowered or phrase in raw for phrase in _EXPLICIT_LOGIN_PHRASES):
        return True
    if (
        _is_harness_error_banner(lowered)
        and "codebuddy" in lowered
        and (_loose_401(lowered) or "login" in lowered or "apikeysource" in lowered)
    ):
        return True
    return False


def codebuddy_login_required_from_lines(
    lines: Iterable[str],
    *,
    turn_failed: bool = True,
) -> bool:
    """Scan one turn's stream-json lines.

    System init is ignored. On a failed turn, a short assistant ``401``
    line counts. On success, only an explicit auth-failure string counts.
    """
    for text in _probe_texts(list(lines)):
        if is_codebuddy_auth_failure_text(text):
            return True
        if turn_failed and _loose_401(text.lower()) and not _is_system_init(text):
            return True
    return False


def _has_auth_status(lowered: str) -> bool:
    return (
        "401" in lowered
        or "unauthorized" in lowered
        or "authorization" in lowered
        or "login" in lowered
    )


def _loose_401(lowered: str) -> bool:
    if "401" not in lowered:
        return False
    return (
        "unauthorized" in lowered
        or "authorization" in lowered
        or "login" in lowered
    )


def _is_harness_error_banner(lowered: str) -> bool:
    return _HARNESS_ERROR_RE.search(lowered) is not None


def _is_system_init(raw: str) -> bool:
    compact = re.sub(r"\s+", "", raw)
    return '"type":"system"' in compact and '"subtype":"init"' in compact


def _clip(text: str) -> str:
    return str(text or "")[:_PROBE_LIMIT]


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return _clip(content)
    if isinstance(content, dict):
        if content.get("text"):
            return _clip(str(content.get("text")))
        nested = content.get("content")
        if nested is not None and nested is not content:
            return _content_to_text(nested)
        return ""
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                piece = _content_to_text(item.get("text") or item.get("content"))
                if piece:
                    parts.append(piece)
        return _clip("".join(parts))
    return ""


def _probe_texts(lines: List[str]) -> List[str]:
    probes: List[str] = []
    for line in lines:
        obj = parse_stream_json_object(line)
        if obj is None:
            if "[harness" in line.lower():
                probes.append(_clip(line))
            continue
        kind = str(obj.get("type") or "")
        if kind == "system":
            continue
        if kind == "assistant":
            message = obj.get("message")
            if isinstance(message, dict):
                text = _content_to_text(message.get("content"))
                if text.strip():
                    probes.append(text)
            continue
        if kind == "user":
            message = obj.get("message")
            if not isinstance(message, dict):
                continue
            content = message.get("content")
            items = content if isinstance(content, list) else []
            for item in items:
                if not isinstance(item, dict) or item.get("type") != "tool_result":
                    continue
                text = _content_to_text(item.get("content"))
                if text.strip():
                    probes.append(text)
            continue
        if kind == "result":
            for key in ("error", "result", "message"):
                value = obj.get(key)
                if isinstance(value, str) and value.strip():
                    probes.append(_clip(value))
    return probes


__all__ = [
    "codebuddy_login_required_from_lines",
    "is_codebuddy_auth_failure_text",
]
