#!/usr/bin/env python3
"""Signed webhook outbox and delivery for managed sessions.

Address policy (overrides the original private-network default):
private RFC1918 addresses and ``http://`` are allowed unless
``MA_WEBHOOK_BLOCK_PRIVATE=1``. Loopback, link-local, and cloud metadata
addresses are always rejected unless ``MA_WEBHOOK_ALLOW_LOOPBACK=1``.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import logging
import random
import socket
import ssl
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncEngine

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.ids import new_ulid

from ma_agent_runtime.config import Settings
from ma_agent_runtime.control_plane import AdminConsoleClient
from ma_agent_runtime.pg_event_store import PgEventStore, _insert_ignore
from ma_agent_runtime.tables import ma_schedule_runs, ma_webhook_deliveries

logger = logging.getLogger(__name__)

IDLE_STOP_TYPES = frozenset({"end_turn", "max_tool_rounds", "requires_action"})
FAILED_STOP_TYPES = frozenset({"retries_exhausted", "refusal", "budget_exceeded", "policy_blocked"})
BACKOFF_SECONDS = (10, 30, 120, 600, 1800)
RESULT_TEXT_LIMIT = 4000
_METADATA_HOSTS = frozenset(
    {
        "metadata.google.internal",
        "metadata.goog",
        "metadata.tencentyun.com",
        "instance-data.ec2.internal",
    }
)
_METADATA_IPS = frozenset(
    {
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)
_RFC1918 = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Any) -> datetime:
    if isinstance(value, datetime):
        current = value
    elif isinstance(value, str) and value:
        current = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise TypeError("expected a timestamp")
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def _as_object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else {}
    if isinstance(value, dict):
        return value
    return {}


def _rowcount(result: Any) -> int:
    count = getattr(result, "rowcount", 0)
    try:
        return int(count or 0)
    except (TypeError, ValueError):
        return 0


def classify_session_event(event: StoredEvent) -> tuple[str, str] | None:
    """Map a terminal session event to a webhook type and stop type."""
    if event.type == "session.status_terminated":
        return ("session.failed", "terminated")
    if event.type != "session.status_idle":
        return None
    reason = event.payload.get("stop_reason")
    stop = reason.get("type") if isinstance(reason, Mapping) else None
    if not isinstance(stop, str):
        return None
    if stop in IDLE_STOP_TYPES:
        return ("session.idle", stop)
    if stop in FAILED_STOP_TYPES:
        return ("session.failed", stop)
    return None


def sign(secret: str, event_id: str, timestamp: int, body: bytes) -> str:
    """Return ``v1,<base64 hmac>``. Raises ValueError when the secret is not ``whsec_``."""
    if not isinstance(secret, str) or not secret.startswith("whsec_"):
        raise ValueError("invalid webhook secret")
    try:
        key = base64.b64decode(secret[len("whsec_") :], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("invalid webhook secret") from exc
    if not key:
        raise ValueError("invalid webhook secret")
    signed = f"{event_id}.{int(timestamp)}.".encode("utf-8") + body
    digest = hmac.new(key, signed, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode("ascii")


def classify_response(status: int | None, error: str | None) -> Literal["succeeded", "retry", "failed"]:
    """Map an HTTP result to a delivery outcome. ``error`` is a class name, not a body."""
    if error == "tls":
        return "failed"
    if error:
        return "retry"
    if status is None:
        return "retry"
    if 200 <= status < 300:
        return "succeeded"
    if 300 <= status < 400:
        return "failed"
    if status in {408, 425, 429} or status >= 500:
        return "retry"
    return "failed"


def backoff_delay(attempts: int) -> float:
    index = min(max(attempts, 1), 5) - 1
    return BACKOFF_SECONDS[index] * random.uniform(0.8, 1.2)


def _unwrap(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _always_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    current = _unwrap(ip)
    if current.is_loopback or current.is_link_local or current in _METADATA_IPS or ip in _METADATA_IPS:
        return True
    if isinstance(current, ipaddress.IPv4Address):
        if current in ipaddress.ip_network("127.0.0.0/8"):
            return True
        if current in ipaddress.ip_network("169.254.0.0/16"):
            return True
    if isinstance(current, ipaddress.IPv6Address) and current in ipaddress.ip_network("fe80::/10"):
        return True
    return False


def _rfc1918(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    current = _unwrap(ip)
    if not isinstance(current, ipaddress.IPv4Address):
        return False
    return any(current in network for network in _RFC1918)


def _addresses(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise OSError(str(exc)) from exc
    found: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        literal = str(sockaddr[0]).split("%", 1)[0]
        try:
            found.append(ipaddress.ip_address(literal))
        except ValueError:
            continue
    if not found:
        raise OSError("no addresses")
    return found


def is_blocked_address(host: str, *, allow_loopback: bool = False, block_private: bool = False) -> bool:
    """True when ``host`` resolves to an address the current policy rejects."""
    normalized = host.rstrip(".").lower()
    if normalized in _METADATA_HOSTS and not allow_loopback:
        return True
    addresses = _addresses(normalized)
    if any(_always_blocked(ip) for ip in addresses) and not allow_loopback:
        return True
    if block_private and any(_rfc1918(ip) for ip in addresses):
        return True
    return False


def delivery_block_reason(url: str, *, allow_loopback: bool, block_private: bool) -> str | None:
    """Return a terminal last_error, or None when the URL may be requested.

    DNS failures raise ``OSError`` so the caller retries.
    """
    parts = urlsplit(url)
    host = (parts.hostname or "").rstrip(".").lower()
    if parts.scheme not in {"http", "https"} or not host or parts.username or parts.password or parts.fragment:
        return "blocked_address"
    if host in _METADATA_HOSTS and not allow_loopback:
        return "blocked_address"
    addresses = _addresses(host)
    if any(_always_blocked(ip) for ip in addresses) and not allow_loopback:
        return "blocked_address"
    if block_private and parts.scheme == "http":
        return "http_not_allowed"
    if block_private and any(_rfc1918(ip) for ip in addresses):
        return "blocked_address"
    return None


def _safe_error(text: str, secret: str) -> str:
    cleaned = text.replace(secret, "") if secret else text
    return cleaned[:500]


def _is_tls(exc: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ssl.SSLError):
            return True
        name = type(current).__name__.lower()
        if "ssl" in name or "certificate" in name:
            return True
        current = current.__cause__ or current.__context__
    return False


def _result_text(event: StoredEvent | None) -> str:
    if event is None:
        return ""
    content = event.payload.get("content")
    parts: list[str] = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, Mapping) and block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(str(block["text"]))
    elif isinstance(event.payload.get("text"), str):
        parts.append(str(event.payload["text"]))
    return "".join(parts)[:RESULT_TEXT_LIMIT]


class WebhookConfigCache:
    """Short-lived copy of enabled webhook configs, including signing secrets."""

    def __init__(
        self,
        client: AdminConsoleClient,
        *,
        ttl: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._ttl = ttl
        self._clock = clock
        self._loaded_at: float | None = None
        self._rows: list[dict[str, Any]] = []

    async def get(self) -> list[dict[str, Any]]:
        now = self._clock()
        if self._loaded_at is None or self._ttl <= 0 or now - self._loaded_at >= self._ttl:
            self._rows = await self._client.list_runtime_webhooks()
            self._loaded_at = now
        return list(self._rows)


class WebhookOutbox:
    """Inserts pending deliveries when a session reaches a terminal status."""

    def __init__(
        self,
        *,
        engine: AsyncEngine,
        cache: WebhookConfigCache,
        store: PgEventStore,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._engine = engine
        self._cache = cache
        self._store = store
        self._clock = clock

    async def on_terminal(self, tenant_id: str, session_id: str, event: StoredEvent) -> None:
        classified = classify_session_event(event)
        if classified is None:
            return
        event_type, stop_type = classified
        session = await self._store.get_session(tenant_id, session_id)
        if session is None:
            return
        webhooks = [
            item
            for item in await self._cache.get()
            if item.get("tenant_id") == tenant_id
            and event_type in (item.get("event_types") or [])
            and self._matches_agent(item, session.agent_id)
            and self._matches_source(item, session.source)
        ]
        if not webhooks:
            return
        schedule_id, schedule_run_id = await self._schedule_refs(session.source, session_id)
        result_text = None
        if any(item.get("include_result_text") for item in webhooks):
            result_text = await self._last_result_text(tenant_id, session_id)
        now = self._clock()
        async with self._engine.begin() as conn:
            for item in webhooks:
                payload = self._session_payload(
                    event_id=new_ulid(),
                    event_type=event_type,
                    created_at=event.created_at,
                    session=session,
                    stop_type=stop_type,
                    schedule_id=schedule_id,
                    schedule_run_id=schedule_run_id,
                    include_result=bool(item.get("include_result_text")),
                    result_text=result_text or "",
                )
                stmt = _insert_ignore(
                    conn.dialect.name,
                    ma_webhook_deliveries,
                    ("webhook_id", "event_key"),
                )
                await conn.execute(
                    stmt.values(
                        id=new_ulid(),
                        tenant_id=tenant_id,
                        webhook_id=str(item.get("id") or ""),
                        event_id=payload["id"],
                        event_type=event_type,
                        event_key=f"{event_type}:{event.id}",
                        payload=payload,
                        status="pending",
                        attempts=0,
                        next_attempt_at=now,
                        created_at=now,
                        updated_at=now,
                    )
                )

    async def enqueue_credential_expiring(self, items: list[dict[str, Any]]) -> int:
        now = self._clock()
        inserted = 0
        webhooks = await self._cache.get()
        async with self._engine.begin() as conn:
            for item in items:
                tenant_id = str(item.get("tenant_id") or "")
                credential_id = str(item.get("credential_id") or "")
                expires_at = str(item.get("expires_at") or "")
                if not tenant_id or not credential_id:
                    continue
                for hook in webhooks:
                    if hook.get("tenant_id") != tenant_id:
                        continue
                    if "credential.expiring" not in (hook.get("event_types") or []):
                        continue
                    event_id = new_ulid()
                    payload = {
                        "type": "event",
                        "id": event_id,
                        "created_at": now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "data": {
                            "type": "credential.expiring",
                            "tenant_id": tenant_id,
                            "vault_id": item.get("vault_id"),
                            "credential_id": credential_id,
                            "credential_type": item.get("credential_type"),
                            "display_name": item.get("display_name"),
                            "expires_at": expires_at,
                        },
                    }
                    stmt = _insert_ignore(
                        conn.dialect.name,
                        ma_webhook_deliveries,
                        ("webhook_id", "event_key"),
                    )
                    result = await conn.execute(
                        stmt.values(
                            id=new_ulid(),
                            tenant_id=tenant_id,
                            webhook_id=str(hook.get("id") or ""),
                            event_id=event_id,
                            event_type="credential.expiring",
                            event_key=f"credential.expiring:{credential_id}:{expires_at}",
                            payload=payload,
                            status="pending",
                            attempts=0,
                            next_attempt_at=now,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                    inserted += _rowcount(result)
        return inserted

    @staticmethod
    def _matches_agent(item: Mapping[str, Any], agent_id: str) -> bool:
        agents = item.get("agent_ids") or []
        return not agents or agent_id in agents

    @staticmethod
    def _matches_source(item: Mapping[str, Any], source: str) -> bool:
        sources = item.get("sources") or []
        return not sources or source in sources

    async def _schedule_refs(self, source: str, session_id: str) -> tuple[str | None, str | None]:
        if source != "schedule":
            return None, None
        async with self._engine.connect() as conn:
            row = (
                await conn.execute(
                    select(ma_schedule_runs.c.schedule_id, ma_schedule_runs.c.id)
                    .where(ma_schedule_runs.c.session_id == session_id)
                    .limit(1)
                )
            ).first()
        if row is None:
            return None, None
        return str(row.schedule_id), str(row.id)

    async def _last_result_text(self, tenant_id: str, session_id: str) -> str:
        after = 0
        last: StoredEvent | None = None
        while True:
            page = await self._store.list_events(
                tenant_id,
                session_id,
                after_seq=after,
                limit=500,
                types=["agent.message"],
            )
            if not page:
                break
            last = page[-1]
            after = page[-1].seq
            if len(page) < 500:
                break
        return _result_text(last)

    @staticmethod
    def _session_payload(
        *,
        event_id: str,
        event_type: str,
        created_at: str,
        session: Any,
        stop_type: str,
        schedule_id: str | None,
        schedule_run_id: str | None,
        include_result: bool,
        result_text: str,
    ) -> dict[str, Any]:
        data: dict[str, Any] = {
            "type": event_type,
            "tenant_id": session.tenant_id,
            "session_id": session.id,
            "agent_id": session.agent_id,
            "agent_version": session.agent_version,
            "source": session.source,
            "stop_reason": {"type": stop_type},
            "schedule_id": schedule_id,
            "schedule_run_id": schedule_run_id,
        }
        if include_result:
            data["result_text"] = result_text
        return {"type": "event", "id": event_id, "created_at": created_at, "data": data}


class WebhookDeliverer:
    """Claims due deliveries and POSTs them with a fresh signature."""

    def __init__(
        self,
        *,
        engine: AsyncEngine,
        cache: WebhookConfigCache,
        settings: Settings,
        http: httpx.AsyncClient | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._engine = engine
        self._cache = cache
        self._settings = settings
        self._clock = clock
        self._http = http or httpx.AsyncClient(
            timeout=httpx.Timeout(10.0),
            follow_redirects=False,
            trust_env=True,
        )
        self._owns_http = http is None

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def deliver_due(self) -> int:
        now = self._clock()
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        rows = await self._claim(now)
        if not rows:
            return 0
        hooks = {str(item.get("id")): item for item in await self._cache.get()}
        sent = 0
        for row in rows:
            await self._deliver_one(row, hooks.get(str(row["webhook_id"])), now)
            sent += 1
        return sent

    async def run_forever(self) -> None:
        while True:
            sent = 0
            try:
                sent = await self.deliver_due()
            except Exception:
                logger.exception("webhook deliver failed")
            if sent == 0:
                await asyncio.sleep(2)

    async def _claim(self, now: datetime) -> list[Mapping[str, Any]]:
        lock_until = now + timedelta(seconds=60)
        due = or_(
            and_(
                ma_webhook_deliveries.c.status == "pending",
                ma_webhook_deliveries.c.next_attempt_at <= now,
            ),
            and_(
                ma_webhook_deliveries.c.status == "sending",
                ma_webhook_deliveries.c.locked_until < now,
            ),
        )
        async with self._engine.begin() as conn:
            if conn.dialect.name == "sqlite":
                ids = [
                    row.id
                    for row in (
                        await conn.execute(
                            select(ma_webhook_deliveries.c.id)
                            .where(due)
                            .order_by(ma_webhook_deliveries.c.next_attempt_at)
                            .limit(20)
                        )
                    ).all()
                ]
                if not ids:
                    return []
                await conn.execute(
                    update(ma_webhook_deliveries)
                    .where(ma_webhook_deliveries.c.id.in_(ids), due)
                    .values(status="sending", locked_until=lock_until, updated_at=now)
                )
                rows = (
                    await conn.execute(
                        select(ma_webhook_deliveries).where(
                            ma_webhook_deliveries.c.id.in_(ids),
                            ma_webhook_deliveries.c.status == "sending",
                        )
                    )
                ).mappings().all()
                return list(rows)
            subq = (
                select(ma_webhook_deliveries.c.id)
                .where(due)
                .order_by(ma_webhook_deliveries.c.next_attempt_at)
                .limit(20)
                .with_for_update(skip_locked=True)
            )
            result = await conn.execute(
                update(ma_webhook_deliveries)
                .where(ma_webhook_deliveries.c.id.in_(subq))
                .values(status="sending", locked_until=lock_until, updated_at=now)
                .returning(ma_webhook_deliveries)
            )
            return list(result.mappings().all())

    async def _deliver_one(self, row: Mapping[str, Any], hook: Mapping[str, Any] | None, now: datetime) -> None:
        delivery_id = str(row["id"])
        created = _aware(row["created_at"])
        if created < now - timedelta(hours=24):
            await self._finish(delivery_id, status="abandoned", now=now, from_status=("sending",))
            return
        secret = str((hook or {}).get("signing_secret") or "")
        if hook is None:
            await self._finish(
                delivery_id,
                status="failed",
                now=now,
                error="webhook_disabled",
                from_status=("sending",),
            )
            return
        url = str(hook.get("url") or "")
        try:
            reason = delivery_block_reason(
                url,
                allow_loopback=self._settings.webhook_allow_loopback,
                block_private=self._settings.webhook_block_private,
            )
        except OSError as exc:
            await self._retry_or_fail(row, secret, now, type(exc).__name__)
            return
        if reason:
            await self._finish(delivery_id, status="failed", now=now, error=reason, from_status=("sending",))
            logger.info("webhook delivery id=%s status=failed error=%s", delivery_id, reason)
            return
        payload = _as_object(row["payload"])
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        timestamp = int(now.timestamp())
        try:
            signature = sign(secret, str(row["event_id"]), timestamp, body)
        except ValueError:
            await self._finish(
                delivery_id,
                status="failed",
                now=now,
                error="invalid_secret",
                from_status=("sending",),
            )
            return
        headers = {
            "content-type": "application/json",
            "user-agent": "AgenticX-Webhooks/1",
            "webhook-id": str(row["event_id"]),
            "webhook-timestamp": str(timestamp),
            "webhook-signature": signature,
        }
        try:
            response = await self._http.post(url, content=body, headers=headers)
        except Exception as exc:
            if _is_tls(exc):
                await self._finish(
                    delivery_id,
                    status="failed",
                    now=now,
                    error="tls_error",
                    attempts=int(row["attempts"] or 0) + 1,
                    from_status=("sending",),
                )
                logger.info("webhook delivery id=%s status=failed error=tls_error", delivery_id)
                return
            await self._retry_or_fail(row, secret, now, type(exc).__name__)
            return
        outcome = classify_response(response.status_code, None)
        attempts = int(row["attempts"] or 0) + 1
        if outcome == "succeeded":
            await self._finish(
                delivery_id,
                status="succeeded",
                now=now,
                attempts=attempts,
                status_code=response.status_code,
                from_status=("sending",),
            )
            return
        if outcome == "failed":
            error = "redirect" if 300 <= response.status_code < 400 else f"http_{response.status_code}"
            await self._finish(
                delivery_id,
                status="failed",
                now=now,
                error=_safe_error(error, secret),
                attempts=attempts,
                status_code=response.status_code,
                from_status=("sending",),
            )
            logger.info("webhook delivery id=%s status=failed error=%s", delivery_id, error)
            return
        await self._retry_or_fail(row, secret, now, f"http_{response.status_code}", status_code=response.status_code)

    async def _retry_or_fail(
        self,
        row: Mapping[str, Any],
        secret: str,
        now: datetime,
        error: str,
        status_code: int | None = None,
    ) -> None:
        attempts = int(row["attempts"] or 0) + 1
        safe = _safe_error(error, secret)
        if attempts >= self._settings.webhook_max_attempts:
            await self._finish(
                str(row["id"]),
                status="failed",
                now=now,
                error=safe,
                attempts=attempts,
                status_code=status_code,
                from_status=("sending",),
            )
            logger.info("webhook delivery id=%s status=failed error=%s", row["id"], safe)
            return
        delay = backoff_delay(attempts)
        await self._finish(
            str(row["id"]),
            status="pending",
            now=now,
            error=safe,
            attempts=attempts,
            status_code=status_code,
            next_attempt_at=now + timedelta(seconds=delay),
            from_status=("sending",),
        )
        logger.info("webhook delivery id=%s status=pending error=%s", row["id"], safe)

    async def _finish(
        self,
        delivery_id: str,
        *,
        status: str,
        now: datetime,
        from_status: tuple[str, ...],
        error: str | None = None,
        attempts: int | None = None,
        status_code: int | None = None,
        next_attempt_at: datetime | None = None,
    ) -> None:
        values: dict[str, Any] = {"status": status, "updated_at": now, "locked_until": None}
        if attempts is not None:
            values["attempts"] = attempts
        if error is not None:
            values["last_error"] = error[:500]
        if status_code is not None:
            values["last_status_code"] = status_code
        if next_attempt_at is not None:
            values["next_attempt_at"] = next_attempt_at
        if status == "succeeded":
            values["delivered_at"] = now
        async with self._engine.begin() as conn:
            await conn.execute(
                update(ma_webhook_deliveries)
                .where(
                    ma_webhook_deliveries.c.id == delivery_id,
                    ma_webhook_deliveries.c.status.in_(from_status),
                )
                .values(**values)
            )


class CredentialExpiryScanner:
    """Asks the control plane for credentials expiring within 72 hours."""

    def __init__(
        self,
        *,
        client: AdminConsoleClient,
        outbox: WebhookOutbox,
        interval_seconds: float = 3600,
    ) -> None:
        self._client = client
        self._outbox = outbox
        self._interval = interval_seconds

    async def scan(self) -> None:
        items = await self._client.list_expiring_credentials(72)
        await self._outbox.enqueue_credential_expiring(items)

    async def run_forever(self) -> None:
        while True:
            try:
                await self.scan()
            except Exception:
                logger.exception("credential expiry scan failed")
            await asyncio.sleep(self._interval)


__all__ = [
    "BACKOFF_SECONDS",
    "CredentialExpiryScanner",
    "FAILED_STOP_TYPES",
    "IDLE_STOP_TYPES",
    "RESULT_TEXT_LIMIT",
    "WebhookConfigCache",
    "WebhookDeliverer",
    "WebhookOutbox",
    "backoff_delay",
    "classify_response",
    "classify_session_event",
    "delivery_block_reason",
    "is_blocked_address",
    "sign",
]
