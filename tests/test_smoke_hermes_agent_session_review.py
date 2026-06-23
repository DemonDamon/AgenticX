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
from unittest.mock import AsyncMock, patch

import pytest

from agenticx.learning.session_review_hook import SessionReviewHook


class _FakeSession:
    session_id = "review-test-001"
    workspace_dir = "/tmp/review-workspace"
    _turns_since_skill_manage = 15
    _total_tool_calls = 10
    provider_name = "openai"
    model_name = "gpt-4o-mini"
    agent_messages: list[dict[str, Any]] = []


def _write_session_observations(session_dir: Path, count: int = 8, errors: int = 2) -> None:
    session_dir.mkdir(parents=True, exist_ok=True)
    observations = []
    tools = ["bash_exec", "file_read", "file_write", "bash_exec", "web_search"]
    for i in range(count):
        observations.append(
            {
                "tool_name": tools[i % len(tools)],
                "success": i >= errors,
                "session_id": "review-test-001",
                "elapsed_ms": 100 + i * 50,
                "turn_index": i + 1,
                "error_signal": "error:" if i < errors else None,
            }
        )
    (session_dir / "tool_call_observations.json").write_text(
        json.dumps(observations),
        encoding="utf-8",
    )


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

    def test_triggers_review_agent_for_complex_session(self, tmp_path: Path) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()
        session_dir = tmp_path / ".agenticx" / "sessions" / session.session_id
        _write_session_observations(session_dir, count=8, errors=2)

        with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
            with patch.object(
                hook,
                "_run_skill_review_agent",
                new=AsyncMock(),
            ) as mock_review:
                asyncio.get_event_loop().run_until_complete(hook._run_review(session))
                mock_review.assert_awaited_once()

    def test_skips_simple_session(self, tmp_path: Path) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()
        session_dir = tmp_path / ".agenticx" / "sessions" / session.session_id
        _write_session_observations(session_dir, count=2, errors=0)

        with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
            with patch.object(
                hook,
                "_run_skill_review_agent",
                new=AsyncMock(),
            ) as mock_review:
                asyncio.get_event_loop().run_until_complete(hook._run_review(session))
                mock_review.assert_not_awaited()

    def test_skips_no_observations(self, tmp_path: Path) -> None:
        hook = SessionReviewHook()
        session = _FakeSession()

        with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
            with patch.object(
                hook,
                "_run_skill_review_agent",
                new=AsyncMock(),
            ) as mock_review:
                asyncio.get_event_loop().run_until_complete(hook._run_review(session))
                mock_review.assert_not_awaited()


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
        session_dir = tmp_path / ".agenticx" / "sessions" / session.session_id
        _write_session_observations(session_dir, count=10, errors=1)

        async def _run() -> None:
            with patch("agenticx.learning.session_review_hook.Path.home", return_value=tmp_path):
                with patch.object(
                    hook,
                    "_run_review",
                    new=AsyncMock(),
                ) as mock_run:
                    await hook.on_agent_end("done", session)
                    await asyncio.sleep(0.05)
                    mock_run.assert_awaited_once()

        asyncio.get_event_loop().run_until_complete(_run())
