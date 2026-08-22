"""Bundled session-memory hook.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from agenticx.hooks.types import HookEvent
from agenticx.utils.workspace_dir import resolve_workspace_dir


async def handle(event: HookEvent) -> bool | None:
    if event.type != "command" or event.action not in {"new", "reset"}:
        return True

    # 兜底不再直接用 cwd：调用方没给工作区时，落点也该由 AGENTICX_WORKSPACE_DIR
    # 决定，而不是"谁启动的进程就写到谁那儿"。
    workspace_dir = resolve_workspace_dir(event.context.get("workspace_dir"))
    memory_dir = workspace_dir / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    file_name = f"{now.strftime('%Y-%m-%d')}-{event.action}.md"
    output = memory_dir / file_name
    lines = [
        f"# Session snapshot ({event.action})",
        "",
        f"- timestamp: {now.isoformat()}",
        f"- agent_id: {event.agent_id}",
        f"- session_key: {event.session_key}",
        "",
    ]
    output.write_text("\n".join(lines), encoding="utf-8")
    return True

