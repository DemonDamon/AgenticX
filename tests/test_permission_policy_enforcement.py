#!/usr/bin/env python3
"""Configured permission rules must run on the execution path.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.runtime.command_sandbox import (
    CommandSandboxPlan,
    CommandSandboxUnavailable,
    WORKSPACE_WRITE,
)
from agenticx.runtime.confirm import ConfirmGate


@pytest.fixture
def permissions(monkeypatch: pytest.MonkeyPatch):
    values: dict[str, object] = {}
    original = ConfigManager.get_value

    def _fake(key, *args, **kwargs):
        if key in values:
            return values[key]
        if str(key).startswith("permissions."):
            return None
        return original(key, *args, **kwargs)

    monkeypatch.setattr(ConfigManager, "get_value", staticmethod(_fake))
    return values


class _RejectGate(ConfirmGate):
    def __init__(self) -> None:
        self.asked = 0

    async def request_confirm(self, question: str, context=None) -> bool:
        self.asked += 1
        return False


class _ApproveGate(ConfirmGate):
    def __init__(self) -> None:
        self.asked = 0

    async def request_confirm(self, question: str, context=None) -> bool:
        self.asked += 1
        return True


def _session(tmp_path: Path) -> StudioSession:
    session = StudioSession()
    workspace = tmp_path / "ws"
    workspace.mkdir(exist_ok=True)
    session.workspace_dir = str(workspace)
    return session


def test_denied_tools_blocks_file_write_without_confirm(permissions, tmp_path: Path) -> None:
    permissions["permissions.denied_tools"] = ["file_write"]
    gate = _RejectGate()
    session = _session(tmp_path)
    target = Path(session.workspace_dir) / "a.txt"
    result = asyncio.run(
        agent_tools.dispatch_tool_async(
            "file_write",
            {"path": str(target), "content": "new"},
            session,
            confirm_gate=gate,
        )
    )
    assert "已被会话权限策略拒绝" in result
    assert gate.asked == 0
    assert not target.exists()


def test_denied_tools_wins_over_allowed_tools(permissions, tmp_path: Path) -> None:
    permissions["permissions.denied_tools"] = ["file_write"]
    permissions["permissions.allowed_tools"] = ["file_write"]
    gate = _ApproveGate()
    session = _session(tmp_path)
    result = asyncio.run(
        agent_tools.dispatch_tool_async(
            "file_write",
            {"path": str(Path(session.workspace_dir) / "a.txt"), "content": "x"},
            session,
            confirm_gate=gate,
        )
    )
    assert "已被会话权限策略拒绝" in result
    assert gate.asked == 0


def test_allowed_tools_skips_confirm_but_keeps_sandbox(
    permissions, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    permissions["permissions.allowed_tools"] = ["bash_exec"]
    captured: dict = {}

    def _fake_plan(argv, **kwargs):
        captured["plan_argv"] = list(argv)
        captured["permissions"] = kwargs.get("permissions")
        return CommandSandboxPlan(
            argv=["sandbox-wrap", *argv],
            env={"PATH": "/bin"},
            permissions=WORKSPACE_WRITE,
            backend="test-backend",
        )

    monkeypatch.setattr(
        "agenticx.runtime.command_sandbox.build_command_sandbox_plan",
        _fake_plan,
    )

    class _Proc:
        def __init__(self) -> None:
            self.returncode = 0
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.stdout.feed_eof()
            self.stderr.feed_eof()

        async def wait(self) -> int:
            return 0

    async def _fake_exec(*args, **kwargs):
        captured["exec_argv"] = list(args)
        return _Proc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    gate = _RejectGate()
    session = _session(tmp_path)
    result = asyncio.run(
        agent_tools.dispatch_tool_async(
            "bash_exec",
            {"command": "mkdir build"},
            session,
            confirm_gate=gate,
        )
    )
    assert gate.asked == 0
    assert "exit_code=0" in result
    assert captured.get("exec_argv", [None])[0] == "sandbox-wrap"
    assert captured.get("permissions") == WORKSPACE_WRITE


def test_sandbox_unavailable_requires_confirm_and_does_not_run(
    permissions, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(*_args, **_kwargs):
        raise CommandSandboxUnavailable("no backend")

    monkeypatch.setattr(
        "agenticx.runtime.command_sandbox.build_command_sandbox_plan",
        _boom,
    )
    ran = {"value": False}

    async def _fake_exec(*_args, **_kwargs):
        ran["value"] = True
        raise AssertionError("must not start")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec)
    gate = _RejectGate()
    session = _session(tmp_path)
    result = asyncio.run(
        agent_tools.dispatch_tool_async(
            "bash_exec",
            {"command": "ls"},
            session,
            confirm_gate=gate,
        )
    )
    assert gate.asked == 1
    assert ran["value"] is False
    assert result.startswith("CANCELLED:")


WRITE_TOOLS = [
    ("file_write", {"path": "a.txt", "content": "x"}),
    ("file_edit", {"path": "a.txt", "old_text": "a", "new_text": "b"}),
    ("bash_exec", {"command": "rm -rf x"}),
    ("bash_bg_start", {"command": "rm -rf x"}),
    ("skill_manage", {"action": "delete", "name": "demo"}),
    ("codegen", {"spec": "write a file"}),
    ("memory_append", {"content": "note"}),
]


@pytest.mark.parametrize("tool_name,arguments", WRITE_TOOLS)
def test_each_write_tool_is_stopped_by_denied_tools(
    permissions, tmp_path: Path, tool_name: str, arguments: dict
) -> None:
    permissions["permissions.denied_tools"] = [tool_name]
    gate = _ApproveGate()
    session = _session(tmp_path)
    result = asyncio.run(
        agent_tools.dispatch_tool_async(
            tool_name,
            arguments,
            session,
            confirm_gate=gate,
        )
    )
    assert "已被会话权限策略拒绝" in result
    assert gate.asked == 0
