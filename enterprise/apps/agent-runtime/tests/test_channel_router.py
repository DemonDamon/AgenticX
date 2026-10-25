#!/usr/bin/env python3
"""Channel router session mapping without a live Feishu connection.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from agenticx.managed.events.store import StoredEvent
from agenticx.managed.protocol import AgentRecord, SessionRecord
from ma_agent_runtime.channels.router import ChannelConfig, ChannelRouter
from ma_agent_runtime.db import build_engines
from ma_agent_runtime.tables import ma_channel_conversations

FIXTURES = Path(__file__).resolve().parent / "fixtures"
TENANT = "01JTENANT00000000000000001"
OWNER = "01JOWNER000000000000000001"
AGENT = "01JAGENT000000000000000001"
CHANNEL = "01JCHANNEL0000000000000001"
NOW = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


class FakeStore:
    def __init__(self) -> None:
        self.sessions: dict[str, SessionRecord] = {}
        self.events: dict[str, list[StoredEvent]] = {}
        self.seq: dict[str, int] = {}

    async def get_session(self, tenant_id: str, session_id: str) -> SessionRecord | None:
        return self.sessions.get(session_id)

    async def last_seq(self, tenant_id: str, session_id: str) -> int:
        return self.seq.get(session_id, 0)

    async def list_events(self, tenant_id: str, session_id: str, *, after_seq: int = 0, limit: int = 100, types: Any = None):
        rows = [event for event in self.events.get(session_id, []) if event.seq > after_seq]
        return rows[:limit]

    def append(self, session_id: str, event_type: str, payload: dict[str, Any]) -> None:
        seq = self.seq.get(session_id, 0) + 1
        self.seq[session_id] = seq
        self.events.setdefault(session_id, []).append(
            StoredEvent(
                id=f"e{seq}",
                tenant_id=TENANT,
                session_id=session_id,
                seq=seq,
                type=event_type,
                payload=payload,
                created_at="2026-10-25T12:00:00.000Z",
            )
        )


class FakeSessions:
    def __init__(self, store: FakeStore, script: Any = None) -> None:
        self.store = store
        self.script = script or default_script
        self.created: list[Any] = []
        self.posted: list[tuple[str, dict[str, Any]]] = []
        self.principals: list[Any] = []
        self._n = 0

    async def create_session(self, principal: Any, req: Any) -> SessionRecord:
        self.principals.append(principal)
        self.created.append(req)
        self._n += 1
        session_id = f"01JSESSION{self._n:016d}"[:26]
        record = SessionRecord(
            id=session_id,
            tenant_id=TENANT,
            agent_id=AGENT,
            agent_version=req.agent_version or 1,
            environment_id=req.environment_id,
            created_by_user_id=principal.user_id,
            source=req.source,
            status="idle",
            title=req.title,
            created_at="2026-10-25T12:00:00.000Z",
            updated_at="2026-10-25T12:00:00.000Z",
        )
        self.store.sessions[session_id] = record
        return record

    async def post_events(self, principal: Any, session_id: str, raw: dict[str, Any]) -> list[Any]:
        self.posted.append((session_id, raw))
        for event in raw["events"]:
            self.script(self.store, session_id, event)
        return []


class FakeRegistry:
    def __init__(self, record: AgentRecord) -> None:
        self.record = record

    async def get_agent(self, tenant_id: str, agent_id: str) -> AgentRecord:
        return self.record


class FakeApi:
    def __init__(self) -> None:
        self.replies: list[tuple[str, str]] = []

    async def reply(self, *, message_id: str, text: str) -> bool:
        self.replies.append((message_id, text))
        return True


class RuntimeSettings:
    channel_reply_timeout_seconds = 5.0
    channel_max_concurrency = 8


def default_script(store: FakeStore, session_id: str, event: dict[str, Any]) -> None:
    if event["type"] != "user.message":
        return
    store.append(session_id, "session.status_running", {})
    store.append(session_id, "agent.message", {"content": [{"type": "text", "text": "助手回复"}]})
    store.append(session_id, "session.status_idle", {"stop_reason": {"type": "end_turn"}})


def agent(**overrides: Any) -> AgentRecord:
    payload = {
        "id": AGENT,
        "tenant_id": TENANT,
        "slug": "assistant",
        "display_name": "助理",
        "latest_version": 2,
        "status": "active",
        "lifecycle": "published",
        "origin": "enterprise",
        "assignment_keys": [],
        "worker_keys": [],
    }
    payload.update(overrides)
    return AgentRecord.model_validate(payload)


def channel(**overrides: Any) -> ChannelConfig:
    payload = {
        "id": CHANNEL,
        "tenant_id": TENANT,
        "name": "助理",
        "agent_id": AGENT,
        "routing": "follow_latest",
        "pinned_version": None,
        "environment_id": None,
        "app_id": "cli_a1b2c3",
        "owner_user_id": OWNER,
        "idle_reset_hours": 24,
        "open_base_url": "https://open.feishu.cn",
        "revision": 1,
    }
    payload.update(overrides)
    return ChannelConfig(**payload)


def event(name: str, **message: Any) -> dict[str, Any]:
    body = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    body["event"]["message"].update(message)
    if "text" in message:
        body["event"]["message"]["content"] = json.dumps({"text": message["text"]}, ensure_ascii=False)
        body["event"]["message"].pop("text", None)
    return body


@pytest.fixture
async def engine(sqlite_urls: Any):
    async_engine, sync_engine = build_engines(sqlite_urls, pool_size=2)
    yield async_engine
    await async_engine.dispose()
    sync_engine.dispose()


def router(engine: Any, service: FakeSessions, registry: FakeRegistry, **settings: Any) -> ChannelRouter:
    runtime = RuntimeSettings()
    for key, value in settings.items():
        setattr(runtime, key, value)
    return ChannelRouter(
        engine=engine,
        service=service,
        registry=registry,
        settings=runtime,  # type: ignore[arg-type]
        clock=Clock(),
        poll_seconds=0.01,
    )


async def mapping(engine: Any, key: str) -> dict[str, Any] | None:
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(ma_channel_conversations).where(ma_channel_conversations.c.conversation_key == key)
            )
        ).mappings().first()
    return dict(row) if row is not None else None


@pytest.mark.asyncio
async def test_first_message_creates_session(engine: Any) -> None:
    store = FakeStore()
    service = FakeSessions(store)
    record = agent()
    api = FakeApi()
    await router(engine, service, FakeRegistry(record)).handle_event(channel(), event("feishu_message_p2p.json"), api)
    assert len(service.created) == 1
    assert service.created[0].source == "channel"
    assert service.created[0].agent_version == record.latest_version
    assert service.principals[0].user_id == OWNER
    row = await mapping(engine, "ou_x")
    assert row is not None
    assert row["conversation_key"] == "ou_x"
    assert api.replies == [("om_1", "助手回复")]


@pytest.mark.asyncio
async def test_second_message_reuses_session(engine: Any) -> None:
    store = FakeStore()
    service = FakeSessions(store)
    bound = router(engine, service, FakeRegistry(agent()))
    await bound.handle_event(channel(), event("feishu_message_p2p.json"), FakeApi())
    second = event("feishu_message_p2p.json", message_id="om_2", text="再问一次")
    await bound.handle_event(channel(), second, FakeApi())
    assert len(service.created) == 1
    assert service.posted[0][0] == service.posted[1][0]


@pytest.mark.asyncio
async def test_group_message_uses_chat_key_and_prefix(engine: Any) -> None:
    store = FakeStore()
    service = FakeSessions(store)
    await router(engine, service, FakeRegistry(agent())).handle_event(
        channel(),
        event("feishu_message_group.json"),
        FakeApi(),
    )
    row = await mapping(engine, "oc_x")
    assert row is not None
    assert row["conversation_key"] == "oc_x"
    posted = service.posted[0][1]["events"][0]["content"][0]["text"]
    assert posted == "成员ou_x：帮我总结"


@pytest.mark.asyncio
async def test_duplicate_message_id_is_dropped(engine: Any) -> None:
    store = FakeStore()
    service = FakeSessions(store)
    api = FakeApi()
    bound = router(engine, service, FakeRegistry(agent()))
    body = event("feishu_message_p2p.json")
    await bound.handle_event(channel(), body, api)
    await bound.handle_event(channel(), body, api)
    assert len(service.posted) == 1
    assert len(api.replies) == 1


@pytest.mark.asyncio
async def test_new_chat_command_resets(engine: Any) -> None:
    store = FakeStore()
    service = FakeSessions(store)
    api = FakeApi()
    bound = router(engine, service, FakeRegistry(agent()))
    await bound.handle_event(channel(), event("feishu_message_p2p.json"), api)
    await bound.handle_event(channel(), event("feishu_message_p2p.json", message_id="om_new", text="/new"), api)
    assert await mapping(engine, "ou_x") is None
    assert api.replies[-1] == ("om_new", "已开始新对话。")
    await bound.handle_event(channel(), event("feishu_message_p2p.json", message_id="om_3", text="新的"), api)
    assert len(service.created) == 2


@pytest.mark.asyncio
async def test_idle_reset(engine: Any) -> None:
    store = FakeStore()
    service = FakeSessions(store)
    old = SessionRecord(
        id="01JOLDSESSION0000000000001",
        tenant_id=TENANT,
        agent_id=AGENT,
        agent_version=2,
        created_by_user_id=OWNER,
        source="channel",
        status="idle",
        created_at="2026-10-24T00:00:00.000Z",
        updated_at="2026-10-24T00:00:00.000Z",
    )
    store.sessions[old.id] = old
    async with engine.begin() as conn:
        await conn.execute(
            ma_channel_conversations.insert().values(
                id="01JMAP00000000000000000001",
                tenant_id=TENANT,
                channel_id=CHANNEL,
                conversation_key="ou_x",
                conversation_type="p2p",
                session_id=old.id,
                agent_version=2,
                last_message_at=NOW - timedelta(hours=25),
                created_at=NOW - timedelta(hours=25),
                updated_at=NOW - timedelta(hours=25),
            )
        )
    await router(engine, service, FakeRegistry(agent())).handle_event(channel(), event("feishu_message_p2p.json"), FakeApi())
    assert len(service.created) == 1
    row = await mapping(engine, "ou_x")
    assert row is not None
    assert row["session_id"] != old.id


@pytest.mark.asyncio
async def test_follow_latest_switches_on_publish(engine: Any) -> None:
    record = agent(latest_version=2)
    store = FakeStore()
    service = FakeSessions(store)
    bound = router(engine, service, FakeRegistry(record))
    await bound.handle_event(channel(), event("feishu_message_p2p.json"), FakeApi())
    record.latest_version = 3
    await bound.handle_event(channel(), event("feishu_message_p2p.json", message_id="om_2", text="版本"), FakeApi())
    assert len(service.created) == 2
    assert service.created[1].agent_version == 3
    row = await mapping(engine, "ou_x")
    assert row is not None
    assert int(row["agent_version"]) == 3


@pytest.mark.asyncio
async def test_pinned_stays(engine: Any) -> None:
    record = agent(latest_version=2)
    store = FakeStore()
    service = FakeSessions(store)
    bound = router(engine, service, FakeRegistry(record))
    pinned = channel(routing="pinned", pinned_version=2)
    await bound.handle_event(pinned, event("feishu_message_p2p.json"), FakeApi())
    record.latest_version = 3
    await bound.handle_event(pinned, event("feishu_message_p2p.json", message_id="om_2", text="仍是旧版"), FakeApi())
    assert len(service.created) == 1
    assert service.posted[0][0] == service.posted[1][0]
    assert service.created[0].agent_version == 2


@pytest.mark.asyncio
async def test_requires_action_interrupts(engine: Any) -> None:
    def script(store: FakeStore, session_id: str, event_body: dict[str, Any]) -> None:
        if event_body["type"] == "user.message":
            store.append(session_id, "session.status_idle", {"stop_reason": {"type": "requires_action", "event_ids": ["e1"]}})
        elif event_body["type"] == "user.interrupt":
            store.append(session_id, "session.status_idle", {"stop_reason": {"type": "end_turn"}})

    store = FakeStore()
    service = FakeSessions(store, script)
    api = FakeApi()
    await router(engine, service, FakeRegistry(agent())).handle_event(channel(), event("feishu_message_p2p.json"), api)
    interrupts = [item for _sid, item in service.posted if item["events"][0]["type"] == "user.interrupt"]
    assert len(interrupts) == 1
    assert api.replies[-1][1] == "需要人工确认才能继续，IM 渠道暂不支持确认，本次回复已中止"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("stop", "notice"),
    [
        ("policy_blocked", "请求触发合规拦截"),
        ("budget_exceeded", "本次用量已达上限，请联系管理员"),
        ("retries_exhausted", "暂时不可用，请稍后再试"),
    ],
)
async def test_stop_notices(engine: Any, stop: str, notice: str) -> None:
    def script(store: FakeStore, session_id: str, event_body: dict[str, Any]) -> None:
        if event_body["type"] == "user.message":
            store.append(session_id, "session.status_idle", {"stop_reason": {"type": stop}})

    api = FakeApi()
    await router(engine, FakeSessions(FakeStore(), script), FakeRegistry(agent())).handle_event(
        channel(),
        event("feishu_message_p2p.json"),
        api,
    )
    assert api.replies[-1][1] == notice


@pytest.mark.asyncio
async def test_timeout_interrupts(engine: Any) -> None:
    def script(store: FakeStore, session_id: str, event_body: dict[str, Any]) -> None:
        return None

    api = FakeApi()
    service = FakeSessions(FakeStore(), script)
    await router(
        engine,
        service,
        FakeRegistry(agent()),
        channel_reply_timeout_seconds=0.2,
    ).handle_event(channel(), event("feishu_message_p2p.json"), api)
    assert any(item["events"][0]["type"] == "user.interrupt" for _sid, item in service.posted)
    assert api.replies[-1][1] == "处理超时，请稍后再试"


@pytest.mark.asyncio
async def test_unpublished_agent_notice(engine: Any) -> None:
    service = FakeSessions(FakeStore())
    api = FakeApi()
    await router(engine, service, FakeRegistry(agent(lifecycle="draft"))).handle_event(
        channel(),
        event("feishu_message_p2p.json"),
        api,
    )
    assert service.created == []
    assert api.replies == [("om_1", "该智能体暂未发布，请联系管理员")]


@pytest.mark.asyncio
async def test_non_text_notice(engine: Any) -> None:
    service = FakeSessions(FakeStore())
    api = FakeApi()
    await router(engine, service, FakeRegistry(agent())).handle_event(
        channel(),
        event("feishu_message_p2p.json", message_type="image", content="{}"),
        api,
    )
    assert service.created == []
    assert api.replies == [("om_1", "暂只支持文字消息")]


@pytest.mark.asyncio
async def test_logs_omit_secret_and_message(engine: Any, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("WARNING")
    await router(engine, FakeSessions(FakeStore()), FakeRegistry(agent())).handle_event(
        channel(),
        event("feishu_message_p2p.json", text="UNIQUE_BODY_77"),
        FakeApi(),
    )
    assert "UNIQUE_BODY_77" not in caplog.text
    assert "super-secret-value" not in caplog.text
