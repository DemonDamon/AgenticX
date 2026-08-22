"""Focused tests for the OS-enforced Studio command sandbox."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agenticx.cli import agent_tools
from agenticx.runtime import command_sandbox
from agenticx.runtime.command_sandbox import (
    DANGER_FULL_ACCESS,
    WORKSPACE_WRITE,
    CommandSandboxError,
    CommandSandboxUnavailable,
    build_command_sandbox_plan,
    normalize_command_permissions,
)
from agenticx.cli.studio import StudioSession


def test_permissions_default_to_workspace_write() -> None:
    assert normalize_command_permissions(None) == WORKSPACE_WRITE
    assert normalize_command_permissions("") == WORKSPACE_WRITE


def test_unknown_permissions_are_rejected() -> None:
    with pytest.raises(CommandSandboxError, match="unsupported sandbox_permissions"):
        normalize_command_permissions("unrestricted")


def test_danger_full_access_keeps_raw_argv_and_environment(tmp_path: Path) -> None:
    plan = build_command_sandbox_plan(
        ["echo", "ok"],
        permissions=DANGER_FULL_ACCESS,
        writable_roots=[tmp_path],
        environ={"EXAMPLE": "1"},
        platform_name="unsupported-test-host",
    )
    assert plan.argv == ("echo", "ok")
    assert plan.env == {"EXAMPLE": "1"}
    assert plan.backend == "none"
    assert plan.writable_roots == ()


def test_macos_plan_denies_global_writes_and_allows_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["/usr/bin/touch", "marker"],
        permissions=WORKSPACE_WRITE,
        writable_roots=[workspace],
        scope_id="session-a",
        cwd=workspace,
        environ={"PATH": "/usr/bin:/bin"},
        platform_name="darwin",
    )

    assert plan.argv[:2] == ("/usr/bin/sandbox-exec", "-p")
    assert plan.argv[-2:] == ("/usr/bin/touch", "marker")
    profile = plan.argv[2]
    assert "(deny file-write*)" in profile
    assert f'(subpath "{workspace}")' in profile
    assert plan.temp_dir is not None
    assert f'(subpath "{plan.temp_dir}")' in profile
    assert plan.env["TMPDIR"] == str(plan.temp_dir)
    assert plan.backend == "macos-sandbox-exec"


def test_macos_profile_escapes_workspace_path(tmp_path: Path) -> None:
    workspace = tmp_path / 'quote"slash\\path'
    workspace.mkdir()
    plan = build_command_sandbox_plan(
        ["true"],
        writable_roots=[workspace],
        scope_id="escaped-path",
        platform_name="darwin",
    )
    profile = plan.argv[2]
    assert '\\"' in profile
    assert "\\\\" in profile


def test_linux_workspace_write_fails_closed_without_bubblewrap(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(command_sandbox.shutil, "which", lambda _name: None)
    with pytest.raises(CommandSandboxUnavailable, match="bubblewrap"):
        build_command_sandbox_plan(
            ["true"],
            writable_roots=[tmp_path],
            platform_name="linux",
        )


def test_unsupported_host_workspace_write_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(CommandSandboxUnavailable, match="no supported OS sandbox"):
        build_command_sandbox_plan(
            ["true"],
            writable_roots=[tmp_path],
            platform_name="plan9",
        )


@pytest.mark.asyncio
async def test_danger_full_access_always_requires_escalation_confirmation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[tuple[str, dict]] = []

    async def _approve(question: str, **kwargs: object) -> bool:
        calls.append((question, dict(kwargs.get("context") or {})))
        return True

    monkeypatch.setattr(agent_tools, "_confirm", _approve)
    session = StudioSession(workspace_dir=str(tmp_path))
    prepared = await agent_tools._bash_exec_prepare(
        "ls",
        {"command": "ls", "sandbox_permissions": DANGER_FULL_ACCESS},
        session,
        tool_name="bash_exec",
        confirm_gate=MagicMock(),
        emit_event=None,
    )

    assert not isinstance(prepared, str)
    assert prepared.argv == ["ls"]
    assert prepared.sandbox_permissions == DANGER_FULL_ACCESS
    assert prepared.sandbox_backend == "none"
    assert len(calls) == 1
    assert calls[0][1]["risk"] == "permission_escalation"


@pytest.mark.asyncio
async def test_danger_full_access_denial_never_builds_launch_plan(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def _deny(*_args: object, **_kwargs: object) -> bool:
        return False

    def _must_not_build(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("denied escalation must not build a subprocess plan")

    monkeypatch.setattr(agent_tools, "_confirm", _deny)
    monkeypatch.setattr(agent_tools, "build_command_sandbox_plan", _must_not_build)
    session = StudioSession(workspace_dir=str(tmp_path))
    result = await agent_tools._bash_exec_prepare(
        "ls",
        {"command": "ls", "sandbox_permissions": DANGER_FULL_ACCESS},
        session,
        tool_name="bash_exec",
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    assert isinstance(result, str)
    assert result.startswith("CANCELLED: 未批准 danger-full-access")


def test_bash_tool_schemas_expose_only_two_permission_levels() -> None:
    by_name = {
        item["function"]["name"]: item["function"]["parameters"]
        for item in agent_tools.STUDIO_TOOLS
        if item.get("type") == "function"
    }
    for name in ("bash_exec", "bash_bg_start"):
        schema = by_name[name]["properties"]["sandbox_permissions"]
        assert schema["enum"] == [WORKSPACE_WRITE, DANGER_FULL_ACCESS]
