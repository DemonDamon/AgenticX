#!/usr/bin/env python3
"""Clarification gate abstractions for runtime adapters.

The clarification gate is the human-in-the-loop primitive for *open-ended*
questions to the user (as opposed to :class:`AsyncConfirmGate` which is a
boolean permission confirmation). It blocks inside a tool call, waits for a
structured answer from the Desktop UI, and returns it as the tool result so
the agent can continue the same turn.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

_log = logging.getLogger(__name__)


def _resolve_clarify_timeout_seconds() -> float:
    """Read default clarify timeout from env ``AGX_CLARIFY_TIMEOUT_SEC``.

    Defaults to 1800s (30min) -- much longer than the 120s confirm timeout
    because clarification questions usually surface while the user is away
    from the keyboard (e.g. a long-running plan generation).
    """
    raw = os.environ.get("AGX_CLARIFY_TIMEOUT_SEC", "").strip()
    if raw:
        try:
            val = float(raw)
            if val > 0:
                return val
        except ValueError:
            pass
    return 1800.0


class ClarifyGate:
    """Abstract clarification gate used by runtime/tools."""

    async def request_clarification(
        self,
        prompt: str,
        options: Optional[List[str]] = None,
        allow_free_text: bool = True,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Request an open-ended answer from the user.

        Returns a dict with keys ``answer_text`` (str) and ``selected_options``
        (list[str]). Implementations may also return sentinel dicts:

        - ``{"__timeout__": True}`` -- no reply within the timeout window.
        - ``{"__suspended__": True}`` -- unattended/automation session, do not
          block; the agent should wrap up gracefully.
        """
        raise NotImplementedError


class AsyncClarifyGate(ClarifyGate):
    """Async gate for service adapters (SSE + HTTP callback).

    Mirrors :class:`AsyncConfirmGate` but carries a structured answer instead
    of a boolean, and never auto-approves -- an open-ended question with no
    user reply must not be silently "approved" because that would drop the
    user's actual choice.
    """

    def __init__(self, timeout_seconds: Optional[float] = None) -> None:
        self._pending: Dict[str, asyncio.Future[Dict[str, Any]]] = {}
        self.last_request: Optional[Dict[str, Any]] = None
        self.last_timeout_info: Optional[Dict[str, Any]] = None
        self.timeout_seconds = (
            timeout_seconds if timeout_seconds is not None and timeout_seconds > 0
            else _resolve_clarify_timeout_seconds()
        )

    async def request_clarification(
        self,
        prompt: str,
        options: Optional[List[str]] = None,
        allow_free_text: bool = True,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload = dict(context or {})
        request_id = str(payload.get("request_id") or uuid.uuid4())
        payload["request_id"] = request_id
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Dict[str, Any]] = loop.create_future()
        self._pending[request_id] = future
        self.last_request = {
            "id": request_id,
            "prompt": prompt,
            "options": list(options or []),
            "allow_free_text": allow_free_text,
            "context": payload,
        }
        try:
            return await asyncio.wait_for(future, timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            self.last_timeout_info = {
                "request_id": request_id,
                "prompt": prompt,
                "timeout_seconds": self.timeout_seconds,
            }
            _log.warning(
                "Clarify gate timed out after %.1fs for request %s",
                self.timeout_seconds,
                request_id,
            )
            if not future.done():
                future.cancel()
            return {"__timeout__": True}
        finally:
            self._pending.pop(request_id, None)

    def resolve(self, request_id: str, answer: Dict[str, Any]) -> bool:
        """Resolve one pending clarification request. Idempotent."""
        fut = self._pending.get(request_id)
        if fut is None or fut.done():
            return False
        fut.set_result(dict(answer))
        return True

    def has_pending(self) -> bool:
        """True if there is at least one unresolved clarification request."""
        return any(not fut.done() for fut in self._pending.values())


class AutoSuspendClarifyGate(ClarifyGate):
    """Never blocks -- used by automation/unattended sessions.

    Returns the suspended sentinel immediately so the agent can wrap up the
    turn and persist the pending question as a todo, instead of hanging
    forever (the Desktop automation runner has no UI to answer it).
    """

    def __init__(self) -> None:
        self._pending: Dict[str, asyncio.Future[Dict[str, Any]]] = {}
        self.last_request: Optional[Dict[str, Any]] = None

    async def request_clarification(
        self,
        prompt: str,
        options: Optional[List[str]] = None,
        allow_free_text: bool = True,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self.last_request = None
        return {"__suspended__": True}
