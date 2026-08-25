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
