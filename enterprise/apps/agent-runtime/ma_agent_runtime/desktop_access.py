#!/usr/bin/env python3
"""Authorization for desktop device tokens and desktop workers on the managed runtime.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Request

from agenticx.managed.errors import (
    AGENT_NOT_FOUND,
    ENVIRONMENT_NOT_FOUND,
    INVALID_REQUEST,
    MAError,
    SESSION_NOT_FOUND,
    UNAUTHORIZED,
)
from agenticx.managed.host.auth import bearer_token, require_scope
from agenticx.managed.host.config import Principal

from ma_agent_runtime.control_plane import DESKTOP_PAT_SCOPE, AdminConsoleClient, TTLCache
from ma_agent_runtime.pg_work_queue import ClaimScope, PgWorkQueue, current_claim_scope

POLL_RE = re.compile(r"^/ma/v1/environments/(?P<env>[^/]+)/work/poll$")
WORK_RE = re.compile(r"^/ma/v1/work/(?P<work>[^/]+)/(ack|heartbeat|complete|fail)$")
INGEST_RE = re.compile(r"^/ma/v1/sessions/(?P<sid>[^/]+)/events:ingest$")
INBOX_RE = re.compile(r"^/ma/v1/sessions/(?P<sid>[^/]+)/inbox/stream$")
SESSION_RE = re.compile(r"^/ma/v1/sessions/(?P<sid>[^/:]+)(?:/(events|events/stream|archive))?$")
CREATE_SESSION_PATH = "/ma/v1/sessions"
WORK_ENVIRONMENTS_PATH = "/ma/v1/work/environments"
MAX_CREATE_BODY_BYTES = 65536


@dataclass(frozen=True)
class Eligibility:
    """Assignment keys and desktop-worker environments one user may claim."""

    assignment_keys: frozenset[str]
    environments: tuple[dict[str, Any], ...]

    def environment_ids(self) -> frozenset[str]:
        found: set[str] = set()
        for item in self.environments:
            env_id = str(item.get("id") or "").strip()
            if env_id:
                found.add(env_id)
        return frozenset(found)

    def intersects(self, keys: list[str]) -> bool:
        """True when any non-empty key is in the user's assignment set."""
        return any(str(key).strip() in self.assignment_keys for key in keys if str(key).strip())


