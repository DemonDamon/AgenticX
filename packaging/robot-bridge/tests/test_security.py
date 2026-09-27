#!/usr/bin/env python3
"""Tests for the input guard, token file handling and local-only binding.

Author: Hongyi Zhao
"""

from __future__ import annotations

import builtins
import os
import stat
import sys

import pytest

from agx_robot_bridge import cli
from agx_robot_bridge.errors import InteractiveInputBlocked
from agx_robot_bridge.security import install_input_guard, load_or_create_token


def test_input_guard(monkeypatch):
    monkeypatch.setattr(builtins, "input", builtins.input)
    monkeypatch.setattr(sys, "stdin", sys.stdin)
    install_input_guard()
    try:
        with pytest.raises(InteractiveInputBlocked, match="'x'"):
            input("x")
        assert sys.stdin.name == os.devnull
        guarded = sys.stdin
        install_input_guard()
        assert sys.stdin is guarded
    finally:
        if getattr(sys.stdin, "name", None) == os.devnull:
            sys.stdin.close()


def test_token_file_created_0600(tmp_path):
    path = tmp_path / "nested" / "robot_bridge.token"
    token = load_or_create_token(path)
    assert path.is_file()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert len(token) >= 32
    assert load_or_create_token(path) == token


def test_empty_token_file_is_regenerated(tmp_path):
    path = tmp_path / "robot_bridge.token"
    path.write_text("  \n", encoding="utf-8")
    path.chmod(0o644)
    token = load_or_create_token(path)
    assert token and path.read_text(encoding="utf-8").strip() == token
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_cli_rejects_public_host(monkeypatch):
    def _must_not_run(*_args, **_kwargs):
        pytest.fail("serve must exit before touching stdin, tokens or the server")

    monkeypatch.setattr(cli, "install_input_guard", _must_not_run)
    monkeypatch.setattr(cli.uvicorn, "run", _must_not_run)
    with pytest.raises(SystemExit) as exc:
        cli.main(["serve", "--host", "0.0.0.0", "--backend", "fake"])
    assert exc.value.code == 2


def test_cli_serve_wiring(monkeypatch, tmp_path):
    calls: dict = {}
    monkeypatch.setattr(cli, "install_input_guard", lambda: calls.setdefault("guard", True))
    monkeypatch.setattr(cli, "_configure_logging", lambda path: calls.setdefault("log", path))
    monkeypatch.setattr(cli.uvicorn, "run", lambda app, **kwargs: calls.setdefault("run", (app, kwargs)))
    token_file = tmp_path / "t.token"
    cli.main(
        [
            "serve",
            "--host",
            "localhost",
            "--port",
            "18999",
            "--backend",
            "fake",
            "--token-file",
            str(token_file),
            "--snapshot-dir",
            str(tmp_path / "snaps"),
        ]
    )
    assert calls["guard"] is True
    assert token_file.is_file()
    app, kwargs = calls["run"]
    assert kwargs["host"] == "localhost" and kwargs["port"] == 18999
    assert kwargs["timeout_graceful_shutdown"] == 20
    assert kwargs["log_config"] is None
    assert app.state.manager is not None
