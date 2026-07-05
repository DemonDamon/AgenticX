"""Smoke tests for wave-1 data source plugins.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import os

import pytest

from agenticx.data_sources.errors import MissingCredentialError


def test_ifind_stub_lists_apis_but_call_requires_credential():
    from agenticx.data_sources.plugins.ifind_plugin import IFindPlugin

    plugin = IFindPlugin()
    apis = plugin.list_apis()
    assert len(apis) == 8
    with pytest.raises(MissingCredentialError):
        asyncio.run(plugin.call("ifind_get_price", {}))


def test_akshare_plugin_list_apis_without_dependency():
    from agenticx.data_sources.plugins.akshare_plugin import AkSharePlugin

    plugin = AkSharePlugin()
    apis = plugin.list_apis()
    assert any(a.name == "stock_price_history" for a in apis)


def test_world_bank_plugin_list_apis():
    from agenticx.data_sources.plugins.world_bank_plugin import WorldBankPlugin

    plugin = WorldBankPlugin()
    apis = plugin.list_apis()
    assert apis[0].name == "indicator_by_country"


@pytest.mark.skipif(
    os.getenv("AGX_NETWORK_TESTS", "").lower() not in {"1", "true", "yes"},
    reason="set AGX_NETWORK_TESTS=1 to run live network plugin tests",
)
def test_akshare_history_returns_recent_rows():
    pytest.importorskip("akshare")
    from agenticx.data_sources.plugins.akshare_plugin import AkSharePlugin

    plugin = AkSharePlugin()
    result = asyncio.run(plugin.call("stock_price_history", {"symbol": "603678", "days": 30}))
    assert len(result.data) <= 30
    assert result.attribution


@pytest.mark.skipif(
    os.getenv("AGX_NETWORK_TESTS", "").lower() not in {"1", "true", "yes"},
    reason="set AGX_NETWORK_TESTS=1 to run live network plugin tests",
)
def test_world_bank_indicator_returns_series():
    from agenticx.data_sources.plugins.world_bank_plugin import WorldBankPlugin

    plugin = WorldBankPlugin()
    result = asyncio.run(
        plugin.call(
            "indicator_by_country",
            {"country": "CHN", "indicator": "NY.GDP.MKTP.KD.ZG", "years": 5},
        )
    )
    series = result.data.get("series", [])
    assert isinstance(series, list)
    assert result.attribution


def test_tushare_requires_mcp_connection():
    from agenticx.data_sources.plugins.tushare_plugin import TusharePlugin

    plugin = TusharePlugin()
    with pytest.raises(MissingCredentialError):
        asyncio.run(plugin.call("daily", {"ts_code": "603678.SH"}))


def test_build_registry_loads_free_defaults(monkeypatch, tmp_path):
    from agenticx.cli import config_manager as cm
    from agenticx.data_sources.registry import build_registry_from_config

    empty_cfg = tmp_path / "config.yaml"
    empty_cfg.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cm.ConfigManager, "GLOBAL_CONFIG_PATH", empty_cfg)
    registry = build_registry_from_config()
    names = {p.name for p in registry.list_plugins()}
    assert "akshare" in names
    assert "world_bank" in names
    assert "imf" in names
    assert "tushare" not in names
    assert "ifind" not in names
