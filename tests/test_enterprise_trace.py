#!/usr/bin/env python3
"""Enterprise turn-trace upload from the replay ledger.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime import enterprise_trace
from agenticx.runtime.enterprise_trace import (
    build_spans,
    flush_outbox,
    trace_upload_enabled,
)
from agenticx.runtime.replay_ledger.contracts import ReplayRunRecord, RunEvent

_TRACE_RE = re.compile(r"^near:[A-Za-z0-9._:-]{1,120}$")
_FORBIDDEN_KEYS = {
    "content",
    "arguments",
    "result",
    "text",
    "text_preview",
    "preview",
    "summary",
    "task",
    "reasoning",
}
_SECRET_MARKERS = (
    "SECRET_ARG",
    "SECRET_RESULT",
    "SECRET_PREVIEW",
    "SECRET_TASK",
    "SECRET_SUMMARY",
)


def _isolate_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, enterprise: dict[str, Any]
) -> None:
    root = tmp_path / "cfg"
    root.mkdir(parents=True, exist_ok=True)
    global_path = root / "config.yaml"
    project_path = root / "project.yaml"
    global_path.write_text(yaml.safe_dump({"enterprise": enterprise}), encoding="utf-8")
    project_path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", global_path)
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", project_path)
    ConfigManager._invalidate_yaml_cache(None)


def _enable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, **overrides: Any) -> None:
    enterprise: dict[str, Any] = {
        "enabled": True,
        "token": "test-pat",
        "base_url": "http://127.0.0.1:9",
    }
    enterprise.update(overrides)
    _isolate_config(monkeypatch, tmp_path, enterprise)


def _run(**overrides: Any) -> ReplayRunRecord:
    fields: dict[str, Any] = {
        "run_id": "run1",
        "session_id": "sess1",
        "turn_id": "turn1",
        "agent_id": "meta",
        "status": "completed",
        "created_at": 1.0,
        "updated_at": 20.0,
        "completed_at": 20.0,
        "provider": "openai",
        "model": "gpt-test",
        "event_count": 0,
    }
    fields.update(overrides)
    return ReplayRunRecord(**fields)


def _event(seq: int, ts: float, event_type: str, **kwargs: Any) -> RunEvent:
    return RunEvent(
        event_id=f"e{seq}",
        run_id=kwargs.get("run_id", "run1"),
        session_id=kwargs.get("session_id", "sess1"),
        turn_id="turn1",
        seq=seq,
        ts=ts,
        type=event_type,
        agent_id=kwargs.get("agent_id", "meta"),
        payload=kwargs.get("payload") or {},
        tool_call_id=kwargs.get("tool_call_id"),
        payload_ref=kwargs.get("payload_ref"),
        title=kwargs.get("title") or "",
    )


def _keys(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from _keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from _keys(child)


def _sample_events() -> list[RunEvent]:
    return [
        _event(
            1,
            0.5,
            "user_message",
            payload={"text": "SECRET_USER", "content": "SECRET_USER"},
        ),
        _event(2, 1.0, "round_started", payload={"round": 1}),
        _event(
            3,
            2.0,
            "context_stats",
            payload={
                "prompt_tokens_approx": 99999,
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 4,
                    "reasoning_tokens": 1,
                    "total_tokens": 14,
                },
            },
        ),
        _event(
            4,
            3.0,
            "tool_call",
            tool_call_id="c1",
            payload={
                "name": "bash_exec",
                "arguments": {"cmd": "SECRET_ARG"},
                "arguments_summary": "SECRET_ARG",
            },
        ),
        _event(
            5,
            4.0,
            "tool_result",
            tool_call_id="c1",
            payload={
                "name": "bash_exec",
                "status": "completed",
                "preview": "SECRET_PREVIEW",
                "result": "SECRET_RESULT",
            },
        ),
        _event(6, 5.0, "round_started", payload={"round": 2}),
        _event(
            7,
            6.0,
            "context_stats",
            payload={
                "usage": {
                    "input_tokens": 1,
                    "output_tokens": 1,
                    "reasoning_tokens": 0,
                    "total_tokens": 2,
                }
            },
        ),
        _event(
            8,
            7.0,
            "tool_call",
            tool_call_id="c2",
            payload={"name": "file_read", "arguments": {"path": "SECRET_ARG"}},
        ),
        _event(
            9,
            8.0,
            "tool_result",
            tool_call_id="c2",
            payload={
                "name": "file_read",
                "status": "error",
                "preview": "SECRET_PREVIEW",
                "result": "SECRET_RESULT",
            },
        ),
        _event(
            10,
            9.0,
            "assistant_output_completed",
            payload={
                "text_preview": "SECRET_BODY",
                "terminal_reason": "model_final",
                "usage_metadata": {
                    "input_tokens": 20,
                    "output_tokens": 8,
                    "reasoning_tokens": 3,
                    "total_tokens": 28,
                },
            },
        ),
        _event(
            11,
            10.0,
            "subagent_started",
            payload={
                "name": "researcher",
                "agent_id": "sub-1",
                "task": "SECRET_TASK",
                "text": "SECRET_BODY",
            },
        ),
        _event(
            12,
            12.0,
            "subagent_completed",
            payload={
                "name": "researcher",
                "agent_id": "sub-1",
                "status": "completed",
                "summary": "SECRET_SUMMARY",
                "text": "SECRET_BODY",
                "result": "SECRET_RESULT",
            },
        ),
        _event(13, 13.0, "run_completed", payload={"status": "completed"}),
    ]


def test_build_spans_maps_rounds_tools_and_subagent() -> None:
    events = _sample_events()
    spans = build_spans(_run(event_count=len(events)), events)
    assert [span["step_kind"] for span in spans] == [
        "model",
        "tool",
        "model",
        "tool",
        "subagent",
        "run",
    ]
    assert [span["step_no"] for span in spans] == [1, 2, 3, 4, 5, 6]
    assert spans[1]["status"] == "ok"
    assert spans[0]["metadata"] == {"parent_step_no": 6}
    assert spans[1]["metadata"] == {"tool_name": "bash_exec", "parent_step_no": 1}
    assert spans[3]["status"] == "error"
    assert spans[3]["metadata"] == {"tool_name": "file_read", "parent_step_no": 3}
    assert "error_message" not in spans[3]
    assert spans[0]["input_tokens"] == 10
    assert spans[0]["output_tokens"] == 4
    assert spans[0]["reasoning_tokens"] == 1
    assert spans[0]["total_tokens"] == 14
    assert spans[0]["input_tokens"] != 99999
    assert spans[2]["input_tokens"] == 20
    assert spans[2]["output_tokens"] == 8
    assert spans[2]["reasoning_tokens"] == 3
    assert spans[2]["total_tokens"] == 28
    assert spans[2]["metadata"] == {"reply": "SECRET_BODY", "parent_step_no": 6}
    assert spans[0]["model"] == "gpt-test"
    assert spans[0]["provider"] == "openai"
    assert spans[0]["duration_ms"] == 1000
    assert spans[2]["duration_ms"] == 4000
    assert spans[1]["duration_ms"] == 1000
    assert spans[3]["duration_ms"] == 1000
    assert spans[4]["status"] == "ok"
    assert spans[4]["metadata"] == {"subagent_name": "researcher", "parent_step_no": 6}
    assert spans[4]["duration_ms"] == 2000
    assert spans[5]["status"] == "ok"
    assert spans[5]["metadata"] == {
        "agent_id": "meta",
        "event_count": len(events),
        "user_text": "SECRET_USER",
    }
    assert spans[5]["duration_ms"] == 19000
    assert all(span["trace_id"] == "near:sess1:run1" for span in spans)
    assert set(_keys(spans)).isdisjoint(_FORBIDDEN_KEYS)
    encoded = json.dumps(spans)
    for marker in _SECRET_MARKERS:
        assert marker not in encoded


def test_build_spans_truncates_trace_id() -> None:
    run = _run(session_id="s" * 200, run_id="r" * 80)
    spans = build_spans(run, [])
    trace_id = spans[0]["trace_id"]
    assert len(trace_id) <= 125
    assert _TRACE_RE.fullmatch(trace_id)
    assert trace_id.endswith("r" * 80)


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("completed", "ok"),
        ("failed", "error"),
        ("cancelled", "cancelled"),
        ("interrupted", "cancelled"),
    ],
)
def test_run_status_mapping(status: str, expected: str) -> None:
    spans = build_spans(_run(status=status), [])
    assert [span["step_kind"] for span in spans] == ["run"]
    assert spans[0]["status"] == expected


def test_error_message_is_clipped() -> None:
    text = "disk full " * 80
    spans = build_spans(
        _run(status="failed", event_count=1),
        [_event(1, 2.0, "error", payload={"text": text, "detail": "ignored"})],
    )
    run_span = spans[-1]
    assert run_span["status"] == "error"
    assert len(run_span["error_message"]) == 500
    assert run_span["error_message"].startswith("disk full")
    model_span = next(span for span in spans if span["step_kind"] == "model")
    assert model_span["status"] == "error"
    assert len(model_span["error_message"]) == 500


@pytest.mark.parametrize(
    ("enterprise", "expected"),
    [
        (
            {"enabled": True, "token": "test-pat", "base_url": "http://127.0.0.1:9"},
            True,
        ),
        (
            {"enabled": False, "token": "test-pat", "base_url": "http://127.0.0.1:9"},
            False,
        ),
        ({"enabled": True, "token": "  ", "base_url": "http://127.0.0.1:9"}, False),
        ({"enabled": True, "token": "test-pat", "base_url": ""}, False),
        (
            {
                "enabled": True,
                "token": "test-pat",
                "base_url": "http://127.0.0.1:9",
                "trace_upload": False,
            },
            False,
        ),
    ],
)
def test_trace_upload_enabled_switches(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    enterprise: dict[str, Any],
    expected: bool,
) -> None:
    _isolate_config(monkeypatch, tmp_path, enterprise)
    assert trace_upload_enabled() is expected


def _seed_outbox(spans: list[dict[str, Any]]) -> None:
    enterprise_trace._append_outbox(spans)


def _outbox_spans() -> list[dict[str, Any]]:
    path = enterprise_trace.outbox_path()
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


@pytest.mark.parametrize(
    ("status_code", "remains", "uploaded"),
    [
        (200, False, 2),
        (500, True, 0),
        (400, False, 0),
        (401, True, 0),
    ],
)
def test_flush_outbox_status_policy(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    status_code: int,
    remains: bool,
    uploaded: int,
) -> None:
    _enable(monkeypatch, tmp_path)
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/desktop/agent-traces"
        assert request.headers["authorization"] == "Bearer test-pat"
        return httpx.Response(status_code, json={"ok": True})

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def factory(*args: Any, **kwargs: Any) -> httpx.Client:
        seen.append(dict(kwargs))
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(enterprise_trace.httpx, "Client", factory)
    spans = [
        {"trace_id": "near:sess:a", "step_no": 1, "step_kind": "run"},
        {"trace_id": "near:sess:a", "step_no": 2, "step_kind": "model"},
    ]
    _seed_outbox(spans)
    assert flush_outbox() == uploaded
    left = _outbox_spans()
    if remains:
        assert len(left) == 2
    else:
        assert left == []
    assert seen
    assert seen[0]["trust_env"] is False


def test_outbox_drops_oldest_lines(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    first = [{"n": index, "trace_id": f"near:s:{index}"} for index in range(2001)]
    _seed_outbox(first)
    _seed_outbox([{"n": 2001, "trace_id": "near:s:2001"}])
    lines = enterprise_trace.outbox_path().read_text(encoding="utf-8").splitlines()
    assert len(lines) == enterprise_trace.MAX_OUTBOX_LINES
    assert json.loads(lines[0])["n"] == 2
    assert json.loads(lines[-1])["n"] == 2001


def test_enqueue_copies_blob_usage_without_message_text(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _enable(monkeypatch, tmp_path)
    monkeypatch.setattr(enterprise_trace, "_start_flush_thread", lambda: None)
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    store = ReplayLedgerStore(tmp_path / "sessions")
    run = _run()
    store.open_run(run)
    blob_ref = store.write_blob(
        run.run_id,
        {
            "text": "SECRET_BODY",
            "reasoning": "visible thought",
            "usage_metadata": {
                "input_tokens": 7,
                "output_tokens": 3,
                "reasoning_tokens": 1,
                "total_tokens": 10,
            },
        },
    )
    store.append_event(
        run.run_id,
        _event(
            0,
            2.0,
            "assistant_output_completed",
            payload={"text_preview": "visible reply", "terminal_reason": "model_final"},
            payload_ref=blob_ref,
        ),
    )
    store.close_run(run.run_id, "completed", 3.0)
    enterprise_trace.enqueue_completed_run(store, run.run_id)
    spans = _outbox_spans()
    encoded = json.dumps(spans)
    assert "SECRET_BODY" not in encoded
    model = next(span for span in spans if span["step_kind"] == "model")
    assert model["metadata"]["reply"] == "visible reply"
    assert model["metadata"]["thought"] == "visible thought"
    assert model["input_tokens"] == 7
    assert model["output_tokens"] == 3
    assert model["reasoning_tokens"] == 1
    assert model["total_tokens"] == 10


def test_finish_enqueues_after_close_and_survives_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    seen: list[str] = []

    def _capture(store: Any, run_id: str) -> None:
        record = store.get_run(run_id)
        seen.append(record.status if record is not None else "")

    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.recorder.enqueue_completed_run",
        _capture,
    )
    store = ReplayLedgerStore(tmp_path / "sessions")
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="sess",
        agent_id="meta",
        provider="openai",
        model="m",
    )
    recorder.start_turn(turn_id="turn", user_input="hi")
    recorder.finish("completed")
    assert seen == ["completed"]
    assert recorder._finished is True

    def _boom(_store: Any, _run_id: str) -> None:
        raise RuntimeError("upload failed")

    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.recorder.enqueue_completed_run",
        _boom,
    )
    other = ReplayLedgerRecorder(
        store=ReplayLedgerStore(tmp_path / "sessions-2"),
        session_id="sess",
        agent_id="meta",
        provider=None,
        model=None,
    )
    other.start_turn(turn_id="turn2", user_input="hi")
    other.finish("failed")
    assert other._finished is True
