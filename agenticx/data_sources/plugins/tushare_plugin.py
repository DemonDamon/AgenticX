#!/usr/bin/env python3
"""Tushare data source plugin, bridged through the global Tushare MCP connection.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agenticx.data_sources.base import ApiSpec, DataSourceResult
from agenticx.data_sources.errors import InvalidParamsError, MissingCredentialError


class TusharePlugin:
    name = "tushare"
    display_name = "Tushare Pro（经 MCP 桥接）"
    domain = "finance"
    requires_credential = True

    def __init__(self, server_name: str = "tushareMcp") -> None:
        self._server_name = server_name

    def list_apis(self) -> List[ApiSpec]:
        return [
            ApiSpec(
                name="daily",
                description="A股日线行情（Tushare daily 接口）。",
                example_params={"ts_code": "603678.SH", "limit": 30},
            ),
            ApiSpec(
                name="income",
                description="上市公司利润表。",
                example_params={"ts_code": "603678.SH", "limit": 4},
            ),
        ]

    async def call(self, api_name: str, params: Dict[str, Any]) -> DataSourceResult:
        if not await self._is_connected():
            raise MissingCredentialError(
                f"tushare 数据源需先在 Desktop 设置 → MCP 中连接 '{self._server_name}'"
                "（配置 Tushare token）。"
            )
        routed_name = await self._resolve_routed_tool(api_name)
        hub = self._hub()
        if hub is None:
            raise MissingCredentialError(
                f"tushare 数据源需先在 Desktop 设置 → MCP 中连接 '{self._server_name}'。"
            )
        raw = await hub.call_tool(routed_name, params)
        return DataSourceResult(
            source=self.name,
            api=api_name,
            data=raw,
            attribution="数据来源：Tushare Pro（经 MCP 桥接）",
        )

    def _hub(self) -> Any:
        try:
            from agenticx.runtime.global_mcp_manager import GlobalMcpManager

            return GlobalMcpManager.load_or_init().hub
        except Exception:
            return None

    def _connected_servers(self) -> set[str]:
        try:
            from agenticx.runtime.global_mcp_manager import GlobalMcpManager

            return set(GlobalMcpManager.load_or_init().connected_servers)
        except Exception:
            return set()

    async def _is_connected(self) -> bool:
        return self._server_name in self._connected_servers()

    async def _resolve_routed_tool(self, api_name: str) -> str:
        hub = self._hub()
        if hub is None:
            raise MissingCredentialError(
                f"tushare 数据源需先在 Desktop 设置 → MCP 中连接 '{self._server_name}'。"
            )
        await hub.discover_all_tools()
        matches: List[str] = []
        for routed_name, route in hub._tool_routing.items():
            server_name = route.client.server_config.name
            if server_name == self._server_name and route.original_name == api_name:
                matches.append(routed_name)
        if matches:
            return matches[0]
        raise InvalidParamsError(
            f"tushare MCP '{self._server_name}' 未暴露 api '{api_name}'。"
            "请确认 tushareMcp 已连接且工具已发现。"
        )


def build_plugin(config: dict) -> TusharePlugin:
    server_name = str(config.get("mcp_server") or "tushareMcp")
    return TusharePlugin(server_name=server_name)
