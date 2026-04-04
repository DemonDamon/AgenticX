"""Session evaluator hook: lightweight post-session analysis.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from agenticx.hooks.types import HookEvent


async def handle(event: HookEvent) -> bool | None:
    if event.type != "agent" or event.action != "stop":
        return True

    eval_dir = Path.home() / ".agenticx" / "evaluations"
    eval_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    summary = {
        "timestamp": now.isoformat(),
        "agent_id": event.agent_id,
        "session_key": event.session_key,
        "context_keys": list(event.context.keys()) if event.context else [],
    }

    filename = f"{now.strftime('%Y%m%d-%H%M%S')}-eval.json"
    (eval_dir / filename).write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return True
