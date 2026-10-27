#!/usr/bin/env python3
"""Turn one Feishu message into a managed session and reply with the last answer.

Direct chats are one session per open_id. Group chats share one session per chat_id.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from agenticx.gateway.adapters.feishu import FeishuAdapter
from agenticx.managed.errors import MAError
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.config import Principal
from agenticx.managed.host.models import CreateSessionRequest
from agenticx.managed.ids import new_ulid

from ma_agent_runtime.channels.feishu_api import FeishuOpenApi
from ma_agent_runtime.config import Settings
from ma_agent_runtime.pg_event_store import _insert_ignore
from ma_agent_runtime.tables import ma_channel_conversations, ma_channel_inbound

logger = logging.getLogger(__name__)

NEW_CHAT_COMMANDS = frozenset({"新对话", "new chat", "/new", "/reset", "重置", "清空上下文"})
NOTICES = {
    "unpublished": "该智能体暂未发布，请联系管理员",
    "non_text": "暂只支持文字消息",
    "needs_confirmation": "需要人工确认才能继续，IM 渠道暂不支持确认，本次回复已中止",
    "timed_out": "处理超时，请稍后再试",
    "policy_blocked": "请求触发合规拦截",
    "budget_exceeded": "本次用量已达上限，请联系管理员",
    "unavailable": "暂时不可用，请稍后再试",
    "new_chat": "已开始新对话。",
}
_MENTION_RE = re.compile(r"@_user_\d+")
_SESSION_SCOPES = frozenset({"ma:sessions:read", "ma:sessions:write"})


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class ChannelConfig:
    id: str
    tenant_id: str
    name: str
    agent_id: str
    routing: str
    pinned_version: int | None
    environment_id: str | None
    app_id: str
    owner_user_id: str
    idle_reset_hours: float
    open_base_url: str
    revision: int


@dataclass
class TurnOutcome:
    final_text: str
    stop_type: str | None
    needs_confirmation: bool
    timed_out: bool


def notice_for(outcome: TurnOutcome) -> str:
    """User-facing closeout, highest priority first."""
    if outcome.needs_confirmation:
        return NOTICES["needs_confirmation"]
    if outcome.timed_out:
        return NOTICES["timed_out"]
    if outcome.stop_type == "policy_blocked":
        return NOTICES["policy_blocked"]
    if outcome.stop_type == "budget_exceeded":
        return NOTICES["budget_exceeded"]
    return NOTICES["unavailable"]


def conversation_identity(chat_type: str, sender_id: str, chat_id: str) -> tuple[str, str]:
    """Return (session key, conversation type).

    A direct chat is keyed by the sender open_id. A group shares one session
    keyed by chat_id.
    """
    if chat_type == "group":
        return chat_id, "group"
    return sender_id, "p2p"


def title_for(conversation_type: str, key: str) -> str:
    label = "群聊" if conversation_type == "group" else "私聊"
    return f"飞书 · {label} {key[-6:]}"[:200]


def short_sender(open_id: str) -> str:
    return "成员" + open_id[-4:]


class ChannelRouter:
    """Map an inbound Feishu event onto one managed session turn."""

    def __init__(
        self,
        *,
        engine: AsyncEngine,
        service: Any,
        registry: Any,
        settings: Settings,
        clock: Callable[[], datetime] = utc_now,
        poll_seconds: float = 1.0,
    ) -> None:
        self._engine = engine
        self._service = service
        self._registry = registry
        self._settings = settings
        self._clock = clock
        self._poll = poll_seconds
        self._slots = asyncio.Semaphore(settings.channel_max_concurrency)
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}

    async def handle_event(self, channel: ChannelConfig, body: dict[str, Any], api: FeishuOpenApi) -> None:
        try:
            await self._handle(channel, body, api)
        except Exception:
            logger.warning("channel turn failed channel=%s code=%s", channel.id, "internal")

    async def wait_for_idle(
        self,
        principal: Principal,
        tenant_id: str,
        session_id: str,
        *,
        after_seq: int,
        timeout: float,
    ) -> TurnOutcome:
        deadline = time.monotonic() + timeout
        cursor = after_seq
        final_text = ""
        stop_type: str | None = None
        needs_confirmation = False
        action_sent = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                await self._interrupt(principal, session_id)
                return TurnOutcome(
                    final_text=final_text,
                    stop_type=stop_type,
                    needs_confirmation=needs_confirmation,
                    timed_out=True,
                )
            await asyncio.sleep(min(self._poll, remaining))
            events = await self._service.store.list_events(
                tenant_id,
                session_id,
                after_seq=cursor,
                limit=100,
            )
            for event in events:
                cursor = max(cursor, int(event.seq))
                if event.type == "agent.message":
                    final_text = _message_text(event)
                if event.type != "session.status_idle":
                    continue
                stop_type = _stop_type(event)
                if stop_type == "requires_action":
                    needs_confirmation = True
                    if not action_sent:
                        action_sent = True
                        await self._interrupt(principal, session_id)
                    continue
                return TurnOutcome(
                    final_text=final_text,
                    stop_type=stop_type,
                    needs_confirmation=needs_confirmation,
                    timed_out=False,
                )

    async def _handle(self, channel: ChannelConfig, body: dict[str, Any], api: FeishuOpenApi) -> None:
        payload = body if isinstance(body, dict) else {}
        _, msg = FeishuAdapter(channel.app_id, "").process_json(payload)
        if msg is None or not msg.message_id:
            return
        if not await self._claim(channel, msg.message_id):
            return
        async with self._slots:
            if msg.content_type != "text":
                await api.reply(message_id=msg.message_id, text=NOTICES["non_text"])
                return
            text = _MENTION_RE.sub("", msg.content or "").strip()
            if not text:
                return
            chat_type = _chat_type(payload)
            key, conversation_type = conversation_identity(chat_type, msg.sender_id, msg.chat_id)
            async with self._lock(channel.id, key):
                await self._turn(channel, api, msg.message_id, msg.sender_id, text, key, conversation_type, chat_type)

    async def _turn(
        self,
        channel: ChannelConfig,
        api: FeishuOpenApi,
        message_id: str,
        sender_id: str,
        text: str,
        key: str,
        conversation_type: str,
        chat_type: str,
    ) -> None:
        if text.lower() in NEW_CHAT_COMMANDS:
            await self._delete_mapping(channel.id, key)
            await api.reply(message_id=message_id, text=NOTICES["new_chat"])
            return
        agent = await self._registry.get_agent(channel.tenant_id, channel.agent_id)
        if agent is None or agent.status != "active" or agent.lifecycle != "published":
            await api.reply(message_id=message_id, text=NOTICES["unpublished"])
            return
        target = agent.latest_version if channel.routing == "follow_latest" else channel.pinned_version
        if not isinstance(target, int):
            await api.reply(message_id=message_id, text=NOTICES["unavailable"])
            return
        now = self._clock()
        mapping = await self._load_mapping(channel.id, key)
        session = None
        if mapping is not None:
            session = await self._service.store.get_session(channel.tenant_id, mapping["session_id"])
        last_at = _as_utc(mapping["last_message_at"]) if mapping is not None else None
        reuse = (
            mapping is not None
            and session is not None
            and session.status not in ("archived", "terminated")
            and int(mapping["agent_version"]) == target
            and last_at is not None
            and now - last_at <= timedelta(hours=channel.idle_reset_hours)
        )
        principal = Principal(
            tenant_id=channel.tenant_id,
            user_id=channel.owner_user_id,
            scopes=_SESSION_SCOPES,
        )
        if reuse and mapping is not None:
            session_id = str(mapping["session_id"])
        else:
            try:
                record = await self._service.create_session(
                    principal,
                    CreateSessionRequest(
                        agent_id=channel.agent_id,
                        agent_version=target,
                        environment_id=channel.environment_id,
                        title=title_for(conversation_type, key),
                        source="channel",
                    ),
                )
            except MAError as exc:
                logger.warning("channel turn failed channel=%s code=%s", channel.id, exc.code)
                await api.reply(message_id=message_id, text=NOTICES["unavailable"])
                return
            session_id = record.id
            await self._save_mapping(channel, key, conversation_type, record.id, int(record.agent_version), now)
        cursor = await self._service.store.last_seq(channel.tenant_id, session_id)
        body_text = text if chat_type != "group" else f"{short_sender(sender_id)}：{text}"
        try:
            await self._service.post_events(
                principal,
                session_id,
                {"events": [{"type": "user.message", "content": [{"type": "text", "text": body_text}]}]},
            )
        except MAError as exc:
            logger.warning("channel turn failed channel=%s code=%s", channel.id, exc.code)
            await api.reply(message_id=message_id, text=NOTICES["unavailable"])
            return
        await self._touch_mapping(channel.id, key, now)
        outcome = await self.wait_for_idle(
            principal,
            channel.tenant_id,
            session_id,
            after_seq=cursor,
            timeout=self._settings.channel_reply_timeout_seconds,
        )
        await api.reply(message_id=message_id, text=outcome.final_text or notice_for(outcome))

    async def _interrupt(self, principal: Principal, session_id: str) -> None:
        try:
            await self._service.post_events(principal, session_id, {"events": [{"type": "user.interrupt"}]})
        except MAError as exc:
            logger.warning("channel turn failed channel=%s code=%s", session_id, exc.code)

    def _lock(self, channel_id: str, key: str) -> asyncio.Lock:
        slot = (channel_id, key)
        lock = self._locks.get(slot)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[slot] = lock
        return lock

    async def _claim(self, channel: ChannelConfig, message_id: str) -> bool:
        async with self._engine.begin() as conn:
            dialect = conn.dialect.name
            stmt = _insert_ignore(dialect, ma_channel_inbound, ("channel_id", "platform_message_id")).values(
                channel_id=channel.id,
                platform_message_id=message_id,
                tenant_id=channel.tenant_id,
                received_at=self._clock(),
            )
            try:
                result = await conn.execute(stmt)
            except IntegrityError:
                return False
            count = getattr(result, "rowcount", 1)
            try:
                inserted = int(count if count is not None else 1)
            except (TypeError, ValueError):
                inserted = 1
            return inserted != 0

    async def _load_mapping(self, channel_id: str, key: str) -> dict[str, Any] | None:
        async with self._engine.connect() as conn:
            result = await conn.execute(
                select(ma_channel_conversations).where(
                    ma_channel_conversations.c.channel_id == channel_id,
                    ma_channel_conversations.c.conversation_key == key,
                )
            )
            row = result.mappings().first()
            return dict(row) if row is not None else None

    async def _save_mapping(
        self,
        channel: ChannelConfig,
        key: str,
        conversation_type: str,
        session_id: str,
        agent_version: int,
        now: datetime,
    ) -> None:
        async with self._engine.begin() as conn:
            insert = pg_insert if conn.dialect.name == "postgresql" else sqlite_insert
            stmt = insert(ma_channel_conversations).values(
                id=new_ulid(),
                tenant_id=channel.tenant_id,
                channel_id=channel.id,
                conversation_key=key,
                conversation_type=conversation_type,
                session_id=session_id,
                agent_version=agent_version,
                last_message_at=now,
                created_at=now,
                updated_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["channel_id", "conversation_key"],
                set_={
                    "conversation_type": conversation_type,
                    "session_id": session_id,
                    "agent_version": agent_version,
                    "last_message_at": now,
                    "updated_at": now,
                },
            )
            await conn.execute(stmt)

    async def _touch_mapping(self, channel_id: str, key: str, now: datetime) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                ma_channel_conversations.update()
                .where(
                    ma_channel_conversations.c.channel_id == channel_id,
                    ma_channel_conversations.c.conversation_key == key,
                )
                .values(last_message_at=now, updated_at=now)
            )

    async def _delete_mapping(self, channel_id: str, key: str) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                delete(ma_channel_conversations).where(
                    ma_channel_conversations.c.channel_id == channel_id,
                    ma_channel_conversations.c.conversation_key == key,
                )
            )


def _chat_type(body: dict[str, Any]) -> str:
    event = body.get("event")
    if not isinstance(event, dict):
        return "p2p"
    message = event.get("message")
    if not isinstance(message, dict):
        return "p2p"
    value = message.get("chat_type")
    return value if isinstance(value, str) and value else "p2p"


def _message_text(event: StoredEvent) -> str:
    content = event.payload.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts).strip()


def _stop_type(event: StoredEvent) -> str | None:
    reason = event.payload.get("stop_reason")
    if not isinstance(reason, dict):
        return None
    value = reason.get("type")
    return str(value) if value else None


def _as_utc(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        current = value
    elif isinstance(value, str) and value:
        current = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        return None
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)
