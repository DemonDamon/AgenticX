#!/usr/bin/env python3
"""``permissions.path_rules`` deny is absolute on reads and writes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import re
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.runtime.command_sandbox import (
    _glob_to_posix_regex,
    _macos_profile,
    build_command_sandbox_plan,
)
from agenticx.runtime.confirm import AsyncConfirmGate
from agenticx.runtime.path_policy import (
    match_path_rules,
    normalize_path_rules,
    path_rule_decision,
)


def _stub_path_rules(monkeypatch, rules) -> None:
    def fake(key, *args, **kwargs):
        if key == "permissions.path_rules":
            return rules
        return None

    monkeypatch.setattr(ConfigManager, "get_value", staticmethod(fake))


def _session_at(workspace: Path) -> StudioSession:
    session = StudioSession()
    session.workspace_dir = str(workspace)
    return session


# --------------------------------------------------------------------------
# Matching: deny wins globally
# --------------------------------------------------------------------------


def test_deny_wins_regardless_of_rule_order() -> None:
    rules = normalize_path_rules(
        [
            {"pattern": "*", "allow": True},
            {"pattern": "**/.env", "allow": False},
        ]
    )
    decision, pattern = match_path_rules("/w/project/.env", rules)
    assert decision is False
    assert pattern == "**/.env"


def test_malformed_rules_are_skipped_not_raised() -> None:
    rules = normalize_path_rules(
        [1, "x", {}, {"pattern": ""}, {"pattern": "**/.env", "allow": False}]
    )
    assert rules == [("**/.env", False)]
    decision, _ = path_rule_decision("/w/.env", [1, "x", {}, {"pattern": ""}, {"pattern": "**/.env", "allow": False}])
    assert decision is False


def test_allow_true_does_not_escape_workspace(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / "x.py"
    target.write_text("nope\n", encoding="utf-8")
    _stub_path_rules(monkeypatch, [{"pattern": "/**", "allow": True}])
    session = _session_at(workspace)
    with pytest.raises(ValueError, match="escapes workspace"):
        agent_tools._resolve_workspace_path(str(target), session, for_write=True)
    with pytest.raises(ValueError, match="escapes workspace"):
        agent_tools._resolve_workspace_path("../outside/x.py", session, for_write=True)


def test_allow_src_skips_confirm_flag_but_not_sandbox(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "ws"
    src = workspace / "src"
    src.mkdir(parents=True)
    allowed = src / "a.py"
    allowed.write_text("ok\n", encoding="utf-8")
    _stub_path_rules(monkeypatch, [{"pattern": "**/src/**", "allow": True}])
    assert agent_tools._path_allowed_without_confirm(allowed) is True
    session = _session_at(workspace)
    resolved = agent_tools._resolve_workspace_path(str(allowed), session, for_write=True)
    assert resolved == allowed.resolve()
    with pytest.raises(ValueError, match="escapes workspace"):
        agent_tools._resolve_workspace_path("../outside/x.py", session, for_write=True)


def test_deny_blocks_file_read_and_write_without_confirm(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    secret = workspace / ".env"
    secret.write_text("TOKEN=planted\n", encoding="utf-8")
    _stub_path_rules(monkeypatch, [{"pattern": "**/.env", "allow": False}])
    session = _session_at(workspace)
    gate = AsyncConfirmGate()

    read = agent_tools._tool_file_read({"path": str(secret)}, session)
    assert "blocked by permissions.path_rules" in read
    assert "planted" not in read

    write = asyncio.run(
        agent_tools._tool_file_write(
            {"path": str(secret), "content": "TOKEN=new\n"},
            session,
            confirm_gate=gate,
        )
    )
    assert "blocked by permissions.path_rules" in write
    assert gate.last_request is None
    assert gate._pending == {}
    assert secret.read_text(encoding="utf-8") == "TOKEN=planted\n"


def test_denied_path_patterns_for_sandbox_drops_allows(monkeypatch) -> None:
    _stub_path_rules(
        monkeypatch,
        [
            {"pattern": "/**", "allow": True},
            {"pattern": "*/.env", "allow": False},
        ],
    )
    assert agent_tools.denied_path_patterns_for_sandbox() == ["*/.env"]


# --------------------------------------------------------------------------
# glob → regex must agree with fnmatch (sandbox vs confirm)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "pattern,path",
    [
        ("*/.env", "/w/.env"),
        ("*/.env", "/w/a/b/.env"),
        ("*/.env", "/w/env"),
        ("*/.env", "/w/.envrc"),
        ("/etc/*", "/etc/passwd"),
        ("/etc/*", "/etcx/passwd"),
        ("a.b", "a.b"),
        ("a.b", "axb"),
        ("*secret[0-9].key", "/w/secret3.key"),
        ("*secret[0-9].key", "/w/secretX.key"),
        ("*[!a].txt", "/w/b.txt"),
        ("*[!a].txt", "/w/a.txt"),
        ("*.pem", "/w/deep/nested/id.pem"),
        ("*/node_modules/*", "/w/node_modules/x/y"),
    ],
)
def test_translated_regex_agrees_with_fnmatch(pattern: str, path: str) -> None:
    assert bool(re.match(_glob_to_posix_regex(pattern), path)) == fnmatch(path, pattern)


def test_unclosed_bracket_is_a_literal_like_fnmatch() -> None:
    assert bool(re.match(_glob_to_posix_regex("a[bc"), "a[bc")) == fnmatch("a[bc", "a[bc")


def test_deny_rules_come_after_the_workspace_allow() -> None:
    profile = _macos_profile([Path("/w")], ["*/.env"])
    allow_at = profile.index('(allow file-write* (subpath "/w"))')
    deny_at = profile.index("(deny file-read-data file-write* (regex")
    assert deny_at > allow_at


def test_no_deny_rules_means_no_deny_lines() -> None:
    profile = _macos_profile([Path("/w")], [])
    assert "(regex" not in profile


@pytest.mark.skipif(sys.platform != "darwin", reason="seatbelt is macOS-only")
def test_a_denied_path_cannot_be_read_from_the_shell(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / ".env").write_text("TOKEN=planted\n", encoding="utf-8")

    plan = build_command_sandbox_plan(
        ["/bin/sh", "-c", "cat .env"],
        writable_roots=[workspace],
        cwd=workspace,
        scope_id="read-deny",
        denied_path_patterns=["*/.env"],
    )
    proc = subprocess.run(
        plan.argv, env=dict(plan.env), cwd=workspace, capture_output=True, text=True
    )
    assert proc.returncode != 0
    assert "planted" not in proc.stdout


def test_linux_enumerates_deny_patterns_inside_reference_mounts(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr("shutil.which", lambda name, **_kw: "/usr/bin/bwrap")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / ".env").write_text("x", encoding="utf-8")
    reference = tmp_path / "reference"
    reference.mkdir()
    (reference / ".env").write_text("x", encoding="utf-8")

    plan = build_command_sandbox_plan(
        ["true"],
        writable_roots=[workspace],
        readable_roots=[reference],
        cwd=workspace,
        scope_id="ref-deny",
        denied_path_patterns=["*/.env"],
        platform_name="linux",
    )
    assert set(plan.denied_write_paths) == {workspace / ".env", reference / ".env"}
