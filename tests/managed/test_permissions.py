#!/usr/bin/env python3
"""Permission engine and managed confirm-gate tests.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

import pytest

from agenticx.managed.permissions import (
    ManagedConfirmGate,
    PermissionEngine,
    ToolAuthorization,
)
from agenticx.managed.spec import compile_spec
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy


def _spec(tools: list[dict[str, Any]] | None = None, **extra: object):
    raw: dict[str, Any] = {"schema": "agx.agent/v1", "model": "fake/scripted"}
    if tools is not None:
        raw["tools"] = tools
    raw.update(extra)
    return compile_spec("agent-1", 1, raw)


def _lookup_tool() -> dict[str, Any]:
    return {
        "type": "custom",
        "name": "lookup_order",
        "description": "Look up an order",
        "input_schema": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
        },
    }


def _matrix_spec():
    return _spec(
        tools=[
            {
                "type": "agx_builtin",
                "configs": [
                    {"name": "bash_exec", "policy": "always_ask"},
                    {"name": "file_read", "policy": "always_allow"},
                    {"name": "web_search", "enabled": False},
                ],
            },
            _lookup_tool(),
        ]
    )


def _mcp_spec():
    return _spec(
        mcp_servers=[{"name": "github", "url": "https://example.com/mcp"}],
        tools=[
            {
                "type": "mcp",
                "server": "github",
                "default_policy": "always_ask",
                "configs": [
                    {"name": "get_issue", "policy": "always_allow"},
                    {"name": "delete_repo", "enabled": False},
                ],
            }
        ],
    )


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("bash_exec", ("ask", "manifest", "always_ask")),
        ("file_read", ("allow", "manifest", "always_allow")),
        ("lookup_order", ("allow", "custom", "always_allow")),
        ("cc_bridge_start", ("deny", "unlisted", "always_ask")),
        ("web_search", ("deny", "unlisted", "always_ask")),
    ],
)
def test_evaluate_matrix(name: str, expected: tuple[str, str, str]) -> None:
    decision = PermissionEngine(_matrix_spec()).evaluate(name, {})
    assert (decision.decision, decision.source, decision.evaluated_policy) == expected


def test_enterprise_deny_beats_manifest_allow() -> None:
    spec = _spec(
        tools=[
            {
                "type": "agx_builtin",
                "configs": [{"name": "file_read", "policy": "always_allow"}],
            }
        ]
    )
    engine = PermissionEngine(spec, EnterpriseAgentPolicy(denied=("file_*",)))
    decision = engine.evaluate("file_read", {})
    assert (decision.decision, decision.source) == ("deny", "enterprise")
    assert decision.subject == "file_read"
    assert "denied by enterprise policy" in decision.reason


def test_enterprise_ask_escalates_allow() -> None:
    spec = _spec(
        tools=[
            {
                "type": "agx_builtin",
                "configs": [{"name": "bash_exec", "policy": "always_allow"}],
            }
        ]
    )
    engine = PermissionEngine(spec, EnterpriseAgentPolicy(always_ask=("git:push",)))
    pushed = engine.evaluate("bash_exec", {"command": "git push origin main"})
    assert (pushed.decision, pushed.source) == ("ask", "enterprise")
    assert pushed.subject == "git:push"
    assert pushed.evaluated_policy == "always_ask"
    listed = engine.evaluate("bash_exec", {"command": "ls"})
    assert (listed.decision, listed.source) == ("allow", "manifest")


def test_custom_tool_ignores_enterprise_deny() -> None:
    spec = _spec(
        tools=[
            {"type": "agx_builtin", "configs": [{"name": "file_read"}]},
            _lookup_tool(),
        ]
    )
    engine = PermissionEngine(spec, EnterpriseAgentPolicy(denied=("*",)))
    custom = engine.evaluate("lookup_order", {"order_id": "A-1"})
    assert (custom.decision, custom.source) == ("allow", "custom")
    denied = engine.evaluate("file_read", {})
    assert denied.decision == "deny"
    assert denied.source == "enterprise"


def test_platform_tool_allowed_unless_enterprise_denied() -> None:
    spec = _spec(tools=[{"type": "agx_builtin", "configs": [{"name": "file_read"}]}])
    allowed = PermissionEngine(spec, platform_tools=frozenset({"task_list"})).evaluate("task_list", {})
    assert allowed.decision == "allow"
    assert allowed.source == "platform"
    denied = PermissionEngine(
        spec,
        EnterpriseAgentPolicy(denied=("task_list",)),
        platform_tools=frozenset({"task_list"}),
    ).evaluate("task_list", {})
    assert denied.decision == "deny"
    assert denied.source == "enterprise"
    unlisted = PermissionEngine(spec).evaluate("task_list", {})
    assert unlisted.decision == "deny"
    assert unlisted.source == "unlisted"


def test_evaluate_mcp() -> None:
    engine = PermissionEngine(_mcp_spec())
    allowed = engine.evaluate_mcp("github", "get_issue", {})
    assert allowed.decision == "allow"
    assert allowed.source == "manifest"
    assert allowed.evaluated_policy == "always_allow"
    listed = engine.evaluate_mcp("github", "list_prs", {})
    assert (listed.decision, listed.source) == ("ask", "manifest")
    deleted = engine.evaluate_mcp("github", "delete_repo", {})
    assert (deleted.decision, deleted.source) == ("deny", "unlisted")
    assert deleted.reason == (
        'mcp tool "github/delete_repo" is disabled for this agent'
    )
    missing = engine.evaluate_mcp("gitlab", "get_issue", {})
    assert (missing.decision, missing.source) == ("deny", "unlisted")
    assert missing.reason == 'mcp server "gitlab" is not enabled for this agent'
    blocked = PermissionEngine(
        _mcp_spec(),
        EnterpriseAgentPolicy(denied=("mcp:get_issue",)),
    )
    denied = blocked.evaluate_mcp("github", "get_issue", {})
    assert (denied.decision, denied.source) == ("deny", "enterprise")
    assert denied.subject == "mcp:get_issue"


def test_tool_authorization() -> None:
    auth = ToolAuthorization()
    assert auth.allows("x") is False
    auth.grant("bash_exec")
    assert auth.allows("bash_exec") is True
    assert auth.allows(None) is True
    assert auth.allows("file_write") is False
    auth.revoke()
    assert auth.allows("bash_exec") is False
    assert auth.allows(None) is False
    assert auth.allows("file_write") is False


async def test_managed_confirm_gate() -> None:
    auth = ToolAuthorization()
    gate = ManagedConfirmGate(auth)
    assert await gate.request_confirm("q", {"tool": "bash_exec"}) is False
    assert gate.last_request is not None
    assert gate.last_request["decision"] == "managed_unauthorized"
    auth.grant("bash_exec")
    assert await gate.request_confirm("q", {"tool": "bash_exec"}) is True
    assert gate.should_emit_prompt({"risk": "high"}) is False


async def test_confirm_helper_uses_managed_gate() -> None:
    from agenticx.cli.agent_tools import _confirm

    auth = ToolAuthorization()
    gate = ManagedConfirmGate(auth)
    seen: list[dict[str, Any]] = []

    async def recorder(payload: dict[str, Any]) -> None:
        seen.append(payload)

    auth.grant("bash_exec")
    approved = await _confirm(
        "rm?",
        confirm_gate=gate,
        context={"tool": "bash_exec", "risk": "high"},
        emit_event=recorder,
        session=None,
    )
    assert approved is True
    assert seen == []

    auth.revoke()
    denied = await _confirm(
        "rm?",
        confirm_gate=gate,
        context={"tool": "bash_exec", "risk": "high"},
        emit_event=recorder,
        session=None,
    )
    assert denied is False
    assert seen == []
