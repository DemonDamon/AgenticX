#!/usr/bin/env python3
"""Admin-console registry, PAT cache, and on-behalf-of middleware.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest

from agenticx.managed.errors import MAError
from agenticx.managed.ids import new_ulid

from ma_agent_runtime.control_plane import (
    AdminConsoleAgentRegistry,
    AdminConsoleClient,
    OnBehalfOfMiddleware,
    PatIntrospectionAuthenticator,
    on_behalf_of_user,
)
from fakes import FakeAdminConsole, agent_record, version_record


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _bundle(agent_id: str, tenant_id: str, *, runtime: str = "cloud", versions: list[int] | None = None, effective: int = 2, default_environment_id: str | None = None) -> dict:
    numbers = versions or [effective]
    return {
        "runtime": runtime,
        "effective": effective,
        "agent": agent_record(agent_id, tenant_id, max(numbers), default_environment_id=default_environment_id),
        "versions": {number: version_record(agent_id, number) for number in numbers},
    }


async def test_get_version_none_uses_effective() -> None:
    agent_id = new_ulid()
    fake = FakeAdminConsole(agents={agent_id: _bundle(agent_id, "t")})
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True)
    loaded = await registry.get_version("t", agent_id, None)
    assert loaded is not None
    assert loaded.version == 2
    assert str(fake.requests[-1].url).endswith("/effective?tenant_id=t")
    await client.aclose()


async def test_integer_version_cached_forever() -> None:
    agent_id = new_ulid()
    clock = _Clock()
    fake = FakeAdminConsole(agents={agent_id: _bundle(agent_id, "t", versions=[1, 2], effective=2)})
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True, clock=clock)
    first = await registry.get_version("t", agent_id, 2)
    second = await registry.get_version("t", agent_id, 2)
    clock.advance(86_400)
    third = await registry.get_version("t", agent_id, 2)
    assert first is not None and second is not None and third is not None
    assert len(fake.requests) == 1
    await client.aclose()


async def test_effective_cache_ttl() -> None:
    agent_id = new_ulid()
    clock = _Clock()
    fake = FakeAdminConsole(agents={agent_id: _bundle(agent_id, "t")})
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True, clock=clock)
    await registry.get_version("t", agent_id, None)
    await registry.get_version("t", agent_id, None)
    assert len(fake.requests) == 1
    clock.advance(11)
    await registry.get_version("t", agent_id, None)
    assert len(fake.requests) == 2
    await client.aclose()


async def test_unknown_agent_returns_none() -> None:
    fake = FakeAdminConsole()
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True)
    assert await registry.get_agent("t", new_ulid()) is None
    await client.aclose()


async def test_non_ulid_agent_id_short_circuits() -> None:
    fake = FakeAdminConsole()
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True)
    assert await registry.get_agent("t", "demo") is None
    assert fake.requests == []
    await client.aclose()


async def test_implicit_local_environment() -> None:
    fake = FakeAdminConsole()
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True)
    environment = await registry.get_environment("t", "local")
    assert environment is not None
    assert environment.type == "cloud"
    assert environment.config.sandbox_backend == "docker"
    assert fake.requests == []
    disabled = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=False)
    assert await disabled.get_environment("t", "local") is None
    assert fake.requests == []
    await client.aclose()


async def test_desktop_worker_agent_without_env_maps_to_unset() -> None:
    agent_id = new_ulid()
    fake = FakeAdminConsole(
        agents={agent_id: _bundle(agent_id, "t", runtime="desktop_worker", default_environment_id=None)}
    )
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True)
    agent = await registry.get_agent("t", agent_id)
    assert agent is not None
    assert agent.default_environment_id == "unset"
    assert await registry.get_environment("t", "unset") is None
    await client.aclose()


async def test_remote_backend_rejected() -> None:
    env_id = new_ulid()
    fake = FakeAdminConsole(
        environments={
            env_id: {
                "id": env_id,
                "tenant_id": "t",
                "name": "remote",
                "type": "cloud",
                "config": {"type": "cloud", "sandbox_backend": "remote"},
                "status": "active",
            }
        }
    )
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    registry = AdminConsoleAgentRegistry(client, cache_seconds=10, implicit_local_env=True)
    with pytest.raises(MAError) as caught:
        await registry.get_environment("t", env_id)
    assert caught.value.code == "invalid_request"
    await client.aclose()


async def test_internal_401_maps_to_internal_error(caplog: pytest.LogCaptureFixture) -> None:
    fake = FakeAdminConsole(status_code=401)
    client = AdminConsoleClient("http://admin.test", "super-secret-internal", transport=fake.transport)
    with caplog.at_level(logging.ERROR):
        with pytest.raises(MAError) as caught:
            await client.get_agent_version("t", new_ulid(), "effective")
    assert caught.value.code == "internal_error"
    assert "super-secret-internal" not in str(caught.value)
    assert "super-secret-internal" not in caplog.text
    await client.aclose()


def _auth(fake: FakeAdminConsole, clock: _Clock | None = None) -> tuple[AdminConsoleClient, PatIntrospectionAuthenticator]:
    client = AdminConsoleClient("http://admin.test", "internal", transport=fake.transport)
    auth = PatIntrospectionAuthenticator(client, cache_seconds=30, clock=clock or _Clock())
    return client, auth


async def test_authenticate_active_and_cache() -> None:
    clock = _Clock()
    fake = FakeAdminConsole(
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "dept_id": None,
                "scopes": ["ma:sessions:read"],
                "token_id": "1",
            }
        }
    )
    client, auth = _auth(fake, clock)
    principal = await auth.authenticate("agx-pat-svc")
    assert principal is not None
    assert principal.tenant_id == "tenant-1"
    assert principal.user_id == "user-1"
    assert principal.scopes == frozenset({"ma:sessions:read"})
    again = await auth.authenticate("agx-pat-svc")
    assert again is not None
    assert len(fake.requests) == 1
    clock.advance(31)
    await auth.authenticate("agx-pat-svc")
    assert len(fake.requests) == 2
    await client.aclose()


async def test_inactive_is_cached() -> None:
    fake = FakeAdminConsole(pats={"agx-pat-old": {"active": False}})
    client, auth = _auth(fake)
    assert await auth.authenticate("agx-pat-old") is None
    assert await auth.authenticate("agx-pat-old") is None
    assert len(fake.requests) == 1
    await client.aclose()


async def test_non_pat_token_short_circuits() -> None:
    fake = FakeAdminConsole()
    client, auth = _auth(fake)
    assert await auth.authenticate("Bearer-xyz") is None
    assert fake.requests == []
    await client.aclose()


async def test_introspect_body_carries_token_not_query() -> None:
    token = "agx-pat-body-only" # gitleaks:allow
    fake = FakeAdminConsole(pats={token: {"active": False}})
    client, auth = _auth(fake)
    await auth.authenticate(token)
    request = fake.requests[-1]
    assert token not in str(request.url)
    assert json.loads(request.content)["token"] == token
    await client.aclose()


async def test_on_behalf_of_requires_scope() -> None:
    user_id = new_ulid()
    fake = FakeAdminConsole(
        pats={
            "agx-pat-obo": {
                "active": True,
                "tenant_id": "tenant-1",
                "user_id": "svc-user",
                "scopes": ["ma:sessions:write", "ma:sessions:on_behalf"],
                "token_id": "1",
            },
            "agx-pat-admin": {
                "active": True,
                "tenant_id": "tenant-1",
                "user_id": "svc-user",
                "scopes": ["ma:admin"],
                "token_id": "2",
            },
            "agx-pat-plain": {
                "active": True,
                "tenant_id": "tenant-1",
                "user_id": "svc-user",
                "scopes": ["ma:sessions:write"],
                "token_id": "3",
            },
        }
    )
    client, auth = _auth(fake)
    token = on_behalf_of_user.set(user_id)
    try:
        delegated = await auth.authenticate("agx-pat-obo")
        assert delegated is not None
        assert delegated.user_id == user_id
        admin = await auth.authenticate("agx-pat-admin")
        assert admin is not None
        assert admin.user_id == user_id
        with pytest.raises(MAError) as caught:
            await auth.authenticate("agx-pat-plain")
        assert caught.value.code == "forbidden_scope"
    finally:
        on_behalf_of_user.reset(token)
    await client.aclose()


async def test_middleware_sets_and_resets_contextvar() -> None:
    user_id = new_ulid()

    async def endpoint(scope, receive, send):  # type: ignore[no-untyped-def]
        del receive
        if scope["type"] != "http":
            return
        body = json.dumps({"user": on_behalf_of_user.get()}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})

    app = OnBehalfOfMiddleware(endpoint)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://mw") as client:
        allowed = await client.get("/", headers={"X-AgenticX-On-Behalf-Of": user_id})
        assert allowed.json()["user"] == user_id
        rejected = await client.get("/", headers={"X-AgenticX-On-Behalf-Of": "not-a-ulid"})
        assert rejected.json()["user"] is None
    assert on_behalf_of_user.get() is None
