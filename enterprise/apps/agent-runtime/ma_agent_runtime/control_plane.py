#!/usr/bin/env python3
"""Admin-console registry, PAT introspection, and on-behalf-of middleware.

Author: Damon Li
"""

from __future__ import annotations

import contextvars
import hashlib
import logging
import time
from collections.abc import Callable
from typing import Any, Literal

import httpx

from agenticx.managed.errors import FORBIDDEN_SCOPE, INTERNAL, INVALID_REQUEST, MAError
from agenticx.managed.host.config import Principal
from agenticx.managed.ids import is_ulid
from agenticx.managed.protocol import AgentRecord, AgentVersionRecord, EnvironmentRecord

logger = logging.getLogger(__name__)

IMPLICIT_LOCAL_ENVIRONMENT_ID = "local"
UNSET_ENVIRONMENT_ID = "unset"
ON_BEHALF_OF_HEADER = "x-agenticx-on-behalf-of"
PAT_PREFIX = "agx-pat-"
PAT_CACHE_MAX_ENTRIES = 10000
DESKTOP_PAT_SCOPE = "desktop:managed"
DESKTOP_IMPLIED_MA_SCOPES = frozenset({"ma:sessions:read", "ma:sessions:write", "ma:worker"})
VersionSelector = int | Literal["effective", "latest"]

on_behalf_of_user: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "ma_on_behalf_of_user",
    default=None,
)


