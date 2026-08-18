#!/usr/bin/env python3
"""Classify LLM provider failures and record session-scoped hard denylist.

Maps Claude Code-style billing/auth hard failures to per-session provider
blacklisting so Meta does not keep spawning subagents on the same dead route.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import re
from typing import TYPE_CHECKING, Any, Dict, Iterator, Literal, Optional, Set

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession

FaultKind = Literal[
    "billing",
    "auth",
    "rate_limit",
    "tool_unavailable",
    "context_window",
    "transient",
    "unknown",
]

_ENTERPRISE_TOKEN_QUOTA_KINDS = {"token_day", "token_week", "monthly"}


def _iter_exception_chain(exc: BaseException) -> Iterator[BaseException]:
    """Yield an exception and its explicit/implicit causes without looping."""
    seen: Set[int] = set()
    current: Optional[BaseException] = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def _iter_json_values(text: str) -> Iterator[Any]:
    """Decode complete JSON values embedded in an SDK exception message."""
    decoder = json.JSONDecoder()
    cursor = 0
    while cursor < len(text):
        start = text.find("{", cursor)
        if start < 0:
            return
        try:
            value, consumed = decoder.raw_decode(text[start:])
        except (TypeError, ValueError, json.JSONDecodeError):
            cursor = start + 1
            continue
        yield value
        cursor = start + max(consumed, 1)


def _structured_error_candidates(exc: BaseException) -> Iterator[Any]:
    """Read structured provider errors before falling back to embedded JSON."""
    for current in _iter_exception_chain(exc):
        response = getattr(current, "response", None)
        if response is not None:
            json_method = getattr(response, "json", None)
            if callable(json_method):
                try:
                    yield json_method()
                except Exception:
                    pass
            for attr in ("text", "content"):
                raw = getattr(response, attr, None)
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                if isinstance(raw, str):
                    yield from _iter_json_values(raw)
        for attr in ("body", "error"):
            raw = getattr(current, attr, None)
            if isinstance(raw, (dict, list)):
                yield raw
            elif isinstance(raw, str):
                yield from _iter_json_values(raw)
        yield from _iter_json_values(str(current))


def enterprise_token_quota_error(exc: BaseException) -> Optional[Dict[str, Any]]:
    """Extract the Gateway's typed day/week/month token-quota response.

    Ordinary provider 429s deliberately return ``None`` so callers retain the
    existing generic rate-limit behaviour.  This function relies on the typed
    ``error.kind`` contract rather than guessing from prose.
    """
    for candidate in _structured_error_candidates(exc):
        if not isinstance(candidate, dict):
            continue
        nested = candidate.get("error")
        error = nested if isinstance(nested, dict) else candidate
        kind = str(error.get("kind") or "").strip()
        if kind not in _ENTERPRISE_TOKEN_QUOTA_KINDS:
            continue
        result: Dict[str, Any] = {"kind": kind}
        for source_key, target_key in (
            ("message", "message"),
            ("period", "period"),
            ("resetAt", "reset_at"),
            ("used", "used"),
            ("limit", "limit"),
        ):
            value = error.get(source_key)
            if value not in (None, ""):
                result[target_key] = value
        return result
    return None


def provider_fault_escalation_enabled() -> bool:
    """When false, do not mutate session provider denylist from LLM errors."""
    raw = str(os.getenv("AGX_PROVIDER_FAULT_ESCALATION", "1") or "").strip().lower()
    return raw not in {"0", "false", "off", "no"}


def _norm_provider(name: str) -> str:
    return str(name or "").strip().lower()


def is_model_param_compat_error(exc: BaseException) -> bool:
    """True when the vendor rejected sampling/tool params for this SKU.

    Typical case: gpt-5 reasoning models reject temperature!=1
    (LiteLLM UnsupportedParamsError). Safe to retry on a different model.
    """
    text = f"{type(exc).__name__} {exc}".lower()
    return (
        "unsupportedparamserror" in text
        or "unsupported params" in text
        or "don't support temperature" in text
        or "does not support temperature" in text
        or "only temperature=1" in text
        or "invalid chat setting" in text
        or "invalid params" in text
    )


def classify_provider_fault(exc: BaseException) -> FaultKind:
    """Best-effort classification from exception message and common SDK patterns."""
    text = f"{type(exc).__name__} {exc}".lower()
    if "accountoverdue" in text or "overdue balance" in text or "欠费" in text:
        return "billing"
    if "payment_required" in text or "402" in text:
        return "billing"
    if re.search(r"\b403\b", text) and (
        "forbidden" in text
        or "invalid" in text and "key" in text
        or "auth" in text
        or "sigv4" in text
        or "signature" in text
    ):
        if "overdue" in text or "billing" in text or "balance" in text:
            return "billing"
        return "auth"
    if re.search(r"\b401\b", text) or "unauthorized" in text or "invalid api key" in text:
        return "auth"
    if "429" in text or "rate limit" in text or "too many requests" in text:
        return "rate_limit"
    if (
        "contextwindowexceeded" in text
        or "context window" in text
        or "maximum context length" in text
        or "context length exceeded" in text
    ):
        return "context_window"
    if "tool" in text and ("not found" in text or "unavailable" in text):
        return "tool_unavailable"
    if "timeout" in text or "timed out" in text or "connection reset" in text:
        return "transient"
    return "unknown"


def _session_deny_set(session: "StudioSession") -> Set[str]:
    """Return the session's mutable deny set (StudioSession dataclass field)."""
    return session.provider_hard_failure_providers


def record_session_provider_hard_failure(
    session: Optional["StudioSession"],
    provider_name: str,
    *,
    fault: FaultKind,
) -> None:
    """Record provider on session when fault is billing or auth (hard block)."""
    if session is None or not provider_fault_escalation_enabled():
        return
    if fault not in {"billing", "auth"}:
        return
    key = _norm_provider(provider_name)
    if not key:
        return
    _session_deny_set(session).add(key)


def is_provider_session_blocked(session: Optional["StudioSession"], provider_name: str) -> bool:
    if session is None:
        return False
    key = _norm_provider(provider_name)
    if not key:
        return False
    return key in _session_deny_set(session)


def human_hint_for_fault(fault: FaultKind) -> str:
    if fault == "billing":
        return "计费/欠费或账户不可用：请充值或更换其他已配置 Provider，勿在同一 Provider 上重复 spawn。"
    if fault == "auth":
        return "鉴权失败：请检查 API Key / Base URL / 组织权限后更换 Provider 再试。"
    if fault == "rate_limit":
        return "触发限流：请降低并发或等待窗口重置后再试。"
    if fault == "context_window":
        return (
            "精简模式仍超出当前模型上下文。请换更大窗口模型（如 glm-4-9b-chat-1m），"
            "或新建会话后再试。"
        )
    return "请检查网络与模型配置后重试。"
