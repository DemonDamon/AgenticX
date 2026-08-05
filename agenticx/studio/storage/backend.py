#!/usr/bin/env python3
"""Session/state storage backend protocol for AgenticX Studio (HA foundation).

The protocol is the single seam through which session truth (messages,
agent context, tail snapshots), runtime agent state, automation tasks and
MCP connection state are persisted. The default ``LocalFileBackend`` keeps
today's single-node behavior byte-identical; ``RedisSessionStorage`` makes
the same state shareable across replicas.

A future ``AsyncSQLBackend`` (PostgreSQL) hangs off the same protocol —
``load_agent_state`` / ``save_agent_state`` are its primary extension point.
Trigger condition: see the parent roadmap plan's "Re-evaluation triggers"
section (``.cursor/plans/pending/2026-08-04-agenticx-ha-roadmap.plan.md``).
Not implemented in this change.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Protocol, TypeVar, runtime_checkable

logger = logging.getLogger(__name__)

_T = TypeVar("_T")


@runtime_checkable
class SessionStorageBackend(Protocol):
    """Async storage contract for session-scoped and process-shared state.

    Load methods never raise for absent/corrupt data: they return ``None``
    or an empty collection, matching the tolerant semantics of the legacy
    file-based readers. Write methods must be atomic (local: temp file +
    ``os.replace``; redis: single ``SET`` command).
    """

    async def load_messages(self, session_id: str) -> list[dict]: ...

    async def save_messages(self, session_id: str, messages: list[dict]) -> None: ...

    async def load_agent_messages(self, session_id: str) -> list[dict]: ...

    async def save_agent_messages(self, session_id: str, messages: list[dict]) -> None: ...

    async def load_messages_tail(self, session_id: str) -> dict | None: ...

    async def save_messages_tail(self, session_id: str, tail: dict) -> None: ...

    async def load_agent_state(self, session_id: str) -> dict | None: ...

    async def save_agent_state(self, session_id: str, state: dict) -> None: ...

    async def delete_session(self, session_id: str) -> None: ...

    async def load_automation_tasks(self) -> list[dict]: ...

    async def save_automation_tasks(self, tasks: list[dict]) -> None: ...

    async def load_mcp_state(self) -> dict: ...

    async def save_mcp_state(self, state: dict) -> None: ...

    async def ping(self) -> bool: ...


class SyncStorageFacade:
    """Synchronous facade over a ``SessionStorageBackend``.

    Legacy call sites (``SessionManager`` persistence, automation task IO,
    MCP state) are synchronous and run both inside and outside event loops.
    Dispatch rules:

    - backends exposing ``<name>_sync`` (e.g. ``LocalFileBackend``) are
      called directly — byte-identical to pre-abstraction behavior;
    - backends exposing ``run_sync`` (e.g. ``RedisSessionStorage``) execute
      the coroutine on the backend's dedicated event-loop thread, so sync
      callers work with or without a running event loop;
    - any other backend is driven via ``asyncio.run`` when no loop is
      running; inside a running loop the call cannot block, so a warning is
      logged and the empty fallback is returned (documented limitation for
      future backends).
    """

    def __init__(self, backend: SessionStorageBackend) -> None:
        self._backend = backend

    @property
    def backend(self) -> SessionStorageBackend:
        return self._backend

    def _blocking(
        self,
        coro_factory: "Callable[[], Any]",
        *,
        empty: _T,
    ) -> _T:
        run_sync = getattr(self._backend, "run_sync", None)
        if callable(run_sync):
            try:
                return run_sync(coro_factory())
            except Exception:
                logger.warning(
                    "sync storage call failed (backend=%s)",
                    type(self._backend).__name__,
                    exc_info=True,
                )
                return empty
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._awaitable(coro_factory))
        logger.warning(
            "storage backend %s cannot serve sync call inside a running loop; "
            "returning empty fallback",
            type(self._backend).__name__,
        )
        return empty

    @staticmethod
    async def _awaitable(coro_factory: "Callable[[], Any]") -> Any:
        return await coro_factory()

    # ── Session messages ──

    def load_messages(self, session_id: str) -> list[dict]:
        fn = getattr(self._backend, "load_messages_sync", None)
        if callable(fn):
            return fn(session_id)
        return self._blocking(lambda: self._backend.load_messages(session_id), empty=[])

    def save_messages(self, session_id: str, messages: list[dict]) -> None:
        fn = getattr(self._backend, "save_messages_sync", None)
        if callable(fn):
            fn(session_id, messages)
            return
        self._blocking(lambda: self._backend.save_messages(session_id, messages), empty=None)

    def load_agent_messages(self, session_id: str) -> list[dict]:
        fn = getattr(self._backend, "load_agent_messages_sync", None)
        if callable(fn):
            return fn(session_id)
        return self._blocking(lambda: self._backend.load_agent_messages(session_id), empty=[])

    def save_agent_messages(self, session_id: str, messages: list[dict]) -> None:
        fn = getattr(self._backend, "save_agent_messages_sync", None)
        if callable(fn):
            fn(session_id, messages)
            return
        self._blocking(lambda: self._backend.save_agent_messages(session_id, messages), empty=None)

    def load_messages_tail(self, session_id: str) -> dict | None:
        fn = getattr(self._backend, "load_messages_tail_sync", None)
        if callable(fn):
            return fn(session_id)
        return self._blocking(lambda: self._backend.load_messages_tail(session_id), empty=None)

    def save_messages_tail(self, session_id: str, tail: dict) -> None:
        fn = getattr(self._backend, "save_messages_tail_sync", None)
        if callable(fn):
            fn(session_id, tail)
            return
        self._blocking(lambda: self._backend.save_messages_tail(session_id, tail), empty=None)

    def load_agent_state(self, session_id: str) -> dict | None:
        fn = getattr(self._backend, "load_agent_state_sync", None)
        if callable(fn):
            return fn(session_id)
        return self._blocking(lambda: self._backend.load_agent_state(session_id), empty=None)

    def save_agent_state(self, session_id: str, state: dict) -> None:
        fn = getattr(self._backend, "save_agent_state_sync", None)
        if callable(fn):
            fn(session_id, state)
            return
        self._blocking(lambda: self._backend.save_agent_state(session_id, state), empty=None)

    def delete_session(self, session_id: str) -> bool:
        """Delete session-scoped state. Returns True when nothing remains."""
        fn = getattr(self._backend, "delete_session_sync", None)
        if callable(fn):
            return bool(fn(session_id))
        self._blocking(lambda: self._backend.delete_session(session_id), empty=None)
        return True

    # ── Process-shared state ──

    def load_automation_tasks(self) -> list[dict]:
        fn = getattr(self._backend, "load_automation_tasks_sync", None)
        if callable(fn):
            return fn()
        return self._blocking(lambda: self._backend.load_automation_tasks(), empty=[])

    def save_automation_tasks(self, tasks: list[dict]) -> None:
        fn = getattr(self._backend, "save_automation_tasks_sync", None)
        if callable(fn):
            fn(tasks)
            return
        self._blocking(lambda: self._backend.save_automation_tasks(tasks), empty=None)

    def load_mcp_state(self) -> dict:
        fn = getattr(self._backend, "load_mcp_state_sync", None)
        if callable(fn):
            return fn()
        return self._blocking(lambda: self._backend.load_mcp_state(), empty={})

    def save_mcp_state(self, state: dict) -> None:
        fn = getattr(self._backend, "save_mcp_state_sync", None)
        if callable(fn):
            fn(state)
            return
        self._blocking(lambda: self._backend.save_mcp_state(state), empty=None)
