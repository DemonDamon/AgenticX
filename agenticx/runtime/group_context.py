#!/usr/bin/env python3
"""Shared context helpers for group-chat routing.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List


@dataclass
class GroupMessage:
    role: str
    content: str
    sender_id: str
    sender_name: str


class GroupChatContext:
    """Read/write normalized group-chat history on top of StudioSession."""

    def __init__(self, session: Any, *, max_items: int = 20) -> None:
        self.session = session
        self.max_items = max(1, int(max_items))

    def _history(self) -> list[dict[str, Any]]:
        history = getattr(self.session, "chat_history", None)
        if not isinstance(history, list):
            history = []
            setattr(self.session, "chat_history", history)
        return history

    def append_user(self, text: str) -> None:
        self._history().append(
            {
                "role": "user",
                "content": str(text or ""),
                "sender_id": "user",
                "sender_name": "我",
                "agent_id": "user",
            }
        )

    def append_agent(self, *, agent_id: str, agent_name: str, text: str, avatar_url: str = "") -> None:
        self._history().append(
            {
                "role": "assistant",
                "content": str(text or ""),
                "sender_id": str(agent_id or ""),
                "sender_name": str(agent_name or "") or str(agent_id or ""),
                "agent_id": str(agent_id or ""),
                "avatar_name": str(agent_name or "") or str(agent_id or ""),
                "avatar_url": str(avatar_url or ""),
            }
        )

    def recent(self) -> List[GroupMessage]:
        out: List[GroupMessage] = []
        for msg in self._history()[-self.max_items :]:
            role = str(msg.get("role", "") or "").strip() or "assistant"
            content = str(msg.get("content", "") or "")
            if not content.strip():
                continue
            sender_id = str(msg.get("sender_id", "") or "").strip()
            sender_name = str(msg.get("sender_name", "") or "").strip()
            if not sender_name:
                sender_name = "我" if role == "user" else (sender_id or "assistant")
            if not sender_id:
                sender_id = "user" if role == "user" else "assistant"
            out.append(
                GroupMessage(
                    role=role,
                    content=content,
                    sender_id=sender_id,
                    sender_name=sender_name,
                )
            )
        return out

    def render_recent_dialogue(self) -> str:
        rows = self.recent()
        if not rows:
            return "(暂无历史消息)"
        lines: list[str] = []
        for row in rows:
            prefix = "用户" if row.role == "user" else f"{row.sender_name}({row.sender_id})"
            lines.append(f"- {prefix}: {row.content}")
        return "\n".join(lines)

