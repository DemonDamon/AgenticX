#!/usr/bin/env python3
"""Smoke tests for trinity session summary continuity.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime.hooks.session_summary_hook import SessionSummaryHook
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt


def test_session_summary_hook_writes_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    monkeypatch.setattr("agenticx.runtime.hooks.session_summary_hook.Path.home", lambda: tmp_path)
    session = StudioSession()
    session.chat_history = [
        {"role": "user", "content": "Need summary persistence."},
        {"role": "assistant", "content": "I will persist a concise summary."},
    ]
    session.session_id = "smoke-session"
    hook = SessionSummaryHook()
    asyncio.run(hook.on_agent_end("final answer", session))
    saved = tmp_path / ".agenticx" / "workspace" / "sessions" / "smoke-session.md"
    assert saved.exists()
    assert "Session Summary" in saved.read_text(encoding="utf-8")


def test_meta_prompt_includes_recent_session_summary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    monkeypatch.setattr("agenticx.runtime.prompts.meta_agent.Path.home", lambda: tmp_path)
    sessions_dir = tmp_path / ".agenticx" / "workspace" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    (sessions_dir / "recent.md").write_text("# Session Summary\n- stable", encoding="utf-8")
    prompt = build_meta_agent_system_prompt(StudioSession())
    assert "Previous Session Summary" in prompt
    assert "stable" in prompt


def test_session_summary_disabled_does_not_write(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "false")
    monkeypatch.setattr("agenticx.runtime.hooks.session_summary_hook.Path.home", lambda: tmp_path)
    session = StudioSession()
    session.chat_history = [{"role": "user", "content": "no-op"}]
    hook = SessionSummaryHook()
    asyncio.run(hook.on_agent_end("done", session))
    saved = tmp_path / ".agenticx" / "workspace" / "sessions"
    assert not saved.exists()
