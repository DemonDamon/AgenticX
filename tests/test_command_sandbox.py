#!/usr/bin/env python3
"""Focused tests for the OS-enforced Studio command sandbox.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.runtime.command_sandbox import (
    DANGER_FULL_ACCESS,
    READ_ONLY,
    WORKSPACE_WRITE,
    CommandSandboxUnavailable,
    _argv_is_git_invocation,
    _bubblewrap_argv,
    _git_credential_read_paths,
    _macos_profile,
    build_command_sandbox_plan,
    normalize_command_permissions,
)


def test_normalize_command_permissions_defaults_and_known_values() -> None:
    assert normalize_command_permissions(None) == WORKSPACE_WRITE
    assert normalize_command_permissions("") == WORKSPACE_WRITE
    assert normalize_command_permissions("unrestricted") == WORKSPACE_WRITE
    assert normalize_command_permissions(READ_ONLY) == READ_ONLY
    assert normalize_command_permissions(WORKSPACE_WRITE) == WORKSPACE_WRITE
    assert normalize_command_permissions(DANGER_FULL_ACCESS) == DANGER_FULL_ACCESS


def test_build_plan_wraps_argv_and_includes_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["/bin/echo", "ok"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        scope_id="session-a",
        cwd=workspace,
        environ={"PATH": "/usr/bin:/bin"},
        platform_name="darwin",
    )
    assert plan.argv
    assert plan.argv[0]
    assert plan.argv != ("/bin/echo", "ok")
    joined = " ".join(plan.argv)
    assert str(workspace) in joined
    assert plan.temp_dir is not None


def test_unsupported_host_raises_unavailable(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with pytest.raises(CommandSandboxUnavailable):
        build_command_sandbox_plan(
            ["/bin/echo", "ok"],
            permissions=WORKSPACE_WRITE,
            writable_roots=[workspace],
            platform_name="unsupported-os",
        )


def test_same_scope_id_gets_distinct_temp_dirs(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    first = build_command_sandbox_plan(
        ["/bin/echo", "one"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        scope_id="shared-scope",
        platform_name="darwin",
    )
    second = build_command_sandbox_plan(
        ["/bin/echo", "two"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        scope_id="shared-scope",
        platform_name="darwin",
    )
    assert first.temp_dir is not None
    assert second.temp_dir is not None
    assert first.temp_dir != second.temp_dir


def test_linux_bubblewrap_unshares_pid_ipc_uts(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    argv = _bubblewrap_argv(
        "/usr/bin/bwrap",
        ("/bin/echo", "ok"),
        [workspace],
        cwd=workspace,
    )
    text = list(argv)
    for flag in ("--unshare-pid", "--unshare-ipc", "--unshare-uts"):
        assert flag in text
    assert "--unshare-net" not in text
    assert text.index("--unshare-pid") < text.index("--proc")
    assert "--" in text


def test_macos_profile_denies_proxy_binaries_after_allows(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    profile = _macos_profile([workspace], deny_patterns=("**/.env",))
    assert "(allow default)" in profile
    assert "(deny default)" not in profile
    deny_exec = '(regex #"/(osascript|osacompile|launchctl|crontab)$")'
    assert deny_exec in profile
    assert profile.rfind(deny_exec) > profile.rfind("(allow file-")
    assert "osascript" in profile
    assert "/open$" not in profile


def test_argv_is_git_invocation() -> None:
    assert _argv_is_git_invocation(["git", "pull"])
    assert _argv_is_git_invocation(["/usr/bin/git", "status"])
    assert _argv_is_git_invocation(["/bin/sh", "-c", "git pull"])
    assert _argv_is_git_invocation(["/bin/sh", "-c", "cd repo && git pull"])
    assert _argv_is_git_invocation(["/bin/bash", "-c", "git fetch && git status"])
    assert not _argv_is_git_invocation(["/bin/echo", "git"])
    assert not _argv_is_git_invocation(["/bin/sh", "-c", "echo git"])
    assert not _argv_is_git_invocation(["/bin/sh", "-c", "cat ~/.git-credentials"])
    assert not _argv_is_git_invocation([])


def test_git_credential_paths_only_when_present(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    assert _git_credential_read_paths({"HOME": str(home)}) == ()
    creds = home / ".git-credentials"
    creds.write_text("https://x:y@host\n", encoding="utf-8")
    ssh = home / ".ssh"
    ssh.mkdir()
    paths = _git_credential_read_paths({"HOME": str(home)})
    texts = {str(p) for p in paths}
    assert str(creds) in texts
    assert str(ssh) in texts


def test_git_in_writable_workspace_reads_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / ".git-credentials").write_text("https://x:y@host\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))
    workspace = tmp_path / "ws"
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["git", "pull"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        cwd=workspace,
        environ={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        platform_name="darwin",
    )
    profile = " ".join(plan.argv)
    assert ".git-credentials" in profile


def test_non_git_command_gets_no_credential_grant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / ".git-credentials").write_text("https://x:y@host\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))
    workspace = tmp_path / "ws"
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["/bin/cat", "inside.txt"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        cwd=workspace,
        environ={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        platform_name="darwin",
    )
    profile = " ".join(plan.argv)
    assert ".git-credentials" not in profile


def test_git_outside_writable_workspace_gets_no_credential_grant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / ".git-credentials").write_text("https://x:y@host\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))
    workspace = tmp_path / "ws"
    workspace.mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    plan = build_command_sandbox_plan(
        ["git", "pull"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        cwd=elsewhere,
        environ={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        platform_name="darwin",
    )
    profile = " ".join(plan.argv)
    assert ".git-credentials" not in profile
