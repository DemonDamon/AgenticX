#!/usr/bin/env python3
"""Tests for read-only replay HTTP endpoints.

Author: Damon Li
"""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient as FastAPITestClient

from agenticx.runtime.replay_ledger import ReplayLedgerStore, ReplayRunRecord, RunEvent
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.studio.server import create_studio_app


class TestClient(FastAPITestClient):
    """Replay API client with the configured Desktop token."""

    def __init__(self, app, **kwargs) -> None:
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("x-agx-desktop-token", "desktop-secret")
        super().__init__(app, headers=headers, **kwargs)


class _Response:
    def __init__(self, content: str) -> None:
        self.content = content
        self.tool_calls: list = []
        self.finish_reason = "stop"
        self.reasoning_content = ""


class _TextLLM:
    def __init__(self, responses: list[str] | None = None) -> None:
        self.responses = list(responses or ["done"])

    def invoke(self, *_args, **_kwargs):
        return _Response(self.responses.pop(0) if self.responses else "done")

    def stream(self, *_args, **_kwargs):
        if False:
            yield ""


def _app(tmp_path: Path, monkeypatch, *, token: str = "desktop-secret"):
    monkeypatch.setenv("HOME", str(tmp_path))
    if token:
        monkeypatch.setenv("AGX_DESKTOP_TOKEN", token)
    else:
        monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    app = create_studio_app()
    manager = app.state.session_manager
    manager._sessions_root = str(tmp_path / ".agenticx" / "sessions")
    manager.create(session_id="session-api")
    return app, manager


def _seed(store: ReplayLedgerStore, count: int = 1) -> None:
    store.open_run(
        ReplayRunRecord(
            run_id="run-api",
            session_id="session-api",
            turn_id="turn-api",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    for index in range(1, count + 1):
        store.append_event(
            "run-api",
            RunEvent(
                event_id=f"event-{index}",
                run_id="run-api",
                session_id="session-api",
                turn_id="turn-api",
                seq=0,
                ts=float(index),
                type="round_started" if index % 2 else "tool_progress",
                agent_id="meta",
                payload={"index": index},
            ),
        )


def test_replay_routes_enforce_desktop_token(tmp_path: Path, monkeypatch) -> None:
    app, _ = _app(tmp_path, monkeypatch, token="desktop-secret")
    client = FastAPITestClient(app)
    assert (
        client.get("/api/runs", params={"session_id": "session-api"}).status_code == 401
    )
    assert (
        client.get(
            "/api/runs",
            params={"session_id": "session-api"},
            headers={"x-agx-desktop-token": "wrong"},
        ).status_code
        == 401
    )


def test_sensitive_replay_reads_require_configured_token(
    tmp_path: Path,
    monkeypatch,
) -> None:
    app, manager = _app(tmp_path, monkeypatch, token="")
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store)
    client = FastAPITestClient(app)

    assert client.get("/api/runs/run-api/events").status_code == 403
    assert client.get("/api/runs/run-api/export").status_code == 403
    assert (
        client.get(
            "/api/runs",
            params={"session_id": "session-api"},
        ).status_code
        == 200
    )


def test_replay_routes_reject_glob_run_id_and_accept_automation_id(
    tmp_path: Path,
    monkeypatch,
) -> None:
    app, manager = _app(tmp_path, monkeypatch, token="desktop-secret")
    store = ReplayLedgerStore(Path(manager._sessions_root))
    store.open_run(
        ReplayRunRecord(
            run_id="automation:task_1.2",
            session_id="session-api",
            turn_id="turn-api",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    client = TestClient(
        app,
        headers={"x-agx-desktop-token": "desktop-secret"},
    )

    assert client.get("/api/runs/%2A/events").status_code in {400, 422}
    assert client.get("/api/runs/automation:task_1.2/events").status_code == 200


def test_sensitive_replay_reads_reject_wrong_and_accept_matching_token(
    tmp_path: Path,
    monkeypatch,
) -> None:
    app, manager = _app(tmp_path, monkeypatch, token="desktop-secret")
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store)
    client = TestClient(app)
    sensitive_urls = [
        ("/api/runs/run-api/events", {"include_payload": "true"}),
        ("/api/runs/run-api/export", {"redact": "false"}),
    ]

    for url, params in sensitive_urls:
        assert (
            client.get(
                url,
                params=params,
                headers={"x-agx-desktop-token": "wrong"},
            ).status_code
            == 401
        )
        assert (
            client.get(
                url,
                params=params,
                headers={"x-agx-desktop-token": "desktop-secret"},
            ).status_code
            == 200
        )


def test_events_paginate_120_rows_without_duplicates(
    tmp_path: Path, monkeypatch
) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 120)
    client = TestClient(app)
    after = 0
    seen: list[int] = []
    sizes: list[int] = []
    while True:
        response = client.get(
            "/api/runs/run-api/events",
            params={"after_seq": after, "limit": 50},
        )
        assert response.status_code == 200
        body = response.json()
        page = [row["seq"] for row in body["events"]]
        sizes.append(len(page))
        seen.extend(page)
        if not body["has_more"]:
            break
        after = body["next_seq"]
    assert sizes == [50, 50, 20]
    assert seen == list(range(1, 121))


def test_event_types_filter_and_payload_expansion(tmp_path: Path, monkeypatch) -> None:
    app, manager = _app(tmp_path, monkeypatch, token="desktop-secret")
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 4)
    response = TestClient(app).get(
        "/api/runs/run-api/events",
        params={"types": "tool_progress,not-a-real-type", "include_payload": "true"},
        headers={"x-agx-desktop-token": "desktop-secret"},
    )
    assert response.status_code == 200
    assert {row["type"] for row in response.json()["events"]} == {"tool_progress"}


