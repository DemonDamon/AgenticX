#!/usr/bin/env python3
"""End-to-end smoke test for turn archive recall injection.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.hooks.turn_archive_hook import TurnArchiveHook
from agenticx.runtime.prompts.meta_agent import _build_memory_recall_context


class _Session(SimpleNamespace):
    pass


def test_e2e_archive_then_recall_in_system_prompt(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGX_TURN_ARCHIVE_ENABLED", "1")
    db_path = tmp_path / "main.sqlite"

    session = _Session(
        session_id="sess-e2e",
        bound_avatar_id="",
        chat_history=[
            {"role": "user", "content": "Explain the ruflo turn archive design"},
            {"role": "assistant", "content": "Archive each user-assistant pair into turns table"},
        ],
        _recall_boost_pending=False,
    )

    with monkeypatch.context() as m:
        store_factory = lambda: WorkspaceMemoryStore(db_path)
        m.setattr("agenticx.memory.recall.WorkspaceMemoryStore", store_factory)
        m.setattr("agenticx.runtime.hooks.turn_archive_hook.WorkspaceMemoryStore", store_factory)

        hook = TurnArchiveHook(enabled=True)
        asyncio.run(hook.on_agent_end("done", session))
        asyncio.run(asyncio.sleep(0.05))

        block = _build_memory_recall_context(session)  # type: ignore[arg-type]

    assert "## 相关历史记忆（自动召回）" in block
    assert "[历史对话]" in block
    assert "turn archive" in block.lower()
