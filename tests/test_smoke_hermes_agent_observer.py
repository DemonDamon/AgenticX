#!/usr/bin/env python3
"""Smoke tests for ObservationHook success inference and observation schema.

Validates hermes-agent proposal v2 Phase 0 / G0: ObservationHook fix.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from agenticx.learning.observer import (
    ObservationHook,
    extract_error_signal,
    infer_success,
)


class TestInferSuccess:
    """Unit tests for the success heuristic."""

    def test_empty_result_is_success(self) -> None:
        assert infer_success("bash_exec", "") is True

    def test_none_result_is_success(self) -> None:
        assert infer_success("bash_exec", None) is True  # type: ignore[arg-type]

    def test_normal_output_is_success(self) -> None:
        assert infer_success("bash_exec", "total 42\ndrwxr-xr-x ...") is True

    def test_error_colon_detected(self) -> None:
        assert infer_success("bash_exec", "Error: file not found") is False

    def test_traceback_detected(self) -> None:
        result = "Traceback (most recent call last):\n  File ..."
        assert infer_success("python_exec", result) is False

    def test_exception_detected(self) -> None:
        assert infer_success("tool", "Exception: something broke") is False

    def test_failed_colon_detected(self) -> None:
        assert infer_success("tool", "failed: connection refused") is False

    def test_command_not_found(self) -> None:
        assert infer_success("bash_exec", "zsh: command not found: foo") is False

    def test_permission_denied(self) -> None:
        assert infer_success("bash_exec", "Permission denied (publickey)") is False

    def test_json_success_false(self) -> None:
        assert infer_success("api_call", '{"success": false, "error": "bad request"}') is False

    def test_json_success_true(self) -> None:
        assert infer_success("api_call", '{"success": true, "data": []}') is True

    def test_json_no_success_key(self) -> None:
        assert infer_success("api_call", '{"result": "ok"}') is True

    def test_large_result_only_checks_prefix(self) -> None:
        big = "x" * 10_000 + "Error: late"
        assert infer_success("tool", big) is True


class TestExtractErrorSignal:
    """Unit tests for error signal extraction."""

    def test_no_error(self) -> None:
        assert extract_error_signal("all good") is None

    def test_empty(self) -> None:
        assert extract_error_signal("") is None

    def test_extracts_first_match(self) -> None:
        assert extract_error_signal("Error: failed: oops") == "error:"

    def test_traceback(self) -> None:
        assert extract_error_signal("Traceback (most recent ...)") == "traceback"


class _FakeSession:
    session_id = "test-session-123"
    workspace_dir = "/tmp/fake-workspace"


class TestObservationHookIntegration:
    """Integration test: hook writes JSONL with correct schema."""

    @pytest.fixture(autouse=True)
    def _enable_learning(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGX_LEARNING_ENABLED", "1")

    @staticmethod
    async def _run_hook_cycle(hook: ObservationHook, tool: str, args: dict, result: str, session: Any) -> None:
        """Run before + after + flush background write tasks."""
        await hook.before_tool_call(tool, args, session)
        await hook.after_tool_call(tool, result, session)
        await asyncio.sleep(0.15)

    def test_successful_tool_call_schema(self, tmp_path: Path) -> None:
        hook = ObservationHook()
        session = _FakeSession()

        with patch.object(hook, "_project_id", return_value="deadbeef"):
            with patch("agenticx.learning.observer.Path.home", return_value=tmp_path):
                asyncio.get_event_loop().run_until_complete(
                    self._run_hook_cycle(hook, "bash_exec", {"cmd": "ls"}, "file1.txt\nfile2.txt", session)
                )

        jsonl_path = tmp_path / ".agenticx" / "instincts" / "projects" / "deadbeef" / "observations.jsonl"
        assert jsonl_path.exists(), f"JSONL not found at {jsonl_path}"
        lines = jsonl_path.read_text().strip().splitlines()
        assert len(lines) == 1
        obs = json.loads(lines[0])

        assert obs["tool_name"] == "bash_exec"
        assert obs["success"] is True
        assert obs["error_signal"] is None
        assert obs["turn_index"] == 1
        assert isinstance(obs["elapsed_ms"], int)
        assert obs["elapsed_ms"] >= 0
        assert "timestamp" in obs
        assert obs["session_id"] == "test-session-123"

    def test_failed_tool_call_records_error(self, tmp_path: Path) -> None:
        hook = ObservationHook()
        session = _FakeSession()

        with patch.object(hook, "_project_id", return_value="deadbeef"):
            with patch("agenticx.learning.observer.Path.home", return_value=tmp_path):
                asyncio.get_event_loop().run_until_complete(
                    self._run_hook_cycle(hook, "bash_exec", {"cmd": "bad"}, "Error: command not found", session)
                )

        jsonl_path = tmp_path / ".agenticx" / "instincts" / "projects" / "deadbeef" / "observations.jsonl"
        lines = jsonl_path.read_text().strip().splitlines()
        obs = json.loads(lines[0])

        assert obs["success"] is False
        assert obs["error_signal"] == "error:"

    def test_turn_index_increments(self, tmp_path: Path) -> None:
        hook = ObservationHook()
        session = _FakeSession()

        async def _run_three() -> None:
            for _ in range(3):
                await self._run_hook_cycle(hook, "tool", {}, "ok", session)

        with patch.object(hook, "_project_id", return_value="deadbeef"):
            with patch("agenticx.learning.observer.Path.home", return_value=tmp_path):
                asyncio.get_event_loop().run_until_complete(_run_three())

        jsonl_path = tmp_path / ".agenticx" / "instincts" / "projects" / "deadbeef" / "observations.jsonl"
        lines = jsonl_path.read_text().strip().splitlines()
        indices = [json.loads(l)["turn_index"] for l in lines]
        assert indices == [1, 2, 3]

    def test_disabled_does_not_write(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGX_LEARNING_ENABLED", "0")
        hook = ObservationHook()
        session = _FakeSession()

        with patch("agenticx.learning.observer.Path.home", return_value=tmp_path):
            result = asyncio.get_event_loop().run_until_complete(
                hook.after_tool_call("tool", "data", session)
            )

        assert result == "data"
        jsonl_path = tmp_path / ".agenticx" / "instincts" / "projects"
        assert not jsonl_path.exists() or not list(jsonl_path.rglob("*.jsonl"))
