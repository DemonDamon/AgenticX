"""Bundled session-memory hook.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from agenticx.hooks.types import HookEvent


async def handle(event: HookEvent) -> bool | None:
    if event.type != "command" or event.action not in {"new", "reset"}:
        return True

    workspace_dir = Path(event.context.get("workspace_dir", Path.cwd()))
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

