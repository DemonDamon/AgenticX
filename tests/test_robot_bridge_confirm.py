#!/usr/bin/env python3
"""risk=robot confirmations cannot be waived, and robot_* calls are routed to the bridge tools.

Author: Hongyi Zhao
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.agent_tools import _confirm, dispatch_tool_async
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.robot_bridge import tools as robot_tools
from agenticx.runtime.confirm import (
    AsyncConfirmGate,
    ConfirmGate,
    RiskAwareAutoConfirmGate,
    is_non_waivable_confirm,
    is_protected_confirm,
    protected_confirm_reason,
)

ROBOT_CONTEXT = {"risk": "robot", "tool": "robot_rollout_start"}


class _CountingGate(ConfirmGate):
    def __init__(self, approve: bool) -> None:
        self.approve = approve
        self.calls = 0

    async def request_confirm(self, question: str, context=None) -> bool:
        self.calls += 1
        return self.approve


@pytest.fixture(autouse=True)
def isolated_config(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(
        ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml"
    )


def test_robot_is_protected():
    assert is_protected_confirm({"risk": "robot"}) is True
    assert protected_confirm_reason({"risk": "robot"}) == "这条操作会让真实机器人运动"
    assert is_non_waivable_confirm({"risk": " ROBOT "}) is True
    assert is_non_waivable_confirm({"risk": "non_whitelisted"}) is False
    assert is_non_waivable_confirm({}) is False
    assert is_non_waivable_confirm(None) is False


async def test_allowed_tools_cannot_waive_robot(monkeypatch):
    monkeypatch.setattr(
        agent_tools, "tool_allowed_without_confirm", lambda *a, **k: True
    )

    denying = _CountingGate(approve=False)
    assert (
        await _confirm("q", confirm_gate=denying, context=dict(ROBOT_CONTEXT)) is False
    )
    assert denying.calls == 1

    untouched = _CountingGate(approve=False)
    assert (
        await _confirm(
            "q",
            confirm_gate=untouched,
            context={"risk": "non_whitelisted", "tool": "bash_exec"},
        )
        is True
    )
    assert untouched.calls == 0


async def test_path_allow_rule_cannot_waive_robot(monkeypatch):
    monkeypatch.setattr(agent_tools, "_path_allowed_without_confirm", lambda _p: True)
    gate = _CountingGate(approve=False)

    context = {**ROBOT_CONTEXT, "path": "/tmp/anything"}
    assert await _confirm("q", confirm_gate=gate, context=context) is False
    assert gate.calls == 1


async def test_unattended_rejects_robot():
    gate = RiskAwareAutoConfirmGate(unattended=True)

    assert await _confirm("q", confirm_gate=gate, context=dict(ROBOT_CONTEXT)) is False
    assert gate.last_request is not None
    assert gate.last_request["decision"] == "blocked_unattended"


async def test_auto_mode_still_prompts_robot():
    events: list[dict[str, Any]] = []
    gate = RiskAwareAutoConfirmGate(delegate=AsyncConfirmGate(timeout_seconds=1))

    async def emit(event: dict[str, Any]) -> None:
        events.append(event)
        if event["type"] == "confirm_required":
            assert gate.resolve(event["data"]["id"], True)

    assert (
        await _confirm(
            "start?", confirm_gate=gate, context=dict(ROBOT_CONTEXT), emit_event=emit
        )
        is True
    )
    assert [e["type"] for e in events] == ["confirm_required", "confirm_response"]
    context = events[0]["data"]["context"]
    assert context["protected_reason"] == "这条操作会让真实机器人运动"


async def test_dispatch_routes_robot_tools(monkeypatch):
    seen: list[tuple[str, dict[str, Any]]] = []

    async def fake_dispatch(name, arguments, session, *, confirm_gate, emit_event):
        seen.append((name, arguments))
        return "routed"

    monkeypatch.setattr(robot_tools, "dispatch_robot_tool", fake_dispatch)

    result = await dispatch_tool_async(
        "robot_status", {"session_id": "x"}, StudioSession()
    )
    assert result == "routed"
    assert seen == [("robot_status", {"session_id": "x"})]

    unknown = await dispatch_tool_async("robot_not_a_tool", {"x": 1}, StudioSession())
    assert unknown != "routed" and "unknown tool" in unknown
    assert len(seen) == 1
