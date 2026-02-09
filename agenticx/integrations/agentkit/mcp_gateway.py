#!/usr/bin/env python3
"""AgentKit MCP Gateway Integration for AgenticX.

Connects AgenticX tools to AgentKit's MCP Gateway service for centralized
tool management, semantic search, and intelligent routing.

Author: Damon Li
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class AgentkitMCPGateway:
    """Client for AgentKit MCP Gateway service.

    Provides integration with AgentKit's centralized MCP Gateway for
    tool discovery, registration, and semantic search capabilities.

    Example:
        >>> gateway = AgentkitMCPGateway()
        >>> await gateway.register_tool(my_tool)
        >>> results = await gateway.search_tools("calculator")
    """

    def __init__(self, api_config: Optional[Dict[str, Any]] = None):
        """Initialize the MCP Gateway client.

        Args:
            api_config: Optional API configuration for AgentkitMCP SDK client.
        """
        self.api_config = api_config or {}
        self._client = None
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        """Lazily initialize the MCP Gateway client."""
        if self._initialized:
            return

        try:
            from agentkit.sdk.mcp import AgentkitMCP

            self._client = AgentkitMCP(**self.api_config)
            self._initialized = True
            logger.info("AgentKit MCP Gateway client initialized")
        except ImportError:
            logger.warning(
                "agentkit-sdk-python not installed. "
                "MCP Gateway features will be unavailable."
            )
            self._initialized = True
        except Exception as e:
            logger.error(f"Failed to init MCP Gateway client: {e}")
            self._initialized = True

    async def register_tool(
        self,
        tool_name: str,
        tool_description: str,
        tool_schema: Dict[str, Any],
        server_name: Optional[str] = None,
    ) -> bool:
        """Register a tool with the MCP Gateway.

        Args:
            tool_name: Name of the tool.
            tool_description: Description of what the tool does.
            tool_schema: JSON Schema for tool parameters.
            server_name: Optional MCP server name.

        Returns:
            True if registration succeeded.
        """
        await self._ensure_initialized()

        if not self._client:
            logger.warning("MCP Gateway client not available")
            return False

        try:
            self._client.register_tool(
                name=tool_name,
                description=tool_description,
                schema=tool_schema,
                server_name=server_name,
            )
            logger.info(f"Tool registered: {tool_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to register tool: {e}")
            return False

    async def search_tools(
        self,
        query: str,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search for tools using semantic search.

        Args:
            query: Natural language search query.
            limit: Maximum number of results.

        Returns:
            List of matching tool dictionaries.
        """
        await self._ensure_initialized()

        if not self._client:
            return []

        try:
            results = self._client.search_tools(query=query, limit=limit)
            return results or []
        except Exception as e:
            logger.error(f"Tool search failed: {e}")
            return []

    async def get_tool(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get details about a specific tool.

        Args:
            tool_name: Name of the tool.

        Returns:
            Tool information dictionary or None if not found.
        """
        await self._ensure_initialized()

        if not self._client:
            return None

        try:
            tool_info = self._client.get_tool(tool_name)
            return tool_info
        except Exception as e:
            logger.error(f"Failed to get tool: {e}")
            return None

    async def list_tools(
        self,
        server_name: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """List all available tools.

        Args:
            server_name: Optional filter by MCP server name.
            limit: Maximum number of tools to return.

        Returns:
            List of tool information dictionaries.
        """
        await self._ensure_initialized()

        if not self._client:
            return []

        try:
            tools = self._client.list_tools(
                server_name=server_name, limit=limit
            )
            return tools or []
        except Exception as e:
            logger.error(f"Failed to list tools: {e}")
            return []
