#!/usr/bin/env python3
"""MCP Connector Resolver — API-level tool resolution via MCP hub.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from typing import Any, Set

from agenticx.tools.fallback_chain import ToolResolver

logger = logging.getLogger(__name__)


class MCPConnectorResolver(ToolResolver):
    """Resolve tasks via MCP tool hub (highest priority level).

    Wraps the existing MCP infrastructure to participate in the
    fallback chain. Maintains an index of available MCP tools and
    routes matching task_intents through the hub.
    """

    def __init__(self, mcp_hub: Any) -> None:
        self._hub = mcp_hub
        self._tool_index: Set[str] = set()

    async def refresh_tool_index(self) -> None:
        """Refresh the index of available MCP tools."""
        tools = await self._hub.list_tools()
        self._tool_index = {t["name"] for t in tools}
        logger.debug("MCP tool index refreshed: %d tools", len(self._tool_index))

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self._tool_index

    async def resolve(self, task_intent: str, **kwargs) -> str:
        result = await self._hub.call_tool(task_intent, kwargs)
        if isinstance(result, dict):
            return json.dumps(result, ensure_ascii=False)
        return str(result)
