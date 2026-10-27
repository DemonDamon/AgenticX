#!/usr/bin/env python3
"""Credential broker session extension: vault resolve, MCP, egress, redaction.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Callable

from agenticx.managed.credentials import (
    MAX_VAULT_IDS,
    CredentialBundle,
    CredentialProvider,
    CredentialResolutionError,
    new_placeholder,
)
from agenticx.managed.egress_policy import SessionEgressPolicy
from agenticx.managed.errors import FORBIDDEN_SCOPE, INTERNAL, INVALID_REQUEST, MAError
from agenticx.managed.events import session_error_event
from agenticx.managed.extensions import SessionExtension, TurnContribution, TurnSetupError
from agenticx.managed.mcp_session import ManagedMcpResolver, McpToolRouter, SessionMcpPool
from agenticx.managed.redaction import PROCESS_SECRETS, SecretRedactor, install_log_redaction
from agenticx.runtime.hooks import AgentHook
from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig

EXTENSION_NAME = "credentials"


class _RedactAndReportHook(AgentHook):
    """Redact a tool result and persist egress denials recorded during the call."""

    def __init__(
        self,
        actor: Any,
        policy: SessionEgressPolicy,
        redactor: SecretRedactor,
    ) -> None:
        self._actor = actor
        self._policy = policy
        self._redactor = redactor

    async def after_tool_call(self, tool_name: str, result: str, session: Any) -> str | None:
        del tool_name, session
        blocked = self._policy.drain_blocked()
        if blocked:
            await self._actor.append(
                [
                    session_error_event("egress_blocked", reason, "exhausted")
                    for _host, reason in blocked
                ]
            )
        text = result if isinstance(result, str) else str(result)
        return self._redactor.redact(text)


class CredentialBrokerExtension:
    """Resolve vaults, open a private MCP pool, and publish the turn policy."""

    name = EXTENSION_NAME

    def __init__(
        self,
        actor: Any,
        provider: CredentialProvider | None,
        *,
        egress_enforce: bool,
        mcp_client_factory: Callable[[MCPServerConfig], Any] | None = None,
    ) -> None:
        self._actor = actor
        self._provider = provider
        self._egress_enforce = egress_enforce
        self._mcp_client_factory = mcp_client_factory
        self._placeholders: dict[str, str] = {}
        self._pool: SessionMcpPool | None = None
        self._router: McpToolRouter | None = None
        self._policy: SessionEgressPolicy | None = None
        self._registered_key: str | None = None

    @property
    def current_router(self) -> McpToolRouter | None:
        """Router for the in-flight turn, or None between turns."""
        return self._router

    async def before_turn(self, bundle: Any) -> TurnContribution:
        del bundle
        actor = self._actor
        vault_ids = list(getattr(actor.record, "vault_ids", []) or [])
        if vault_ids and self._provider is not None:
            try:
                resolved = await self._provider.resolve(
                    actor.tenant_id,
                    actor.session_id,
                    vault_ids,
                )
            except CredentialResolutionError as exc:
                raise TurnSetupError("vault_resolution_failed", str(exc)) from None
        else:
            resolved = CredentialBundle()
        for credential in resolved.env_credentials():
            self._placeholders.setdefault(credential.credential_id, new_placeholder())
        allow = _allow_domains(actor)
        policy = SessionEgressPolicy(
            allow_domains=allow,
            bundle=resolved,
            placeholders=dict(self._placeholders),
            enforce=self._egress_enforce,
        )
        self._policy = policy
        redactor = SecretRedactor({credential.label(): credential.secret for credential in resolved.credentials})
        key = f"{actor.tenant_id}:{actor.session_id}"
        PROCESS_SECRETS.register(key, redactor)
        self._registered_key = key
        router = McpToolRouter()
        pool = SessionMcpPool(
            actor.spec,
            resolved,
            policy,
            router,
            client_factory=self._mcp_client_factory or MCPClientV2,
        )
        self._pool = pool
        self._router = router
        schemas, events = await pool.open()
        network = policy.command_network()
        return TurnContribution(
            hooks=[_RedactAndReportHook(actor, policy, redactor)],
            tool_schemas=schemas,
            resolvers=[ManagedMcpResolver(pool, router)],
            command_env=policy.command_env(),
            command_network=network,
            egress_guard=policy.to_guard(),
            redactor=redactor,
            events=events,
        )

    async def after_turn(self, bundle: Any) -> list[dict[str, Any]]:
        del bundle
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
        self._router = None
        policy = self._policy
        self._policy = None
        if policy is None:
            return []
        return [
            session_error_event("egress_blocked", reason, "exhausted")
            for _host, reason in policy.drain_blocked()
        ]

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
        self._router = None
        self._policy = None
        if self._registered_key is not None:
            PROCESS_SECRETS.unregister(self._registered_key)
            self._registered_key = None
        self._placeholders.clear()


def _allow_domains(actor: Any) -> tuple[str, ...]:
    environment = actor.environment
    if getattr(environment, "type", None) != "cloud":
        return ()
    raw = getattr(getattr(environment, "config", None), "egress_allow_domains", ()) or ()
    return tuple(str(domain).lower() for domain in raw if str(domain).strip())


def _make_vault_validator(provider: CredentialProvider) -> Any:
    async def validate(principal: Any, req: Any, environment: Any) -> list[str]:
        ids = list(req.vault_ids)
        if not ids:
            return []
        if environment.type == "desktop_worker":
            raise MAError(
                INVALID_REQUEST,
                "vault_ids are not supported for desktop_worker environments",
            )
        scopes = set(principal.scopes)
        if "ma:vaults:read" not in scopes and "ma:admin" not in scopes:
            raise MAError(
                FORBIDDEN_SCOPE,
                "vault_ids require ma:vaults:read",
                details={"scope": "ma:vaults:read"},
            )
        if len(ids) > MAX_VAULT_IDS or len(set(ids)) != len(ids):
            raise MAError(INVALID_REQUEST, "vault_ids must contain at most 20 unique ids")
        try:
            statuses = await provider.validate_vault_ids(principal.tenant_id, ids)
        except CredentialResolutionError:
            raise MAError(INTERNAL, "vault service unavailable") from None
        by_id = {vault_id: status for vault_id, status in statuses}
        for vault_id in ids:
            status = by_id.get(vault_id, "missing")
            if status == "missing":
                raise MAError(INVALID_REQUEST, f"vault not found: {vault_id}")
            if status != "active":
                raise MAError(INVALID_REQUEST, f"vault is archived: {vault_id}")
        return ids

    return validate


def install_credential_broker(
    state: Any,
    provider: CredentialProvider | None,
    *,
    egress_enforce: bool = True,
    mcp_client_factory: Callable[[MCPServerConfig], Any] | None = None,
) -> None:
    """Register the vault validator and the cloud-only credential extension.

    A later call with the same extension name replaces the factory. Passing
    ``provider=None`` removes the vault validator (vault_ids go back to
    "not supported") while egress policy still runs.
    """
    install_log_redaction()
    if provider is not None:
        state.service.register_create_validator("vault_ids", _make_vault_validator(provider))
    else:
        state.service._create_validators.pop("vault_ids", None)

    async def _factory(actor: Any) -> SessionExtension | None:
        if getattr(actor.environment, "type", None) != "cloud":
            return None
        return CredentialBrokerExtension(
            actor,
            provider,
            egress_enforce=egress_enforce,
            mcp_client_factory=mcp_client_factory,
        )

    _factory._ma_extension_name = EXTENSION_NAME  # type: ignore[attr-defined]
    state.service.register_extension_factory(_factory)
    if provider is not None and callable(getattr(provider, "aclose", None)):
        state.shutdown_hooks.append(provider.aclose)


__all__ = [
    "EXTENSION_NAME",
    "CredentialBrokerExtension",
    "install_credential_broker",
]
