"""Smoke tests for the unified data source gateway core framework.

Author: Damon Li
"""

import asyncio

import pytest

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import (
    DataSourceApiNotFoundError,
    DataSourceNotFoundError,
    UpstreamTimeoutError,
)
from agenticx.data_sources.registry import DataSourceRegistry, build_registry_from_config


class _FakePlugin:
    name = "fake"
    display_name = "Fake Source"
    domain = "finance"
    requires_credential = False

    def list_apis(self):
        return [ApiSpec(name="ping", description="returns pong"), ApiSpec(name="slow", description="slow")]

    async def call(self, api_name, params):
        if api_name == "slow":
            await asyncio.sleep(10)
        return DataSourceResult(source=self.name, api=api_name, data={"pong": True})


def test_build_registry_from_config_loads_free_defaults_by_default(monkeypatch, tmp_path):
    from agenticx.cli import config_manager as cm

    empty_cfg = tmp_path / "config.yaml"
    empty_cfg.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cm.ConfigManager, "GLOBAL_CONFIG_PATH", empty_cfg)
    registry = build_registry_from_config()
    names = {plugin.name for plugin in registry.list_plugins()}
    assert "akshare" in names
    assert "world_bank" in names


def test_unknown_data_source_returns_clear_error():
    registry = DataSourceRegistry()
    with pytest.raises(DataSourceNotFoundError):
        asyncio.run(registry.call("nope", "ping", {}))


def test_unknown_api_returns_clear_error():
    registry = DataSourceRegistry()
    registry.register(_FakePlugin())
    with pytest.raises(DataSourceApiNotFoundError):
        asyncio.run(registry.call("fake", "nope", {}))


def test_successful_call_roundtrips_result():
    registry = DataSourceRegistry()
    registry.register(_FakePlugin())
    result = asyncio.run(registry.call("fake", "ping", {}))
    assert result.data == {"pong": True}


def test_plugin_timeout_raises_upstream_timeout_error():
    registry = DataSourceRegistry(timeout_seconds=0.05)
    registry.register(_FakePlugin())
    with pytest.raises(UpstreamTimeoutError):
        asyncio.run(registry.call("fake", "slow", {}))


def test_one_plugin_failure_does_not_block_other_plugins():
    registry = DataSourceRegistry()
    registry.register(_FakePlugin())

    class _BrokenPlugin:
        name = "broken"
        display_name = "Broken"
        domain = "finance"
        requires_credential = False

        def list_apis(self):
            return [ApiSpec(name="x", description="x")]

        async def call(self, api_name, params):
            raise RuntimeError("upstream exploded")

    registry.register(_BrokenPlugin())
    with pytest.raises(RuntimeError):
        asyncio.run(registry.call("broken", "x", {}))
    result = asyncio.run(registry.call("fake", "ping", {}))
    assert result.data == {"pong": True}
