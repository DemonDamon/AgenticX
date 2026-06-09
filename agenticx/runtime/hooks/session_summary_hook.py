#!/usr/bin/env python3
"""Session summary hook for cross-session continuity.

Author: Damon Li
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from agenticx.runtime.hooks import AgentHook
from agenticx.runtime.session_summary_store import (
    is_session_summary_enabled,
    resolve_session_key,
    summary_path,
    summary_root,
)

logger = logging.getLogger(__name__)

_MAX_SUMMARY_CHARS = 2000
_MAX_HISTORY_MESSAGES = 12


class SessionSummaryHook(AgentHook):
    """Persist compact session summaries on agent end."""

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        if not is_session_summary_enabled():
            return
        chat_history = getattr(session, "chat_history", None) or []
        if not chat_history and not final_text:
            return
        session_key = resolve_session_key(session)
        if not session_key:
            logger.warning(
                "[session_summary] skip write: missing session key on agent end"
            )
            return
        summary = self._build_summary(chat_history, final_text)
        root = summary_root()
        root.mkdir(parents=True, exist_ok=True)
        output_path = summary_path(session_key)
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
