#!/usr/bin/env python3
"""Confirmation gate abstractions for runtime adapters.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

_log = logging.getLogger(__name__)

_VALID_TIMEOUT_ACTIONS = frozenset({"approve", "reject", "skip"})
CONFIRM_RISK_LOW = "low"
PROTECTED_CONFIRM_RISKS = frozenset(
    {"high", "destructive", "computer_use", "non_whitelisted", "policy"}
)


def normalize_confirm_risk(context: Optional[Dict[str, Any]] = None) -> str:
    """Normalize risk for auto-confirm decisions.

    Only an explicit ``risk=low`` is eligible for automatic approval. Missing,
    unknown, or misspelled values are intentionally treated as protected so a
    newly added tool cannot silently bypass confirmation.
    """

    raw_risk = (context or {}).get("risk")
    if isinstance(raw_risk, str) and raw_risk.strip().lower() == CONFIRM_RISK_LOW:
        return CONFIRM_RISK_LOW
    return "protected"


def is_protected_confirm(context: Optional[Dict[str, Any]] = None) -> bool:
    """Return whether a confirmation must not be auto-approved."""

    return normalize_confirm_risk(context) != CONFIRM_RISK_LOW


#: 为什么这一步会被拦下来。自动模式下弹出确认时，用户的第一反应是「我不是开了全自动
#: 吗，这个怎么还问我」——不给出理由，他下次就会把整个功能关掉。
PROTECTED_CONFIRM_REASONS: Dict[str, str] = {
    "high": "这条操作被标记为高风险",
    "destructive": "这条操作会删除或覆盖已有内容",
    "computer_use": "这条操作会读取或控制本机桌面",
    "non_whitelisted": "这条命令不在默认可直接执行的白名单里",
    "policy": "这条操作会改动技能或长期记忆等配置",
}
UNKNOWN_PROTECTED_CONFIRM_REASON = "系统无法判定这步的风险，按受保护处理"


def protected_confirm_reason(context: Optional[Dict[str, Any]] = None) -> str:
    """One line explaining why a request cannot be auto-approved.

    Unknown/missing risks intentionally get a reason too: fail-closed means new
    tools land here by default, and "no explanation" is exactly what makes an
    unexplained prompt feel like a bug.
    """

    if not is_protected_confirm(context):
        return ""
    raw = (context or {}).get("risk")
    key = raw.strip().lower() if isinstance(raw, str) else ""
    return PROTECTED_CONFIRM_REASONS.get(key, UNKNOWN_PROTECTED_CONFIRM_REASON)


def confirm_denial_note(gate: Any, request_id: str) -> str:
    """Why a confirmation came back denied.

    「用户拒绝了」和「无人值守下策略直接拦下」对使用者是两件事：前者他自己按的，
    后者他根本没在场。工具结果里一律写 user denied，会让人回头去找一个不存在的点击。
    """

    last = getattr(gate, "last_request", None)
    if isinstance(last, dict) and last.get("id") == request_id:
        if last.get("decision") == "blocked_unattended":
            return "无人值守运行不批准受保护操作"
    timeout_info = getattr(gate, "last_timeout_info", None)
    if (
        isinstance(timeout_info, dict)
        and timeout_info.get("request_id") == request_id
        and not timeout_info.get("approved")
    ):
        return "等待确认超时"
    return "用户拒绝"


def _resolve_confirm_timeout_seconds() -> float:
    """Read confirm timeout from env AGX_CONFIRM_TIMEOUT_SEC, default 120."""
    raw = os.environ.get("AGX_CONFIRM_TIMEOUT_SEC", "").strip()
    if raw:
        try:
            val = float(raw)
            if val > 0:
                return val
        except ValueError:
            pass
    return 120.0


class ConfirmGate(ABC):
    """Abstract confirmation gate used by runtime/tools."""

    @abstractmethod
    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        """Request user confirmation and return approval."""

    def should_emit_prompt(self, context: Optional[Dict[str, Any]] = None) -> bool:
        """Whether the caller should publish a user-facing confirmation event."""

        return False

    def is_service_mode(self) -> bool:
        """Whether this gate is driven by an HTTP/SSE service adapter."""

        return False

    def resolve(self, request_id: str, approved: bool) -> bool:
        """Resolve a pending confirmation when supported by the gate."""

        return False


class SyncConfirmGate(ConfirmGate):
    """CLI gate backed by blocking input()."""

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        answer = input(f"{question} [y/N] ").strip().lower()
        return answer in {"y", "yes", "是"}


class AsyncConfirmGate(ConfirmGate):
    """Async gate for service adapters (SSE + HTTP callback).

    Supports configurable timeout so long-running tasks do not hang
    indefinitely when the user does not respond.
    """

    def __init__(
        self,
        timeout_seconds: Optional[float] = None,
        timeout_action: str = "reject",
    ) -> None:
        self._pending: Dict[str, asyncio.Future[bool]] = {}
        self.last_request: Optional[Dict[str, Any]] = None
        self.last_timeout_info: Optional[Dict[str, Any]] = None

        action = timeout_action.strip().lower()
        if action not in _VALID_TIMEOUT_ACTIONS:
            raise ValueError(
                f"timeout_action must be one of {sorted(_VALID_TIMEOUT_ACTIONS)}, got {timeout_action!r}"
            )
        self.timeout_action = action
        self.timeout_seconds = (
            timeout_seconds if timeout_seconds is not None and timeout_seconds > 0
            else _resolve_confirm_timeout_seconds()
        )

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        payload = dict(context or {})
        request_id = str(payload.get("request_id") or uuid.uuid4())
        payload["request_id"] = request_id
        loop = asyncio.get_running_loop()
        future: asyncio.Future[bool] = loop.create_future()
        self._pending[request_id] = future
        self.last_request = {
            "id": request_id,
            "question": question,
            "context": payload,
        }
        try:
            return await asyncio.wait_for(future, timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            effective_action = (
                "reject" if is_protected_confirm(payload) else self.timeout_action
            )
            approved = effective_action == "approve"
            self.last_timeout_info = {
                "request_id": request_id,
                "question": question,
                "action_taken": effective_action,
                "configured_action": self.timeout_action,
                "approved": approved,
                "timeout_seconds": self.timeout_seconds,
            }
            _log.warning(
                "Confirm gate timed out after %.1fs for request %s, action=%s",
                self.timeout_seconds,
                request_id,
                effective_action,
            )
            if not future.done():
                future.cancel()
            return approved
        finally:
            self._pending.pop(request_id, None)

    def resolve(self, request_id: str, approved: bool) -> bool:
        """Resolve one pending confirmation request."""
        fut = self._pending.get(request_id)
        if fut is None or fut.done():
            return False
        fut.set_result(bool(approved))
        return True

    def should_emit_prompt(self, context: Optional[Dict[str, Any]] = None) -> bool:
        return True

    def is_service_mode(self) -> bool:
        return True


class RiskAwareAutoConfirmGate(ConfirmGate):
    """Auto-approve explicit low-risk requests while protecting everything else.

    Interactive callers may supply a managed delegate so protected requests are
    surfaced to the user. Unattended callers deliberately reject protected
    requests immediately instead of creating a pending future that can hang an
    automation indefinitely.
    """

    def __init__(
        self,
        delegate: Optional[ConfirmGate] = None,
        *,
        unattended: bool = False,
    ) -> None:
        self.delegate = delegate
        self.unattended = bool(unattended)
        self._pending = getattr(delegate, "_pending", {})
        self.last_request: Optional[Dict[str, Any]] = None

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        payload = dict(context or {})
        if not is_protected_confirm(payload):
            self.last_request = None
            return True

        request_id = str(payload.get("request_id") or uuid.uuid4())
        payload["request_id"] = request_id
        self.last_request = {
            "id": request_id,
            "question": question,
            "context": payload,
        }
        if self.unattended or self.delegate is None:
            self.last_request["decision"] = "blocked_unattended"
            return False

        approved = await self.delegate.request_confirm(question, payload)
        self.last_request = getattr(self.delegate, "last_request", None)
        return approved

    def should_emit_prompt(self, context: Optional[Dict[str, Any]] = None) -> bool:
        return (
            not self.unattended
            and self.delegate is not None
            and is_protected_confirm(context)
            and self.delegate.should_emit_prompt(context)
        )

    def is_service_mode(self) -> bool:
        return True

    def resolve(self, request_id: str, approved: bool) -> bool:
        if self.delegate is None:
            return False
        return self.delegate.resolve(request_id, approved)


class AutoApproveConfirmGate(ConfirmGate):
    """Legacy unconditional gate.

    Production unattended paths must use :class:`RiskAwareAutoConfirmGate`.
    This class remains for backwards compatibility with external integrations.
    """

    def __init__(self) -> None:
        self._pending: Dict[str, asyncio.Future[bool]] = {}
        self.last_request: Optional[Dict[str, Any]] = None

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        self.last_request = None
        return True
