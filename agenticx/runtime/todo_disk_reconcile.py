#!/usr/bin/env python3
"""Reconcile sticky todos with on-disk write evidence from tool results.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

from agenticx.runtime.stall_policy import TodoParseResult, latest_todo_from_messages

_WROTE_PATH_RE = re.compile(
    r"(?:OK:\s*(?:wrote|saved|updated)|file_write|wrote\s+(?:to\s+)?)"
    r"[`'\"]?\s*([^\s`\"'\n]+)",
    re.IGNORECASE,
)
_EXIT_OK_RE = re.compile(r"exit\s*(?:code\s*)?[:=]?\s*0\b", re.IGNORECASE)
_FILENAME_HINT_RE = re.compile(
    r"([A-Za-z0-9_./-]+\.(?:md|txt|py|json|yaml|yml|sh|ts|tsx|js|jsx))",
    re.IGNORECASE,
)


def collect_disk_write_paths(messages: list[dict[str, Any]]) -> set[str]:
    paths: set[str] = set()
    for item in messages or []:
        if str(item.get("role", "")).strip() != "tool":
            continue
        content = str(item.get("content", "") or "")
        if not content:
            continue
        for match in _WROTE_PATH_RE.finditer(content):
            raw = match.group(1).strip().rstrip(".,;)")
            if raw:
                paths.add(raw)
        tool_name = str(item.get("tool_name", item.get("toolName", "")) or "").strip()
        if tool_name == "file_write" and "ERROR" not in content[:40]:
            for token in re.findall(r"/[\w./+-]+\.[A-Za-z0-9]+", content):
                paths.add(token)
    return paths


def _filename_hints(text: str) -> list[str]:
    hints: list[str] = []
    for match in _FILENAME_HINT_RE.finditer(str(text or "")):
        token = match.group(1).strip()
        if token and token not in hints:
            hints.append(token)
    bare = Path(str(text or "").strip()).name
    if bare and bare not in hints and "." in bare:
        hints.append(bare)
    return hints


def in_progress_item_has_disk_evidence(content: str, paths: set[str]) -> bool:
    if not paths:
        return False
    normalized_paths = {p.replace("\\", "/") for p in paths}
    for hint in _filename_hints(content):
        hint_norm = hint.replace("\\", "/")
        for path in normalized_paths:
            if hint_norm in path or path.endswith(hint_norm):
                return True
            if Path(path).name == Path(hint_norm).name:
                return True
    return False


def todos_need_disk_promote(messages: list[dict[str, Any]]) -> bool:
    """True when every in_progress todo item has matching disk write evidence."""
    parsed = latest_todo_from_messages(messages)
    if parsed is None:
        return False
    in_progress = [i for i in parsed.items if i.get("status") == "in_progress"]
    if not in_progress:
        return False
    paths = collect_disk_write_paths(messages)
    if not paths:
        return False
    return all(
        in_progress_item_has_disk_evidence(str(i.get("content", "")), paths)
        for i in in_progress
    )


def reconcile_todos_with_disk(session: Any) -> Optional[str]:
    """Mark in_progress todos completed when disk evidence exists. Returns notice text."""
    messages = list(getattr(session, "chat_history", None) or [])
    if not todos_need_disk_promote(messages):
        return None
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is None:
        return "检测到任务产出已落盘，进度条将自动勾选对应项。"
    try:
        payload = list(todo_manager.to_payload())
    except Exception:
        return None
    changed = False
    for item in payload:
        if str(item.get("status", "")).strip() == "in_progress":
            item["status"] = "completed"
            changed = True
    if not changed:
        return None
    try:
        todo_manager.load_payload(payload)
    except Exception:
        return None
    return "检测到任务产出已落盘，已自动勾选进行中的 todo 项。"
