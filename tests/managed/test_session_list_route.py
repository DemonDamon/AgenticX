#!/usr/bin/env python3
"""GET /ma/v1/sessions returns only the caller's sessions unless scope=tenant.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import AgentDefinition, Principal
from agenticx.managed.testing import PerSessionScriptFactory, ScriptStep
from tests.managed.conftest import make_config

_READ_WRITE = frozenset({"ma:sessions:read", "ma:sessions:write"})


def _plain_manifest() -> dict[str, object]:
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": "Reply with the scripted text.",
        "runtime": {"max_tool_rounds": 4},
    }


@asynccontextmanager
async def _client(app: object, token: str) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
        trust_env=False,
    ) as client:
        yield client


async def _create(client: httpx.AsyncClient, agent_id: str) -> str:
    response = await client.post("/ma/v1/sessions", json={"agent_id": agent_id})
    assert response.status_code == 201, response.text
    session_id = response.json()["id"]
    assert isinstance(session_id, str)
    return session_id


async def test_session_list_is_caller_scoped(tmp_path: Path) -> None:
    config = make_config(
        tmp_path,
        manifest=_plain_manifest(),
        tokens={
            "token-a": Principal(tenant_id="dev", user_id="user-a", scopes=_READ_WRITE),
            "token-b": Principal(tenant_id="dev", user_id="user-b", scopes=_READ_WRITE),
            "token-admin": Principal(tenant_id="dev", user_id="admin", scopes=frozenset({"ma:admin"})),
            "token-noread": Principal(
                tenant_id="dev",
                user_id="user-c",
                scopes=frozenset({"ma:sessions:write"}),
            ),
        },
    )
    demo = config.agents["demo"]
    other_record = demo.record.model_copy(update={"id": "other", "slug": "other"})
    other_version = demo.versions[1].model_copy(update={"agent_id": "other"})
    config.agents = {
        "demo": demo,
        "other": AgentDefinition(record=other_record, versions={1: other_version}),
    }
    app = create_ma_app(config, llm_factory=PerSessionScriptFactory([ScriptStep("hi")]))
    await app.state.ma.startup()
    try:
        async with _client(app, "token-a") as user_a, _client(app, "token-b") as user_b:
            first = await _create(user_a, "demo")
            await asyncio.sleep(0.02)
            second = await _create(user_a, "other")
            await asyncio.sleep(0.02)
            third = await _create(user_b, "demo")

            listed = await user_a.get("/ma/v1/sessions")
            assert listed.status_code == 200, listed.text
            rows = listed.json()["data"]
            assert [row["id"] for row in rows] == [second, first]
            assert rows[0]["created_at"] > rows[1]["created_at"]
            assert {row["created_by_user_id"] for row in rows} == {"user-a"}

            by_agent = await user_a.get("/ma/v1/sessions", params={"agent_id": "other"})
            assert by_agent.status_code == 200, by_agent.text
            assert [row["id"] for row in by_agent.json()["data"]] == [second]

            demo_only = await user_a.get("/ma/v1/sessions", params={"agent_id": "demo"})
            assert [row["id"] for row in demo_only.json()["data"]] == [first]

            own = await user_b.get("/ma/v1/sessions")
            assert [row["id"] for row in own.json()["data"]] == [third]

            tenant_denied = await user_a.get("/ma/v1/sessions", params={"scope": "tenant"})
            assert tenant_denied.status_code == 403
            denied_body = tenant_denied.json()["error"]
            assert denied_body["code"] == "forbidden_scope"
            assert denied_body["details"]["scope"] == "ma:admin"

            async with _client(app, "token-admin") as admin:
                tenant = await admin.get("/ma/v1/sessions", params={"scope": "tenant"})
                assert tenant.status_code == 200, tenant.text
                tenant_rows = tenant.json()["data"]
                assert [row["id"] for row in tenant_rows] == [third, second, first]
                created = [row["created_at"] for row in tenant_rows]
                assert created == sorted(created, reverse=True)

            bad_limit = await user_a.get("/ma/v1/sessions", params={"limit": 0})
            assert bad_limit.status_code == 400
            assert bad_limit.json()["error"]["code"] == "invalid_request"

            bad_scope = await user_a.get("/ma/v1/sessions", params={"scope": "x"})
            assert bad_scope.status_code == 400
            assert bad_scope.json()["error"]["code"] == "invalid_request"

            async with _client(app, "token-noread") as noread:
                missing = await noread.get("/ma/v1/sessions")
                assert missing.status_code == 403
                assert missing.json()["error"]["code"] == "forbidden_scope"

            fetched = await user_a.get(f"/ma/v1/sessions/{first}")
            assert fetched.status_code == 200, fetched.text
            assert fetched.json()["id"] == first
    finally:
        await app.state.ma.shutdown()
