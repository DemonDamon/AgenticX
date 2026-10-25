#!/usr/bin/env python3
"""HOME isolation and command-sandbox probe policy.

Author: Damon Li
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from agenticx.runtime.command_sandbox import CommandSandboxUnavailable
from agenticx.runtime.session_boundary import sessions_root

from ma_agent_runtime.isolation import (
    RUNTIME_CONFIG_YAML,
    RuntimeIsolationError,
    ensure_isolated_home,
    probe_command_sandbox,
    write_runtime_config,
)


def test_home_must_match(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home_a = tmp_path / "a"
    home_b = tmp_path / "b"
    monkeypatch.setenv("HOME", str(home_a))
    with pytest.raises(RuntimeIsolationError):
        ensure_isolated_home(home_b)


def test_creates_sessions_root_equal_to_session_boundary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    data_dir = ensure_isolated_home(home)
    assert data_dir == home / ".agenticx"
    assert sessions_root() == home / ".agenticx" / "sessions"
    assert sessions_root().is_dir()


def test_write_runtime_config(tmp_path: Path) -> None:
    path = write_runtime_config(tmp_path)
    assert path.read_text(encoding="utf-8") == RUNTIME_CONFIG_YAML
    assert path.stat().st_mode & 0o777 == 0o600


def test_probe_required_raises_when_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise CommandSandboxUnavailable("no bwrap")

    monkeypatch.setattr("ma_agent_runtime.isolation.build_command_sandbox_plan", boom)
    with pytest.raises(RuntimeIsolationError, match="no bwrap"):
        probe_command_sandbox(tmp_path, mode="required")


def test_probe_best_effort_returns_none(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise CommandSandboxUnavailable("no bwrap")

    monkeypatch.setattr("ma_agent_runtime.isolation.build_command_sandbox_plan", boom)
    with caplog.at_level(logging.WARNING):
        assert probe_command_sandbox(tmp_path, mode="best_effort") == "none"
    assert any(record.levelno == logging.WARNING for record in caplog.records)


def test_probe_success_returns_backend(tmp_path: Path) -> None:
    class _Proc:
        returncode = 0
        stderr = b""

    def runner(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return _Proc()

    backend = probe_command_sandbox(tmp_path, mode="required", runner=runner)
    assert backend
    assert backend != "none"
