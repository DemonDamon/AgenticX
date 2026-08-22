#!/usr/bin/env python3
"""Smoke: bash_exec OUTPUT_HINT on long successful stdout (FR-10).

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


@pytest.fixture
def auto_confirm(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    async def _yes(*_a: object, **_k: object) -> bool:
        return True

    monkeypatch.setattr(agent_tools, "_confirm", _yes)
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(tmp_path))

    def _passthrough_plan(argv, *, permissions, **_kwargs):
        return SimpleNamespace(
            argv=tuple(argv),
            env=os.environ.copy(),
            permissions=agent_tools.normalize_command_permissions(permissions),
            backend="test-passthrough",
        )

    monkeypatch.setattr(agent_tools, "build_command_sandbox_plan", _passthrough_plan)


def test_hint_appended_for_long_stdout(auto_confirm: None) -> None:
    session = StudioSession()
    # Long stdout with a path-like token so path_part is non-empty.
    cmd = "python3 -c \"print('/tmp/demo-long-path.md' + 'x' * 220)\""
    out = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, session)
    assert "exit_code=0" in out
    assert "OUTPUT_HINT:" in out
    assert "非空行" in out


def test_hint_skipped_for_empty_stdout(auto_confirm: None) -> None:
    session = StudioSession()
    out = agent_tools.dispatch_tool("bash_exec", {"command": "true"}, session)
    assert "exit_code=0" in out
    assert "OUTPUT_HINT:" not in out


def test_hint_skipped_on_error_exit(auto_confirm: None) -> None:
    session = StudioSession()
    out = agent_tools.dispatch_tool(
        "bash_exec",
        {"command": "python3 -c \"print('x'*250); raise SystemExit(1)\""},
        session,
    )
    assert "exit_code=1" in out
    assert "OUTPUT_HINT:" not in out
