#!/usr/bin/env python3
"""HTTP routes for the data source gateway settings (Desktop "数据源" tab).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from fastapi import FastAPI, Header, HTTPException

from agenticx.cli.config_manager import ConfigManager
from agenticx.data_sources.catalog import DATA_SOURCE_CATALOG


def register_data_sources_routes(app: FastAPI, *, check_token: Callable[[Optional[str]], None]) -> None:
    """Attach ``/api/data-sources/*`` routes to the given FastAPI app."""

    if getattr(app.state, "_data_sources_routes_registered", False):
        return
    app.state._data_sources_routes_registered = True

    def _auth(token: Optional[str]) -> None:
        check_token(token)

    def _effective_section() -> Dict[str, Dict[str, Any]]:
        from agenticx.data_sources.registry import _effective_data_sources_section

        global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH) or {}
        return _effective_data_sources_section(global_data.get("data_sources"))

    def _build_status_items() -> List[Dict[str, Any]]:
        from agenticx.cli.agent_tools import _get_data_source_registry
        from agenticx.runtime.global_mcp_manager import GlobalMcpManager

        registry = _get_data_source_registry()
        loaded = {plugin.name: plugin for plugin in registry.list_plugins()}
        config = _effective_section()

        mcp_connected: set[str] = set()
        try:
            mcp_connected = set(GlobalMcpManager.load_or_init().connected_servers)
        except Exception:
            mcp_connected = set()

        items: List[Dict[str, Any]] = []
        for meta in DATA_SOURCE_CATALOG:
            name = str(meta["name"])
            entry = config.get(name, {})
            enabled = bool(entry.get("enabled", meta.get("default_enabled", False)))
            mcp_server = meta.get("mcp_server")
            stub_only = bool(meta.get("stub_only", False))
            plugin = loaded.get(name)

            if not enabled:
                status = "disabled"
            elif stub_only:
                status = "missing_credential"
            elif mcp_server and mcp_server not in mcp_connected:
                status = "mcp_disconnected"
            elif plugin is None:
                status = "missing_credential" if meta.get("requires_credential") else "unavailable"
            else:
                status = "ready"

            item: Dict[str, Any] = {
                "name": name,
                "display_name": meta["display_name"],
                "domain": meta["domain"],
                "requires_credential": bool(meta.get("requires_credential", False)),
                "enabled": enabled,
                "status": status,
                "stub_only": stub_only,
            }
            if mcp_server:
                item["mcp_server"] = mcp_server
                item["mcp_connected"] = mcp_server in mcp_connected
            if plugin is not None:
                item["apis"] = [
                    {"name": spec.name, "description": spec.description}
                    for spec in plugin.list_apis()
                ]
            elif stub_only:
                from agenticx.data_sources.plugins.ifind_plugin import IFindPlugin

                item["apis"] = [
                    {"name": spec.name, "description": spec.description}
                    for spec in IFindPlugin().list_apis()
                ]
            items.append(item)
        return items

    @app.get("/api/data-sources/config")
    async def get_data_sources_config(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _auth(x_agx_desktop_token)
        return {"data_sources": _effective_section()}

    @app.put("/api/data-sources/config")
    async def put_data_sources_config(
        payload: Dict[str, Any],
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _auth(x_agx_desktop_token)
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="missing 'name'")
        patch = payload.get("patch")
        if not isinstance(patch, dict):
            raise HTTPException(status_code=400, detail="missing 'patch' object")
        ConfigManager.update_section("data_sources", name, patch)
        from agenticx.cli.agent_tools import reset_data_source_registry_cache

        reset_data_source_registry_cache()
        return {"ok": True, "data_sources": _effective_section()}

    @app.get("/api/data-sources/status")
    async def get_data_sources_status(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _auth(x_agx_desktop_token)
        return {"data_sources": _build_status_items()}

    @app.post("/api/data-sources/test")
    async def test_data_source(
        payload: Dict[str, Any],
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        _auth(x_agx_desktop_token)
        from agenticx.cli.agent_tools import _get_data_source_registry

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="missing 'name'")
        registry = _get_data_source_registry()
        plugin = registry.get(name)
        if plugin is None:
            raise HTTPException(status_code=404, detail=f"unknown data source '{name}'")
        apis = plugin.list_apis()
        if not apis:
            return {"ok": False, "detail": "plugin exposes no apis"}
        probe = apis[0]
        params = probe.example_params or {}
        try:
            await registry.call(name, probe.name, params)
            return {"ok": True}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "detail": str(exc)}
