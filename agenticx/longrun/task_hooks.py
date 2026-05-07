#!/usr/bin/env python3
"""Route task workspace lifecycle phases through ``HookRegistry``.

Author: Damon Li
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

_log = logging.getLogger(__name__)


def dispatch_task_workspace_event(
    phase: str,
    *,
    task_id: str,
    path: Path,
    timeout_sec: float,
    fatal: bool,
    extra_context: Dict[str, Any] | None = None,
) -> None:
    """Dispatch ``task_workspace:<phase>`` synchronously via hooks registry."""
    from agenticx.hooks.registry import dispatch_hook_event_sync

    ctx: Dict[str, Any] = {
        "phase": phase,
        "cwd": str(path),
        "workspace_path": str(path),
        "timeout_sec": timeout_sec,
    }
    if extra_context:
        ctx.update(extra_context)
    try:
        dispatch_hook_event_sync(
            hook_type="task_workspace",
            action=str(phase or "").strip(),
            context_payload=ctx,
            agent_id="longrun",
            session_key=str(task_id or ""),
            task_id=str(task_id or "") or None,
        )
    except Exception as exc:
        _log.warning(
            "task_workspace hook failed phase=%s task=%s err=%s",
            phase,
            task_id,
            exc,
        )
        if fatal:
            from agenticx.longrun.task_workspace import TaskWorkspaceHookError

            raise TaskWorkspaceHookError(f"task_workspace:{phase} failed: {exc}") from exc
