#!/usr/bin/env python3
"""Smoke: permissions deny short-circuits before confirm_required path (G4).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from unittest.mock import MagicMock, patch

import pytest

from agenticx.cli.agent_tools import _tool_bash_exec, tool_denied_by_session_permissions
from agenticx.runtime.confirm import ConfirmGate


class ExplodingConfirmGate(ConfirmGate):
    """Fails the test if confirmation is requested (deny did not short-circuit)."""

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        raise AssertionError("confirm_required path must not run when tool is policy-denied")


def test_tool_denied_by_session_permissions_fnmatch() -> None:
    with patch(
        "agenticx.cli.agent_tools.ConfigManager.get_value",
        return_value=["bash_exec", "file_*"],
    ):
        assert tool_denied_by_session_permissions("bash_exec")
        assert tool_denied_by_session_permissions("file_write")
        assert tool_denied_by_session_permissions("file_read")
        assert tool_denied_by_session_permissions("memory_search") is None


@pytest.mark.asyncio
async def test_bash_exec_denied_skips_confirm_for_risky_command() -> None:
    with patch(
        "agenticx.cli.agent_tools.ConfigManager.get_value",
        return_value=["bash_exec"],
    ):
        out = await _tool_bash_exec(
            {"command": "rm -rf /tmp/should-not-run-this"},
            session=None,
            confirm_gate=ExplodingConfirmGate(),
            emit_event=None,
        )
    assert "ERROR" in out
    assert "拒绝" in out or "权限" in out
