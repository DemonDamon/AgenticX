#!/usr/bin/env python3
"""Credential reference injection at MCP stdio env and provider lookup.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agenticx.cli.config_manager import AgxConfig
from agenticx.cli.studio import StudioSession
from agenticx.runtime.credential_store import (
    CredentialStore,
    MissingCredentialError,
    credentials_path,
)
from agenticx.studio.session_manager import SessionManager
from agenticx.tools.remote_v2 import _resolve_mcp_mapping, build_stdio_env


def _sandbox_home(tmp_path: Path) -> None:
    assert Path.home().is_relative_to(tmp_path)


def _store() -> CredentialStore:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return CredentialStore(path)


class _Server:
    def __init__(self, name: str, env: dict[str, str]) -> None:
        self.name = name
        self.env = env


def test_build_stdio_env_resolves_reference(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    secret = "ghp_test_value_0123456789"
    _store().set("GITHUB_TOKEN", secret, "github")
    env = build_stdio_env(
        _Server("github", {"GITHUB_TOKEN": "${cred:GITHUB_TOKEN}", "PLAIN_VALUE": "visible"})
    )
    assert env["GITHUB_TOKEN"] == secret
    assert env["PLAIN_VALUE"] == "visible"


def test_build_stdio_env_missing_reference_names_the_credential(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    with pytest.raises(RuntimeError) as exc_info:
        build_stdio_env(_Server("github", {"X": "${cred:NOT_DEFINED}"}))
    message = str(exc_info.value)
    assert "NOT_DEFINED" in message
    assert "github" in message
    assert "设置 → 凭证" in message


def test_mcp_header_mapping_resolves_and_empty_is_falsy(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    secret = "ghp_test_value_0123456789"
    _store().set("GITHUB_TOKEN", secret, "")
    resolved = _resolve_mcp_mapping(
        "github",
        {"Authorization": "Bearer ${cred:GITHUB_TOKEN}"},
    )
    assert resolved["Authorization"] == f"Bearer {secret}"
    assert (_resolve_mcp_mapping("github", {}) or None) is None
    with pytest.raises(RuntimeError, match="MISSING_HDR"):
        _resolve_mcp_mapping("remote", {"Authorization": "${cred:MISSING_HDR}"})


def test_get_provider_resolves_api_key_and_secret_key(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    _store().set("OPENAI_KEY", "sk-test-value-0123456789", "")
    _store().set("QIANFAN_SK", "sk-secret-value-0123456789", "")
    cfg = AgxConfig(
        providers={
            "openai": {
                "api_key": "${cred:OPENAI_KEY}",
                "secret_key": "${cred:QIANFAN_SK}",
                "model": "gpt-4o",
            }
        }
    )
    provider = cfg.get_provider("openai")
    assert provider.api_key == "sk-test-value-0123456789"
    assert provider.secret_key == "sk-secret-value-0123456789"


def test_get_provider_plain_key_does_not_create_credentials_file(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    cfg = AgxConfig(providers={"openai": {"api_key": "sk-plain-test", "model": "gpt-4o"}})
    assert cfg.get_provider("openai").api_key == "sk-plain-test"
    assert not credentials_path().exists()


def test_get_provider_missing_reference_raises(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    cfg = AgxConfig(
        providers={"openai": {"api_key": "${cred:MISSING_ONE}", "model": "gpt-4o"}}
    )
    with pytest.raises(MissingCredentialError) as exc_info:
        cfg.get_provider("openai")
    assert exc_info.value.name == "MISSING_ONE"


def test_dispatch_tool_async_redacts_string_result(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    from agenticx.cli.agent_tools import dispatch_tool_async

    secret = "scratch-secret-value-0123456789"
    _store().set("SCRATCH_KEY", secret, "")
    session = StudioSession()
    session.scratchpad["note"] = f"see {secret}"
    text = asyncio.run(dispatch_tool_async("scratchpad_read", {"key": "note"}, session))
    assert isinstance(text, str)
    assert secret not in text
    assert "[REDACTED:SCRATCH_KEY]" in text
    assert secret in session.scratchpad["note"]


def test_persist_redacts_disk_copies_and_keeps_memory(tmp_path: Path) -> None:
    _sandbox_home(tmp_path)
    secret = "persist-secret-value-0123456789"
    _store().set("PERSIST_KEY", secret, "")
    manager = SessionManager()
    managed = manager.create(session_id="credpersist01")
    session = managed.studio_session
    session.chat_history.append({"role": "user", "content": f"token {secret}"})
    session.agent_messages.append({"role": "assistant", "content": secret})
    session.chat_history.append({"role": "user", "content": ["not-a-string"]})
    assert manager._persist_session_state("credpersist01", session) is True

    assert secret in session.chat_history[0]["content"]
    assert session.chat_history[0].get("timestamp")
    assert secret in session.agent_messages[0]["content"]
    assert session.chat_history[1]["content"] == ["not-a-string"]

    messages = Path(manager._messages_path("credpersist01")).read_text(encoding="utf-8")
    agent_messages = Path(manager._agent_messages_path("credpersist01")).read_text(encoding="utf-8")
    assert secret not in messages
    assert "[REDACTED:PERSIST_KEY]" in messages
    assert secret not in agent_messages
    assert "[REDACTED:PERSIST_KEY]" in agent_messages
    assert "not-a-string" in messages
