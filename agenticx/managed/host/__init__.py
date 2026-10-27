#!/usr/bin/env python3
"""Managed Agents HTTP host.

Author: Damon Li
"""

from agenticx.managed.host.actor import (
    LocalTurnExecutor,
    SessionActor,
    TurnExecutor,
    content_to_model_text,
    message_text,
)
from agenticx.managed.host.app import MAHostState, create_ma_app
from agenticx.managed.host.auth import (
    StaticTokenAuthenticator,
    TokenAuthenticator,
    bearer_token,
    require_scope,
)
from agenticx.managed.host.config import (
    DEFAULT_PORT,
    DEFAULT_TENANT_ID,
    DEV_ID_RE,
    AgentDefinition,
    HostConfig,
    HostConfigError,
    Principal,
    build_dev_config,
    default_environments,
    dev_principal,
    load_agents_file,
)
from agenticx.managed.host.models import CreateSessionRequest, session_to_wire
from agenticx.managed.host.registry import AgentRegistry, StaticAgentRegistry
from agenticx.managed.host.service import ExecutorFactory, SessionService

__all__ = [
    "DEFAULT_PORT",
    "DEFAULT_TENANT_ID",
    "DEV_ID_RE",
    "AgentDefinition",
    "AgentRegistry",
    "CreateSessionRequest",
    "ExecutorFactory",
    "HostConfig",
    "HostConfigError",
    "LocalTurnExecutor",
    "MAHostState",
    "Principal",
    "SessionActor",
    "SessionService",
    "StaticAgentRegistry",
    "StaticTokenAuthenticator",
    "TokenAuthenticator",
    "TurnExecutor",
    "bearer_token",
    "build_dev_config",
    "content_to_model_text",
    "create_ma_app",
    "default_environments",
    "dev_principal",
    "load_agents_file",
    "message_text",
    "require_scope",
    "session_to_wire",
]
