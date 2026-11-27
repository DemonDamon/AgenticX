"""Tests for the session stream reattach fallback to the replay ledger.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

import agenticx.studio.server as server_module
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.reattach import format_ledger_cursor, parse_ledger_cursor, read_reattach_replay
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.studio.server import create_studio_app

SID = "ledger-reattach-1"


def _parse_sse(text: str) -> tuple[list[dict], list[str]]:
    events: list[dict] = []
    ids: list[str] = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("id: "):
                ids.append(line[4:].strip())
            elif line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events, ids


async def _app_with_crashed_turn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[object, str, ReplayLedgerRecorder]:
    """A session whose turn was cut by a crash: no live hub, an open run in the ledger."""
    monkeypatch.setattr(ConfigManager, "get_value", lambda key, default=None: None)
    for name in ("AGX_LEDGER_REATTACH", "AGX_HA_MODE", "AGX_STORAGE_BACKEND"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)

    app = create_studio_app()
    manager = app.state.session_manager
    manager._sessions_root = str(tmp_path / "sessions")
    manager._session_store = SessionStore(tmp_path / "sessions.sqlite")
    # Keep the session files written by create() inside tmp_path as well.
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: tmp_path / "sessions")
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()
    manager.create(session_id=SID)
    manager.set_execution_state(SID, "running")

    store = ReplayLedgerStore(Path(manager._sessions_root))
    recorder = ReplayLedgerRecorder(
        store=store, session_id=SID, agent_id="meta", provider="test", model="test-model"
    )
    run_id = recorder.start_turn(turn_id="turn-reattach", user_input="帮我完成两步任务")
    for event_type, data, round_idx in (
        ("round_start", {"round": 3}, 3),
        ("tool_call", {"name": "todo_write", "arguments": {"todos": []}, "tool_call_id": "c2"}, 3),
        (
            "confirm_required",
            {"id": "req-9", "question": "允许写入吗？", "context": {"tool": "todo_write", "request_id": "req-9"}},
            3,
        ),
    ):
        recorder.observe(RuntimeEvent(event_type, data), session=StudioSession(), round_idx=round_idx)
    # seq 1 = run_started, 2 = user_message (both skipped on replay), 3..5 = the turn's structure
    return app, run_id, recorder


async def _stream(app: object, headers: dict | None = None) -> str:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get(f"/api/sessions/{SID}/stream", headers=headers)
        assert response.status_code == 200
        return response.text


def test_ledger_cursor_roundtrip_and_plain_integers_are_not_ledger_cursors() -> None:
    cursor = format_ledger_cursor("run-abc", 12)

    assert cursor == "ledger:run-abc:12"
    assert parse_ledger_cursor(cursor) == ("run-abc", 12)
    assert parse_ledger_cursor("57") is None
    assert parse_ledger_cursor("ledger:run-abc") is None
    assert parse_ledger_cursor(None, "57", cursor) == ("run-abc", 12)  # first match wins


async def test_stale_live_seq_after_restart_replays_the_crashed_turn_from_the_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    events, ids = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))

    assert events[0]["type"] == "replay_gap"
    assert events[0]["data"] == {
        "since": "57",
        "oldest_buffered": format_ledger_cursor(run_id, 3),
        "source": "ledger",
    }
    assert [event["type"] for event in events[1:-1]] == ["round_start", "tool_call", "confirm_required"]
    assert events[1]["data"]["round"] == 3
    assert events[2]["data"]["name"] == "todo_write"
    assert events[2]["data"]["tool_call_id"] == "c2"
    assert events[3]["data"]["id"] == "req-9"
    assert events[-1] == {"type": "done", "data": {"reason": "replayed_from_ledger"}}
    assert ids == [format_ledger_cursor(run_id, seq) for seq in (3, 4, 5)]


async def test_second_client_without_cursor_reads_the_same_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    first, _ = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))
    second_text, third_text = await asyncio.gather(_stream(app), _stream(app))
    second, second_ids = _parse_sse(second_text)
    third, third_ids = _parse_sse(third_text)

    assert second[0]["type"] == "round_start"  # no cursor, no gap notice
    assert second_ids == third_ids == [format_ledger_cursor(run_id, seq) for seq in (3, 4, 5)]
    assert second[0] == first[1]
    assert second[1] == first[2]
    assert second[2] == first[3]
    assert second[-1]["data"]["reason"] == "replayed_from_ledger"


async def test_ledger_cursor_resumes_after_that_event(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    events, ids = _parse_sse(
        await _stream(app, headers={"Last-Event-ID": format_ledger_cursor(run_id, 3)})
    )

    assert [event["type"] for event in events] == ["tool_call", "confirm_required", "done"]
    assert ids == [format_ledger_cursor(run_id, 4), format_ledger_cursor(run_id, 5)]


async def test_switch_off_keeps_the_not_running_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)
    monkeypatch.setenv("AGX_LEDGER_REATTACH", "0")

    events, ids = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]
    assert ids == []


async def test_closed_run_is_not_replayed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)
    recorder.finish("completed")

    events, _ids = _parse_sse(await _stream(app))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]


async def test_open_run_with_idle_session_is_not_replayed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)
    app.state.session_manager.set_execution_state(SID, "idle")

    events, _ids = _parse_sse(await _stream(app))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]


async def test_ledger_read_failure_answers_not_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("ledger unreadable")

    monkeypatch.setattr(server_module, "read_reattach_replay", _boom)
    events, _ids = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]


def test_summarized_event_whose_blob_is_missing_is_skipped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store, session_id=SID, agent_id="meta", provider="test", model="test-model"
    )
    recorder.start_turn(turn_id="turn-blob", user_input="go")
    big = {"command": "echo " + "y" * 5000}
    recorder.observe(
        RuntimeEvent("confirm_required", {"id": "req-big", "question": "?", "context": big}),
        session=StudioSession(),
        round_idx=1,
    )
    monkeypatch.setattr(ReplayLedgerStore, "read_blob", lambda self, run_id, ref: None)

    replay = read_reattach_replay(str(tmp_path), SID, "running")

    assert replay is not None
    assert replay["rows"] == []