def test_legacy_session_returns_honest_empty_runs(tmp_path: Path, monkeypatch) -> None:
    app, _ = _app(tmp_path, monkeypatch)
    response = TestClient(app).get("/api/runs", params={"session_id": "session-api"})
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "runs": [],
        "legacy_summary_available": True,
        "reason": "no_replay_ledger",
    }


def test_corrupt_event_row_returns_partial_run(tmp_path: Path, monkeypatch) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store)
    events_path = (
        Path(manager._sessions_root)
        / "session-api"
        / "runs"
        / "run-api"
        / "events.jsonl"
    )
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write("not-json\n")
    response = TestClient(app).get("/api/runs/run-api/events")
    assert response.status_code == 200
    assert response.json()["run"]["completeness"] == "partial"


def test_corrupt_event_export_reports_partial_run(tmp_path: Path, monkeypatch) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store)
    events_path = (
        Path(manager._sessions_root)
        / "session-api"
        / "runs"
        / "run-api"
        / "events.jsonl"
    )
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write("not-json\n")

    response = TestClient(app).get(
        "/api/runs/run-api/export",
        params={"format": "markdown"},
    )

    assert response.status_code == 200
    assert "- Completeness: `partial`" in response.text
    assert "记录不完整: corrupt_event_line" in response.text


def test_missing_payload_blob_export_reports_partial_run(
    tmp_path: Path,
    monkeypatch,
) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    store.append_event(
        "run-api",
        RunEvent(
            event_id="missing-blob-event",
            run_id="run-api",
            session_id="session-api",
            turn_id="turn-api",
            seq=0,
            ts=2.0,
            type="tool_call",
            agent_id="meta",
            tool_call_id="call-missing",
            payload={"name": "file_read", "arguments_summary": "{}"},
            payload_ref="0" * 64,
        ),
    )

    response = TestClient(app).get(
        "/api/runs/run-api/export",
        params={"format": "markdown"},
    )

    assert response.status_code == 200
    assert "- Completeness: `partial`" in response.text
    assert "记录不完整: payload_blob_missing" in response.text


