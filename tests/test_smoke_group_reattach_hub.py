#!/usr/bin/env python3
"""Smoke tests: group chat SSE event-hub reattach + mid-turn persist.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Callable, Dict, List

from fastapi.testclient import TestClient

from agenticx.runtime.group_router import GroupReply
from agenticx.studio.server import create_studio_app


def _extract_events(lines: List[str]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for line in lines:
        if not line.startswith("data: "):
            continue
        try:
            events.append(json.loads(line[6:]))
        except json.JSONDecodeError:
            continue
    return events


def _install_fake_router(
    monkeypatch: Any,
    *,
    replies: List[GroupReply] | None = None,
    delay_s: float = 0.0,
    boom_after: int | None = None,
    should_stop_sink: list | None = None,
    append_history: bool = True,
) -> None:
    from agenticx.studio import server as server_module

    items = list(
        replies
        or [
            GroupReply(
                agent_id="a1",
                avatar_name="成员甲",
                avatar_url="",
                content="reply-1",
                event_type="group_reply",
            ),
            GroupReply(
                agent_id="a2",
                avatar_name="成员乙",
                avatar_url="",
                content="reply-2",
                event_type="group_reply",
            ),
            GroupReply(
                agent_id="a3",
                avatar_name="成员丙",
                avatar_url="",
                content="reply-3",
                event_type="group_reply",
            ),
        ]
    )

    class _FakeGroupRouter:
        def __init__(self, **_kwargs) -> None:
            pass

        def pick_targets(self, **_kwargs):
            return []

        def _plain_targets_in_text(self, *_args, **_kwargs):
            return []

        async def run_group_turn(self, **kwargs):
            should_stop: Callable[[], Any] = kwargs.get("should_stop") or (lambda: False)
            if should_stop_sink is not None:
                should_stop_sink.append(should_stop)
            base_session = kwargs.get("base_session")
            for idx, reply in enumerate(items):
                if should_stop():
                    return
                if delay_s > 0:
                    await asyncio.sleep(delay_s)
                if append_history and base_session is not None:
                    hist = getattr(base_session, "chat_history", None)
                    if not isinstance(hist, list):
                        hist = []
                        setattr(base_session, "chat_history", hist)
                    hist.append(
                        {
                            "role": "assistant",
                            "content": reply.content,
                            "agent_id": reply.agent_id,
                            "avatar_name": reply.avatar_name,
                            "sender_id": reply.agent_id,
                            "sender_name": reply.avatar_name,
                        }
                    )
                yield reply
                if boom_after is not None and idx + 1 >= boom_after:
                    raise RuntimeError("simulated mid-turn failure")

    monkeypatch.setattr(server_module, "GroupChatRouter", _FakeGroupRouter)
    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: object())


def _setup_group_session(client: TestClient, app: Any) -> tuple[str, Any, Any]:
    manager = app.state.session_manager
    avatar_registry = app.state.avatar_registry
    group_registry = app.state.group_registry
    session_id = client.get("/api/session").json()["session_id"]
    a1 = avatar_registry.create_avatar(name="成员甲", role="Engineer")
    a2 = avatar_registry.create_avatar(name="成员乙", role="Engineer")
    a3 = avatar_registry.create_avatar(name="成员丙", role="Engineer")
    group = group_registry.create_group(
        name="测试群",
        avatar_ids=[a1.id, a2.id, a3.id],
        routing="intelligent",
    )
    return session_id, group, manager


def test_group_stream_publishes_to_event_hub(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)
    published: list[str] = []

    _install_fake_router(
        monkeypatch,
        replies=[
            GroupReply(
                agent_id="a1",
                avatar_name="成员甲",
                avatar_url="",
                content="hub-ok",
                event_type="group_reply",
            )
        ],
    )

    app = create_studio_app()
    client = TestClient(app)
    session_id, group, manager = _setup_group_session(client, app)

    original_ensure = manager.ensure_event_hub

    def _spy_ensure(sid: str):
        hub = original_ensure(sid)
        orig_publish = hub.publish

        async def _capturing_publish(event):
            published.append(str(getattr(event, "type", "") or ""))
            return await orig_publish(event)

        hub.publish = _capturing_publish  # type: ignore[method-assign]
        return hub

    monkeypatch.setattr(manager, "ensure_event_hub", _spy_ensure)

    resp = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "group_id": group.id,
            "user_input": "你好",
        },
    )
    assert resp.status_code == 200
    events = _extract_events(resp.text.splitlines())
    assert any(e.get("type") == "group_reply" for e in events)
    assert "group_reply" in published


def test_group_turn_survives_client_disconnect(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)
    producer_tasks: list[asyncio.Task] = []
    real_create_task = asyncio.create_task

    def _track_create_task(coro, *args, **kwargs):
        task = real_create_task(coro, *args, **kwargs)
        name = getattr(getattr(coro, "cr_code", None), "co_name", "") or ""
        if name == "_produce_group_events":
            producer_tasks.append(task)
        return task

    monkeypatch.setattr(asyncio, "create_task", _track_create_task)
    _install_fake_router(monkeypatch, delay_s=0.05)

    app = create_studio_app()
    client = TestClient(app)
    session_id, group, manager = _setup_group_session(client, app)
    managed = manager.get(session_id)
    assert managed is not None

    with client.stream(
        "POST",
        "/api/chat",
        json={
            "session_id": session_id,
            "group_id": group.id,
            "user_input": "三位都回一下",
        },
    ) as resp:
        assert resp.status_code == 200
        saw_reply = False
        for line in resp.iter_lines():
            if not line.startswith("data: "):
                continue
            try:
                payload = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "group_reply":
                saw_reply = True
                break
        assert saw_reply

    # Hub mode leaves the producer running after disconnect; wait for it.
    deadline = time.time() + 3.0
    while time.time() < deadline:
        hist = list(managed.studio_session.chat_history or [])
        assistant = [
            m
            for m in hist
            if isinstance(m, dict)
            and m.get("role") == "assistant"
            and str(m.get("content") or "").startswith("reply-")
        ]
        if len(assistant) >= 3:
            break
        if producer_tasks and all(t.done() for t in producer_tasks):
            break
        time.sleep(0.05)

    hist = list(managed.studio_session.chat_history or [])
    assistant = [
        m
        for m in hist
        if isinstance(m, dict)
        and m.get("role") == "assistant"
        and str(m.get("content") or "").startswith("reply-")
    ]
    assert len(assistant) == 3
    assert {m.get("content") for m in assistant} == {"reply-1", "reply-2", "reply-3"}


def test_group_should_stop_uses_interrupt(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)
    stop_fns: list = []
    ctx: dict[str, Any] = {"session_id": "", "manager": None}

    replies = [
        GroupReply(
            agent_id="a1",
            avatar_name="成员甲",
            avatar_url="",
            content="before-interrupt",
            event_type="group_reply",
        ),
        GroupReply(
            agent_id="a2",
            avatar_name="成员乙",
            avatar_url="",
            content="should-not-emit",
            event_type="group_reply",
        ),
    ]

    class _FakeGroupRouter:
        def __init__(self, **_kwargs) -> None:
            pass

        def pick_targets(self, **_kwargs):
            return []

        def _plain_targets_in_text(self, *_args, **_kwargs):
            return []

        async def run_group_turn(self, **kwargs):
            should_stop = kwargs.get("should_stop") or (lambda: False)
            stop_fns.append(should_stop)
            base_session = kwargs.get("base_session")
            hist = getattr(base_session, "chat_history", None)
            if not isinstance(hist, list):
                hist = []
                setattr(base_session, "chat_history", hist)
            hist.append(
                {
                    "role": "assistant",
                    "content": replies[0].content,
                    "agent_id": replies[0].agent_id,
                }
            )
            yield replies[0]
            mgr = ctx["manager"]
            sid = str(ctx["session_id"] or "")
            if mgr is not None and sid:
                mgr.request_interrupt(sid)
            await asyncio.sleep(0)
            if should_stop():
                return
            hist.append(
                {
                    "role": "assistant",
                    "content": replies[1].content,
                    "agent_id": replies[1].agent_id,
                }
            )
            yield replies[1]

    monkeypatch.setattr(server_module, "GroupChatRouter", _FakeGroupRouter)
    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_kwargs: object())

    app = create_studio_app()
    client = TestClient(app)
    session_id, group, manager = _setup_group_session(client, app)
    ctx["session_id"] = session_id
    ctx["manager"] = manager

    resp = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "group_id": group.id,
            "user_input": "打断测试",
        },
    )
    assert resp.status_code == 200
    assert stop_fns, "should_stop callback was not captured"
    # Callback itself is interrupt-based (no HTTP disconnect dependency).
    manager.clear_interrupt(session_id)
    assert stop_fns[0]() is False
    manager.request_interrupt(session_id)
    assert stop_fns[0]() is True

    events = _extract_events(resp.text.splitlines())
    reply_contents = [
        str((e.get("data") or {}).get("content") or "")
        for e in events
        if e.get("type") == "group_reply"
    ]
    assert "before-interrupt" in reply_contents
    assert "should-not-emit" not in reply_contents


def test_group_replies_persist_mid_turn(monkeypatch) -> None:
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)
    _install_fake_router(
        monkeypatch,
        replies=[
            GroupReply(
                agent_id="a1",
                avatar_name="成员甲",
                avatar_url="",
                content="persist-1",
                event_type="group_reply",
            ),
            GroupReply(
                agent_id="a2",
                avatar_name="成员乙",
                avatar_url="",
                content="persist-2",
                event_type="group_reply",
            ),
        ],
        boom_after=2,
    )

    app = create_studio_app()
    client = TestClient(app)
    session_id, group, manager = _setup_group_session(client, app)

    persist_calls = {"n": 0}
    real_incremental = manager.incremental_persist

    def _spy_incremental(sid: str) -> bool:
        persist_calls["n"] += 1
        return real_incremental(sid)

    monkeypatch.setattr(manager, "incremental_persist", _spy_incremental)

    resp = client.post(
        "/api/chat",
        json={
            "session_id": session_id,
            "group_id": group.id,
            "user_input": "落盘测试",
        },
    )
    assert resp.status_code == 200
    assert persist_calls["n"] >= 2

    rows = manager._load_messages_snapshot(session_id)
    contents = {str(r.get("content") or "") for r in rows if isinstance(r, dict)}
    assert "persist-1" in contents
    assert "persist-2" in contents


def test_group_reattach_replays_and_continues(monkeypatch) -> None:
    """FR-3: reattach endpoint replays hub buffer after the first group_reply seq."""
    import httpx

    from agenticx.runtime.events import RuntimeEvent
    from agenticx.studio import server as server_module

    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)

    app = create_studio_app()

    async def _run() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            created = await ac.get("/api/session")
            assert created.status_code == 200
            session_id = created.json()["session_id"]
            manager = app.state.session_manager
            avatar_registry = app.state.avatar_registry
            group_registry = app.state.group_registry
            a1 = avatar_registry.create_avatar(name="成员甲", role="Engineer")
            group_registry.create_group(
                name="测试群", avatar_ids=[a1.id], routing="intelligent"
            )

            manager.set_execution_state(session_id, "running")
            hub = manager.ensure_event_hub(session_id)

            await hub.publish(
                RuntimeEvent(
                    type="group_reply",
                    data={
                        "agent_id": "a1",
                        "avatar_name": "成员1",
                        "content": "reply-1",
                        "skipped": False,
                        "error": "",
                    },
                    agent_id="a1",
                )
            )
            since = hub.current_seq  # skip reply-1

            async def _publish_rest() -> None:
                await asyncio.sleep(0.05)  # let reattach subscribe first
                for idx, content in ((2, "reply-2"), (3, "reply-3")):
                    await hub.publish(
                        RuntimeEvent(
                            type="group_reply",
                            data={
                                "agent_id": f"a{idx}",
                                "avatar_name": f"成员{idx}",
                                "content": content,
                                "skipped": False,
                                "error": "",
                            },
                            agent_id=f"a{idx}",
                        )
                    )
                    await asyncio.sleep(0.02)
                await hub.publish_done()

            publisher = asyncio.create_task(_publish_rest())

            async with ac.stream(
                "GET",
                f"/api/sessions/{session_id}/stream",
                params={"since": str(since)},
            ) as reattach:
                assert reattach.status_code == 200
                text = ""
                async for chunk in reattach.aiter_text():
                    text += chunk
                events = _extract_events(text.splitlines())

            await publisher

            reply_contents = [
                str((e.get("data") or {}).get("content") or "")
                for e in events
                if e.get("type") == "group_reply"
            ]
            assert "reply-1" not in reply_contents
            assert "reply-2" in reply_contents
            assert "reply-3" in reply_contents
            assert any(e.get("type") == "done" for e in events)

    asyncio.run(_run())
