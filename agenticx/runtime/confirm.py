#!/usr/bin/env python3
"""Confirmation gate abstractions for runtime adapters.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


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
    """Async gate for service adapters (SSE + HTTP callback)."""

    def __init__(self) -> None:
        self._pending: Dict[str, asyncio.Future[bool]] = {}
        self.last_request: Optional[Dict[str, Any]] = None

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
            return await future
        finally:
            self._pending.pop(request_id, None)

    def resolve(self, request_id: str, approved: bool) -> bool:
        """Resolve one pending confirmation request."""
        fut = self._pending.get(request_id)
        if fut is None or fut.done():
            return False
        fut.set_result(bool(approved))
        return True
