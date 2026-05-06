"""Tests for GlobalMcpManager.restore_from_last_session().

AC-1.2: Given mcp_state.json with ["A", "B"], restore_from_last_session() results
        in connected_servers == {"A"} when B fails, or {"A", "B"} when both succeed.
"""

from __future__ import annotations

import asyncio
import json
from typing import Set

import pytest


class TestRestoreFromLastSession:
    def setup_method(self):
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        GlobalMcpManager.reset_for_testing()

    def _patch_state_path(self, monkeypatch, state_file):
        monkeypatch.setattr(
            "agenticx.runtime.global_mcp_state._state_path",
            lambda: state_file,
        )

    def _patch_connect(self, monkeypatch, fail_names: Set[str]):
        """Patch mcp_connect_async so that servers in *fail_names* fail."""

        async def _mock_connect(hub, configs, connected, name):
            if name in fail_names:
                return False, f"simulated failure for {name}"
            connected.add(name)
            return True, ""

        import agenticx.runtime.global_mcp_manager as _mod

        monkeypatch.setattr(_mod, "mcp_connect_async", _mock_connect)

    def test_both_succeed(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps({"last_connected": ["A", "B"], "updated_at": 0.0}), encoding="utf-8"
        )
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch, fail_names=set())

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"A": object(), "B": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert manager.connected_servers == {"A", "B"}

    def test_one_fails_only_success_retained(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps({"last_connected": ["A", "B"], "updated_at": 0.0}), encoding="utf-8"
        )
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch, fail_names={"B"})

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"A": object(), "B": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert "A" in manager.connected_servers
        assert "B" not in manager.connected_servers

    def test_empty_state_is_noop(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        # No state file — restore should be a no-op.
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch, fail_names=set())

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        manager = GlobalMcpManager.load_or_init()
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert manager.connected_servers == set()

    def test_state_file_updated_after_restore(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps({"last_connected": ["A", "B"], "updated_at": 0.0}), encoding="utf-8"
        )
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch, fail_names={"B"})

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"A": object(), "B": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        data = json.loads(state_file.read_text())
        assert data["last_connected"] == ["A"], (
            "state file should contain only successfully connected servers after restore"
        )
