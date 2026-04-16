#!/usr/bin/env python3
"""Runtime observation hook for tool call learning signals.

Captures structured observations for every tool call, including success
inference, error signals, and timing metadata.  Observations are persisted
as JSON under ``~/.agenticx/sessions/<session_id>/tool_call_observations.json``.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.runtime.hooks import AgentHook

logger = logging.getLogger("agenticx.learning")

_RESULT_PREVIEW_LEN = 200
_OBS_FILENAME = "tool_call_observations.json"

_ERROR_SIGNALS: tuple[str, ...] = (
    "error:",
    "traceback",
    "exception:",
    "failed:",
    "command not found",
    "permission denied",
    "errno",
    "filenotfounderror",
    "modulenotfounderror",
    "no such file",
    "connectionerror",
    "timeout",
)


def _learning_enabled() -> bool:
    try:
        from agenticx.learning.config import get
        return bool(get("enabled", True))
    except Exception:
        flag = os.getenv("AGX_LEARNING_ENABLED", "1").strip().lower()
        return flag in {"1", "true", "on", "yes"}


def infer_success(tool_name: str, result: str) -> bool:
    """Heuristic success detection from tool result text."""
    if not result:
        return True
    lower = result[:4000].lower()
    if any(sig in lower for sig in _ERROR_SIGNALS):
        return False
    try:
        parsed = json.loads(result)
        if isinstance(parsed, dict) and parsed.get("success") is False:
            return False
    except (json.JSONDecodeError, ValueError, TypeError):
        pass
    return True


def extract_error_signal(result: str) -> str | None:
    """Return the first matched error indicator, or ``None``."""
    if not result:
        return None
    lower = result[:4000].lower()
    for sig in _ERROR_SIGNALS:
        if sig in lower:
            return sig
    return None


def _resolve_session_dir(session: Any) -> Path | None:
    """Resolve the session's on-disk directory."""
    session_id = str(
        getattr(session, "session_id", "") or getattr(session, "id", "") or ""
    ).strip()
    if not session_id:
        return None
    return Path.home() / ".agenticx" / "sessions" / session_id


class ObservationHook(AgentHook):
    """Capture tool-call observations and persist to the session directory.

    Observation file: ``~/.agenticx/sessions/<session_id>/tool_call_observations.json``
    """

    def __init__(self) -> None:
        super().__init__()
        self._turn_index: int = 0
        self._call_start: float = 0.0

    async def before_tool_call(self, tool_name: str, arguments: dict[str, Any], session: Any) -> None:  # type: ignore[override]
        self._call_start = time.monotonic()
        return None

    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None:
        if not _learning_enabled():
            return result
        elapsed_ms = int((time.monotonic() - self._call_start) * 1000) if self._call_start else 0
        self._turn_index += 1
        success = infer_success(tool_name, result)
        observation: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "tool_name": tool_name,
            "result_summary": (result or "")[:_RESULT_PREVIEW_LEN],
            "success": success,
            "error_signal": extract_error_signal(result) if not success else None,
            "turn_index": self._turn_index,
            "elapsed_ms": elapsed_ms,
        }
        session_dir = _resolve_session_dir(session)
        if session_dir is not None:
            asyncio.create_task(self._persist(session_dir, observation))
        return result

    async def _persist(self, session_dir: Path, observation: dict[str, Any]) -> None:
        await asyncio.to_thread(self._persist_sync, session_dir, observation)

    @staticmethod
    def _persist_sync(session_dir: Path, observation: dict[str, Any]) -> None:
        try:
            obs_path = session_dir / _OBS_FILENAME
            existing: list[dict[str, Any]] = []
            if obs_path.is_file():
                try:
                    data = json.loads(obs_path.read_text(encoding="utf-8"))
                    if isinstance(data, list):
                        existing = data
                except (json.JSONDecodeError, ValueError):
                    pass
            existing.append(observation)
            session_dir.mkdir(parents=True, exist_ok=True)
            obs_path.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            logger.debug("Failed to persist observation", exc_info=True)
