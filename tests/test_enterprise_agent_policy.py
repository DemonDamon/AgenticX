#!/usr/bin/env python3
"""Enterprise agent-action policy matching.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.enterprise_agent_policy import (
    EnterpriseAgentPolicy,
    enterprise_ask_subject,
    enterprise_denied_subject,
    load_enterprise_agent_policy,
    policy_subjects,
)


def _values(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "enterprise.enabled": True,
        "enterprise.token": "pat-test",
        "enterprise.agent_action_policy": {},
    }
    data.update(overrides)
    return data


def _install(monkeypatch: pytest.MonkeyPatch, values: dict[str, object] | None, *, explode: bool = False) -> None:
    def get_value(cls: object, key: str) -> object:
        del cls
        if explode:
            raise RuntimeError("config unreadable")
        assert values is not None
        return values.get(key)

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(get_value))


def test_unsigned_enterprise_yields_empty_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    populated = {
        "denied_tools": ["bash_exec"],
        "always_ask_tools": ["file_write"],
        "disable_session_allow": True,
    }
    _install(
        monkeypatch,
        _values(**{"enterprise.enabled": False, "enterprise.agent_action_policy": populated}),
    )
    assert load_enterprise_agent_policy() == EnterpriseAgentPolicy()

    _install(
        monkeypatch,
        _values(**{"enterprise.enabled": "true", "enterprise.agent_action_policy": populated}),
    )
    assert load_enterprise_agent_policy() == EnterpriseAgentPolicy()

    _install(
        monkeypatch,
        _values(**{"enterprise.token": "   ", "enterprise.agent_action_policy": populated}),
    )
    assert load_enterprise_agent_policy() == EnterpriseAgentPolicy()

    _install(monkeypatch, None, explode=True)
    assert load_enterprise_agent_policy() == EnterpriseAgentPolicy()


def test_mcp_call_matches_mcp_subject() -> None:
    policy = EnterpriseAgentPolicy(denied=("mcp:send_*",))
    arguments = {"tool_name": "send_message"}
    assert "mcp:send_message" in policy_subjects("mcp_call", arguments)
    assert enterprise_denied_subject("mcp_call", arguments, policy) == "mcp:send_message"


def test_bash_git_push_matches_git_subject() -> None:
    policy = EnterpriseAgentPolicy(always_ask=("git:push",))
    arguments = {"command": "cd x && git push origin main"}
    assert policy_subjects("bash_exec", arguments) == ["bash_exec", "git:push"]
    assert enterprise_ask_subject("bash_exec", arguments, policy) == "git:push"
    assert enterprise_ask_subject("bash_exec", {"command": "echo git push"}, policy) is None
    assert enterprise_ask_subject("bash_exec", {"command": "GIT PUSH origin"}, policy) == "git:push"


def test_denied_patterns_outrank_always_ask() -> None:
    policy = EnterpriseAgentPolicy(
        denied=("git:push",),
        always_ask=("bash_exec", "git:push"),
    )
    arguments = {"command": "cd x && git push origin main"}
    assert enterprise_denied_subject("bash_exec", arguments, policy) == "git:push"
    assert enterprise_ask_subject("bash_exec", arguments, policy) == "bash_exec"


def test_disk_policy_is_revalidated(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(
        monkeypatch,
        _values(
            **{
                "enterprise.agent_action_policy": {
                    "deniedTools": ["bash_exec", "bad name", "bash_exec"],
                    "always_ask_tools": ["git:push"],
                    "disable_session_allow": "true",
                }
            }
        ),
    )
    loaded = load_enterprise_agent_policy()
    assert loaded.denied == ("bash_exec",)
    assert loaded.always_ask == ("git:push",)
    assert loaded.disable_session_allow is False
