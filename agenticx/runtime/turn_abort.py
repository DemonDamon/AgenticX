#!/usr/bin/env python3
"""Turn abort vs durable job cancel — two independent cancel scopes.

Chat / SSE stop signals **turn abort** only: in-flight turn-scoped tools
(near_browser, MCP, bash, …) may be cancelled. Durable jobs created via
``create_durable_job`` (or bridged automation durable rows) keep running
until an explicit ``cancel_durable_job`` / ``DurableJobStore.control(cancel)``.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from agenticx.runtime.durable_jobs.access import get_durable_job_store
from agenticx.runtime.durable_jobs.models import DurableJob, JobStatus
from agenticx.runtime.durable_jobs.store import DurableJobStore


class TurnAbortHandle:
    """Turn-scoped abort flag (independent of durable job control)."""

    def __init__(self) -> None:
        self._event = asyncio.Event()

    def abort(self) -> None:
        """Signal that the current chat turn should stop."""
        self._event.set()

    def clear(self) -> None:
        """Reset for a new turn."""
        self._event.clear()

    def is_aborted(self) -> bool:
        return self._event.is_set()

    @property
    def event(self) -> asyncio.Event:
        return self._event


async def cancel_turn_scoped_dispatch(dispatch_task: asyncio.Task[Any]) -> None:
    """Cancel an in-flight turn-scoped tool task.

    This is **turn abort only**. It must never call
    ``DurableJobStore.control(..., action=\"cancel\")``. Durable jobs survive
    chat stop; use :func:`cancel_durable_job` for those.
    """
    if dispatch_task.done():
        return
    dispatch_task.cancel()
    try:
        await dispatch_task
    except asyncio.CancelledError:
        pass


def abort_chat_turn(
    manager: Any,
    session_id: str,
    *,
    durable_store: Any = None,
) -> Dict[str, Any]:
    """Abort the current chat turn only.

    Calls ``manager.request_interrupt(session_id)`` so AgentRuntime's
    ``should_stop`` cancels turn-scoped tool waits. Even when
    ``durable_store`` is passed, this function **never** cancels durable jobs.

    Returns:
        Payload with ``scope=\"turn\"`` and ``durable_jobs_cancelled=False``.
    """
    _ = durable_store  # intentionally unused — turn abort ≠ durable cancel
    sid = str(session_id or "").strip()
    if not sid:
        return {
            "ok": False,
            "error": "session_id is required",
            "scope": "turn",
            "durable_jobs_cancelled": False,
        }
    request = getattr(manager, "request_interrupt", None)
    if not callable(request):
        return {
            "ok": False,
            "error": "manager.request_interrupt unavailable",
            "scope": "turn",
            "durable_jobs_cancelled": False,
        }
    request(sid)
    return {
        "ok": True,
        "session_id": sid,
        "scope": "turn",
        "durable_jobs_cancelled": False,
    }


def create_durable_job(
    *,
    owner: str,
    kind: str,
    payload: Optional[Dict[str, Any]] = None,
    store: Optional[DurableJobStore] = None,
    job_id: Optional[str] = None,
) -> DurableJob:
    """Enqueue a durable job that survives chat/turn stop."""
    target = store if store is not None else get_durable_job_store()
    return target.create(
        owner=owner,
        kind=kind,
        payload=payload,
        job_id=job_id,
        status=JobStatus.QUEUED,
    )


def cancel_durable_job(
    job_id: str,
    *,
    store: Optional[DurableJobStore] = None,
) -> Dict[str, Any]:
    """Explicitly cancel a durable job via store.control(cancel).

    This is the only supported path to cancel durable background work from
    chat tools. Chat stop / turn abort must not call this.
    """
    jid = str(job_id or "").strip()
    if not jid:
        return {"ok": False, "error": "job_id is required"}
    target = store if store is not None else get_durable_job_store()
    ok = target.control(jid, action="cancel")
    job = target.get(jid)
    status = job.status.value if job is not None else None
    if not ok:
        return {
            "ok": False,
            "job_id": jid,
            "status": status,
            "error": "cancel failed (missing or already terminal)",
        }
    return {
        "ok": True,
        "job_id": jid,
        "status": status or JobStatus.CANCELLED.value,
    }
