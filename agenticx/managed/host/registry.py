#!/usr/bin/env python3
"""Agent and environment lookup for the Managed Agents host.

Author: Damon Li
"""

from __future__ import annotations

from typing import Protocol

from agenticx.managed.host.config import HostConfig
from agenticx.managed.protocol import AgentRecord, AgentVersionRecord, EnvironmentRecord


class AgentRegistry(Protocol):
    """Tenant-scoped agent, version, and environment reads.

    MA-E03 replaces the static file registry with admin-console lookups.
    """

    async def get_agent(self, tenant_id: str, agent_id: str) -> AgentRecord | None:
        """Return the agent record, or None when the tenant does not own it."""
        ...

    async def get_version(
        self,
        tenant_id: str,
        agent_id: str,
        version: int | None,
    ) -> AgentVersionRecord | None:
        """Return one version. ``version is None`` selects ``latest_version``."""
        ...

    async def get_environment(
        self,
        tenant_id: str,
        environment_id: str,
    ) -> EnvironmentRecord | None:
        """Return the environment, or None when the tenant does not own it."""
        ...


class StaticAgentRegistry:
    """Registry backed by one ``HostConfig``. Other tenants always miss."""

    def __init__(self, config: HostConfig) -> None:
        self._config = config

    def _visible(self, tenant_id: str) -> bool:
        return tenant_id == self._config.tenant_id

    async def get_agent(self, tenant_id: str, agent_id: str) -> AgentRecord | None:
        if not self._visible(tenant_id):
            return None
        definition = self._config.agents.get(agent_id)
        if definition is None:
            return None
        return definition.record

    async def get_version(
        self,
        tenant_id: str,
        agent_id: str,
        version: int | None,
    ) -> AgentVersionRecord | None:
        if not self._visible(tenant_id):
            return None
        definition = self._config.agents.get(agent_id)
        if definition is None:
            return None
        chosen = definition.record.latest_version if version is None else version
        return definition.versions.get(chosen)

    async def get_environment(
        self,
        tenant_id: str,
        environment_id: str,
    ) -> EnvironmentRecord | None:
        if not self._visible(tenant_id):
            return None
        return self._config.environments.get(environment_id)


__all__ = [
    "AgentRegistry",
    "StaticAgentRegistry",
]
