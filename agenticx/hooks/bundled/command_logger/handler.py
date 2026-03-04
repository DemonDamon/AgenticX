"""Bundled command logger hook.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.hooks.types import HookEvent


async def handle(event: HookEvent) -> bool | None:
    if event.type != "command":
        return True

    log_dir = Path.home() / ".agenticx" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "commands.log"
    line = json.dumps(
        {
            "timestamp": event.timestamp.isoformat(),
            "action": event.action,
            "agent_id": event.agent_id,
            "session_key": event.session_key,
            "context": event.context,
        },
        ensure_ascii=False,
    )
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(f"{line}\n")
    return True

