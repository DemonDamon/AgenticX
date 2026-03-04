"""Bundled agent metrics hook.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.hooks.types import HookEvent


async def handle(event: HookEvent) -> bool | None:
    metrics_dir = Path.home() / ".agenticx" / "metrics"
    metrics_dir.mkdir(parents=True, exist_ok=True)
    metrics_file = metrics_dir / "agent_metrics.jsonl"
    payload = {
        "timestamp": event.timestamp.isoformat(),
        "type": event.type,
        "action": event.action,
        "agent_id": event.agent_id,
        "task_id": event.task_id,
        "session_key": event.session_key,
    }
    with open(metrics_file, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return True

