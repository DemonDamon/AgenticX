#!/usr/bin/env python3
"""In-workspace MCP gateway (container-side app + host-side client).

Selectively internalized from AgentScope 2.0
``src/agentscope/workspace/_mcp_gateway/`` and ``workspace/_gateway_client.py``
(Apache-2.0, commit ``6d7189c``). The mechanism: run MCP server processes
*inside* a sandbox/container and expose them over a small HTTP gateway, so the
file-system / network side effects of MCP tools stay inside the sandbox instead
of landing on the host ``~/.agenticx/``.

AGX adaptation:
* The gateway is decoupled from any concrete MCP implementation via the
  ``MCPBackend`` protocol, so it can front AGX's own ``MCPHub`` in production
  and an ``InMemoryMCPBackend`` in tests / local demos.
* The host-side ``GatewayClient`` accepts an injected transport, enabling
  Docker-free smoke testing over an in-process ASGI transport.

Author: Damon Li
"""

from agenticx.sandbox.mcp_gateway.gateway_app import (
    GatewayState,
    InMemoryMCPBackend,
    MCPBackend,
    build_gateway_app,
)
from agenticx.sandbox.mcp_gateway.client import GatewayClient, GatewayToolError

__all__ = [
    "GatewayState",
    "InMemoryMCPBackend",
    "MCPBackend",
    "build_gateway_app",
    "GatewayClient",
    "GatewayToolError",
]
