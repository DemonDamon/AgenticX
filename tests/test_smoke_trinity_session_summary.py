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
from agenticx.runtime.session_summary_store import summary_path


def _patch_summary_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setattr("agenticx.runtime.session_summary_store.Path.home", lambda: tmp_path)
    root = tmp_path / ".agenticx" / "workspace" / "sessions"
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_session_summary_hook_writes_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    root = _patch_summary_home(monkeypatch, tmp_path)
    session = StudioSession()
    session.chat_history = [
        {"role": "user", "content": "Need summary persistence."},
        {"role": "assistant", "content": "I will persist a concise summary."},
    ]
    setattr(session, "_session_id", "smoke-session")
    hook = SessionSummaryHook()
    asyncio.run(hook.on_agent_end("final answer", session))
    saved = root / "smoke-session.md"
    assert saved.exists()
    assert "Session Summary" in saved.read_text(encoding="utf-8")


def test_session_summary_hook_skips_without_session_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    root = _patch_summary_home(monkeypatch, tmp_path)
    session = StudioSession()
    session.chat_history = [{"role": "user", "content": "no key"}]
    hook = SessionSummaryHook()
    asyncio.run(hook.on_agent_end("done", session))
    assert list(root.glob("*.md")) == []


def test_meta_prompt_includes_cross_session_summary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    root = _patch_summary_home(monkeypatch, tmp_path)
    (root / "other-session.md").write_text("# Session Summary\n- stable", encoding="utf-8")
    session = StudioSession()
    setattr(session, "_session_id", "current-session")
    # Only sessions that explicitly inherited a prior topic may receive
    # automatic cross-session summary injection.
    session.agent_messages = [
        {
            "role": "system",
            "content": "[context_inherited] 以下是前一话题的上下文摘要，用于保持连续性：\nparent summary",
        }
    ]
    session.chat_history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
    ]
    prompt = build_meta_agent_system_prompt(session)
    assert "其他会话摘要" in prompt
    assert "stable" in prompt


def test_meta_prompt_skips_cross_session_summary_for_fresh_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Brand-new chats must stay clean: no automatic previous-session summary."""
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    root = _patch_summary_home(monkeypatch, tmp_path)
    (root / "other-session.md").write_text(
        "# Session Summary\n下一步是委派游承峰启动 F1，要现在开工吗？",
        encoding="utf-8",
    )
    session = StudioSession()
    setattr(session, "_session_id", "fresh-session")
    # First-turn prompt build happens before the user message is appended.
    session.chat_history = []
    session.agent_messages = []
    prompt = build_meta_agent_system_prompt(session)
    assert "其他会话摘要" not in prompt
    assert "游承峰" not in prompt
    assert "F1" not in prompt


def test_meta_prompt_excludes_current_session_summary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    root = _patch_summary_home(monkeypatch, tmp_path)
    current = "session-a"
    (root / f"{current}.md").write_text("# Session Summary\n- current only", encoding="utf-8")
    (root / "session-b.md").write_text("# Session Summary\n- other session", encoding="utf-8")

    session = StudioSession()
    setattr(session, "_session_id", current)
    session.agent_messages = [
        {
            "role": "system",
            "content": "[context_inherited] 以下是前一话题的上下文摘要，用于保持连续性：\nparent",
        }
    ]
    session.chat_history = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a"},
    ]
    prompt = build_meta_agent_system_prompt(session)
    assert "current only" not in prompt
    assert "other session" in prompt


def test_meta_prompt_skips_summary_on_retry_pending_user(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "true")
    root = _patch_summary_home(monkeypatch, tmp_path)
    (root / "other-session.md").write_text("# Session Summary\n- stale wrong answer", encoding="utf-8")
    session = StudioSession()
    setattr(session, "_session_id", "retry-session")
    session.chat_history = [{"role": "user", "content": "retry me"}]
    prompt = build_meta_agent_system_prompt(session)
    assert "stale wrong answer" not in prompt
    assert "其他会话摘要" not in prompt


def test_session_summary_disabled_does_not_write(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SESSION_SUMMARY", "false")
    root = _patch_summary_home(monkeypatch, tmp_path)
    session = StudioSession()
    setattr(session, "_session_id", "noop")
    session.chat_history = [{"role": "user", "content": "no-op"}]
    hook = SessionSummaryHook()
    asyncio.run(hook.on_agent_end("done", session))
    assert not list(root.glob("*.md"))
