#!/usr/bin/env python3
"""Resolve which composer commands are visible in one context.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agenticx.studio.command_store import CommandStore, CommandValidationError

BUILTIN_COMMANDS = (
    {
        "name": "perf",
        "description": "诊断这次对话的性能",
        "kind": "local",
        "scope": "builtin",
        "instructions": "",
    },
)

_CONTEXTS = frozenset({"meta", "avatar", "group", "room"})
_SUBJECT_CONTEXT = {"avatar": "avatar", "group": "group", "room": "room"}


def resolve_visible(
    store: CommandStore,
    *,
    context: str,
    subject_id: str = "",
    session_id: str = "",
    sessions_root: Path | None = None,
) -> list[dict[str, Any]]:
    """Return the winning command for each name in this context.

    Precedence, low to high: builtin, global, current subject, session pin.
    A group context does not load avatar files. A room context does not load
    avatar or group files. ``sessions_root`` is accepted for call-site clarity;
    pins are read from ``store.sessions_root``.
    """
    del sessions_root
    clean_context = str(context or "").strip()
    if clean_context not in _CONTEXTS:
        raise CommandValidationError("invalid context")
    by_name: dict[str, dict[str, Any]] = {}
    for item in BUILTIN_COMMANDS:
        by_name[str(item["name"])] = dict(item)
    for row in store.list_commands("global"):
        _put(by_name, row, "global")
    subject_scope = _SUBJECT_CONTEXT.get(clean_context)
    if subject_scope is not None:
        subject = str(subject_id or "").strip()
        if not subject:
            raise CommandValidationError("subject_id is required")
        for row in store.list_commands(subject_scope, subject):
            _put(by_name, row, subject_scope)
    session = str(session_id or "").strip()
    if session:
        for row in store.list_session_pins(session):
            _put(by_name, row, "session")
    locals_first = [row for row in by_name.values() if row.get("kind") == "local"]
    prompts = sorted(
        (row for row in by_name.values() if row.get("kind") != "local"),
        key=lambda row: str(row.get("name") or ""),
    )
    return locals_first + prompts


def _put(by_name: dict[str, dict[str, Any]], row: dict[str, Any], scope: str) -> None:
    name = str(row.get("name") or "").strip()
    if not name:
        return
    by_name[name] = {
        "name": name,
        "description": str(row.get("description") or ""),
        "kind": "prompt",
        "scope": scope,
        "instructions": str(row.get("instructions") or ""),
    }
