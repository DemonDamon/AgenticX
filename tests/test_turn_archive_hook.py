#!/usr/bin/env python3
"""Tests for TurnArchiveHook.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from agenticx.runtime.hooks.turn_archive_hook import TurnArchiveHook


class _FakeSession:
    session_id = "sess-hook"
    bound_avatar_id = "avatar-1"
    chat_history = [
        {"role": "user", "content": "Please explain the ruflo compaction bridge in detail"},
        {"role": "assistant", "content": "It archives each turn before context compaction happens"},
    ]


def test_turn_archive_hook_disabled_does_not_archive() -> None:
    hook = TurnArchiveHook(enabled=False)
    with patch("agenticx.runtime.hooks.turn_archive_hook.asyncio.create_task") as create_task:
        asyncio.run(hook.on_agent_end("done", _FakeSession()))
        create_task.assert_not_called()


def test_turn_archive_hook_enabled_schedules_archive() -> None:
    hook = TurnArchiveHook(enabled=True)
    with patch("agenticx.runtime.hooks.turn_archive_hook.asyncio.create_task") as create_task:
        asyncio.run(hook.on_agent_end("done", _FakeSession()))
        create_task.assert_called_once()


def test_turn_archive_hook_on_compaction_sets_boost_flag() -> None:
    hook = TurnArchiveHook(enabled=True)
    session = SimpleNamespace()
    asyncio.run(hook.on_compaction(5, "summary", session))
    assert getattr(session, "_recall_boost_pending", False) is True
