#!/usr/bin/env python3
"""Per-session, per-turn MCP connections for managed agents.

Connections are not shared with ``GlobalMcpManager``. Tokens live only in the
client config for this turn.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from agenticx.managed.credentials import CredentialBundle
from agenticx.managed.egress_policy import SessionEgressPolicy
from agenticx.managed.events import session_error_event
from agenticx.managed.spec import AgentSpec
from agenticx.tools.fallback_chain import ToolResolver
from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig

logger = logging.getLogger(__name__)

MCP_FUNCTION_PREFIX = "mcp__"
MCP_DISCOVER_TIMEOUT_SECONDS = 20.0
MCP_CALL_TIMEOUT_SECONDS = 120.0
MCP_RESULT_MAX_CHARS = 65536
RESERVED_ARGUMENT_NAMES = frozenset({"task_intent", "max_level"})
_SLUG_RE = re.compile(r"[^A-Za-z0-9_-]")


@dataclass(frozen=True)
class McpToolBinding:
    function_name: str
    server: str
    tool: str
    server_url: str


class McpToolRouter:
    """Map runtime function names to the MCP server and tool they call."""

    def __init__(self) -> None:
        self._bindings: dict[str, McpToolBinding] = {}

    def add(self, binding: McpToolBinding) -> None:
        self._bindings[binding.function_name] = binding

    def resolve(self, function_name: str) -> McpToolBinding | None:
        return self._bindings.get(function_name)

    def clear(self) -> None:
        self._bindings.clear()


def _slug(value: str) -> str:
    return _SLUG_RE.sub("_", value)


def mcp_function_name(server: str, tool: str, taken: set[str]) -> str:
    """Build ``mcp__<server>__<tool>``, unique and at most 64 characters."""
    name = f"{MCP_FUNCTION_PREFIX}{_slug(server)}__{_slug(tool)}"
    if len(name) > 64:
        digest = hashlib.sha1(f"{server}\0{tool}".encode()).hexdigest()[:8]
        name = name[:55] + "_" + digest
    if name not in taken:
        taken.add(name)
        return name
    number = 2
    while True:
        suffix = f"_{number}"
        base = name
        if len(base) + len(suffix) > 64:
            base = base[: 64 - len(suffix)]
        candidate = base + suffix
        if candidate not in taken:
            taken.add(candidate)
            return candidate
        number += 1


def _mcp_error(server: str, error_type: str, message: str) -> dict[str, Any]:
    event = session_error_event(error_type, message[:300], "exhausted")
    error = event.get("error")
    if isinstance(error, dict):
        error["mcp_server"] = server
    return event


def _render_block(block: Any) -> str:
    if isinstance(block, Mapping):
        kind = block.get("type")
        if kind == "text" or (kind is None and "text" in block):
            text = block.get("text")
            return text if isinstance(text, str) else ""
        if kind == "image":
            return "[image omitted]"
        label = kind if isinstance(kind, str) and kind else "block"
        return f"[{label} omitted]"
    kind = getattr(block, "type", None)
    if kind == "text" or (kind is None and hasattr(block, "text")):
        text = getattr(block, "text", "")
        return text if isinstance(text, str) else ""
    if kind == "image":
        return "[image omitted]"
    label = kind if isinstance(kind, str) and kind else "block"
    return f"[{label} omitted]"


def _render_result(result: Any) -> str:
    content = getattr(result, "content", None)
    if content is None and isinstance(result, Mapping):
        content = result.get("content")
    blocks = list(content or [])
    text = "\n".join(_render_block(block) for block in blocks).strip()
    is_error = bool(getattr(result, "isError", False))
    if isinstance(result, Mapping) and not is_error:
        is_error = bool(result.get("isError"))
    if is_error:
        rendered = "ERROR: " + text
    elif not text:
        rendered = "(empty result)"
    else:
        rendered = text
    if len(rendered) > MCP_RESULT_MAX_CHARS:
        return rendered[:MCP_RESULT_MAX_CHARS]
    return rendered


class SessionMcpPool:
    """MCP clients for one session turn. ``close`` is idempotent."""

    def __init__(
        self,
        spec: AgentSpec,
        bundle: CredentialBundle,
        policy: SessionEgressPolicy,
        router: McpToolRouter,
        *,
        client_factory: Callable[[MCPServerConfig], Any] = MCPClientV2,
    ) -> None:
        self._spec = spec
        self._bundle = bundle
        self._policy = policy
        self._router = router
        self._client_factory = client_factory
        self._clients: dict[str, Any] = {}
        self._closed = False

    async def open(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Connect declared servers. Returns tool schemas and session.error events."""
        self._router.clear()
        schemas: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        taken: set[str] = set()
        for server in self._spec.mcp_servers:
            toolset = self._spec.mcp_toolset(server.name)
            if toolset is None:
                continue
            denial = self._policy.check(server.url)
            if denial:
                events.append(_mcp_error(server.name, "egress_blocked", denial))
                self._policy.drain_blocked()
                continue
            credential = self._bundle.mcp_credential_for(server.url)
            headers = {"Authorization": f"Bearer {credential.secret}"} if credential else {}
            transport = "streamable_http" if server.transport == "http" else "sse"
            config = MCPServerConfig(
                name=server.name,
                url=server.url,
                transport=transport,
                headers=headers,
                timeout=60.0,
            )
            try:
                client = self._client_factory(config)
            except Exception as exc:
                events.append(
                    _mcp_error(
                        server.name,
                        "mcp_connection_failed",
                        f"mcp server {server.name}: {type(exc).__name__}",
                    )
                )
                continue
            try:
                tools = await asyncio.wait_for(
                    client.discover_tools(),
                    MCP_DISCOVER_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                events.append(
                    _mcp_error(
                        server.name,
                        "mcp_connection_failed",
                        f"mcp server {server.name}: {type(exc).__name__}",
                    )
                )
                await _close_client(client)
                continue
            self._clients[server.name] = client
            for tool in tools or []:
                tool_name = str(getattr(tool, "name", "") or "")
                if not tool_name or toolset.policy_for(tool_name) is None:
                    continue
                input_schema = getattr(tool, "inputSchema", None)
                properties = input_schema.get("properties") if isinstance(input_schema, Mapping) else None
                if isinstance(properties, Mapping) and RESERVED_ARGUMENT_NAMES.intersection(properties):
                    logger.warning(
                        "skipping mcp tool %s/%s: reserved argument name",
                        server.name,
                        tool_name,
                    )
                    continue
                function_name = mcp_function_name(server.name, tool_name, taken)
                self._router.add(
                    McpToolBinding(
                        function_name=function_name,
                        server=server.name,
                        tool=tool_name,
                        server_url=server.url,
                    )
                )
                description = str(getattr(tool, "description", "") or "")
                parameters = input_schema if isinstance(input_schema, Mapping) else {
                    "type": "object",
                    "properties": {},
                }
                schemas.append(
                    {
                        "type": "function",
                        "function": {
                            "name": function_name,
                            "description": f"[MCP {server.name}] {description}"[:1024],
                            "parameters": parameters,
                        },
                    }
                )
        return schemas, events

    async def call(self, function_name: str, arguments: dict[str, Any]) -> str:
        binding = self._router.resolve(function_name)
        if binding is None:
            return f"ERROR: unknown tool '{function_name}'"
        client = self._clients.get(binding.server)
        if client is None:
            return f"ERROR: mcp tool {binding.server}/{binding.tool} failed: RuntimeError"
        cleaned = {
            key: value
            for key, value in arguments.items()
            if not str(key).startswith("__")
        }
        args = self._policy.substitute_arguments(binding.server_url, cleaned)
        try:
            result = await asyncio.wait_for(
                client.call_tool(binding.tool, args),
                MCP_CALL_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            return (
                f"ERROR: mcp tool {binding.server}/{binding.tool} failed: {type(exc).__name__}"
            )
        return _render_result(result)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        clients = list(self._clients.values())
        self._clients.clear()
        for client in clients:
            await _close_client(client)


async def _close_client(client: Any) -> None:
    closer = getattr(client, "close", None)
    if closer is None:
        return
    try:
        await closer()
    except Exception:
        logger.warning("mcp client close failed")


class ManagedMcpResolver(ToolResolver):
    """Execute ``mcp__<server>__<tool>`` calls against the session pool."""

    def __init__(self, pool: SessionMcpPool, router: McpToolRouter) -> None:
        self._pool = pool
        self._router = router

    async def can_handle(self, task_intent: str) -> bool:
        return self._router.resolve(task_intent) is not None

    async def resolve(self, task_intent: str, **kwargs: Any) -> str:
        return await self._pool.call(task_intent, kwargs)


__all__ = [
    "MCP_CALL_TIMEOUT_SECONDS",
    "MCP_DISCOVER_TIMEOUT_SECONDS",
    "MCP_FUNCTION_PREFIX",
    "MCP_RESULT_MAX_CHARS",
    "RESERVED_ARGUMENT_NAMES",
    "ManagedMcpResolver",
    "McpToolBinding",
    "McpToolRouter",
    "SessionMcpPool",
    "mcp_function_name",
]
