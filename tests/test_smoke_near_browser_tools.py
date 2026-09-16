#!/usr/bin/env python3
"""Smoke tests for near_browser_* WorkPanel tools.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

from agenticx.cli.agent_tools import (
    NEAR_BROWSER_TOOL_NAMES,
    dispatch_tool_async,
    merge_near_browser_tools_into,
)


class _Session:
    _session_id = "sess-test"
    session_id = "sess-test"


def test_near_browser_tools_missing_bridge(monkeypatch):
    monkeypatch.delenv("AGX_BROWSER_BRIDGE_URL", raising=False)
    monkeypatch.delenv("AGX_BROWSER_BRIDGE_TOKEN", raising=False)
    monkeypatch.setattr(
        "agenticx.cli.browser_bridge_settings.browser_bridge_base_url",
        lambda: "",
    )
    monkeypatch.setattr(
        "agenticx.cli.browser_bridge_settings.browser_bridge_token",
        lambda: "",
    )
    session = _Session()

    async def _run() -> None:
        for name in sorted(NEAR_BROWSER_TOOL_NAMES):
            args: dict = {}
            if name == "near_browser_open":
                args = {"url": "https://example.com"}
            elif name == "near_browser_click":
                args = {"index": 0}
            elif name == "near_browser_type":
                args = {"index": 0, "text": "x"}
            elif name == "near_browser_press_key":
                args = {"key": "Enter"}
            result = await dispatch_tool_async(name, args, session)
            assert "browser_bridge.port" in result, result
            assert "Traceback" not in result, result

    asyncio.run(_run())


def test_near_browser_click_requires_index():
    async def _run() -> None:
        result = await dispatch_tool_async("near_browser_click", {"url": "x"}, _Session())
        assert "index" in result.lower()
        assert result.startswith("ERROR:")

    asyncio.run(_run())


def test_merge_near_browser_tools_disabled(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.agent_tools.browser_control_config_enabled",
        lambda: False,
    )
    merged = merge_near_browser_tools_into(
        [{"type": "function", "function": {"name": "knowledge_search"}}]
    )
    names = {t["function"]["name"] for t in merged}
    assert "near_browser_open" not in names
    assert "near_browser_snapshot" not in names


def test_merge_near_browser_tools_enabled(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.agent_tools.browser_control_config_enabled",
        lambda: True,
    )
    names = {t["function"]["name"] for t in merge_near_browser_tools_into([])}
    assert NEAR_BROWSER_TOOL_NAMES <= names
