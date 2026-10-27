#!/usr/bin/env python3
"""Session service: create sessions, route events, and recover after restart.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Literal

from agenticx.managed.builder import ManagedAgentBuilder
from agenticx.managed.errors import (
    AGENT_NOT_FOUND,
    AGENT_VERSION_NOT_FOUND,
    ENVIRONMENT_NOT_FOUND,
    INVALID_REQUEST,
    MAError,
    SESSION_NOT_FOUND,
    TASK_NOT_FOUND,
    THREAD_NOT_FOUND,
)
from agenticx.managed.events import EventLog
from agenticx.managed.extensions import SessionExtensionFactory
from agenticx.managed.events.state_machine import (
    KIND_BY_EVENT_TYPE,
    PendingAction,
    SessionStateMachine,
)
from agenticx.managed.events.store import SESSION_VISIBLE_THREAD_TYPES, EventStore, StoredEvent, ThreadFilter
from agenticx.managed.host.actor import LocalTurnExecutor, SessionActor, TurnExecutor
from agenticx.managed.host.config import HostConfig, Principal
from agenticx.managed.host.tasks import (
    TASK_EVENT_TYPES,
    TaskRecord,
    fold_task_events,
    overlay_live_records,
    task_completed_event,
)
from agenticx.managed.host.models import CreateSessionRequest
from agenticx.managed.host.registry import AgentRegistry
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.protocol import (
    CLIENT_EVENT_TYPES,
    SERVER_EVENT_TYPES,
    EnvironmentRecord,
    EnvironmentType,
    SessionRecord,
    Usage,
)
from agenticx.managed.spec import compile_spec

ExecutorFactory = Callable[[SessionActor], TurnExecutor]
CreateValidator = Callable[
    [Principal, CreateSessionRequest, EnvironmentRecord],
    Awaitable[list[Any]],
]

_KNOWN_EVENT_TYPES = frozenset(SERVER_EVENT_TYPES) | frozenset(CLIENT_EVENT_TYPES)
_TASK_STATES = frozenset({"running", "succeeded", "failed", "cancelled", "unknown"})


class SessionService:
    """Host-facing session operations. One state machine is cached per session."""

    def __init__(
        self,
        *,
        config: HostConfig,
        event_log: EventLog,
        registry: AgentRegistry,
        builder: ManagedAgentBuilder,
    ) -> None:
        self.config = config
        self.event_log = event_log
        self.registry = registry
        self.builder = builder
        self._actors: dict[tuple[str, str], SessionActor] = {}
        self._actors_lock = asyncio.Lock()
        self._factories: dict[str, ExecutorFactory] = {}
        self._create_validators: dict[str, CreateValidator] = {}
        self._extension_factories: list[SessionExtensionFactory] = []
        self.register_executor_factory("cloud", LocalTurnExecutor)

    @property
    def store(self) -> EventStore:
        return self.event_log.store

    def register_executor_factory(self, env_type: EnvironmentType, factory: ExecutorFactory) -> None:
        """Register the turn executor used for ``env_type``. Later calls replace it."""
        self._factories[env_type] = factory

    def supports_environment(self, env_type: EnvironmentType) -> bool:
        return env_type in self._factories

    def executor_factory(self, env_type: EnvironmentType) -> ExecutorFactory | None:
        """Return the registered factory for ``env_type`` (used to wrap it)."""
        return self._factories.get(env_type)

    def register_create_validator(
        self,
        field: Literal["vault_ids", "resources"],
        validator: CreateValidator,
    ) -> None:
        """Install the validator for a CreateSessionRequest list field. Later calls replace it."""
        self._create_validators[field] = validator

    def register_extension_factory(self, factory: SessionExtensionFactory) -> None:
        """Register a session extension. A named factory replaces the previous one."""
        name = getattr(factory, "_ma_extension_name", None)
        if name:
            for index, existing in enumerate(self._extension_factories):
                if getattr(existing, "_ma_extension_name", None) == name:
                    self._extension_factories[index] = factory
                    return
        self._extension_factories.append(factory)

    @property
    def extension_factories(self) -> tuple[SessionExtensionFactory, ...]:
        return tuple(self._extension_factories)

    async def _validated_list(
        self,
        field: str,
        principal: Principal,
        req: CreateSessionRequest,
        environment: EnvironmentRecord,
    ) -> list[Any]:
        raw = getattr(req, field)
        if not raw:
            return []
        validator = self._create_validators.get(field)
        if validator is None:
            raise MAError(INVALID_REQUEST, f"{field} are not supported by this host yet")
        return await validator(principal, req, environment)

    async def startup(self) -> None:
        """Move unsettled sessions to idle/retries_exhausted after a restart."""
        for record in await self.store.list_unsettled_sessions():
            rows = await self._all_events(record.tenant_id, record.id, list(TASK_EVENT_TYPES))
            dangling = [item for item in fold_task_events(rows).values() if item.state == "unknown"]
            if dangling:
                await self.event_log.append(
                    record.tenant_id,
                    record.id,
                    [
                        task_completed_event(
                            item.task_id,
                            state="failed",
                            summary=item.summary,
                            result=None,
                            error={
                                "type": "host_restarted",
                                "message": "task was lost by a host restart",
                            },
                            duration_ms=0,
                        )
                        for item in dangling
                    ],
                )
            machine = SessionStateMachine(record.status, record.stop_reason)
            events = machine.recover_after_restart()
            if not events:
                continue
            await self.event_log.append(record.tenant_id, record.id, events)
            await self.store.update_session(
                record.tenant_id,
                record.id,
                {
                    "status": machine.status,
                    "stop_reason": (
                        machine.stop_reason.model_dump(mode="json")
                        if machine.stop_reason
                        else None
                    ),
                },
            )

    async def shutdown(self) -> None:
        actors = list(self._actors.values())
        for actor in actors:
            await actor.executor.close()
        self._actors.clear()
        await self.store.close()

    async def create_session(self, principal: Principal, req: CreateSessionRequest) -> SessionRecord:
        """Create an idle session. No events are written; the first seq is 1."""
        agent = await self.registry.get_agent(principal.tenant_id, req.agent_id)
        if agent is None:
            raise MAError(AGENT_NOT_FOUND, "agent not found")
        if agent.status != "active":
            raise MAError(INVALID_REQUEST, "agent is disabled")
        version = await self.registry.get_version(
            principal.tenant_id,
            agent.id,
            req.agent_version,
        )
        if version is None:
            raise MAError(AGENT_VERSION_NOT_FOUND, "agent version not found")
        environment_id = req.environment_id or agent.default_environment_id or "local"
        environment = await self.registry.get_environment(principal.tenant_id, environment_id)
        if environment is None or environment.status != "active":
            raise MAError(ENVIRONMENT_NOT_FOUND, "environment not found")
        if not self.supports_environment(environment.type):
            raise MAError(
                INVALID_REQUEST,
                f'environment type "{environment.type}" is not available on this host',
            )
        spec = compile_spec(agent.id, version.version, version.manifest)
        if spec.multiagent is not None:
            if not getattr(self.config, "threads_enabled", False):
                raise MAError(INVALID_REQUEST, "multiagent is not enabled on this host")
            if environment.type != "cloud":
                raise MAError(INVALID_REQUEST, "multiagent agents require a cloud environment")
            if req.vault_ids or req.resources:
                raise MAError(INVALID_REQUEST, "multiagent sessions do not support vault_ids or resources yet")
        vault_ids = await self._validated_list("vault_ids", principal, req, environment)
        resources = await self._validated_list("resources", principal, req, environment)
        now = utc_now_iso()
        record = SessionRecord(
            id=new_ulid(),
            tenant_id=principal.tenant_id,
            agent_id=agent.id,
            agent_version=version.version,
            environment_id=environment.id,
            created_by_user_id=principal.user_id,
            source=req.source,
            status="idle",
            stop_reason=None,
            title=req.title,
            vault_ids=vault_ids,
            resources=resources,
            usage=Usage(),
            created_at=now,
            updated_at=now,
            archived_at=None,
        )
        return await self.store.create_session(record)

    async def get_session(self, principal: Principal, session_id: str) -> SessionRecord:
        record = await self.store.get_session(principal.tenant_id, session_id)
        if record is None:
            raise MAError(SESSION_NOT_FOUND, "session not found")
        return record

    async def list_sessions(
        self,
        principal: Principal,
        *,
        agent_id: str | None,
        limit: int,
        all_users: bool,
    ) -> list[SessionRecord]:
        """Sessions of this tenant; only the caller's own unless ``all_users``."""
        return await self.store.list_sessions(
            principal.tenant_id,
            agent_id=agent_id,
            created_by_user_id=None if all_users else principal.user_id,
            limit=limit,
        )

    async def post_events(self, principal: Principal, session_id: str, raw: Any) -> list[StoredEvent]:
        actor = await self.actor_for(principal.tenant_id, session_id)
        return await actor.handle_client_batch(raw)

    async def list_events(
        self,
        principal: Principal,
        session_id: str,
        *,
        after_seq: int,
        limit: int,
        types: Sequence[str],
        thread_filter: ThreadFilter | None = ThreadFilter("session"),
    ) -> tuple[list[StoredEvent], bool]:
        await self.get_session(principal, session_id)
        for event_type in types:
            if event_type not in _KNOWN_EVENT_TYPES:
                raise MAError(INVALID_REQUEST, f"unknown event type {event_type}")
        rows = await self.store.list_events(
            principal.tenant_id,
            session_id,
            after_seq=after_seq,
            limit=limit,
            types=list(types) or None,
            thread_filter=thread_filter,
        )
        return rows, len(rows) == limit

    async def list_threads(
        self,
        principal: Principal,
        session_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, Any]]:
        record = await self.get_session(principal, session_id)
        folded = await self._folded_threads(record)
        rows = [self._primary_thread(record), *folded.values()]
        if not include_archived:
            rows = [item for item in rows if item.get("terminated_reason") != "archived"]
        return rows

    async def get_thread(self, principal: Principal, session_id: str, thread_id: str) -> dict[str, Any]:
        record = await self.get_session(principal, session_id)
        if thread_id == record.id:
            return self._primary_thread(record)
        folded = await self._folded_threads(record)
        found = folded.get(thread_id)
        if found is None:
            raise MAError(THREAD_NOT_FOUND, "thread not found")
        return found

    async def list_thread_events(
        self,
        principal: Principal,
        session_id: str,
        thread_id: str,
        *,
        after_seq: int,
        limit: int,
        types: Sequence[str],
    ) -> tuple[list[StoredEvent], bool]:
        await self.get_thread(principal, session_id, thread_id)
        for event_type in types:
            if event_type not in _KNOWN_EVENT_TYPES:
                raise MAError(INVALID_REQUEST, f"unknown event type {event_type}")
        thread_filter = ThreadFilter("thread", None if thread_id == session_id else thread_id)
        rows = await self.store.list_events(
            principal.tenant_id,
            session_id,
            after_seq=after_seq,
            limit=limit,
            types=list(types) or None,
            thread_filter=thread_filter,
        )
        return rows, len(rows) == limit

    async def archive_thread(self, principal: Principal, session_id: str, thread_id: str) -> dict[str, Any]:
        record = await self.get_session(principal, session_id)
        if thread_id == record.id:
            raise MAError(INVALID_REQUEST, "primary thread cannot be archived")
        actor = await self.actor_for(principal.tenant_id, session_id)
        if actor.threads is None:
            raise MAError(THREAD_NOT_FOUND, "thread not found")
        await actor.threads.archive(thread_id)
        refreshed = await self.get_session(principal, session_id)
        folded = await self._folded_threads(refreshed)
        found = folded.get(thread_id)
        if found is None:
            raise MAError(THREAD_NOT_FOUND, "thread not found")
        return found

    async def _folded_threads(self, record: Any) -> dict[str, dict[str, Any]]:
        rows = await self._all_events(record.tenant_id, record.id, list(SESSION_VISIBLE_THREAD_TYPES))
        folded: dict[str, dict[str, Any]] = {}
        for event in rows:
            thread_id = event.thread_id
            if not thread_id:
                continue
            if event.type == "session.thread_created":
                agent = event.payload.get("agent")
                folded[thread_id] = {
                    "id": thread_id,
                    "session_id": record.id,
                    "is_primary": False,
                    "parent_thread_id": record.id,
                    "agent": dict(agent) if isinstance(agent, dict) else {},
                    "status": "idle",
                    "stop_reason": None,
                    "terminated_reason": None,
                    "archived_at": None,
                    "created_at": event.created_at,
                }
                continue
            item = folded.get(thread_id)
            if item is None:
                continue
            if event.type == "session.thread_status_running":
                if item["status"] != "terminated":
                    item["status"] = "running"
            elif event.type == "session.thread_status_idle":
                if item["status"] != "terminated":
                    item["status"] = "idle"
                    item["stop_reason"] = event.payload.get("stop_reason")
            elif event.type == "session.thread_status_terminated":
                reason = event.payload.get("reason")
                item["status"] = "terminated"
                item["terminated_reason"] = reason if isinstance(reason, str) else None
                if reason == "archived":
                    item["archived_at"] = event.created_at
        return folded

    def _primary_thread(self, record: Any) -> dict[str, Any]:
        if record.status in ("running", "rescheduling"):
            status = "running"
        elif record.status == "idle":
            status = "idle"
        else:
            status = "terminated"
        stop = record.stop_reason.model_dump(mode="json") if record.stop_reason else None
        return {
            "id": record.id,
            "session_id": record.id,
            "is_primary": True,
            "parent_thread_id": None,
            "agent": {
                "type": "primary",
                "agent_id": record.agent_id,
                "agent_version": record.agent_version,
            },
            "status": status,
            "stop_reason": stop,
            "terminated_reason": None,
            "archived_at": record.archived_at,
            "created_at": record.created_at,
        }

    async def _all_events(
        self,
        tenant_id: str,
        session_id: str,
        types: list[str],
    ) -> list[StoredEvent]:
        rows: list[StoredEvent] = []
        cursor = 0
        while True:
            batch = await self.store.list_events(
                tenant_id,
                session_id,
                after_seq=cursor,
                limit=500,
                types=types,
            )
            rows.extend(batch)
            if len(batch) < 500:
                break
            cursor = batch[-1].seq
        return rows

    async def _task_view(
        self,
        principal: Principal,
        session_id: str,
    ) -> tuple[dict[str, TaskRecord], Any]:
        record = await self.get_session(principal, session_id)
        rows = await self._all_events(record.tenant_id, record.id, list(TASK_EVENT_TYPES))
        folded = fold_task_events(rows)
        actor = self._actors.get((record.tenant_id, record.id))
        executor = getattr(actor, "executor", None)
        tasks = getattr(executor, "tasks", None)
        if tasks is not None:
            overlay_live_records(folded, tasks.live_records())
        return folded, tasks

    async def list_tasks(
        self,
        principal: Principal,
        session_id: str,
        *,
        state: str | None,
        limit: int,
    ) -> list[TaskRecord]:
        folded, _tasks = await self._task_view(principal, session_id)
        selected = _parse_task_states(state)
        records = list(folded.values())
        if selected is not None:
            records = [item for item in records if item.state in selected]
        records.sort(key=lambda item: item.created_at, reverse=True)
        return records[:limit]

    async def get_task(
        self,
        principal: Principal,
        session_id: str,
        task_id: str,
    ) -> TaskRecord:
        folded, _tasks = await self._task_view(principal, session_id)
        record = folded.get(task_id)
        if record is None:
            raise MAError(TASK_NOT_FOUND, "task not found")
        return record

    async def cancel_task(
        self,
        principal: Principal,
        session_id: str,
        task_id: str,
    ) -> TaskRecord:
        folded, tasks = await self._task_view(principal, session_id)
        record = folded.get(task_id)
        if record is None:
            raise MAError(TASK_NOT_FOUND, "task not found")
        if tasks is not None:
            live = tasks.live_record(task_id)
            if live is not None and live.state == "running":
                killed = await tasks.kill(
                    task_id,
                    error_type="cancelled_by_api",
                    message="cancelled via API",
                    wake=True,
                )
                if killed is not None:
                    return killed
        return record

    async def archive(self, principal: Principal, session_id: str) -> SessionRecord:
        actor = await self.actor_for(principal.tenant_id, session_id)
        key = (principal.tenant_id, session_id)
        async with actor.lock:
            actor.sm.archive()
            updated = await self.store.update_session(
                principal.tenant_id,
                session_id,
                {"status": "archived", "archived_at": utc_now_iso()},
            )
            actor.record = updated
            async with self._actors_lock:
                if self._actors.get(key) is actor:
                    self._actors.pop(key, None)
        self.event_log.broadcaster.close_session(session_id)
        await actor.executor.close()
        return updated

    async def actor_for(self, tenant_id: str, session_id: str) -> SessionActor:
        """Return the cached actor, creating one state machine for the session."""
        key = (tenant_id, session_id)
        cached = self._actors.get(key)
        if cached is not None:
            return cached
        async with self._actors_lock:
            cached = self._actors.get(key)
            if cached is not None:
                return cached
            record = await self.store.get_session(tenant_id, session_id)
            if record is None:
                raise MAError(SESSION_NOT_FOUND, "session not found")
            version = await self.registry.get_version(
                tenant_id,
                record.agent_id,
                record.agent_version,
            )
            if version is None:
                raise MAError(AGENT_VERSION_NOT_FOUND, "agent version not found")
            spec = compile_spec(record.agent_id, version.version, version.manifest)
            environment = await self.registry.get_environment(
                tenant_id,
                record.environment_id or "local",
            )
            if environment is None:
                raise MAError(ENVIRONMENT_NOT_FOUND, "environment not found")
            factory = self._factories.get(environment.type)
            if factory is None:
                raise MAError(
                    INVALID_REQUEST,
                    f'environment type "{environment.type}" is not available on this host',
                )
            pending: list[PendingAction] = []
            if (
                record.status == "idle"
                and record.stop_reason is not None
                and record.stop_reason.type == "requires_action"
            ):
                for event_id in record.stop_reason.event_ids:
                    stored = await self.store.get_event(tenant_id, session_id, event_id)
                    if stored is None:
                        continue
                    kind = KIND_BY_EVENT_TYPE.get(stored.type)
                    if kind is None:
                        continue
                    pending.append(PendingAction(event_id, kind))
            machine = SessionStateMachine(record.status, record.stop_reason, pending)
            actor = SessionActor(
                service=self,
                record=record,
                spec=spec,
                environment=environment,
                sm=machine,
            )
            actor.executor = factory(actor)
            self._actors[key] = actor
            return actor


def _parse_task_states(state: str | None) -> set[str] | None:
    if state is None or not state.strip():
        return None
    chosen: set[str] = set()
    for part in state.split(","):
        value = part.strip()
        if not value:
            continue
        if value not in _TASK_STATES:
            raise MAError(INVALID_REQUEST, f"unknown task state {value}")
        chosen.add(value)
    return chosen or None


__all__ = [
    "CreateValidator",
    "ExecutorFactory",
    "SessionService",
]
