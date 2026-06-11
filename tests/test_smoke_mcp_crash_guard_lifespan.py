"""Smoke test: studio lifespan installs mcp_crash_guard before MCP restore."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from starlette.testclient import TestClient


def test_studio_lifespan_calls_install_mcp_crash_guard(monkeypatch):
    install_calls: list[str] = []

    def _fake_install(loop=None):
        install_calls.append("installed")

    mock_gmcp = MagicMock()
    mock_gmcp.schedule_restore = MagicMock()
    mock_gmcp.close_all = AsyncMock()

    monkeypatch.setattr(
        "agenticx.runtime.mcp_crash_guard.install_mcp_crash_guard",
        _fake_install,
    )
    monkeypatch.setattr(
        "agenticx.runtime.global_mcp_manager.GlobalMcpManager.load_or_init",
        lambda: mock_gmcp,
    )
    monkeypatch.setattr(
        "agenticx.runtime.global_mcp_manager.GlobalMcpManager.singleton",
        lambda: mock_gmcp,
    )
    monkeypatch.setattr(
        "agenticx.studio.supervisor.maybe_start_supervisor",
        AsyncMock(),
    )

    from agenticx.studio.server import create_studio_app

    app = create_studio_app()
    with TestClient(app) as _client:
        pass

    assert install_calls == ["installed"]
    mock_gmcp.schedule_restore.assert_called_once()


def test_server_module_imports_cleanly():
    import agenticx.studio.server  # noqa: F401
