#!/usr/bin/env python3
"""Registry that loads and routes data source plugins.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import importlib
import logging
from typing import Any, Callable, Dict, List, Optional

from agenticx.cli.config_manager import ConfigManager
from agenticx.data_sources.base import DataSourcePlugin, DataSourceResult
from agenticx.data_sources.errors import (
    DataSourceApiNotFoundError,
    DataSourceNotFoundError,
    UpstreamTimeoutError,
)

logger = logging.getLogger(__name__)

DEFAULT_CALL_TIMEOUT_SECONDS = 20.0

# Sub-Plan B registers concrete plugin modules here (lazy import per entry).
_PLUGIN_MODULE_PATHS: Dict[str, str] = {
    "akshare": "agenticx.data_sources.plugins.akshare_plugin",
    "world_bank": "agenticx.data_sources.plugins.world_bank_plugin",
    "imf": "agenticx.data_sources.plugins.imf_plugin",
    "tushare": "agenticx.data_sources.plugins.tushare_plugin",
    "ifind": "agenticx.data_sources.plugins.ifind_plugin",
}


class DataSourceRegistry:
    """Loads enabled plugins from config and routes query_data_source calls."""

    def __init__(self, timeout_seconds: float = DEFAULT_CALL_TIMEOUT_SECONDS) -> None:
        self._plugins: Dict[str, DataSourcePlugin] = {}
        self._timeout_seconds = timeout_seconds

    def register(self, plugin: DataSourcePlugin) -> None:
        """Register a plugin instance, overwriting any prior registration with the same name."""
        self._plugins[plugin.name] = plugin

    def list_plugins(self) -> List[DataSourcePlugin]:
        return list(self._plugins.values())

    def get(self, name: str) -> Optional[DataSourcePlugin]:
        return self._plugins.get(name)

    async def call(self, data_source_name: str, api_name: str, params: dict) -> DataSourceResult:
        plugin = self._plugins.get(data_source_name)
        if plugin is None:
            available = ", ".join(sorted(self._plugins.keys())) or "(none enabled)"
            raise DataSourceNotFoundError(
                f"unknown data source '{data_source_name}'. Available: {available}"
            )
        api_names = {spec.name for spec in plugin.list_apis()}
        if api_name not in api_names:
            raise DataSourceApiNotFoundError(
                f"'{data_source_name}' has no api '{api_name}'. "
                f"Available: {', '.join(sorted(api_names))}"
            )
        try:
            return await asyncio.wait_for(
                plugin.call(api_name, params),
                timeout=self._timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise UpstreamTimeoutError(
                f"'{data_source_name}.{api_name}' timed out after {self._timeout_seconds}s"
            ) from exc


def _load_plugin_builder(module_path: str) -> Optional[Callable[[dict], DataSourcePlugin]]:
    try:
        module = importlib.import_module(module_path)
    except ImportError as exc:
        logger.warning("data source module %s not available: %s", module_path, exc)
        return None
    builder = getattr(module, "build_plugin", None)
    if not callable(builder):
        logger.warning("data source module %s has no build_plugin()", module_path)
        return None
    return builder


def build_registry_from_config(
    *,
    timeout_seconds: float = DEFAULT_CALL_TIMEOUT_SECONDS,
) -> DataSourceRegistry:
    """Load ``data_sources:`` from config and instantiate enabled plugins.

    Entry-level fault tolerant: one plugin failing to construct must not
    prevent other plugins from loading.
    """
    registry = DataSourceRegistry(timeout_seconds=timeout_seconds)
    global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH) or {}
    section = global_data.get("data_sources")
    if not isinstance(section, dict):
        return registry

    for name, raw_entry in section.items():
        if not isinstance(raw_entry, dict):
            logger.warning("data source %s config is not an object; skipping", name)
            continue
        if not raw_entry.get("enabled", False):
            continue
        module_path = _PLUGIN_MODULE_PATHS.get(name)
        if not module_path:
            logger.warning("data source %s has no registered plugin module; skipping", name)
            continue
        builder = _load_plugin_builder(module_path)
        if builder is None:
            continue
        try:
            plugin = builder(raw_entry)
            registry.register(plugin)
        except Exception as exc:
            logger.warning("failed to load data source plugin %s: %s", name, exc)
            continue

    return registry
