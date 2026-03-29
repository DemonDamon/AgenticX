#!/usr/bin/env python3
"""Runtime observation hook for tool call learning signals.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.runtime.hooks import AgentHook

_RESULT_PREVIEW_LEN = 200


def _learning_enabled() -> bool:
    flag = os.getenv("AGX_LEARNING_ENABLED", "false").strip().lower()
    return flag in {"1", "true", "on", "yes"}


class ObservationHook(AgentHook):
    """Capture tool-call observations and append JSONL asynchronously."""

    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None:
        if not _learning_enabled():
            return result
        observation = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "project_id": self._project_id(session),
            "session_id": str(getattr(session, "session_id", "") or getattr(session, "id", "") or ""),
            "tool_name": tool_name,
            "result_summary": (result or "")[:_RESULT_PREVIEW_LEN],
            "success": True,
        }
        asyncio.create_task(self._append_jsonl(observation))
        return result

    async def _append_jsonl(self, observation: dict[str, Any]) -> None:
        project_id = str(observation.get("project_id", "default")).strip() or "default"
        output_dir = Path.home() / ".agenticx" / "instincts" / "projects" / project_id
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / "observations.jsonl"
        payload = json.dumps(observation, ensure_ascii=False)
        await asyncio.to_thread(self._append_line, output_file, payload)

    @staticmethod
    def _append_line(path: Path, payload: str) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(payload + "\n")

    @staticmethod
    def _project_id(session: Any) -> str:
        workspace_dir = str(getattr(session, "workspace_dir", "") or "").strip()
        if not workspace_dir:
            workspace_dir = str(Path.cwd())
        digest = hashlib.sha256(workspace_dir.encode("utf-8")).hexdigest()
        return digest[:8]