def test_export_rejects_event_count_over_cap(tmp_path: Path, monkeypatch) -> None:
    from agenticx.studio import run_replay_routes

    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 3)
    monkeypatch.setattr(run_replay_routes, "MAX_EXPORT_EVENTS", 2)

    response = TestClient(app).get("/api/runs/run-api/export")

    assert response.status_code == 413
    assert response.json()["detail"] == "export_too_large"


def test_export_rejects_resolved_payload_bytes_over_cap(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from agenticx.studio import run_replay_routes

    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    payload_ref = store.write_blob("run-api", {"result": "x" * 100})
    store.append_event(
        "run-api",
        RunEvent(
            event_id="large-payload",
            run_id="run-api",
            session_id="session-api",
            turn_id="turn-api",
            seq=0,
            ts=2.0,
            type="tool_result",
            agent_id="meta",
            payload={"name": "file_read", "status": "completed"},
            payload_ref=payload_ref,
        ),
    )
    monkeypatch.setattr(run_replay_routes, "MAX_EXPORT_RESOLVED_BYTES", 32)

    response = TestClient(app).get("/api/runs/run-api/export")

    assert response.status_code == 413
    assert response.json()["detail"] == "export_too_large"


def test_events_and_export_bound_high_compression_payload(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from agenticx.studio import run_replay_routes

    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    raw = json.dumps({"result": "x" * 10_000}, separators=(",", ":")).encode()
    payload_ref = hashlib.sha256(raw).hexdigest()
    blob_path = (
        Path(manager._sessions_root)
        / "session-api"
        / "runs"
        / "run-api"
        / "blobs"
        / f"{payload_ref}.json.gz"
    )
    blob_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(blob_path, "wb") as handle:
        handle.write(raw)
    store.append_event(
        "run-api",
        RunEvent(
            event_id="zip-bomb",
            run_id="run-api",
            session_id="session-api",
            turn_id="turn-api",
            seq=0,
            ts=2.0,
            type="tool_result",
            agent_id="meta",
            payload={"name": "file_read", "status": "completed"},
            payload_ref=payload_ref,
        ),
    )
    monkeypatch.setattr(run_replay_routes, "MAX_EXPORT_RESOLVED_BYTES", 128)
    client = TestClient(app)

    events_response = client.get(
        "/api/runs/run-api/events",
        params={"include_payload": "true"},
    )
    export_response = client.get("/api/runs/run-api/export")

    assert events_response.status_code == 200
    assert events_response.json()["events"][0]["resolved_payload"] is None
    assert events_response.json()["run"]["gap_reason"] == "payload_blob_too_large"
    assert export_response.status_code == 413
    assert export_response.json()["detail"] == "export_too_large"


def test_export_budget_counts_each_repeated_blob_expansion(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from agenticx.studio import run_replay_routes

    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    payload = {"result": "x" * 20}
    payload_ref = store.write_blob("run-api", payload)
    for index in range(2):
        store.append_event(
            "run-api",
            RunEvent(
                event_id=f"repeated-payload-{index}",
                run_id="run-api",
                session_id="session-api",
                turn_id="turn-api",
                seq=0,
                ts=2.0 + index,
                type="tool_result",
                agent_id="meta",
                payload={"name": "file_read", "status": "completed"},
                payload_ref=payload_ref,
            ),
        )
    serialized_size = len(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    monkeypatch.setattr(
        run_replay_routes,
        "MAX_EXPORT_RESOLVED_BYTES",
        serialized_size * 2 - 1,
    )

    response = TestClient(app).get("/api/runs/run-api/export")

    assert response.status_code == 413
    assert response.json()["detail"] == "export_too_large"


def test_export_reads_repeated_blob_once(tmp_path: Path, monkeypatch) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    payload_ref = store.write_blob("run-api", {"result": "shared"})
    for index in range(2):
        store.append_event(
            "run-api",
            RunEvent(
                event_id=f"cached-payload-{index}",
                run_id="run-api",
                session_id="session-api",
                turn_id="turn-api",
                seq=0,
                ts=2.0 + index,
                type="tool_result",
                agent_id="meta",
                payload={"name": "file_read", "status": "completed"},
                payload_ref=payload_ref,
            ),
        )
    reads = 0
    original_read_blob = ReplayLedgerStore.read_blob

    def _counted_read_blob(self, run_id: str, blob_ref: str, **kwargs):
        nonlocal reads
        reads += 1
        return original_read_blob(self, run_id, blob_ref, **kwargs)

    monkeypatch.setattr(ReplayLedgerStore, "read_blob", _counted_read_blob)

    response = TestClient(app).get("/api/runs/run-api/export")

    assert response.status_code == 200
    assert reads == 1


def test_corrupt_run_metadata_is_partial_not_legacy_empty(
    tmp_path: Path, monkeypatch
) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store)
    run_path = (
        Path(manager._sessions_root) / "session-api" / "runs" / "run-api" / "run.json"
    )
    run_path.write_text("{broken", encoding="utf-8")
    response = TestClient(app).get("/api/runs", params={"session_id": "session-api"})
    assert response.status_code == 200
    assert response.json()["runs"][0]["completeness"] == "partial"
    assert response.json()["runs"][0]["gap_reason"] == "corrupt_run_metadata"


def test_subagent_runs_are_nested_by_source_tool_call_id(
    tmp_path: Path, monkeypatch
) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    store.append_event(
        "run-api",
        RunEvent(
            event_id="tool-anchor",
            run_id="run-api",
            session_id="session-api",
            turn_id="turn-api",
            seq=0,
            ts=2.0,
            type="tool_call",
            agent_id="meta",
            tool_call_id="call-delegate",
            payload={
                "name": "delegate_to_avatar",
                "source_tool_call_id": "call-delegate",
            },
        ),
    )
    SubAgentRunStore("session-api").open_run(
        run_id="canonical-sub-run",
        kind="delegate",
        name="worker",
        role="worker",
        task="do work",
        status="running",
        source_tool_call_id="call-delegate",
    )
    response = TestClient(app).get("/api/runs/run-api/events")
    assert response.status_code == 200
    nested = response.json()["events"][0]["subagent_runs"]
    assert nested[0]["run"]["run_id"] == "canonical-sub-run"
    assert nested[0]["run"]["source_tool_call_id"] == "call-delegate"
    assert "activity" in nested[0]


def test_subagent_runs_are_nested_only_on_parent_tool_call_anchor(
    tmp_path: Path, monkeypatch
) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store, 0)
    for event_id, event_type in [
        ("tool-anchor", "tool_call"),
        ("tool-result", "tool_result"),
        ("progress", "tool_progress"),
    ]:
        store.append_event(
            "run-api",
            RunEvent(
                event_id=event_id,
                run_id="run-api",
                session_id="session-api",
                turn_id="turn-api",
                seq=0,
                ts=2.0,
                type=event_type,
                agent_id="meta",
                tool_call_id="call-delegate",
                payload={"source_tool_call_id": "call-delegate"},
            ),
        )
    subagent_store = SubAgentRunStore("session-api")
    subagent_store.open_run(
        run_id="canonical-sub-run",
        kind="delegate",
        name="worker",
        role="worker",
        task="do work",
        status="running",
        source_tool_call_id="call-delegate",
    )

    events = TestClient(app).get("/api/runs/run-api/events").json()["events"]

    assert "subagent_runs" in events[0]
    assert [row["run"]["run_id"] for row in events[0]["subagent_runs"]] == [
        "canonical-sub-run"
    ]
    assert "subagent_runs" not in events[1]
    assert "subagent_runs" not in events[2]


def test_studio_chat_and_loop_inject_checkpoint_store(
    tmp_path: Path, monkeypatch
) -> None:
    from agenticx.studio import server as server_module

    captured: list[object | None] = []
    real_runtime = server_module.AgentRuntime

    class _CapturingRuntime(real_runtime):
        def __init__(self, *args, **kwargs):
            captured.append(kwargs.get("checkpoint_store"))
            super().__init__(*args, **kwargs)

    app, _ = _app(tmp_path, monkeypatch)
    monkeypatch.setattr(server_module, "AgentRuntime", _CapturingRuntime)
    monkeypatch.setattr(
        server_module.ProviderResolver,
        "resolve",
        lambda **_: _TextLLM(["done", "DONE"]),
    )
    client = TestClient(app)
    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": "session-api", "user_input": "hello"},
    ) as response:
        assert response.status_code == 200
        list(response.iter_lines())
    with client.stream(
        "POST",
        "/api/loop",
        json={
            "session_id": "session-api",
            "user_input": "iterate",
            "max_iterations": 1,
            "completion_promise": "DONE",
        },
    ) as response:
        assert response.status_code == 200
        list(response.iter_lines())

    assert len(captured) == 2
    assert all(store is not None for store in captured)


def test_studio_avatar_turn_uses_active_avatar_as_replay_actor(
    tmp_path: Path, monkeypatch
) -> None:
    from agenticx.studio import server as server_module

    app, manager = _app(tmp_path, monkeypatch)
    managed = manager.get("session-api", touch=False)
    managed.avatar_id = "avatar-worker"
    managed.studio_session.avatar_id = "avatar-worker"
    monkeypatch.setattr(
        server_module.ProviderResolver, "resolve", lambda **_: _TextLLM()
    )
    client = TestClient(app)
    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": "session-api", "user_input": "hello"},
    ) as response:
        assert response.status_code == 200
        list(response.iter_lines())

    store = ReplayLedgerStore(Path(manager._sessions_root))
    record = store.list_runs("session-api")[0]
    events = store.read_events(record.run_id)[0]
    assert record.agent_id == "avatar-worker"
    assert {event.agent_id for event in events} == {"avatar-worker"}


