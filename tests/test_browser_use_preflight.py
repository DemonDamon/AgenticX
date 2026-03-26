"""browser-use MCP preflight (uvx browser-use install)."""

from __future__ import annotations

import subprocess

import pytest


def test_preflight_fails_without_uvx(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli import studio_mcp

    monkeypatch.setattr(studio_mcp.shutil, "which", lambda _x: None)
    ok, msg = studio_mcp.preflight_browser_use_install(echo=False)
    assert ok is False
    assert "uvx" in msg


def test_preflight_ok_when_install_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli import studio_mcp

    monkeypatch.setattr(studio_mcp.shutil, "which", lambda _x: "/fake/uvx")

    def fake_run(*_a, **_k):
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(studio_mcp.subprocess, "run", fake_run)
    ok, msg = studio_mcp.preflight_browser_use_install(echo=False)
    assert ok is True
    assert msg == "ok"


def test_preflight_fails_on_nonzero_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli import studio_mcp

    monkeypatch.setattr(studio_mcp.shutil, "which", lambda _x: "/fake/uvx")

    def fake_run(*_a, **_k):
        return subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="boom")

    monkeypatch.setattr(studio_mcp.subprocess, "run", fake_run)
    ok, msg = studio_mcp.preflight_browser_use_install(echo=False)
    assert ok is False
    assert "boom" in msg


def test_is_stock_browser_use_config() -> None:
    from agenticx.cli.studio_mcp import _is_stock_browser_use_mcp_config
    from agenticx.tools.remote_v2 import MCPServerConfig

    cfg = MCPServerConfig(
        name="browser-use",
        command="uvx",
        args=["browser-use[cli]", "--mcp"],
    )
    assert _is_stock_browser_use_mcp_config(cfg) is True
    cfg2 = MCPServerConfig(name="browser-use", command="npx", args=["foo"])
    assert _is_stock_browser_use_mcp_config(cfg2) is False
