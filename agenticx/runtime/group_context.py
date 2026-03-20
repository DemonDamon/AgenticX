#!/usr/bin/env python3
"""Shared context helpers for group-chat routing.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, List


@dataclass
class GroupMessage:
    role: str
    content: str
    sender_id: str
    sender_name: str


@dataclass
class ActiveThread:
    partner_id: str
    partner_name: str
    turn_count: int
    last_topic: str


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

    def _scratchpad(self) -> dict[str, Any]:
        scratchpad = getattr(self.session, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            scratchpad = {}
            setattr(self.session, "scratchpad", scratchpad)
        return scratchpad

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

    def get_active_thread(self) -> ActiveThread | None:
        raw = self._scratchpad().get("group_active_thread")
        if not isinstance(raw, dict):
            return None
        partner_id = str(raw.get("partner_id", "") or "").strip()
        if not partner_id:
            return None
        partner_name = str(raw.get("partner_name", "") or "").strip() or partner_id
        try:
            turn_count = max(1, int(raw.get("turn_count", 1) or 1))
        except (TypeError, ValueError):
            turn_count = 1
        last_topic = str(raw.get("last_topic", "") or "").strip()
        return ActiveThread(
            partner_id=partner_id,
            partner_name=partner_name,
            turn_count=turn_count,
            last_topic=last_topic,
        )

    def set_active_thread(self, *, partner_id: str, partner_name: str, last_topic: str) -> ActiveThread:
        thread = ActiveThread(
            partner_id=str(partner_id or "").strip(),
            partner_name=str(partner_name or "").strip() or str(partner_id or "").strip(),
            turn_count=1,
            last_topic=str(last_topic or "").strip(),
        )
        self._scratchpad()["group_active_thread"] = asdict(thread)
        return thread

    def bump_active_thread(self, *, partner_id: str, partner_name: str, last_topic: str = "") -> ActiveThread:
        existing = self.get_active_thread()
        normalized_id = str(partner_id or "").strip()
        normalized_name = str(partner_name or "").strip() or normalized_id
        normalized_topic = str(last_topic or "").strip()
        if existing is None or existing.partner_id != normalized_id:
            return self.set_active_thread(
                partner_id=normalized_id,
                partner_name=normalized_name,
                last_topic=normalized_topic,
            )
        updated = ActiveThread(
            partner_id=normalized_id,
            partner_name=normalized_name,
            turn_count=max(1, existing.turn_count + 1),
            last_topic=normalized_topic or existing.last_topic,
        )
        self._scratchpad()["group_active_thread"] = asdict(updated)
        return updated

    def clear_active_thread(self) -> None:
        self._scratchpad().pop("group_active_thread", None)

    @staticmethod
    def render_members_summary(members: List[dict[str, str]]) -> str:
        if not members:
            return "(no members)"
        lines: list[str] = []
        for item in members:
            avatar_id = str(item.get("id", "") or "").strip()
            avatar_name = str(item.get("name", "") or "").strip() or avatar_id
            avatar_role = str(item.get("role", "") or "").strip() or "General Assistant"
            lines.append(f"- {avatar_name}({avatar_id}): {avatar_role}")
        return "\n".join(lines)

