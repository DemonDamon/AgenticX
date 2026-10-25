#!/usr/bin/env python3
"""Command sandbox network isolation flags.

Author: Damon Li
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from agenticx.runtime.command_sandbox import (
    CommandSandboxError,
    CommandSandboxUnavailable,
    _macos_profile,
    build_command_sandbox_plan,
)


def test_bwrap_unshare_net(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    real_which = shutil.which

    def which(cmd: str, *args: object, **kwargs: object) -> str | None:
        if cmd == "bwrap":
            return "/usr/bin/bwrap"
        return real_which(cmd, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(shutil, "which", which)
    denied = build_command_sandbox_plan(
        ["/bin/true"],
        writable_roots=[workspace],
        platform_name="linux",
        network="deny",
    )
    inherited = build_command_sandbox_plan(
        ["/bin/true"],
        writable_roots=[workspace],
        platform_name="linux",
        network="inherit",
    )
    assert "--unshare-net" in denied.argv
    assert "--unshare-net" not in inherited.argv


def test_macos_profile_denies_network(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    denied = _macos_profile([workspace], deny_network=True)
    inherited = _macos_profile([workspace])
    assert "(deny network-outbound (remote ip))" in denied
    assert "(deny network-outbound (remote ip))" not in inherited


def test_danger_full_access_rejects_deny() -> None:
    with pytest.raises(CommandSandboxUnavailable, match="confined permission tier"):
        build_command_sandbox_plan(
            ["/bin/true"],
            permissions="danger-full-access",
            network="deny",
        )


def test_invalid_network_mode() -> None:
    with pytest.raises(CommandSandboxError, match="invalid network mode"):
        build_command_sandbox_plan(["/bin/true"], network="drop")
