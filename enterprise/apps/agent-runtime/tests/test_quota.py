#!/usr/bin/env python3
"""User x agent quota windows, admission, and the runtime flag.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, func, select, text
from zoneinfo import ZoneInfo

from agenticx.managed.gateway_llm import GatewayLLMFactory
from agenticx.managed.host.actor import LocalTurnExecutor
from agenticx.managed.ids import new_ulid

from fakes import DEFAULT_MANIFEST, FakeAdminConsole, FakeGateway, agent_record, version_record
from ma_agent_runtime.app import build_app
from ma_agent_runtime.config import Settings
from ma_agent_runtime.db import split_database_url
from ma_agent_runtime.quota import USAGE_SQL, AgentQuotaEnforcer, window_starts
from ma_agent_runtime.tables import ma_session_usage, ma_work_items, metadata

SHANGHAI = ZoneInfo("Asia/Shanghai")
SUNDAY_AFTERNOON = datetime(2026, 10, 25, 13, 0, tzinfo=timezone.utc)


def test_window_starts() -> None:
    sunday = window_starts(SUNDAY_AFTERNOON, SHANGHAI)
    assert sunday["daily"] == datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc)
    assert sunday["weekly"] == datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc)
    assert sunday["monthly"] == datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc)

    next_sunday = window_starts(datetime(2026, 11, 1, 5, 0, tzinfo=timezone.utc), SHANGHAI)
    assert next_sunday["weekly"] == datetime(2026, 10, 25, 16, 0, tzinfo=timezone.utc)
    assert next_sunday["weekly"].astimezone(SHANGHAI).date().isoformat() == "2026-10-26"

    crossed = window_starts(datetime(2026, 10, 25, 16, 30, tzinfo=timezone.utc), SHANGHAI)
    assert crossed["daily"] == datetime(2026, 10, 25, 16, 0, tzinfo=timezone.utc)
    assert crossed["daily"].astimezone(SHANGHAI).date().isoformat() == "2026-10-26"


def test_invalid_quota_timezone_fails_startup(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    env = {
        "DATABASE_URL": "postgresql://ma:ma@127.0.0.1:55432/ma",
        "MA_INTERNAL_TOKEN": "token",
        "MA_RUNTIME_GATEWAY_TOKEN": "agx-pat-gateway",
        "MA_RUNTIME_HOME": str(home),
        "HOME": str(home),
        "MA_QUOTA_TIMEZONE": "Not/AZone",
    }
    with pytest.raises(RuntimeError, match="MA_QUOTA_TIMEZONE"):
        Settings.from_env(env)

    valid = dict(env)
    del valid["MA_QUOTA_TIMEZONE"]
    settings = Settings.from_env(valid)
    assert settings.quota_timezone == "Asia/Shanghai"
    assert settings.agent_quota_enabled is False


def _engine() -> Any:
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    return engine


def _insert_usage(
    engine: Any,
    *,
    tenant: str,
    agent: str,
    user: str,
    when: datetime,
    tokens: int,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            ma_session_usage.insert().values(
                id=new_ulid(),
                tenant_id=tenant,
                session_id=new_ulid(),
                agent_id=agent,
                agent_version=1,
                user_id=user,
                model="m",
                input_tokens=tokens,
                output_tokens=0,
                cache_read_input_tokens=0,
                tool_calls=0,
                runtime_ms=0,
                is_error=False,
                event_seq=None,
                created_at=when,
            )
        )


def _enforcer(
    engine: Any,
    handler: Any,
    *,
    enabled: bool = True,
    clock: Any = None,
    monotonic: Any = None,
) -> AgentQuotaEnforcer:
    client = httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)
    return AgentQuotaEnforcer(
        sync_engine=engine,
        admin_url="http://admin.test",
        internal_token="it",
        settings=Settings(
            database_url="sqlite://",
            internal_token="it",
            admin_url="http://admin.test",
            gateway_url="http://gw/v1",
            gateway_token="agx-pat-gw", # gitleaks:allow
            home=Path("/tmp"),
            allow_sqlite=True,
            agent_quota_enabled=enabled,
            quota_timezone="Asia/Shanghai",
        ),
        http=client,
        clock=clock or (lambda: SUNDAY_AFTERNOON),
        monotonic=monotonic or (lambda: 0.0),
    )


def _rule(monthly: int, daily: int = 0, weekly: int = 0, source: str = "user") -> dict[str, Any]:
    return {
        "quota": {
            "source": source,
            "rule_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "daily_tokens": daily,
            "weekly_tokens": weekly,
            "monthly_tokens": monthly,
        }
    }


def test_usage_sums_by_window() -> None:
    engine = _engine()
    tenant, agent, user = "T", new_ulid(), new_ulid()
    _insert_usage(engine, tenant=tenant, agent=agent, user=user, when=SUNDAY_AFTERNOON, tokens=100)
    _insert_usage(
        engine,
        tenant=tenant,
        agent=agent,
        user=user,
        when=datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc),
        tokens=200,
    )
    _insert_usage(
        engine,
        tenant=tenant,
        agent=agent,
        user=user,
        when=datetime(2026, 9, 15, tzinfo=timezone.utc),
        tokens=999,
    )
    _insert_usage(
        engine,
        tenant=tenant,
        agent=new_ulid(),
        user=user,
        when=SUNDAY_AFTERNOON,
        tokens=50,
    )
    _insert_usage(
        engine,
        tenant=tenant,
        agent=agent,
        user=new_ulid(),
        when=SUNDAY_AFTERNOON,
        tokens=50,
    )
    enforcer = _enforcer(engine, lambda request: httpx.Response(500, json={}))
    try:
        assert enforcer.usage(tenant, agent, user, SUNDAY_AFTERNOON) == {
            "daily": 100,
            "weekly": 300,
            "monthly": 300,
        }
    finally:
        enforcer.close()
        engine.dispose()


def test_check_uses_user_rule_over_default() -> None:
    engine = _engine()
    tenant, agent, user = "T", new_ulid(), new_ulid()
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_rule(250))

    enforcer = _enforcer(engine, handler)
    try:
        _insert_usage(engine, tenant=tenant, agent=agent, user=user, when=SUNDAY_AFTERNOON, tokens=300)
        decision = enforcer.check(tenant, agent, user)
        assert decision.exceeded is True
        assert decision.period == "monthly"
        assert decision.used == 300
        assert decision.limit == 250

        def no_rule(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json={"quota": None})

        enforcer._http = httpx.Client(transport=httpx.MockTransport(no_rule), trust_env=False)  # noqa: SLF001
        enforcer._rules.clear()  # noqa: SLF001
        assert enforcer.check(tenant, agent, user).exceeded is False

        def both(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_rule(5, daily=5))

        enforcer._http = httpx.Client(transport=httpx.MockTransport(both), trust_env=False)  # noqa: SLF001
        enforcer._rules.clear()  # noqa: SLF001
        _insert_usage(engine, tenant=tenant, agent=agent, user=user, when=SUNDAY_AFTERNOON, tokens=0)
        # The previous 300 already exceeds both. Inserting 0 does not change that.
        both_decision = enforcer.check(tenant, agent, new_ulid())
        fresh_user = new_ulid()
        _insert_usage(engine, tenant=tenant, agent=agent, user=fresh_user, when=SUNDAY_AFTERNOON, tokens=5)
        enforcer._rules.clear()  # noqa: SLF001
        both_decision = enforcer.check(tenant, agent, fresh_user)
        assert both_decision.exceeded is True
        assert both_decision.period == "daily"

        before = len(seen)
        assert enforcer.check(tenant, agent, None).exceeded is False
        assert len(seen) == before
    finally:
        enforcer.close()
        engine.dispose()


def test_control_plane_down_allows(caplog: pytest.LogCaptureFixture) -> None:
    engine = _engine()
    tenant, agent, user = "T", new_ulid(), new_ulid()
    mode = {"status": 500, "body": {"error": "down"}}
    clock = {"t": 0.0}

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(mode["status"], json=mode["body"])

    enforcer = _enforcer(engine, handler, monotonic=lambda: clock["t"])
    _insert_usage(engine, tenant=tenant, agent=agent, user=user, when=SUNDAY_AFTERNOON, tokens=10)
    try:
        with caplog.at_level("WARNING"):
            assert enforcer.check(tenant, agent, user).exceeded is False
            clock["t"] = 10
            assert enforcer.check(tenant, agent, user).exceeded is False
            first_warnings = [record for record in caplog.records if "control plane" in record.message]
            assert len(first_warnings) == 1

            mode["status"] = 200
            mode["body"] = _rule(10)
            clock["t"] = 10
            hit = enforcer.check(tenant, agent, user)
            assert hit.exceeded is True
            assert hit.limit == 10

            mode["status"] = 500
            mode["body"] = {"error": "down"}
            clock["t"] = 50
            stale = enforcer.check(tenant, agent, user)
            assert stale.exceeded is True
            assert stale.limit == 10
            warnings = [record for record in caplog.records if "control plane" in record.message]
            assert len(warnings) == 1

            clock["t"] = 80
            enforcer.check(tenant, agent, user)
            warnings = [record for record in caplog.records if "control plane" in record.message]
            assert len(warnings) == 2
    finally:
        enforcer.close()
        engine.dispose()


def test_usage_query_uses_index() -> None:
    url = os.environ.get("MA_TEST_DATABASE_URL")
    if not url:
        pytest.skip("MA_TEST_DATABASE_URL is not set")
    urls = split_database_url(url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    params = {
        "day": datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc),
        "week": datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc),
        "month": datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc),
        "tenant": "T",
        "agent": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "user": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "earliest": datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc),
    }
    try:
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            rows = conn.execute(text("EXPLAIN " + USAGE_SQL), params).all()
        blob = "\n".join(str(row[0]) for row in rows)
        assert "ma_session_usage_quota_idx" in blob
    finally:
        engine.dispose()


def _settings(tmp_path: Path, gateway: FakeGateway, **overrides: Any) -> Settings:
    home = (tmp_path / "home").resolve()
    values: dict[str, Any] = {
        "database_url": f"sqlite:///{tmp_path / 'ma.db'}",
        "internal_token": "it",
        "admin_url": "http://admin.test",
        "gateway_url": gateway.base_url + "/v1",
        "gateway_token": "agx-pat-gw",
        "home": home,
        "command_sandbox": "best_effort",
        "allow_sqlite": True,
        "implicit_local_env": True,
    }
    values.update(overrides)
    return Settings(**values)


def _prepare_db(settings: Settings) -> Any:
    urls = split_database_url(settings.database_url)
    engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(engine)
    return engine


def _bundle(agent_id: str, tenant_id: str, *, runtime: str = "cloud", environment_id: str | None = None) -> dict[str, Any]:
    return {
        "runtime": runtime,
        "effective": 1,
        "agent": agent_record(agent_id, tenant_id, 1, default_environment_id=environment_id),
        "versions": {1: version_record(agent_id, 1, DEFAULT_MANIFEST)},
    }


def _quota_client(body: dict[str, Any], status: int = 200) -> httpx.Client:
    def handle(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handle), trust_env=False)


async def _boot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    script: list[dict[str, Any]],
    quota: dict[str, Any],
    worker: bool = False,
    runtime: str = "cloud",
    environment: dict[str, Any] | None = None,
) -> tuple[Any, httpx.AsyncClient, FakeGateway, str, str]:
    gateway = FakeGateway(script)
    gateway.start()
    home = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    tenant = "T"
    user_id = new_ulid()
    agent_id = new_ulid()
    env_id = environment["id"] if environment else None
    fake = FakeAdminConsole(
        agents={agent_id: _bundle(agent_id, tenant, runtime=runtime, environment_id=env_id)},
        environments={environment["id"]: environment} if environment else None,
        pats={
            "agx-pat-svc": {
                "active": True,
                "tenant_id": tenant,
                "user_id": "SVCUSER000000000000000000",
                "scopes": ["ma:sessions:read", "ma:sessions:write", "ma:sessions:on_behalf", "ma:agents:read"],
                "token_id": "1",
            }
        },
    )
    settings = _settings(
        tmp_path,
        gateway,
        agent_quota_enabled=True,
        quota_timezone="Asia/Shanghai",
        desktop_worker_enabled=worker,
    )
    store = _prepare_db(settings)
    app = build_app(
        settings,
        admin_transport=fake.transport,
        scrub_env=False,
        quota_http=_quota_client(quota),
    )
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")
    await app.state.ma.startup()
    app.state.ma.extras["usage_engine"] = store
    app.state.ma.extras["quota_user"] = user_id
    app.state.ma.extras["quota_agent"] = agent_id
    app.state.ma.extras["quota_tenant"] = tenant
    return app, client, gateway, agent_id, user_id


async def _shutdown(app: Any, client: httpx.AsyncClient, gateway: FakeGateway) -> None:
    await client.aclose()
    await app.state.ma.shutdown()
    engine = app.state.ma.extras.get("usage_engine")
    if engine is not None:
        engine.dispose()
    gateway.close()


def _headers(user_id: str) -> dict[str, str]:
    return {"Authorization": "Bearer agx-pat-svc", "X-AgenticX-On-Behalf-Of": user_id}


async def _wait_stop(client: httpx.AsyncClient, sid: str, headers: dict[str, str], stop_type: str) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for _ in range(75):
        response = await client.get(f"/ma/v1/sessions/{sid}", headers=headers)
        record = response.json()
        stop = record.get("stop_reason") or {}
        if record.get("status") == "idle" and stop.get("type") == stop_type:
            return record
        await asyncio.sleep(0.1)
    events = await client.get(f"/ma/v1/sessions/{sid}/events", headers=headers)
    raise AssertionError({"session": record, "events": events.json()})


async def test_admission_rejects_new_turn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, client, gateway, agent_id, user_id = await _boot(
        tmp_path,
        monkeypatch,
        script=[{"text": "should-not-run"}],
        quota=_rule(1),
    )
    headers = _headers(user_id)
    try:
        engine = app.state.ma.extras["usage_engine"]
        _insert_usage(
            engine,
            tenant=app.state.ma.extras["quota_tenant"],
            agent=agent_id,
            user=user_id,
            when=datetime.now(timezone.utc),
            tokens=1,
        )
        created = await client.post("/ma/v1/sessions", headers=headers, json={"agent_id": agent_id, "source": "portal"})
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "hi"}]}]},
        )
        assert posted.status_code == 200, posted.text
        events = (await client.get(f"/ma/v1/sessions/{sid}/events", headers=headers)).json()["data"]
        assert [event["type"] for event in events] == [
            "user.message",
            "session.status_running",
            "session.error",
            "session.status_idle",
        ]
        assert events[2]["error"]["type"] == "budget_exceeded"
        assert events[3]["stop_reason"]["type"] == "budget_exceeded"
        assert events[0]["processed_at"]
        assert gateway.calls == []
    finally:
        await _shutdown(app, client, gateway)


async def test_admission_passes_when_under_quota(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, client, gateway, agent_id, user_id = await _boot(
        tmp_path,
        monkeypatch,
        script=[{"text": "hello-quota"}],
        quota=_rule(1000),
    )
    headers = _headers(user_id)
    try:
        created = await client.post("/ma/v1/sessions", headers=headers, json={"agent_id": agent_id, "source": "portal"})
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "hi"}]}]},
        )
        assert posted.status_code == 200, posted.text
        record = await _wait_stop(client, sid, headers, "end_turn")
        assert record["stop_reason"]["type"] == "end_turn"
        assert gateway.calls
    finally:
        await _shutdown(app, client, gateway)


async def test_admission_desktop_no_work_item(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_id = new_ulid()
    environment = {
        "id": env_id,
        "tenant_id": "T",
        "name": "desk",
        "type": "desktop_worker",
        "config": {"type": "desktop_worker", "worker_keys": []},
        "status": "active",
    }
    app, client, gateway, agent_id, user_id = await _boot(
        tmp_path,
        monkeypatch,
        script=[{"text": "nope"}],
        quota=_rule(1),
        worker=True,
        runtime="desktop_worker",
        environment=environment,
    )
    headers = _headers(user_id)
    try:
        engine = app.state.ma.extras["usage_engine"]
        _insert_usage(
            engine,
            tenant="T",
            agent=agent_id,
            user=user_id,
            when=datetime.now(timezone.utc),
            tokens=1,
        )
        created = await client.post(
            "/ma/v1/sessions",
            headers=headers,
            json={"agent_id": agent_id, "environment_id": env_id, "source": "api"},
        )
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "hi"}]}]},
        )
        assert posted.status_code == 200, posted.text
        await _wait_stop(client, sid, headers, "budget_exceeded")
        queue = app.state.ma.extras["work_queue"]
        with queue._engine.connect() as conn:  # noqa: SLF001
            count = conn.execute(select(func.count()).select_from(ma_work_items)).scalar_one()
        assert count == 0
        assert gateway.calls == []
    finally:
        await _shutdown(app, client, gateway)


async def test_guard_stops_mid_turn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, client, gateway, agent_id, user_id = await _boot(
        tmp_path,
        monkeypatch,
        script=[
            {"tool": "bash_exec", "arguments": {"command": "true"}},
            {"text": "second-should-not-run"},
        ],
        quota=_rule(5),
    )
    headers = _headers(user_id)
    try:
        created = await client.post("/ma/v1/sessions", headers=headers, json={"agent_id": agent_id, "source": "portal"})
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        posted = await client.post(
            f"/ma/v1/sessions/{sid}/events",
            headers=headers,
            json={"events": [{"type": "user.message", "content": [{"type": "text", "text": "use a tool"}]}]},
        )
        assert posted.status_code == 200, posted.text
        record = await _wait_stop(client, sid, headers, "budget_exceeded")
        assert record["stop_reason"]["type"] == "budget_exceeded"
        assert len(gateway.calls) == 1
    finally:
        await _shutdown(app, client, gateway)


def test_flag_off_does_not_wrap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    gateway = FakeGateway([{"text": "ok"}])
    gateway.start()
    home = (tmp_path / "home").resolve()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("MA_RUNTIME_HOME", str(home))
    settings = _settings(tmp_path, gateway, agent_quota_enabled=False)
    _prepare_db(settings).dispose()
    fake = FakeAdminConsole()
    app = build_app(settings, admin_transport=fake.transport, scrub_env=False)
    try:
        assert app.state.ma.service.executor_factory("cloud") is LocalTurnExecutor
        assert type(app.state.ma.service.builder._llm_factory) is GatewayLLMFactory  # noqa: SLF001
    finally:
        gateway.close()
