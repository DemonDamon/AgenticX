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


def test_trim_ohlcv_rows_keeps_only_chart_fields():
    """Trimming keeps date/OHLC/volume and drops heavy fields to fit budget."""
    from agenticx.data_sources.plugins.akshare_plugin import _trim_ohlcv_rows

    rows = [
        {
            "date": "2026-07-03",
            "open": 81.26,
            "high": 89.4,
            "low": 77.93,
            "close": 85.48,
            "volume": 42942215.0,
            "amount": 3636196443.0,
            "outstanding_share": 475566631.0,
            "turnover": 0.09,
        },
    ]
    trimmed = _trim_ohlcv_rows(rows)
    assert trimmed == [
        {
            "date": "2026-07-03",
            "open": 81.26,
            "high": 89.4,
            "low": 77.93,
            "close": 85.48,
            "volume": 42942215.0,
        }
    ]


def test_trim_ohlcv_rows_normalizes_chinese_columns():
    """Eastmoney fallback rows use Chinese keys; trim normalizes to English."""
    from agenticx.data_sources.plugins.akshare_plugin import _trim_ohlcv_rows

    rows = [{"日期": "2026-07-03", "开盘": 81.26, "最高": 89.4, "最低": 77.93, "收盘": 85.48, "成交量": 100}]
    trimmed = _trim_ohlcv_rows(rows)
    assert trimmed[0]["date"] == "2026-07-03"
    assert trimmed[0]["close"] == 85.48
    assert trimmed[0]["volume"] == 100


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
