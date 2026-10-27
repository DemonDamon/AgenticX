#!/usr/bin/env python3
"""Webhook signature, outbox filtering, delivery, and address policy.

Author: Damon Li
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import hmac
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import SessionRecord

from fakes import FakeAdminConsole
from ma_agent_runtime.control_plane import AdminConsoleClient
from ma_agent_runtime.db import build_engines
from ma_agent_runtime.pg_event_store import PgEventStore
from ma_agent_runtime.tables import ma_webhook_deliveries
from ma_agent_runtime.webhooks import (
    BACKOFF_SECONDS,
    CredentialExpiryScanner,
    WebhookDeliverer,
    WebhookOutbox,
    sign,
)


def reference_verify(raw_body: bytes, headers: dict[str, str], secret: str) -> bool:
    """Copied from the webhook research note and renamed."""
    headers = {name.lower(): value for name, value in headers.items()}
    event_id = headers.get("webhook-id")
    timestamp = headers.get("webhook-timestamp")
    signatures = headers.get("webhook-signature")
    if not all(isinstance(value, str) for value in (event_id, timestamp, signatures)):
        return False
    if not isinstance(secret, str) or not secret.startswith("whsec_"):
        return False
    if not re.fullmatch(r"[0-9]+", timestamp):
        return False
    try:
        if abs(int(time.time()) - int(timestamp)) > 300:
            return False
        key = base64.b64decode(secret[6:], validate=True)
    except (ValueError, binascii.Error):
        return False
    if not key:
        return False
    signed = f"{event_id}.{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(key, signed, hashlib.sha256).digest()
    for part in signatures.split():
        if not part.startswith("v1,"):
            continue
        try:
            supplied = base64.b64decode(part[3:], validate=True)
        except (ValueError, binascii.Error):
            continue
        if hmac.compare_digest(supplied, expected):
            return True
    return False


class Clock:
    def __init__(self, now: datetime | None = None) -> None:
        self.now = now or datetime.now(timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now = self.now + timedelta(seconds=seconds)


class StaticCache:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    async def get(self) -> list[dict[str, Any]]:
        return list(self.rows)


def _settings(**extra: Any) -> SimpleNamespace:
    values = {
        "webhook_allow_loopback": False,
        "webhook_block_private": False,
        "webhook_max_attempts": 6,
        "webhook_config_cache_seconds": 0,
    }
    values.update(extra)
    return SimpleNamespace(**values)


def _secret() -> str:
    return "whsec_" + base64.b64encode(b"k" * 32).decode("ascii")


def _hook(**extra: Any) -> dict[str, Any]:
    body = {
        "id": extra.pop("id", new_ulid()),
        "tenant_id": "T",
        "url": "https://hooks.example.com/h",
        "event_types": ["session.idle"],
        "agent_ids": [],
        "sources": [],
        "include_result_text": False,
        "signing_secret": _secret(),
    }
    body.update(extra)
    return body


def _session(**extra: Any) -> SessionRecord:
    now = utc_now_iso()
    values: dict[str, Any] = {
        "id": new_ulid(),
        "tenant_id": "T",
        "agent_id": "A",
        "agent_version": 3,
        "source": "api",
        "status": "idle",
        "created_by_user_id": "U",
        "created_at": now,
        "updated_at": now,
    }
    values.update(extra)
    return SessionRecord(**values)


@pytest.fixture
async def runtime(sqlite_urls: Any):
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    store = PgEventStore(async_engine)
    try:
        yield async_engine, store
    finally:
        await store.close()
        sync_engine.dispose()


async def _deliveries(engine: Any) -> list[dict[str, Any]]:
    async with engine.connect() as conn:
        rows = (await conn.execute(select(ma_webhook_deliveries))).mappings().all()
    return [dict(row) for row in rows]


def test_signature_matches_reference() -> None:
    secret = _secret()
    event_id = "01JEVENT000000000000000000"
    body = b'{"a":1}'
    signed = sign(secret, event_id, 1700000000, body)
    expected = base64.b64encode(
        hmac.new(
            b"k" * 32,
            b'01JEVENT000000000000000000.1700000000.{"a":1}',
            hashlib.sha256,
        ).digest()
    ).decode("ascii")
    assert signed == "v1," + expected
    # reference_verify rejects timestamps older than five minutes, so the
    # fixed vector is checked above and a fresh timestamp is verified here.
    fresh_ts = int(time.time())
    fresh = sign(secret, event_id, fresh_ts, body)
    assert reference_verify(
        body,
        {
            "webhook-id": event_id,
            "webhook-timestamp": str(fresh_ts),
            "webhook-signature": fresh,
        },
        secret,
    )


@pytest.mark.asyncio
async def test_outbox_filters(runtime: Any) -> None:
    engine, store = runtime
    idle_hook = _hook(agent_ids=["A"], include_result_text=False)
    failed_hook = _hook(event_types=["session.failed"])
    rich_hook = _hook(agent_ids=["A"], include_result_text=True)
    outbox = WebhookOutbox(engine=engine, cache=StaticCache([idle_hook, failed_hook, rich_hook]), store=store)
    session = _session(source="schedule")
    await store.create_session(session)
    await store.append_events(
        "T",
        session.id,
        [
            {"type": "agent.message", "content": [{"type": "text", "text": "earlier"}]},
            {"type": "agent.message", "content": [{"type": "text", "text": "最终结果"}]},
        ],
    )
    from ma_agent_runtime.tables import ma_schedule_runs

    async with engine.begin() as conn:
        await conn.execute(
            ma_schedule_runs.insert().values(
                id="run-schedule-1",
                tenant_id="T",
                schedule_id="sched-1",
                schedule_revision=1,
                trigger="schedule",
                scheduled_for=datetime.now(timezone.utc),
                status="running",
                session_id=session.id,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )
    event = StoredEvent(
        id=new_ulid(),
        tenant_id="T",
        session_id=session.id,
        seq=3,
        type="session.status_idle",
        payload={"stop_reason": {"type": "end_turn"}},
        created_at="2026-10-26T01:00:00.000Z",
    )
    await outbox.on_terminal("T", session.id, event)
    await outbox.on_terminal("T", session.id, event)
    rows = await _deliveries(engine)
    idle_rows = [row for row in rows if row["webhook_id"] == idle_hook["id"]]
    rich_rows = [row for row in rows if row["webhook_id"] == rich_hook["id"]]
    assert len(idle_rows) == 1
    assert len(rich_rows) == 1
    assert len([row for row in rows if row["webhook_id"] == failed_hook["id"]]) == 0
    payload = idle_rows[0]["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    assert payload["data"]["type"] == "session.idle"
    assert payload["data"]["stop_reason"] == {"type": "end_turn"}
    assert payload["data"]["schedule_id"] == "sched-1"
    assert payload["data"]["schedule_run_id"] == "run-schedule-1"
    assert "result_text" not in payload["data"]
    rich_payload = rich_rows[0]["payload"]
    if isinstance(rich_payload, str):
        rich_payload = json.loads(rich_payload)
    assert rich_payload["data"]["result_text"] == "最终结果"
    failed = StoredEvent(
        id=new_ulid(),
        tenant_id="T",
        session_id=session.id,
        seq=4,
        type="session.status_idle",
        payload={"stop_reason": {"type": "budget_exceeded"}},
        created_at="2026-10-26T01:05:00.000Z",
    )
    await outbox.on_terminal("T", session.id, failed)
    rows = await _deliveries(engine)
    failed_rows = [row for row in rows if row["webhook_id"] == failed_hook["id"]]
    assert len(failed_rows) == 1
    failed_payload = failed_rows[0]["payload"]
    if isinstance(failed_payload, str):
        failed_payload = json.loads(failed_payload)
    assert failed_payload["data"]["type"] == "session.failed"


async def _pending(engine: Any, hook: dict[str, Any], clock: Clock, **extra: Any) -> None:
    event_id = extra.pop("event_id", new_ulid())
    payload = extra.pop(
        "payload",
        {"type": "event", "id": event_id, "created_at": "2026-10-26T01:00:00Z", "data": {"type": "session.idle"}},
    )
    async with engine.begin() as conn:
        await conn.execute(
            ma_webhook_deliveries.insert().values(
                id=new_ulid(),
                tenant_id="T",
                webhook_id=hook["id"],
                event_id=event_id,
                event_type="session.idle",
                event_key=f"session.idle:{event_id}",
                payload=payload,
                status="pending",
                attempts=0,
                next_attempt_at=clock.now,
                created_at=clock.now,
                updated_at=clock.now,
            )
        )


def _deliverer(engine: Any, hook: dict[str, Any], transport: httpx.MockTransport, clock: Clock, **settings: Any) -> WebhookDeliverer:
    return WebhookDeliverer(
        engine=engine,
        cache=StaticCache([hook]),
        settings=_settings(**settings),
        http=httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(10.0), follow_redirects=False),
        clock=clock,
    )


@pytest.mark.asyncio
async def test_deliver_success_headers(runtime: Any) -> None:
    engine, _store = runtime
    clock = Clock()
    hook = _hook(url="https://203.0.113.10/hook")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    await _pending(engine, hook, clock)
    deliverer = _deliverer(engine, hook, httpx.MockTransport(handler), clock)
    try:
        assert await deliverer.deliver_due() == 1
    finally:
        await deliverer.aclose()
    request = seen[0]
    rows = await _deliveries(engine)
    assert request.headers["webhook-id"] == rows[0]["event_id"]
    assert request.headers["webhook-timestamp"].isdigit()
    assert request.headers["webhook-signature"].startswith("v1,")
    assert reference_verify(request.content, dict(request.headers), hook["signing_secret"])
    assert rows[0]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_retry_then_fail(runtime: Any) -> None:
    engine, _store = runtime
    clock = Clock()
    hook = _hook(url="https://203.0.113.10/hook")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    await _pending(engine, hook, clock)
    deliverer = _deliverer(engine, hook, httpx.MockTransport(handler), clock)
    try:
        previous = clock.now
        for _ in range(6):
            await deliverer.deliver_due()
            row = (await _deliveries(engine))[0]
            if row["status"] == "failed":
                break
            nxt = row["next_attempt_at"]
            if nxt.tzinfo is None:
                nxt = nxt.replace(tzinfo=timezone.utc)
            delta = (nxt - previous).total_seconds()
            base = BACKOFF_SECONDS[int(row["attempts"]) - 1]
            assert base * 0.8 <= delta <= base * 1.2
            previous = nxt
            clock.now = nxt
        row = (await _deliveries(engine))[0]
        assert row["status"] == "failed"
        assert int(row["attempts"]) == 6
    finally:
        await deliverer.aclose()


@pytest.mark.asyncio
async def test_redirect_and_client_error_do_not_retry(runtime: Any) -> None:
    engine, _store = runtime
    clock = Clock()
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(302 if calls["n"] == 1 else 400)

    hook = _hook(url="https://203.0.113.10/hook")
    await _pending(engine, hook, clock)
    deliverer = _deliverer(engine, hook, httpx.MockTransport(handler), clock)
    try:
        await deliverer.deliver_due()
        await deliverer.deliver_due()
    finally:
        await deliverer.aclose()
    row = (await _deliveries(engine))[0]
    assert row["status"] == "failed"
    assert row["last_error"] == "redirect"
    assert calls["n"] == 1

    clock.advance(5)
    other = _hook(url="https://203.0.113.11/hook")
    calls["n"] = 0

    def bad(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400)

    await _pending(engine, other, clock)
    second = _deliverer(engine, other, httpx.MockTransport(bad), clock)
    try:
        await second.deliver_due()
        await second.deliver_due()
    finally:
        await second.aclose()
    bad_row = [row for row in await _deliveries(engine) if row["webhook_id"] == other["id"]][0]
    assert bad_row["status"] == "failed"
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_retry_keeps_event_id_but_resigns(runtime: Any) -> None:
    engine, _store = runtime
    clock = Clock()
    hook = _hook(url="https://203.0.113.10/hook")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(503)

    await _pending(engine, hook, clock)
    deliverer = _deliverer(engine, hook, httpx.MockTransport(handler), clock)
    try:
        await deliverer.deliver_due()
        row = (await _deliveries(engine))[0]
        nxt = row["next_attempt_at"]
        clock.now = nxt if nxt.tzinfo else nxt.replace(tzinfo=timezone.utc)
        await deliverer.deliver_due()
    finally:
        await deliverer.aclose()
    assert seen[0].headers["webhook-id"] == seen[1].headers["webhook-id"]
    assert seen[0].headers["webhook-timestamp"] != seen[1].headers["webhook-timestamp"]
    assert reference_verify(seen[0].content, dict(seen[0].headers), hook["signing_secret"])
    assert reference_verify(seen[1].content, dict(seen[1].headers), hook["signing_secret"])


@pytest.mark.asyncio
async def test_blocked_addresses(runtime: Any) -> None:
    engine, _store = runtime
    clock = Clock()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(204)

    cases = [
        ("https://10.0.0.5/h", {}, "succeeded", True),
        ("http://1.1.1.1/h", {}, "succeeded", True),
        ("https://127.0.0.1/h", {}, "blocked_address", False),
        ("https://169.254.169.254/h", {}, "blocked_address", False),
        ("https://[::1]/h", {}, "blocked_address", False),
        ("https://127.0.0.1/h", {"webhook_allow_loopback": True}, "succeeded", True),
        ("https://10.1.2.3/h", {"webhook_block_private": True}, "blocked_address", False),
        ("http://1.1.1.1/h", {"webhook_block_private": True}, "http_not_allowed", False),
    ]
    for url, flags, expect, delivered in cases:
        seen.clear()
        hook = _hook(url=url)
        await _pending(engine, hook, clock)
        deliverer = _deliverer(engine, hook, httpx.MockTransport(handler), clock, **flags)
        try:
            await deliverer.deliver_due()
        finally:
            await deliverer.aclose()
        row = [item for item in await _deliveries(engine) if item["webhook_id"] == hook["id"]][0]
        assert row["status"] == ("succeeded" if expect == "succeeded" else "failed"), url
        if expect != "succeeded":
            assert row["last_error"] == expect, url
        assert bool(seen) is delivered, url


@pytest.mark.asyncio
async def test_errors_never_contain_secret(runtime: Any, caplog: pytest.LogCaptureFixture) -> None:
    engine, _store = runtime
    clock = Clock()
    secret = "whsec_" + base64.b64encode(b"super-secret-key-material!!!!").decode("ascii")
    hook = _hook(url="https://203.0.113.10/hook", signing_secret=secret)

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    await _pending(engine, hook, clock)
    deliverer = _deliverer(engine, hook, httpx.MockTransport(handler), clock)
    try:
        with caplog.at_level(logging.INFO):
            await deliverer.deliver_due()
    finally:
        await deliverer.aclose()
    row = (await _deliveries(engine))[0]
    signature = sign(secret, str(row["event_id"]), int(clock.now.timestamp()), b"{}")
    assert secret not in (row["last_error"] or "")
    assert secret not in caplog.text
    assert signature not in caplog.text
    assert "webhook-signature" not in caplog.text


@pytest.mark.asyncio
async def test_credential_expiring_enqueued_once(runtime: Any) -> None:
    engine, store = runtime
    fake = FakeAdminConsole()
    fake.expiring = [
        {
            "tenant_id": "T",
            "vault_id": "V",
            "credential_id": "cred-1",
            "credential_type": "static_bearer",
            "display_name": "mcp",
            "expires_at": "2026-10-27T00:00:00.000Z",
        }
    ]
    client = AdminConsoleClient("http://admin.test", "token", transport=fake.transport)
    hook = _hook(event_types=["credential.expiring"])
    outbox = WebhookOutbox(engine=engine, cache=StaticCache([hook]), store=store)
    scanner = CredentialExpiryScanner(client=client, outbox=outbox)
    try:
        await scanner.scan()
        await scanner.scan()
    finally:
        await client.aclose()
    rows = await _deliveries(engine)
    assert len(rows) == 1
    payload = rows[0]["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    assert payload["data"]["credential_id"] == "cred-1"
    assert payload["data"]["type"] == "credential.expiring"
