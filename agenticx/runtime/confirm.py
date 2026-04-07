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
        timeout_action: str = "approve",
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
            approved = self.timeout_action == "approve"
            self.last_timeout_info = {
                "request_id": request_id,
                "question": question,
                "action_taken": self.timeout_action,
                "approved": approved,
                "timeout_seconds": self.timeout_seconds,
            }
            _log.warning(
                "Confirm gate timed out after %.1fs for request %s, action=%s",
                self.timeout_seconds,
                request_id,
                self.timeout_action,
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


class AutoApproveConfirmGate(ConfirmGate):
    """Always approve confirmation requests (best for autonomous sub-agents)."""

    def __init__(self) -> None:
        self._pending: Dict[str, asyncio.Future[bool]] = {}
        self.last_request: Optional[Dict[str, Any]] = None

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        self.last_request = None
        return True
