#!/usr/bin/env python3
"""MCP hub utilities for multi-server tool aggregation.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field, create_model  # type: ignore

from agenticx.tools.base import BaseTool, ToolError
from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig, MCPToolInfo

logger = logging.getLogger(__name__)


class MCPHubConfig(BaseModel):
    """Configuration for MCPHub."""

    servers: List[MCPServerConfig] = Field(default_factory=list)
    auto_mode: bool = False


@dataclass
class _ToolRoute:
    client: MCPClientV2
    original_name: str
    tool_info: MCPToolInfo


class MCPHubTool(BaseTool):
    """Tool wrapper that forwards execution to MCPHub routing."""

    def __init__(
        self,
        *,
        hub: "MCPHub",
        routed_name: str,
        original_name: str,
        description: str,
        input_schema: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
        organization_id: Optional[str] = None,
    ) -> None:
        args_schema = _create_args_model_from_schema(
            schema=input_schema or {},
            model_name=f"{routed_name.title().replace('_', '')}Args",
        )
        super().__init__(
            name=routed_name,
            description=description,
            args_schema=args_schema,
            timeout=timeout,
            organization_id=organization_id,
        )
        self._hub = hub
        self._routed_name = routed_name
        self._original_name = original_name

    def _run(self, **kwargs: Any) -> Any:
        return asyncio.run(self._arun(**kwargs))

    async def _arun(self, **kwargs: Any) -> Any:
        result = await self._hub.call_tool(self._routed_name, kwargs)
        return self._hub.extract_tool_result(self._routed_name, result)


def _json_schema_to_python_type(schema: Dict[str, Any]) -> type:
    schema_type = schema.get("type", "string")
    if schema_type == "string":
        return str
    if schema_type == "integer":
        return int
    if schema_type == "number":
        return float
    if schema_type == "boolean":
        return bool
    if schema_type == "array":
        item_type = _json_schema_to_python_type(schema.get("items", {"type": "string"}))
        return List[item_type]
    if schema_type == "object":
        return Dict[str, Any]
    return str


def _create_args_model_from_schema(schema: Dict[str, Any], model_name: str):
    if not schema or schema.get("type") != "object":
        return create_model(model_name)

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    fields: Dict[str, Tuple[type, Any]] = {}

    for field_name, field_schema in properties.items():
        field_type = _json_schema_to_python_type(field_schema)
        if field_name in required:
            fields[field_name] = (field_type, ...)
        else:
            fields[field_name] = (Optional[field_type], None)

    return create_model(model_name, **fields)


class MCPHub:
    """Aggregate tools from multiple MCP clients with optional auto mode."""

    def __init__(
        self,
        clients: List[MCPClientV2],
        *,
        auto_mode: bool = False,
        organization_id: Optional[str] = None,
    ) -> None:
        self.clients = clients
        self.auto_mode = auto_mode
        self.organization_id = organization_id
        self._tool_routing: Dict[str, _ToolRoute] = {}
        self._merged_tools: List[MCPToolInfo] = []

    @classmethod
    def from_config(
        cls,
        config: MCPHubConfig,
        *,
        organization_id: Optional[str] = None,
    ) -> "MCPHub":
        clients = [MCPClientV2(server) for server in config.servers]
        return cls(clients, auto_mode=config.auto_mode, organization_id=organization_id)

    async def discover_all_tools(self) -> List[MCPToolInfo]:
        """Discover and merge tools from all MCP clients."""
        discovered = await asyncio.gather(
            *(client.discover_tools() for client in self.clients),
            return_exceptions=True,
        )

        routing: Dict[str, _ToolRoute] = {}
        merged: List[MCPToolInfo] = []

        for client, tools in zip(self.clients, discovered):
            if isinstance(tools, Exception):
                logger.warning("Failed to discover tools from %s: %s", client.server_config.name, tools)
                continue
            server_name = client.server_config.name
            for tool in tools:
                routed_name = self._resolve_routed_name(server_name, tool.name, routing)
                routing[routed_name] = _ToolRoute(
                    client=client,
                    original_name=tool.name,
                    tool_info=tool,
                )
                merged.append(tool.model_copy(update={"name": routed_name}))

        self._tool_routing = routing
        self._merged_tools = merged
        return list(self._merged_tools)

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Route a tool call to the correct client."""
        if not self._tool_routing:
            await self.discover_all_tools()

        route = self._tool_routing.get(name)
        if route is None:
            raise ToolError(
                f"Tool '{name}' not found in MCPHub routing table",
                tool_name=name,
            )

        return await route.client.call_tool(route.original_name, arguments or {})

    async def get_tools_for_agent(self) -> List[BaseTool]:
        """Return auto-injected tools for Agent usage."""
        if not self.auto_mode:
            return []

        if not self._tool_routing:
            await self.discover_all_tools()

        tools: List[BaseTool] = []
        for routed_name, route in self._tool_routing.items():
            tools.append(
                MCPHubTool(
                    hub=self,
                    routed_name=routed_name,
                    original_name=route.original_name,
                    description=route.tool_info.description or f"MCP tool {routed_name}",
                    input_schema=route.tool_info.inputSchema,
                    timeout=route.client.server_config.timeout,
                    organization_id=self.organization_id,
                )
            )
        return tools

    async def close(self) -> None:
        """Close all underlying MCP clients."""
        await asyncio.gather(*(client.close() for client in self.clients), return_exceptions=True)

    def extract_tool_result(self, routed_name: str, result: Any) -> Any:
        """Normalize MCP CallToolResult payloads to tool output."""
        if hasattr(result, "isError") and getattr(result, "isError"):
            content_blocks = getattr(result, "content", None) or []
            texts: List[str] = []
            for block in content_blocks:
                text_value = getattr(block, "text", None)
                if isinstance(text_value, str) and text_value.strip():
                    texts.append(text_value.strip())
            error_msg = "\n".join(texts) if texts else "Unknown error"
            raise ToolError(f"Remote tool execution failed: {error_msg}", routed_name)

        content_blocks = getattr(result, "content", None) or []
        for block in content_blocks:
            text_value = getattr(block, "text", None)
            if isinstance(text_value, str):
                return text_value
            blob_value = getattr(block, "blob", None)
            if blob_value is not None:
                return blob_value

        structured = getattr(result, "structuredContent", None)
        if structured is not None:
            return structured
        return result

    @staticmethod
    def _resolve_routed_name(
        server_name: str,
        tool_name: str,
        existing_routes: Dict[str, _ToolRoute],
    ) -> str:
        if tool_name not in existing_routes:
            return tool_name

        base_name = f"{server_name}__{tool_name}"
        candidate = base_name
        suffix = 2
        while candidate in existing_routes:
            candidate = f"{base_name}_{suffix}"
            suffix += 1
        return candidate
