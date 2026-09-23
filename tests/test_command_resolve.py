#!/usr/bin/env python3
"""Tests for composer command visibility.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.studio.command_resolve import resolve_visible
from agenticx.studio.command_store import CommandStore


def test_group_hides_avatar_commands(tmp_path: Path) -> None:
    store = CommandStore(tmp_path / "commands", tmp_path / "sessions")
    store.add_command(scope="avatar", subject_id="ava-1", name="avatar-only", instructions="private")
    store.add_command(scope="group", subject_id="g1", name="group-only", instructions="shared in group")
    store.add_command(scope="global", name="everyone", instructions="global")
    visible = resolve_visible(store, context="group", subject_id="g1")
    names = [item["name"] for item in visible]
    assert "avatar-only" not in names
    assert "group-only" in names
    assert "everyone" in names
    assert names[0] == "perf"


def test_session_pin_shadows_global_and_builtin_stays_if_not_shadowed(tmp_path: Path) -> None:
    store = CommandStore(tmp_path / "commands", tmp_path / "sessions")
    store.add_command(scope="global", name="summarize-pr", description="global", instructions="global text")
    store.pin_command("sess-1", scope="global", name="summarize-pr")
    pins = store.list_session_pins("sess-1")
    pins[0]["instructions"] = "pinned text"
    session_file = tmp_path / "sessions" / "sess-1" / "commands.json"
    session_file.write_text(
        '{"version":1,"commands":[{"id":"pin1","name":"summarize-pr","description":"pinned","instructions":"pinned text","created_at":"2026-09-23T00:00:00+00:00"}]}\n',
        encoding="utf-8",
    )
    visible = resolve_visible(store, context="meta", session_id="sess-1")
    by_name = {item["name"]: item for item in visible}
    assert by_name["summarize-pr"]["scope"] == "session"
    assert by_name["summarize-pr"]["instructions"] == "pinned text"
    assert by_name["perf"]["scope"] == "builtin"
    assert by_name["perf"]["kind"] == "local"


def test_disabled_builtin_is_hidden(tmp_path: Path) -> None:
    store = CommandStore(tmp_path / "commands", tmp_path / "sessions")
    store.set_builtin_enabled("perf", False)
    visible = resolve_visible(store, context="meta")
    assert "perf" not in [item["name"] for item in visible]
    store.set_builtin_enabled("perf", True)
    visible = resolve_visible(store, context="meta")
    assert "perf" in [item["name"] for item in visible]