class EligibilityResolver:
    """Cache admin-console worker eligibility per tenant and user."""

    def __init__(
        self,
        client: AdminConsoleClient,
        *,
        cache_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._cache = TTLCache(cache_seconds, clock=clock)

    async def resolve(self, tenant_id: str, user_id: str) -> Eligibility:
        key = f"{tenant_id}|{user_id}"
        hit, cached = self._cache.get(key)
        if hit:
            return cached
        body = await self._client.get_worker_eligibility(tenant_id, user_id)
        record = _eligibility_from(body)
        self._cache.put(key, record)
        return record


def is_desktop_principal(principal: Principal) -> bool:
    """True for a device PAT that was not also granted admin."""
    return DESKTOP_PAT_SCOPE in principal.scopes and "ma:admin" not in principal.scopes


class DesktopAccessMiddleware:
    """Pure ASGI middleware. Installed when the worker plane or desktop PATs are enabled."""

    def __init__(
        self,
        app: Any,
        *,
        state_getter: Callable[[], Any],
        resolver: EligibilityResolver,
        work_queue: PgWorkQueue | None,
        enforce_worker_rules: bool,
        enforce_desktop_sessions: bool,
    ) -> None:
        self.app = app
        self._state_getter = state_getter
        self._resolver = resolver
        self._work_queue = work_queue
        self._enforce_worker_rules = enforce_worker_rules
        self._enforce_desktop_sessions = enforce_desktop_sessions

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path") or "")
        method = str(scope.get("method") or "")
        token = bearer_token(_authorization_header(scope))
        state = self._state_getter()
        principal = await state.authenticator.authenticate(token) if token else None
        if principal is None:
            await self.app(scope, receive, send)
            return
        ctx_token = None
        try:
            if (
                self._enforce_worker_rules
                and self._work_queue is not None
                and (matched := POLL_RE.match(path))
                and method == "POST"
            ):
                eligibility = await self._resolver.resolve(principal.tenant_id, principal.user_id)
                env_id = matched["env"]
                if env_id not in eligibility.environment_ids():
                    await _error(send, MAError(ENVIRONMENT_NOT_FOUND, "environment not found"))
                    return
                allowed: set[str] = set()
                for agent_id in self._work_queue.queued_agent_ids(principal.tenant_id, env_id):
                    agent = await state.registry.get_agent(principal.tenant_id, agent_id)
                    if agent is None:
                        continue
                    if not agent.worker_keys or eligibility.intersects(agent.worker_keys):
                        allowed.add(agent_id)
                ctx_token = current_claim_scope.set(
                    ClaimScope(principal.user_id, frozenset(allowed))
                )
            elif self._enforce_worker_rules and (
                WORK_RE.match(path) or INGEST_RE.match(path) or INBOX_RE.match(path)
            ):
                ctx_token = current_claim_scope.set(ClaimScope(principal.user_id, None))
            elif self._enforce_desktop_sessions and is_desktop_principal(principal):
                if path == CREATE_SESSION_PATH and method == "POST":
                    body, receive = await _buffer_body(receive, MAX_CREATE_BODY_BYTES)
                    err = await self._check_desktop_create(state, principal, body)
                    if err is not None:
                        await _error(send, err)
                        return
                elif (matched := SESSION_RE.match(path)):
                    record = await state.store.get_session(principal.tenant_id, matched["sid"])
                    if record is not None and record.created_by_user_id != principal.user_id:
                        await _error(send, MAError(SESSION_NOT_FOUND, "session not found"))
                        return
            await self.app(scope, receive, send)
        finally:
            if ctx_token is not None:
                current_claim_scope.reset(ctx_token)

    async def _check_desktop_create(
        self,
        state: Any,
        principal: Principal,
        body: bytes | None,
    ) -> MAError | None:
        if body is None:
            return None
        try:
            data = json.loads(body or b"{}")
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        if data.get("source") != "desktop":
            return MAError(
                INVALID_REQUEST,
                'desktop tokens must create sessions with source "desktop"',
            )
        agent_id = str(data.get("agent_id") or "")
        agent = await state.registry.get_agent(principal.tenant_id, agent_id)
        if agent is None:
            return None
        eligibility = await self._resolver.resolve(principal.tenant_id, principal.user_id)
        visible = (
            agent.status == "active"
            and agent.lifecycle == "published"
            and eligibility.intersects(agent.assignment_keys)
        )
        if not visible:
            return MAError(AGENT_NOT_FOUND, "agent not found")
        env_id = data.get("environment_id") or agent.default_environment_id or "local"
        environment = await state.registry.get_environment(principal.tenant_id, str(env_id))
        if (
            environment is not None
            and environment.type == "desktop_worker"
            and environment.id not in eligibility.environment_ids()
        ):
            return MAError(ENVIRONMENT_NOT_FOUND, "environment not found")
        return None


def build_work_environments_router(
    state_getter: Callable[[], Any],
    resolver: EligibilityResolver,
) -> APIRouter:
    """GET /ma/v1/work/environments for the signed-in worker."""
    router = APIRouter()

    @router.get(WORK_ENVIRONMENTS_PATH)
    async def list_work_environments(request: Request) -> dict[str, Any]:
        state = state_getter()
        token = bearer_token(request.headers.get("authorization"))
        if token is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        principal = await state.authenticator.authenticate(token)
        if principal is None:
            raise MAError(UNAUTHORIZED, "missing or invalid bearer token")
        require_scope(principal, "ma:worker")
        eligibility = await resolver.resolve(principal.tenant_id, principal.user_id)
        data: list[dict[str, str]] = []
        for item in eligibility.environments:
            env_id = str(item.get("id") or "").strip()
            if not env_id:
                continue
            name = str(item.get("name") or env_id)
            data.append({"id": env_id, "name": name})
        return {"data": data}

    return router


def _eligibility_from(body: dict[str, Any]) -> Eligibility:
    raw_keys = body.get("assignment_keys") or []
    keys: list[str] = []
    if isinstance(raw_keys, list):
        for item in raw_keys:
            text = str(item).strip()
            if text:
                keys.append(text)
    raw_envs = body.get("environments") or []
    environments: list[dict[str, Any]] = []
    if isinstance(raw_envs, list):
        for item in raw_envs:
            if isinstance(item, dict) and str(item.get("id") or "").strip():
                environments.append(item)
    return Eligibility(frozenset(keys), tuple(environments))


def _authorization_header(scope: dict[str, Any]) -> str | None:
    for key, value in scope.get("headers") or []:
        if bytes(key).lower() == b"authorization":
            return bytes(value).decode("latin-1")
    return None


async def _error(send: Callable[..., Awaitable[None]], err: MAError) -> None:
    payload = json.dumps(err.to_dict()).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": err.http_status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})


async def _buffer_body(receive: Any, limit: int) -> tuple[bytes | None, Any]:
    """Collect the request body. Over the limit, replay the original messages."""
    messages: list[dict[str, Any]] = []
    total = 0
    overflow = False
    while True:
        message = await receive()
        if message.get("type") != "http.request":
            messages.append(message)
            break
        chunk = message.get("body") or b""
        total += len(chunk)
        messages.append(message)
        if total > limit:
            overflow = True
        if not message.get("more_body"):
            break
    if overflow:
        index = 0

        async def replay_original() -> dict[str, Any]:
            nonlocal index
            if index < len(messages):
                current = messages[index]
                index += 1
                return current
            return await receive()

        return None, replay_original
    payload = b"".join(
        message.get("body") or b"" for message in messages if message.get("type") == "http.request"
    )
    sent = False

    async def replay_combined() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": payload, "more_body": False}
        return await receive()

    return payload, replay_combined


__all__ = [
    "CREATE_SESSION_PATH",
    "DesktopAccessMiddleware",
    "Eligibility",
    "EligibilityResolver",
    "MAX_CREATE_BODY_BYTES",
    "WORK_ENVIRONMENTS_PATH",
    "build_work_environments_router",
    "is_desktop_principal",
]
