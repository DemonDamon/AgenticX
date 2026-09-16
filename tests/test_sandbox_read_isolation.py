#!/usr/bin/env python3
"""Reads stay inside the workspace on hosts that isolate them.

Author: Damon Li
"""

from __future__ import annotations

import inspect
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from agenticx.runtime.command_sandbox import (
    READ_ONLY,
    _over_broad_read_roots,
    _toolchain_read_roots,
    build_command_sandbox_plan,
    path_deny_enforcement_for_host,
    shell_read_isolation_for_host,
)


def _sandbox_backend_available() -> bool:
    if sys.platform == "darwin":
        return shutil.which("sandbox-exec") is not None
    if sys.platform.startswith("linux"):
        return shutil.which("bwrap") is not None
    return False


posix_isolated = pytest.mark.skipif(
    not _sandbox_backend_available(),
    reason="needs a real OS sandbox backend (sandbox-exec or bwrap)",
)


def _run(workspace: Path, command: str, **kwargs) -> subprocess.CompletedProcess:
    plan = build_command_sandbox_plan(
        ["/bin/sh", "-c", command],
        writable_roots=[workspace],
        cwd=workspace,
        scope_id="read-isolation",
        **kwargs,
    )
    return subprocess.run(
        list(plan.argv),
        env=dict(plan.env),
        cwd=workspace,
        capture_output=True,
        text=True,
    )


@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "inside.txt").write_text("hello\n", encoding="utf-8")
    return ws


@posix_isolated
def test_cat_workspace_file_succeeds(workspace: Path) -> None:
    proc = _run(workspace, "cat inside.txt")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip() == "hello"


@posix_isolated
def test_cat_home_probe_file_fails(workspace: Path) -> None:
    probe = Path.home() / ".agx-read-probe"
    probe.write_text("PLANTED-FAKE-PROBE\n", encoding="utf-8")
    try:
        proc = _run(workspace, f"cat {probe}")
        assert proc.returncode != 0
        combined = (proc.stdout or "") + (proc.stderr or "")
        assert "PLANTED-FAKE-PROBE" not in combined
    finally:
        probe.unlink(missing_ok=True)


@posix_isolated
@pytest.mark.parametrize(
    "binary, args",
    [
        ("python3", ["-c", "print(1)"]),
        ("python", ["-c", "print(1)"]),
        ("node", ["-e", "console.log(1)"]),
    ],
)
def test_toolchain_binaries_still_run(workspace: Path, binary: str, args: list[str]) -> None:
    if shutil.which(binary) is None:
        pytest.skip(f"{binary} is not on PATH")
    quoted = " ".join(shlex_quote(part) for part in [binary, *args])
    proc = _run(workspace, quoted)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def shlex_quote(part: str) -> str:
    import shlex

    return shlex.quote(part)


def test_host_reports_read_isolation_and_deny_enforcement() -> None:
    assert shell_read_isolation_for_host("Windows") == "none"
    assert shell_read_isolation_for_host("win32") == "none"
    assert shell_read_isolation_for_host("Darwin") == "full"
    assert shell_read_isolation_for_host("darwin") == "full"
    assert path_deny_enforcement_for_host("Windows") == "partial"
    assert path_deny_enforcement_for_host("win32") == "partial"


def test_the_two_host_fields_are_not_the_same_implementation() -> None:
    assert inspect.getsource(shell_read_isolation_for_host) != inspect.getsource(
        path_deny_enforcement_for_host
    )
    assert shell_read_isolation_for_host("win32") != path_deny_enforcement_for_host(
        "win32"
    )


def test_the_home_directory_is_never_a_read_root() -> None:
    home = str(Path.home())
    environ = {
        "HOME": home,
        "PATH": os.pathsep.join(["/bin", "/usr/bin", home, "/"]),
        "GOPATH": "/",
        "CARGO_HOME": home,
    }
    roots = _toolchain_read_roots(environ, ["/bin/sh"], host=sys.platform)
    texts = {str(path) for path in roots}
    assert "/" not in texts
    assert home not in texts
    assert "/Users" not in texts and "/home" not in texts


def test_the_block_list_covers_home_from_the_environment() -> None:
    blocked = _over_broad_read_roots({"HOME": "/Users/someone"})
    assert os.path.normcase("/Users/someone") in blocked
    assert os.path.normcase("/") in blocked


@posix_isolated
def test_read_only_tier_still_reads_workspace_and_blocks_writes(workspace: Path) -> None:
    proc = _run(workspace, "cat inside.txt", permissions=READ_ONLY)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.strip() == "hello"
    assert _run(workspace, "echo x > blocked.txt", permissions=READ_ONLY).returncode != 0
    assert not (workspace / "blocked.txt").exists()


def test_linux_does_not_bind_the_whole_root_filesystem(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("shutil.which", lambda name, **_kw: "/usr/bin/bwrap")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["true"],
        writable_roots=[workspace],
        cwd=workspace,
        scope_id="linux-read",
        platform_name="linux",
    )
    argv = list(plan.argv)
    triples = [
        (argv[i], argv[i + 1], argv[i + 2])
        for i, token in enumerate(argv[:-2])
        if token in {"--ro-bind", "--ro-bind-try", "--bind"}
    ]
    assert ("--ro-bind", "/", "/") not in triples
    assert ("--ro-bind-try", "/", "/") not in triples
    assert "--ro-bind-try" in argv
