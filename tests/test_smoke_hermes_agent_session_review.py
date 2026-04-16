#!/usr/bin/env python3
"""Smoke tests for SessionReviewHook — on_agent_end lifecycle.

Validates hermes-agent proposal v2 §4.2.1 / Phase 1 / G1.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from agenticx.learning.session_review_hook import SessionReviewHook


class _FakeSession:
    session_id = "review-test-001"
    workspace_dir = "/tmp/review-workspace"
    _turns_since_skill_manage = 15
    _total_tool_calls = 10


def _write_observations(project_dir: Path, session_id: str, count: int = 8, errors: int = 2) -> None:
    """Write synthetic observations for testing."""
    project_dir.mkdir(parents=True, exist_ok=True)
    lines = []
    tools = ["bash_exec", "file_read", "file_write", "bash_exec", "web_search"]
    for i in range(count):
        tool = tools[i % len(tools)]
        success = i >= errors
        obs = {
            "tool_name": tool,
            "success": success,
            "session_id": session_id,
            "elapsed_ms": 100 + i * 50,
            "turn_index": i + 1,
            "error_signal": "error:" if not success else None,
        }
        lines.append(json.dumps(obs))
    (project_dir / "observations.jsonl").write_text("\n".join(lines) + "\n")


class TestShouldReview:
    def test_below_nudge_interval(self) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()
        session._turns_since_skill_manage = 3
        assert hook._should_review(session) is False

    def test_below_min_tool_calls(self) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()
        session._total_tool_calls = 2
        session._turns_since_skill_manage = 20
        assert hook._should_review(session) is False

    def test_meets_thresholds(self) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()
        assert hook._should_review(session) is True

    def test_defaults_when_attrs_missing_rejects(self) -> None:
        """Session without counters defaults to 0 tool calls → below threshold."""
        hook = SessionReviewHook()

        class _BareSess:
            pass

        assert hook._should_review(_BareSess()) is False


class TestRunReview:
    @pytest.fixture(autouse=True)
    def _enable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGX_SKILL_REVIEW_ENABLED", "1")

    def test_writes_pending_skills(self, tmp_path: Path) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()

        project_id = hook._resolve_project_id(session)
        project_dir = tmp_path / ".agenticx" / "instincts" / "projects" / project_id
        _write_observations(project_dir, session.session_id, count=8, errors=2)

        with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
            asyncio.get_event_loop().run_until_complete(hook._run_review(session))

        pending_path = project_dir / "pending_skills.json"
        assert pending_path.exists()
        pending = json.loads(pending_path.read_text())
        assert isinstance(pending, list)
        assert len(pending) == 1
        rec = pending[0]
        assert rec["session_id"] == "review-test-001"
        assert rec["recommendation"] == "review_suggested"
        assert rec["signals"]["tool_call_count"] == 8
        assert rec["signals"]["error_count"] == 2
        assert rec["signals"]["error_recovery_count"] >= 0

    def test_skips_simple_session(self, tmp_path: Path) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()

        project_id = hook._resolve_project_id(session)
        project_dir = tmp_path / ".agenticx" / "instincts" / "projects" / project_id
        _write_observations(project_dir, session.session_id, count=2, errors=0)

        with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
            asyncio.get_event_loop().run_until_complete(hook._run_review(session))

        pending_path = project_dir / "pending_skills.json"
        assert not pending_path.exists()

    def test_skips_no_observations(self, tmp_path: Path) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()

        with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
            asyncio.get_event_loop().run_until_complete(hook._run_review(session))


class TestOnAgentEnd:
    def test_disabled_by_default(self) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()
        asyncio.get_event_loop().run_until_complete(
            hook.on_agent_end("done", session)
        )

    def test_enabled_triggers_review(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGX_SKILL_REVIEW_ENABLED", "1")
        hook = SessionReviewHook()
        session = _FakeSession()

        project_id = hook._resolve_project_id(session)
        project_dir = tmp_path / ".agenticx" / "instincts" / "projects" / project_id
        _write_observations(project_dir, session.session_id, count=10, errors=1)

        async def _run() -> None:
            with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
                await hook.on_agent_end("done", session)
                await asyncio.sleep(0.3)

        asyncio.get_event_loop().run_until_complete(_run())

        pending_path = project_dir / "pending_skills.json"
        assert pending_path.exists()
