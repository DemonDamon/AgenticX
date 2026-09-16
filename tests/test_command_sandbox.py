#!/usr/bin/env python3
"""Focused tests for the OS-enforced Studio command sandbox.

Author: Damon Li
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
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
    (home / ".git-credentials").write_text("https://x:y@host\n", encoding="utf-8")
    ssh = home / ".ssh"
    ssh.mkdir()
    paths = _git_credential_read_paths({"HOME": str(home)})
    texts = {str(p) for p in paths}
    assert str(ssh) in texts
    assert not any(str(p).endswith(".git-credentials") for p in paths)


def _assert_sandboxed_git_uses_temp_store(plan, home: Path, secret: str) -> None:
    assert plan.env["GIT_TERMINAL_PROMPT"] == "0"
    assert plan.env["GIT_CONFIG_COUNT"] == "2"
    assert plan.env["GIT_CONFIG_KEY_0"] == "credential.helper"
    assert plan.env["GIT_CONFIG_VALUE_0"] == ""
    assert plan.env["GIT_CONFIG_KEY_1"] == "credential.helper"
    store_file = Path(plan.env["GIT_CONFIG_VALUE_1"].removeprefix("store --file="))
    assert store_file.is_file()
    assert secret in store_file.read_text(encoding="utf-8")
    assert store_file.parent == plan.temp_dir
    profile = " ".join(plan.argv)
    assert str(home / ".git-credentials") not in profile


def test_git_in_writable_workspace_stages_store_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    secret = "https://x:y@example.com\n"
    (home / ".git-credentials").write_text(secret, encoding="utf-8")
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
    _assert_sandboxed_git_uses_temp_store(plan, home, secret)
    profile = " ".join(plan.argv)
    assert ".ssh" not in profile


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
    assert "GIT_CONFIG_COUNT" not in plan.env
    assert plan.env.get("GIT_TERMINAL_PROMPT") != "0"


def test_git_outside_writable_workspace_still_avoids_keychain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    secret = "https://x:y@example.com\n"
    (home / ".git-credentials").write_text(secret, encoding="utf-8")
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
    _assert_sandboxed_git_uses_temp_store(plan, home, secret)
    profile = " ".join(plan.argv)
    assert str(home / ".ssh") not in profile


def test_git_in_writable_workspace_grants_ssh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    home.mkdir()
    ssh = home / ".ssh"
    ssh.mkdir()
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
    assert str(ssh.resolve()) in " ".join(plan.argv)


@pytest.mark.skipif(
    sys.platform != "darwin" or shutil.which("sandbox-exec") is None,
    reason="needs macOS sandbox-exec",
)
def test_sandboxed_git_credential_fill_uses_store_not_keychain(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    (home / ".git-credentials").write_text(
        "https://sandbox-user:sandbox-token@example.com\n",
        encoding="utf-8",
    )
    workspace = tmp_path / "ws"
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["git", "credential", "fill"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        cwd=workspace,
        environ={
            "HOME": str(home),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        },
        platform_name="darwin",
    )
    proc = subprocess.run(
        list(plan.argv),
        input="protocol=https\nhost=example.com\n\n",
        env=dict(plan.env),
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "sandbox-user" in proc.stdout
    assert "sandbox-token" in proc.stdout
