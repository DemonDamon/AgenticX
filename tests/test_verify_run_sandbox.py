#!/usr/bin/env python3
"""verify_run and delegated sessions use the same OS sandbox.

Author: Damon Li
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

from agenticx.project_state.store import ProjectStore
from agenticx.project_state.verify import run_verify
from agenticx.runtime.command_sandbox import CommandSandboxUnavailable
from agenticx.runtime.meta_tools import inherit_session_sandbox_policy


def _sandbox_backend_available() -> bool:
    if sys.platform == "darwin":
        return shutil.which("sandbox-exec") is not None
    if sys.platform.startswith("linux"):
        return shutil.which("bwrap") is not None
    return False


posix_isolated = pytest.mark.skipif(
    not _sandbox_backend_available(),
    reason="needs a real OS sandbox backend",
)


@pytest.fixture()
def project(tmp_path: Path):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    store = ProjectStore.open(workspace, create=True)
    return store, workspace, outside


def _write_steps(store: ProjectStore, cmd: str) -> None:
    store.verify_yaml_path.write_text(
        "schema_version: 1\nsteps:\n  - name: probe\n    type: shell\n    cmd: "
        f"{cmd!r}\n",
        encoding="utf-8",
    )


@posix_isolated
def test_verify_cannot_write_outside_the_workspace(project) -> None:
    store, workspace, outside = project
    target = outside / "planted.txt"
    _write_steps(store, f"echo pwned > {target}")
    result = run_verify(store, workspace_root=workspace)
    assert result.passed is False
    assert not target.exists()


@posix_isolated
def test_verify_can_write_inside_the_workspace(project) -> None:
    store, workspace, _ = project
    _write_steps(store, "echo ok > built.txt && cat built.txt")
    result = run_verify(store, workspace_root=workspace)
    assert result.passed is True, result.steps[0].log_excerpt
    assert (workspace / "built.txt").read_text(encoding="utf-8").strip() == "ok"


def test_delegated_session_inherits_parent_sandbox_tier() -> None:
    class _Session:
        pass

    parent = _Session()
    parent.command_permissions = "read-only"
    parent.path_rules = [{"pattern": "**/.env", "allow": False}]
    child = _Session()
    inherit_session_sandbox_policy(parent, child)
    assert child.command_permissions == "read-only"
    assert child.path_rules == [{"pattern": "**/.env", "allow": False}]
    assert child.command_permissions != "workspace-write"


def test_delegated_session_snapshots_config_when_parent_has_no_attrs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(
        ConfigManager,
        "get_value",
        staticmethod(
            lambda key, *a, **k: (
                "read-only"
                if key == "permissions.command_permissions"
                else [{"pattern": "secrets/**", "allow": False}]
                if key == "permissions.path_rules"
                else None
            )
        ),
    )

    class _Session:
        pass

    parent = _Session()
    child = _Session()
    inherit_session_sandbox_policy(parent, child)
    assert child.command_permissions == "read-only"
    assert child.path_rules == [{"pattern": "secrets/**", "allow": False}]


def test_missing_sandbox_backend_fails_the_step_without_running(
    project, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, workspace, _ = project
    _write_steps(store, "echo should-not-run > ran.txt")
    monkeypatch.setattr(
        "agenticx.project_state.verify.build_command_sandbox_plan",
        lambda *a, **k: (_ for _ in ()).throw(
            CommandSandboxUnavailable("no backend here")
        ),
    )
    result = run_verify(store, workspace_root=workspace)
    assert result.passed is False
    assert result.steps[0].exit_code == 126
    assert "sandbox unavailable" in (result.steps[0].log_excerpt or "").lower()
    assert not (workspace / "ran.txt").exists()
