#!/usr/bin/env python3
"""AgentKit platform integration for AgenticX.

Provides bridge classes for connecting AgenticX modules to Volcengine
AgentKit managed services including Memory, Knowledge, MCP, A2A,
Runtime management, credential detection, and veadk interoperability.

Author: Damon Li
"""

from .memory_bridge import AgentkitMemoryBridge
from .knowledge_bridge import AgentkitKnowledgeBridge
from .mcp_app_adapter import AgenticXMCPAppAdapter
from .a2a_app_adapter import AgenticXA2AAppAdapter
from .runtime_client import AgentkitRuntimeClient
from .credential_detector import CredentialDetector
from .mcp_gateway import AgentkitMCPGateway
from .veadk_bridge import VeADKBridge

__all__ = [
    # Memory and Knowledge bridges
    "AgentkitMemoryBridge",
    "AgentkitKnowledgeBridge",
    # App adapters
    "AgenticXMCPAppAdapter",
    "AgenticXA2AAppAdapter",
    # Runtime client
    "AgentkitRuntimeClient",
    # Credential detection
    "CredentialDetector",
    # MCP Gateway
    "AgentkitMCPGateway",
    # VeADK bridge
    "VeADKBridge",
]
