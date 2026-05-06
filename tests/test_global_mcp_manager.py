"""Tests for GlobalMcpManager singleton and basic connect/disconnect flow.

AC-1.1: init creates only one MCPHub; connect_one / disconnect_one update mcp_state.json.
"""

from __future__ import annotations

import json
import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_cfg(name: str = "foo") -> MagicMock:
    cfg = MagicMock()
    cfg.name = name
    cfg.command = "echo"
    cfg.args = []
    cfg.env = {}
    cfg.timeout = 60.0
    cfg.cwd = None
    return cfg


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGlobalMcpManagerSingleton:
    def setup_method(self):
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        GlobalMcpManager.reset_for_testing()

    def test_load_or_init_returns_same_instance(self):
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        inst1 = GlobalMcpManager.load_or_init()
        inst2 = GlobalMcpManager.singleton()
        assert inst1 is inst2, "singleton() must return the same object as load_or_init()"

    def test_only_one_mcp_hub_created(self):
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager
        from agenticx.tools.mcp_hub import MCPHub

        hub_instances: list[MCPHub] = []
        original_init = MCPHub.__init__

        def counting_init(self, *args, **kwargs):
            hub_instances.append(self)
            original_init(self, *args, **kwargs)

        with patch.object(MCPHub, "__init__", counting_init):
            GlobalMcpManager.reset_for_testing()
            GlobalMcpManager.load_or_init()
            GlobalMcpManager.load_or_init()  # second call must NOT create another hub

        assert len(hub_instances) == 1, (
            f"Expected exactly 1 MCPHub, got {len(hub_instances)}"
        )


class TestConnectDisconnectPersistence:
    """connect_one / disconnect_one must update mcp_state.json."""

    def setup_method(self):
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        GlobalMcpManager.reset_for_testing()

    def test_connect_one_adds_to_state_file(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        monkeypatch.setattr(
            "agenticx.runtime.global_mcp_state._state_path",
            lambda: state_file,
        )

        manager = _make_manager_with_mock_connect(monkeypatch, "foo", success=True)

        asyncio.run(manager.connect_one("foo"))

        assert state_file.exists(), "mcp_state.json must be created after connect"
        data = json.loads(state_file.read_text())
        assert "foo" in data["last_connected"], "connected server must appear in last_connected"

    def test_disconnect_one_removes_from_state_file(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps({"last_connected": ["foo"], "updated_at": 0.0}), encoding="utf-8"
        )
        monkeypatch.setattr(
            "agenticx.runtime.global_mcp_state._state_path",
            lambda: state_file,
        )

        manager = _make_manager_with_mock_disconnect(monkeypatch, "foo", success=True)
        # Pretend foo is already connected.
        manager._connected_servers.add("foo")

        asyncio.run(manager.disconnect_one("foo"))

        data = json.loads(state_file.read_text())
        assert "foo" not in data["last_connected"], "disconnected server must be removed from last_connected"

    def test_failed_connect_does_not_persist(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        monkeypatch.setattr(
            "agenticx.runtime.global_mcp_state._state_path",
            lambda: state_file,
        )

        manager = _make_manager_with_mock_connect(monkeypatch, "bar", success=False)

        asyncio.run(manager.connect_one("bar"))

        if state_file.exists():
            data = json.loads(state_file.read_text())
            assert "bar" not in data.get("last_connected", [])


# ---------------------------------------------------------------------------
# Factories for mocked managers
# ---------------------------------------------------------------------------


def _make_manager_with_mock_connect(monkeypatch, name: str, *, success: bool):
    from agenticx.runtime.global_mcp_manager import GlobalMcpManager

    GlobalMcpManager.reset_for_testing()
    manager = GlobalMcpManager.load_or_init()

    cfg = _make_mock_cfg(name)
    manager._mcp_configs = {name: cfg}
    manager._configs_mtime = 9999.0  # prevent reload

    async def _mock_connect(hub, configs, connected, n):
        if success:
            connected.add(n)
            return True, ""
        return False, "mock failure"

    monkeypatch.setattr("agenticx.runtime.global_mcp_manager.mcp_connect_async", _mock_connect)
    # Patch the import inside connect_one as well
    import agenticx.runtime.global_mcp_manager as _mod
    monkeypatch.setattr(_mod, "mcp_connect_async", _mock_connect)

    return manager


def _make_manager_with_mock_disconnect(monkeypatch, name: str, *, success: bool):
    from agenticx.runtime.global_mcp_manager import GlobalMcpManager

    GlobalMcpManager.reset_for_testing()
    manager = GlobalMcpManager.load_or_init()

    cfg = _make_mock_cfg(name)
    manager._mcp_configs = {name: cfg}
    manager._configs_mtime = 9999.0

    async def _mock_disconnect(hub, configs, connected, n):
        if success:
            connected.discard(n)
            return True, ""
        return False, "mock failure"

    import agenticx.runtime.global_mcp_manager as _mod
    monkeypatch.setattr(_mod, "mcp_disconnect_async", _mock_disconnect)

    return manager
