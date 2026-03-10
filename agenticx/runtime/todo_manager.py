#!/usr/bin/env python3
"""Todo manager for agent-loop task tracking.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

MAX_TODO_ITEMS = 20
TODO_STATUSES = {"pending", "in_progress", "completed"}


@dataclass
class TodoItem:
    """One todo item in runtime planning list."""

    content: str
    status: str
    active_form: str

    def to_dict(self) -> Dict[str, str]:
        """Convert item to JSON-serializable dict."""
        return {
            "content": self.content,
            "status": self.status,
            "active_form": self.active_form,
        }


class TodoManager:
    """A lightweight TodoWrite state manager."""

    def __init__(self) -> None:
        self._items: List[TodoItem] = []

    @property
    def items(self) -> List[TodoItem]:
        """Return a shallow copy of todo items."""
        return list(self._items)

    def to_payload(self) -> List[Dict[str, str]]:
        """Export todo items for persistence."""
        return [item.to_dict() for item in self._items]

    def load_payload(self, items: List[Dict[str, Any]]) -> None:
        """Load todo items from persistence payload."""
        parsed = self._validate_items(items)
        self._items = parsed

    def update(self, items: List[Dict[str, Any]]) -> str:
        """Replace all items with validated list and return rendered text."""
        parsed = self._validate_items(items)
        self._items = parsed
        return self.render()

    def render(self) -> str:
        """Render todos as readable list."""
        if not self._items:
            return "No todos."
        lines: List[str] = []
        for item in self._items:
            if item.status == "completed":
                lines.append(f"[x] {item.content}")
            elif item.status == "in_progress":
                lines.append(f"[>] {item.content} <- {item.active_form}")
            else:
                lines.append(f"[ ] {item.content}")
        completed = sum(1 for item in self._items if item.status == "completed")
        lines.append(f"\n({completed}/{len(self._items)} completed)")
        return "\n".join(lines)

    def _validate_items(self, items: List[Dict[str, Any]]) -> List[TodoItem]:
        if not isinstance(items, list):
            raise ValueError("items must be a list")
        if len(items) > MAX_TODO_ITEMS:
            raise ValueError(f"max {MAX_TODO_ITEMS} todos allowed")

        parsed: List[TodoItem] = []
        in_progress_count = 0
        seen_contents = set()
        for idx, raw in enumerate(items):
            if not isinstance(raw, dict):
                raise ValueError(f"item {idx} must be an object")
            content = str(raw.get("content", "")).strip()
            status = str(raw.get("status", "")).strip().lower()
            active_form = str(raw.get("active_form", raw.get("activeForm", ""))).strip()
            if not content:
                raise ValueError(f"item {idx}: content required")
            if content in seen_contents:
                raise ValueError(f"item {idx}: duplicate content")
            seen_contents.add(content)
            if status not in TODO_STATUSES:
                raise ValueError(f"item {idx}: invalid status '{status}'")
            if not active_form:
                raise ValueError(f"item {idx}: active_form required")
            if status == "in_progress":
                in_progress_count += 1
            parsed.append(TodoItem(content=content, status=status, active_form=active_form))

        if in_progress_count > 1:
            raise ValueError("only one task can be in_progress")
        return parsed