def test_studio_main_turn_creates_one_run(tmp_path: Path, monkeypatch) -> None:
    from agenticx.studio import server as server_module

    app, manager = _app(tmp_path, monkeypatch)
    monkeypatch.setattr(
        server_module.ProviderResolver, "resolve", lambda **_: _TextLLM()
    )
    client = TestClient(app)
    with client.stream(
        "POST",
        "/api/chat",
        json={"session_id": "session-api", "user_input": "hello"},
    ) as response:
        assert response.status_code == 200
        list(response.iter_lines())
    runs = ReplayLedgerStore(Path(manager._sessions_root)).list_runs("session-api")
    assert len(runs) == 1
    assert runs[0].status == "completed"


def test_loop_turns_create_ordered_runs(tmp_path: Path, monkeypatch) -> None:
    from agenticx.studio import server as server_module

    app, manager = _app(tmp_path, monkeypatch)
    llm = _TextLLM(["keep going", "DONE"])
    monkeypatch.setattr(server_module.ProviderResolver, "resolve", lambda **_: llm)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/api/loop",
        json={
            "session_id": "session-api",
            "user_input": "iterate",
            "max_iterations": 2,
            "completion_promise": "DONE",
        },
    ) as response:
        assert response.status_code == 200
        list(response.iter_lines())
    runs = ReplayLedgerStore(Path(manager._sessions_root)).list_runs("session-api")
    assert len(runs) == 2
    assert [record.created_at for record in runs] == sorted(
        record.created_at for record in runs
    )


def test_session_delete_removes_run_index(tmp_path: Path, monkeypatch) -> None:
    app, manager = _app(tmp_path, monkeypatch)
    store = ReplayLedgerStore(Path(manager._sessions_root))
    _seed(store)
    assert manager.delete("session-api") is True
    assert store.list_runs("session-api") == []