class TTLCache:
    """Monotonic TTL cache. Evicts the oldest insertion when full."""

    def __init__(
        self,
        ttl_seconds: float,
        *,
        max_entries: int = 1024,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._clock = clock
        self._data: dict[str, tuple[float, Any]] = {}
        self._order: list[str] = []

    def get(self, key: str) -> tuple[bool, Any]:
        item = self._data.get(key)
        if item is None:
            return False, None
        stored_at, value = item
        if self._clock() - stored_at > self._ttl:
            self._data.pop(key, None)
            if key in self._order:
                self._order.remove(key)
            return False, None
        return True, value

    def put(self, key: str, value: Any) -> None:
        now = self._clock()
        if key in self._data:
            self._data[key] = (now, value)
            return
        while len(self._data) >= self._max and self._order:
            oldest = self._order.pop(0)
            self._data.pop(oldest, None)
        self._order.append(key)
        self._data[key] = (now, value)


class ForeverCache:
    """Insertion-order cache with a fixed capacity and no expiry."""

    def __init__(self, max_entries: int = 512) -> None:
        self._max = max_entries
        self._data: dict[str, Any] = {}
        self._order: list[str] = []

    def get(self, key: str) -> tuple[bool, Any]:
        if key not in self._data:
            return False, None
        return True, self._data[key]

    def put(self, key: str, value: Any) -> None:
        if key in self._data:
            self._data[key] = value
            return
        while len(self._data) >= self._max and self._order:
            oldest = self._order.pop(0)
            self._data.pop(oldest, None)
        self._order.append(key)
        self._data[key] = value


class AdminConsoleClient:
    """Bearer calls to admin-console ``/api/internal/ma/*``."""

    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            trust_env=False,
            transport=transport,
            headers={"Authorization": f"Bearer {internal_token}"},
        )

    async def get_agent_version(
        self,
        tenant_id: str,
        agent_id: str,
        version: VersionSelector,
    ) -> dict[str, Any] | None:
        return await self._read(
            "GET",
            f"/api/internal/ma/agent-versions/{agent_id}/{version}",
            params={"tenant_id": tenant_id},
            allow_404=True,
        )

    async def get_environment(self, tenant_id: str, environment_id: str) -> dict[str, Any] | None:
        return await self._read(
            "GET",
            f"/api/internal/ma/environments/{environment_id}",
            params={"tenant_id": tenant_id},
            allow_404=True,
        )

    async def get_worker_eligibility(self, tenant_id: str, user_id: str) -> dict[str, Any]:
        """GET /api/internal/ma/worker-eligibility.

        401, network errors, and non-200 responses map to ``internal_error``,
        the same way ``get_environment`` does.
        """
        body = await self._read(
            "GET",
            "/api/internal/ma/worker-eligibility",
            params={"tenant_id": tenant_id, "user_id": user_id},
            allow_404=False,
        )
        if body is None:
            raise MAError(INTERNAL, "control plane unavailable")
        return body

    async def introspect(self, token: str) -> dict[str, Any]:
        body = await self._read(
            "POST",
            "/api/internal/ma/pat-introspect",
            json={"token": token},
            allow_404=False,
        )
        if body is None:
            raise MAError(INTERNAL, "control plane unavailable")
        return body

    async def list_runtime_schedules(self) -> dict[str, Any]:
        body = await self._read("GET", "/api/internal/ma/schedules", allow_404=False)
        return body or {"data": [], "disabled_ids": []}

    async def list_runtime_webhooks(self) -> list[dict[str, Any]]:
        body = await self._read("GET", "/api/internal/ma/webhooks", allow_404=False)
        return list((body or {}).get("data") or [])

    async def list_expiring_credentials(self, within_hours: int) -> list[dict[str, Any]]:
        body = await self._read(
            "GET",
            "/api/internal/ma/credentials/expiring",
            allow_404=False,
            params={"within_hours": str(within_hours)},
        )
        return list((body or {}).get("data") or [])

    async def list_runtime_channels(self) -> list[dict[str, Any]]:
        body = await self._read("GET", "/api/internal/ma/channels", allow_404=False)
        return list((body or {}).get("data") or [])

    async def resolve_channel_credential(self, tenant_id: str, channel_id: str) -> dict[str, str]:
        body = await self._read(
            "POST",
            f"/api/internal/ma/channels/{channel_id}/credential",
            allow_404=True,
            json={"tenant_id": tenant_id},
        )
        if body is None:
            raise MAError(INTERNAL, "channel not found")
        return {"app_id": str(body["app_id"]), "app_secret": str(body["app_secret"])}

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _read(
        self,
        method: str,
        url: str,
        *,
        allow_404: bool,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        try:
            response = await self._client.request(method, url, params=params, json=json)
        except httpx.HTTPError as exc:
            raise MAError(INTERNAL, "control plane unavailable") from exc
        if response.status_code == 401:
            logger.error("admin-console rejected the internal token")
            raise MAError(INTERNAL, "control plane rejected the runtime credential")
        if response.status_code == 404 and allow_404:
            return None
        if response.status_code != 200:
            raise MAError(INTERNAL, "control plane unavailable")
        try:
            body = response.json()
        except ValueError as exc:
            raise MAError(INTERNAL, "control plane unavailable") from exc
        if not isinstance(body, dict):
            raise MAError(INTERNAL, "control plane unavailable")
        return body


class AdminConsoleAgentRegistry:
    """AgentRegistry that reads agents and environments from admin-console."""

    def __init__(
        self,
        client: AdminConsoleClient,
        *,
        cache_seconds: float,
        implicit_local_env: bool,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._implicit_local_env = implicit_local_env
        self._agents = TTLCache(cache_seconds, clock=clock)
        self._effective_versions = TTLCache(cache_seconds, clock=clock)
        self._environments = TTLCache(cache_seconds, clock=clock)
        self._immutable_versions = ForeverCache(512)

    async def get_agent(self, tenant_id: str, agent_id: str) -> AgentRecord | None:
        if not is_ulid(agent_id):
            return None
        key = f"{tenant_id}|{agent_id}|effective"
        hit, cached = self._agents.get(key)
        if hit:
            return cached
        body = await self._client.get_agent_version(tenant_id, agent_id, "effective")
        if body is None:
            return None
        record = AgentRecord.model_validate(body["agent"])
        if record.default_environment_id is None and body.get("runtime") == "desktop_worker":
            record = record.model_copy(update={"default_environment_id": UNSET_ENVIRONMENT_ID})
        self._remember_version(tenant_id, agent_id, body.get("version"), effective=True)
        self._agents.put(key, record)
        return record

    async def get_version(
        self,
        tenant_id: str,
        agent_id: str,
        version: int | None,
    ) -> AgentVersionRecord | None:
        if not is_ulid(agent_id):
            return None
        if version is None:
            key = f"{tenant_id}|{agent_id}|effective"
            hit, cached = self._effective_versions.get(key)
            if hit:
                return cached
            body = await self._client.get_agent_version(tenant_id, agent_id, "effective")
            if body is None:
                return None
            record = self._remember_version(tenant_id, agent_id, body.get("version"), effective=True)
            return record
        key = f"{tenant_id}|{agent_id}|v{version}"
        hit, cached = self._immutable_versions.get(key)
        if hit:
            return cached
        body = await self._client.get_agent_version(tenant_id, agent_id, version)
        if body is None:
            return None
        return self._remember_version(tenant_id, agent_id, body.get("version"), effective=False)

    async def get_environment(self, tenant_id: str, environment_id: str) -> EnvironmentRecord | None:
        if environment_id == IMPLICIT_LOCAL_ENVIRONMENT_ID:
            if not self._implicit_local_env:
                return None
            return _implicit_local_environment(tenant_id)
        if environment_id == UNSET_ENVIRONMENT_ID or not is_ulid(environment_id):
            return None
        key = f"{tenant_id}|{environment_id}"
        hit, cached = self._environments.get(key)
        if hit:
            return cached
        body = await self._client.get_environment(tenant_id, environment_id)
        if body is None:
            return None
        record = EnvironmentRecord.model_validate(body["environment"])
        if record.type == "cloud" and record.config.sandbox_backend == "remote":
            raise MAError(
                INVALID_REQUEST,
                'sandbox backend "remote" is not available on this runtime',
            )
        self._environments.put(key, record)
        return record

    def _remember_version(
        self,
        tenant_id: str,
        agent_id: str,
        payload: Any,
        *,
        effective: bool,
    ) -> AgentVersionRecord | None:
        if not isinstance(payload, dict):
            return None
        record = AgentVersionRecord.model_validate(payload)
        self._immutable_versions.put(f"{tenant_id}|{agent_id}|v{record.version}", record)
        if effective:
            self._effective_versions.put(f"{tenant_id}|{agent_id}|effective", record)
            self._effective_versions.put(f"{tenant_id}|{agent_id}|effective_version", record.version)
        return record


class PatIntrospectionAuthenticator:
    """Resolve caller PATs through admin-console, with a short cache."""

    def __init__(
        self,
        client: AdminConsoleClient,
        *,
        cache_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        desktop_pat_enabled: bool = False,
    ) -> None:
        self._client = client
        self._cache = TTLCache(cache_seconds, max_entries=PAT_CACHE_MAX_ENTRIES, clock=clock)
        self._desktop_pat_enabled = desktop_pat_enabled

    async def authenticate(self, token: str) -> Principal | None:
        if not token.startswith(PAT_PREFIX):
            return None
        key = hashlib.sha256(token.encode("utf-8")).hexdigest()
        hit, cached = self._cache.get(key)
        if not hit:
            body = await self._client.introspect(token)
            cached = None
            tenant_id = str(body.get("tenant_id") or "")
            user_id = str(body.get("user_id") or "")
            if body.get("active") is True and tenant_id and user_id:
                raw_scopes = body.get("scopes") or []
                scopes = frozenset(str(item) for item in raw_scopes)
                if self._desktop_pat_enabled and DESKTOP_PAT_SCOPE in scopes:
                    scopes = scopes | DESKTOP_IMPLIED_MA_SCOPES
                cached = Principal(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    scopes=scopes,
                )
            self._cache.put(key, cached)
        if cached is None:
            return None
        obo = on_behalf_of_user.get()
        if obo is None:
            return cached
        if "ma:sessions:on_behalf" not in cached.scopes and "ma:admin" not in cached.scopes:
            raise MAError(
                FORBIDDEN_SCOPE,
                "on-behalf-of requires ma:sessions:on_behalf",
                details={"scope": "ma:sessions:on_behalf"},
            )
        return Principal(tenant_id=cached.tenant_id, user_id=obo, scopes=cached.scopes)


class OnBehalfOfMiddleware:
    """Copy a valid ULID from X-AgenticX-On-Behalf-Of into ``on_behalf_of_user``."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        raw = _header(scope, ON_BEHALF_OF_HEADER.encode("latin-1"))
        token = None
        if raw is not None:
            if is_ulid(raw):
                token = on_behalf_of_user.set(raw)
            else:
                logger.warning("ignored malformed on-behalf-of header")
        try:
            await self.app(scope, receive, send)
        finally:
            if token is not None:
                on_behalf_of_user.reset(token)


def _header(scope: dict[str, Any], name: bytes) -> str | None:
    for key, value in scope.get("headers") or []:
        if bytes(key).lower() == name:
            return bytes(value).decode("latin-1").strip()
    return None


def _implicit_local_environment(tenant_id: str) -> EnvironmentRecord:
    return EnvironmentRecord(
        id=IMPLICIT_LOCAL_ENVIRONMENT_ID,
        tenant_id=tenant_id,
        name="默认云端环境",
        type="cloud",
        config={
            "type": "cloud",
            "sandbox_backend": "docker",
            "image": None,
            "egress_allow_domains": [],
            "idle_ttl_seconds": 3600,
        },
        status="active",
    )


__all__ = [
    "IMPLICIT_LOCAL_ENVIRONMENT_ID",
    "ON_BEHALF_OF_HEADER",
    "PAT_CACHE_MAX_ENTRIES",
    "PAT_PREFIX",
    "UNSET_ENVIRONMENT_ID",
    "DESKTOP_IMPLIED_MA_SCOPES",
    "DESKTOP_PAT_SCOPE",
    "AdminConsoleAgentRegistry",
    "AdminConsoleClient",
    "ForeverCache",
    "OnBehalfOfMiddleware",
    "PatIntrospectionAuthenticator",
    "TTLCache",
    "on_behalf_of_user",
]
