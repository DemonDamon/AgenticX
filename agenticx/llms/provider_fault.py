#!/usr/bin/env python3
"""Classify LLM provider failures and record session-scoped hard denylist.

Maps Claude Code-style billing/auth hard failures to per-session provider
blacklisting so Meta does not keep spawning subagents on the same dead route.

Author: Damon Li
"""

from __future__ import annotations

import os
import re
from typing import TYPE_CHECKING, Literal, Optional, Set

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession

FaultKind = Literal["billing", "auth", "rate_limit", "tool_unavailable", "transient", "unknown"]


def provider_fault_escalation_enabled() -> bool:
    """When false, do not mutate session provider denylist from LLM errors."""
    raw = str(os.getenv("AGX_PROVIDER_FAULT_ESCALATION", "1") or "").strip().lower()
    return raw not in {"0", "false", "off", "no"}


def _norm_provider(name: str) -> str:
    return str(name or "").strip().lower()


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
    return "请检查网络与模型配置后重试。"
