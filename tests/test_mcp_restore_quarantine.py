"""Tests for GlobalMcpManager restore quarantine and timeout behavior."""

from __future__ import annotations

import asyncio
import json
from typing import Set

import pytest


class TestRestoreQuarantine:
    def setup_method(self):
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        GlobalMcpManager.reset_for_testing()

    def _patch_state_path(self, monkeypatch, state_file):
        monkeypatch.setattr(
            "agenticx.runtime.global_mcp_state._state_path",
            lambda: state_file,
        )

    def _patch_connect(self, monkeypatch, fail_names: Set[str] | None = None, slow_names: Set[str] | None = None):
        fail_names = fail_names or set()
        slow_names = slow_names or set()

        async def _mock_connect(hub, configs, connected, name):
            if name in slow_names:
                await asyncio.sleep(5)
            if name in fail_names:
                return False, f"simulated failure for {name}"
            connected.add(name)
            return True, ""

        import agenticx.runtime.global_mcp_manager as _mod

        monkeypatch.setattr(_mod, "mcp_connect_async", _mock_connect)

    def test_failure_records_quarantine_count(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps({"last_connected": ["bad-mcp"], "updated_at": 0.0}),
            encoding="utf-8",
        )
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch, fail_names={"bad-mcp"})

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager
        from agenticx.runtime.global_mcp_state import read_quarantined

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"bad-mcp": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert read_quarantined() == {"bad-mcp": 1}

    def test_quarantined_server_skipped_on_restore(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps(
                {
                    "last_connected": ["bad-mcp", "good-mcp"],
                    "quarantined": {"bad-mcp": 2},
                    "updated_at": 0.0,
                }
            ),
            encoding="utf-8",
        )
        self._patch_state_path(monkeypatch, state_file)
        connect_calls: list[str] = []

        async def _mock_connect(hub, configs, connected, name):
            connect_calls.append(name)
            connected.add(name)
            return True, ""

        import agenticx.runtime.global_mcp_manager as _mod

        monkeypatch.setattr(_mod, "mcp_connect_async", _mock_connect)

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"bad-mcp": object(), "good-mcp": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert connect_calls == ["good-mcp"]
        assert "good-mcp" in manager.connected_servers

    def test_timeout_counts_as_failure_without_blocking_others(self, tmp_path, monkeypatch):
        import agenticx.runtime.global_mcp_manager as _mod

        monkeypatch.setattr(_mod, "_RESTORE_CONNECT_TIMEOUT", 0.05)

        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps({"last_connected": ["slow-mcp", "fast-mcp"], "updated_at": 0.0}),
            encoding="utf-8",
        )
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch, slow_names={"slow-mcp"})

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager
        from agenticx.runtime.global_mcp_state import read_quarantined

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"slow-mcp": object(), "fast-mcp": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert "fast-mcp" in manager.connected_servers
        assert "slow-mcp" not in manager.connected_servers
        assert read_quarantined().get("slow-mcp") == 1

    def test_success_clears_quarantine(self, tmp_path, monkeypatch):
        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps(
                {
                    "last_connected": ["good-mcp"],
                    "quarantined": {"good-mcp": 1},
                    "updated_at": 0.0,
                }
            ),
            encoding="utf-8",
        )
        self._patch_state_path(monkeypatch, state_file)
        self._patch_connect(monkeypatch)

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager
        from agenticx.runtime.global_mcp_state import read_quarantined

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"good-mcp": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert read_quarantined() == {}

    def test_threshold_zero_never_skips(self, tmp_path, monkeypatch):
        import agenticx.runtime.global_mcp_manager as _mod

        monkeypatch.setattr(_mod, "_RESTORE_QUARANTINE_THRESHOLD", 0)

        state_file = tmp_path / "mcp_state.json"
        state_file.write_text(
            json.dumps(
                {
                    "last_connected": ["bad-mcp"],
                    "quarantined": {"bad-mcp": 99},
                    "updated_at": 0.0,
                }
            ),
            encoding="utf-8",
        )
        self._patch_state_path(monkeypatch, state_file)
        connect_calls: list[str] = []

        async def _mock_connect(hub, configs, connected, name):
            connect_calls.append(name)
            return False, "still bad"

        import agenticx.runtime.global_mcp_manager as _mod

        monkeypatch.setattr(_mod, "mcp_connect_async", _mock_connect)

        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        manager = GlobalMcpManager.load_or_init()
        manager._mcp_configs = {"bad-mcp": object()}
        manager._configs_mtime = 9999.0

        asyncio.run(manager.restore_from_last_session())

        assert connect_calls == ["bad-mcp"]
