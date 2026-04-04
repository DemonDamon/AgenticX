"""Session checkpoint hook: snapshot state on session start/stop.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from agenticx.hooks.types import HookEvent


async def handle(event: HookEvent) -> bool | None:
    checkpoint_dir = Path.home() / ".agenticx" / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    payload = {
        "timestamp": now.isoformat(),
        "event_type": event.type,
        "event_action": event.action,
        "agent_id": event.agent_id,
        "session_key": event.session_key,
    }

    filename = f"{now.strftime('%Y%m%d-%H%M%S')}-{event.action}.json"
    (checkpoint_dir / filename).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return True
