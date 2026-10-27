#!/usr/bin/env python3
"""Managed bash override does not change personal-mode dispatch.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.cli.agent_tools import dispatch_tool_async
from agenticx.cli.studio import StudioSession
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy


def _session(tmp_path: Path) -> StudioSession:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    session = StudioSession()
    session.workspace_dir = str(workspace)
    session.session_id = "personal"
    return session


async def test_no_override_attribute_uses_builtin(tmp_path: Path) -> None:
    session = _session(tmp_path)
    called = {"n": 0}

    async def fake(arguments, session, *, confirm_gate, emit_event=None):
        del arguments, session, confirm_gate, emit_event
        called["n"] += 1
        return "OVERRIDE"

    result = await dispatch_tool_async("bash_exec", {"command": "echo x"}, session)
    assert result.startswith("exit_code=0")
    assert called["n"] == 0
    assert fake  # the unused override stands in for a monkeypatched replacement


async def test_override_used_when_present(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    session = _session(tmp_path)
    called = {"n": 0}

    async def fake(arguments, session, *, confirm_gate, emit_event=None):
        del arguments, session, confirm_gate, emit_event
        called["n"] += 1
        return "FROM_OVERRIDE"

    session.managed_tool_overrides = {"bash_exec": fake}
    result = await dispatch_tool_async("bash_exec", {"command": "echo x"}, session)
    assert result == "FROM_OVERRIDE"
    assert called["n"] == 1

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_policy.load_enterprise_agent_policy",
        lambda: EnterpriseAgentPolicy(denied=("bash_exec",)),
    )
    denied = await dispatch_tool_async("bash_exec", {"command": "echo x"}, session)
    assert called["n"] == 1
    assert "企业策略禁止执行「bash_exec」" in denied
