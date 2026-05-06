#!/usr/bin/env python3
"""Process-level singleton for MCP connections.

All Machi sessions share a single MCPHub and a single ``connected_servers``
set.  New sessions are therefore MCP-ready instantly without spawning extra
child processes.

Lifecycle
---------
1. ``GlobalMcpManager.load_or_init()`` is called once at ``agx serve`` startup
   (inside the FastAPI lifespan or create_studio_app).
2. ``restore_from_last_session()`` runs in the background to reconnect servers
   that were connected the last time Machi ran.
3. On shutdown ``close_all()`` gracefully terminates every stdio child.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Dict, Optional, Set, TYPE_CHECKING

from agenticx.runtime.global_mcp_state import (
    add_to_last_connected,
    read_last_connected,
    remove_from_last_connected,
    write_last_connected,
)

if TYPE_CHECKING:
    from agenticx.tools.mcp_hub import MCPHub
    from agenticx.tools.remote_v2 import MCPServerConfig


def mcp_connect_async(hub, configs, connected, name):  # type: ignore[no-untyped-def]
    """Thin shim so tests can monkeypatch agenticx.runtime.global_mcp_manager.mcp_connect_async."""
    from agenticx.cli.studio_mcp import mcp_connect_async as _real

    return _real(hub, configs, connected, name)


def mcp_disconnect_async(hub, configs, connected, name):  # type: ignore[no-untyped-def]
    """Thin shim so tests can monkeypatch agenticx.runtime.global_mcp_manager.mcp_disconnect_async."""
    from agenticx.cli.studio_mcp import mcp_disconnect_async as _real

    return _real(hub, configs, connected, name)

logger = logging.getLogger(__name__)

# Maximum parallel reconnections on startup.
_RESTORE_CONCURRENCY = 4


class GlobalMcpManager:
    """Singleton that owns the process-level MCPHub and connection state."""

    _instance: Optional["GlobalMcpManager"] = None

    def __init__(self) -> None:
        from agenticx.tools.mcp_hub import MCPHub

        self._hub: MCPHub = MCPHub(clients=[], auto_mode=False)
        self._connected_servers: Set[str] = set()
        self._mcp_configs: Dict[str, "MCPServerConfig"] = {}
        self._configs_mtime: float = 0.0
        self._restore_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Singleton access
    # ------------------------------------------------------------------

    @classmethod
    def singleton(cls) -> "GlobalMcpManager":
        """Return the process-level singleton (must call load_or_init first)."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def load_or_init(cls) -> "GlobalMcpManager":
        """Create (or return) the singleton and load MCP configs from disk."""
        inst = cls.singleton()
        inst._reload_configs_if_needed()
        return inst

    @classmethod
    def reset_for_testing(cls) -> None:
        """Destroy the singleton so unit tests start with a clean slate."""
        cls._instance = None

    # ------------------------------------------------------------------
    # Properties (read-through views used by StudioSession proxies)
    # ------------------------------------------------------------------

    @property
    def hub(self) -> "MCPHub":
        return self._hub

    @property
    def connected_servers(self) -> Set[str]:
        return self._connected_servers

    @property
    def mcp_configs(self) -> Dict[str, "MCPServerConfig"]:
        self._reload_configs_if_needed()
        return self._mcp_configs

    # ------------------------------------------------------------------
    # Config hot-reload
    # ------------------------------------------------------------------

    def _config_mtime(self) -> float:
        """Max mtime of all MCP config files (best-effort; 0 on error)."""
        try:
            from agenticx.cli.studio_mcp import all_mcp_config_search_paths

            paths = all_mcp_config_search_paths()
            mtimes = []
            for p in paths:
                try:
                    mtimes.append(os.path.getmtime(p))
                except OSError:
                    pass
            return max(mtimes) if mtimes else 0.0
        except Exception:
            return 0.0

    def _reload_configs_if_needed(self) -> None:
        mtime = self._config_mtime()
        if mtime <= self._configs_mtime and self._mcp_configs:
            return
        try:
            from agenticx.cli.studio_mcp import load_available_servers

            self._mcp_configs = load_available_servers()
            self._configs_mtime = mtime or time.time()
            logger.debug("GlobalMcpManager: reloaded %d MCP configs", len(self._mcp_configs))
        except Exception as exc:
            logger.warning("GlobalMcpManager: failed to load MCP configs: %s", exc)
            if not self._mcp_configs:
                self._mcp_configs = {}

    # ------------------------------------------------------------------
    # Startup restore
    # ------------------------------------------------------------------

    def schedule_restore(self) -> None:
        """Fire-and-forget background restore (call from sync startup context)."""
        try:
            loop = asyncio.get_running_loop()
            self._restore_task = loop.create_task(self.restore_from_last_session())
        except RuntimeError:
            # No running loop — can happen in tests or CLI contexts; skip silently.
            logger.debug("GlobalMcpManager.schedule_restore: no running event loop, skipping")

    async def restore_from_last_session(self) -> None:
        """Connect servers listed in mcp_state.json, up to _RESTORE_CONCURRENCY at a time."""
        names = read_last_connected()
        if not names:
            return
        self._reload_configs_if_needed()
        logger.info("GlobalMcpManager: restoring %d MCP server(s): %s", len(names), names)

        semaphore = asyncio.Semaphore(_RESTORE_CONCURRENCY)

        async def _connect_one_safe(name: str) -> None:
            async with semaphore:
                ok, err = await self.connect_one(name, _persist=False)
                if not ok:
                    logger.warning(
                        "GlobalMcpManager: restore failed for '%s': %s", name, err
                    )

        await asyncio.gather(*(_connect_one_safe(n) for n in names), return_exceptions=True)

        # Persist the actually-connected set (failures are excluded).
        write_last_connected(sorted(self._connected_servers))
        logger.info(
            "GlobalMcpManager: restore done — connected: %s", sorted(self._connected_servers)
        )

    # ------------------------------------------------------------------
    # Connect / disconnect
    # ------------------------------------------------------------------

    async def connect_one(self, name: str, *, _persist: bool = True) -> tuple[bool, str]:
        """Connect a single MCP server by name and (optionally) persist to state file."""
        self._reload_configs_if_needed()
        ok, err = await mcp_connect_async(
            self._hub, self._mcp_configs, self._connected_servers, name
        )
        if ok and _persist:
            add_to_last_connected(name)
        return ok, err

    async def disconnect_one(self, name: str) -> tuple[bool, str]:
        """Disconnect a single MCP server by name and persist."""
        self._reload_configs_if_needed()
        ok, err = await mcp_disconnect_async(
            self._hub, self._mcp_configs, self._connected_servers, name
        )
        if ok:
            remove_from_last_connected(name)
        return ok, err

    async def close_all(self) -> None:
        """Gracefully terminate all MCP child processes (call on server shutdown)."""
        logger.info("GlobalMcpManager: closing all MCP connections (%d)", len(self._connected_servers))
        try:
            await self._hub.close()
        except Exception as exc:
            logger.warning("GlobalMcpManager: hub.close() error: %s", exc)
        self._connected_servers.clear()

    # ------------------------------------------------------------------
    # Read-only helpers
    # ------------------------------------------------------------------

    def get_tool_names_by_server(self) -> Dict[str, list]:
        """Return {server_name: [routed_tool_name, ...]} for all connected servers."""
        result: Dict[str, list] = {}
        for routed_name, route in self._hub._tool_routing.items():
            server_name = route.client.server_config.name
            result.setdefault(server_name, []).append(routed_name)
        return result
