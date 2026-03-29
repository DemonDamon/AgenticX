#!/usr/bin/env python3
"""Session summary hook for cross-session continuity.

Author: Damon Li
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.runtime.hooks import AgentHook

_MAX_SUMMARY_CHARS = 2000
_MAX_HISTORY_MESSAGES = 12


def _is_enabled() -> bool:
    flag = os.getenv("AGX_SESSION_SUMMARY", "false").strip().lower()
    return flag in {"1", "true", "on", "yes"}


def _summary_root() -> Path:
    return Path.home() / ".agenticx" / "workspace" / "sessions"


class SessionSummaryHook(AgentHook):
    """Persist compact session summaries on agent end."""

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        if not _is_enabled():
            return
        chat_history = getattr(session, "chat_history", None) or []
        if not chat_history and not final_text:
            return
        session_id = str(
            getattr(session, "session_id", None)
            or getattr(session, "id", None)
            or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        )
        summary = self._build_summary(chat_history, final_text)
        root = _summary_root()
        root.mkdir(parents=True, exist_ok=True)
        output_path = root / f"{session_id}.md"
        output_path.write_text(summary, encoding="utf-8")

    def _build_summary(self, chat_history: list[dict], final_text: str) -> str:
        lines = [
            f"# Session Summary ({datetime.now(timezone.utc).isoformat()})",
            "",
            "## Recent Turns",
        ]
        for item in chat_history[-_MAX_HISTORY_MESSAGES:]:
            role = str(item.get("role", "unknown")).strip() or "unknown"
            content = str(item.get("content", "")).strip()
            if not content:
                continue
            snippet = " ".join(content.split())[:180]
            lines.append(f"- {role}: {snippet}")
        if final_text.strip():
            lines.extend(["", "## Final Response", final_text.strip()[:600]])
        rendered = "\n".join(lines).strip()
        if len(rendered) <= _MAX_SUMMARY_CHARS:
            return rendered + "\n"
        return rendered[:_MAX_SUMMARY_CHARS].rstrip() + "\n"
