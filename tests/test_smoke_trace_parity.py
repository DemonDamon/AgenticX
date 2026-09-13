"""Smoke tests for session trace parity (S5).

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from tests.test_smoke_telemetry_query import _write_failed_session, _write_obs_only_session

_DELEGATE_MESSAGES = [
    {"role": "user", "content": "handoff", "timestamp": "2026-09-07T03:00:00+00:00"},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "call-dlg",
                "type": "function",
                "function": {"name": "delegate_to_avatar", "arguments": "{}"},
            }
        ],
        "timestamp": "2026-09-07T03:00:01+00:00",
        "usage": {"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
    },
    {
        "role": "tool",
        "tool_call_id": "call-dlg",
        "name": "delegate_to_avatar",
        "content": "started",
        "timestamp": "2026-09-07T03:00:02+00:00",
    },
]

_DLG_RECORD = {
    "run_id": "dlg-1",
    "kind": "delegate",
    "owner_session_id": "sess-dlg",
    "cluster_id": "c1",
    "badge_seq": "A",
    "name": "researcher",
    "role": "worker",
    "task": "SECRET_TASK_TEXT",
    "status": "completed",
    "created_at": 1757214000,
    "updated_at": 1757214002,
    "started_at": 1757214000,
    "completed_at": 1757214002,
    "source_tool_call_id": "call-dlg",
    "avatar_session_id": "ava-sess-1",
    "status_history": [],
    "output_files": [],
    "artifacts": [],
    "detail_refs": {},
    "activity_count": 0,
    "schema_version": 1,
}

_CONFIRM_STATE = {
    "checkpoint": {
        "session_id": "sess-confirm",
        "turn_id": "t1",
        "round_idx": 1,
        "status": "awaiting_confirm",
        "pending_tool_calls": [],
        "confirm_state": {
            "pending": [
                {
                    "request_id": "cnf-1",
                    "question": "delete the workspace",
                    "context": {},
                }
            ],
            "last_request": "cnf-1",
        },
        "created_at": 1,
        "updated_at": 1,
    }
}


def _write_runs(session_dir: Path, record: dict) -> None:
    root = session_dir / "subagent_runs"
    root.mkdir(parents=True, exist_ok=True)
    run_id = str(record.get("run_id") or "dlg-1")
    (root / "index.json").write_text(
        json.dumps({"runs": {run_id: {}}, "clusters": {}}),
        encoding="utf-8",
    )
    (root / f"{run_id}.json").write_text(json.dumps(record), encoding="utf-8")


def _write_delegate_session(root: Path) -> Path:
    session_dir = root / "sessions" / "sess-dlg"
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps(_DELEGATE_MESSAGES), encoding="utf-8"
    )
    record = dict(_DLG_RECORD)
    record["owner_session_id"] = "sess-dlg"
    _write_runs(session_dir, record)
    return session_dir


def _write_confirm_session(root: Path) -> Path:
    session_dir = root / "sessions" / "sess-confirm"
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps(
            [{"role": "user", "content": "please", "timestamp": "2026-09-07T04:00:00+00:00"}]
        ),
        encoding="utf-8",
    )
    (session_dir / "agent_state.json").write_text(
        json.dumps(_CONFIRM_STATE), encoding="utf-8"
    )
    return session_dir


def _isolate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))
    monkeypatch.setenv("AGENTICX_UMODEL_PATH", str(tmp_path / "umodel.json"))
    monkeypatch.delenv("AGENTICX_GATEWAY_USAGE_JSONL", raising=False)


def test_load_run_records_from_session_dir(tmp_path):
    from agenticx.ops.parity import load_run_records

    session_dir = _write_delegate_session(tmp_path)
    records = load_run_records(session_dir)
    assert len(records) == 1
    assert records[0].run_id == "dlg-1"
    assert records[0].kind == "delegate"
    assert records[0].source_tool_call_id == "call-dlg"


def test_load_run_records_missing_dir(tmp_path):
    from agenticx.ops.parity import load_run_records

    session_dir = _write_failed_session(tmp_path)
    assert load_run_records(session_dir) == []


def test_load_confirm_pendings_from_agent_state(tmp_path):
    from agenticx.ops.parity import load_confirm_pendings

    session_dir = _write_confirm_session(tmp_path)
    pending = load_confirm_pendings(session_dir)
    assert any(row.get("request_id") == "cnf-1" for row in pending)
    assert all("question" not in row for row in pending)


def test_run_kind_for_tool_name():
    from agenticx.ops.parity import run_kind_for_tool_name

    assert run_kind_for_tool_name("delegate_to_avatar") == "delegate"
    assert run_kind_for_tool_name("spawn_subagent") == "spawn"
    assert run_kind_for_tool_name("bash_exec") == ""


def test_get_trace_enriches_matching_tool_span(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    _write_delegate_session(tmp_path)
    result = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="sess-dlg")
    )
    hit = next(span for span in result.items if span.span_id == "call-dlg")
    assert hit.attributes["agenticx.run.id"] == "dlg-1"
    assert hit.attributes["agenticx.run.kind"] == "delegate"


def test_get_trace_appends_run_when_tool_row_missing(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    session_dir = _write_obs_only_session(tmp_path)
    record = dict(_DLG_RECORD)
    record["owner_session_id"] = "sess-obs"
    _write_runs(session_dir, record)
    result = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="sess-obs")
    )
    hit = next(span for span in result.items if span.span_id == "dlg-1")
    assert hit.name == "delegate"
    assert hit.attributes["agenticx.evidence.source"] == "subagent_runs"


def test_get_trace_appends_confirm_wait(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    _write_confirm_session(tmp_path)
    result = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="sess-confirm")
    )
    assert any(span.name == "confirm.wait" and span.span_id == "cnf-1" for span in result.items)
    blob = json.dumps([span.attributes for span in result.items], default=str)
    assert "delete the workspace" not in blob


def test_get_trace_failed_session_unchanged_names(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    _write_failed_session(tmp_path)
    result = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="sess-fail")
    )
    names = {span.name for span in result.items}
    assert "bash_exec" in names
    assert "delegate" not in names
    assert "confirm.wait" not in names


def test_parity_delegate_ok_when_tool_and_run(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.parity import PRESENT, build_parity
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    session_dir = _write_delegate_session(tmp_path)
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    traces = provider.get_trace(QueryScope(session_id="sess-dlg", limit=200))
    rows = build_parity(
        session_dir,
        traces.items,
        provider._load_messages("sess-dlg") or [],
        session_id="sess-dlg",
    )
    hit = next(row for row in rows if row.kind == "delegate")
    assert hit.runtime == PRESENT
    assert hit.span == PRESENT
    assert hit.status == "ok"


def test_parity_run_without_span_is_missing(tmp_path):
    from agenticx.ops.parity import MISSING, build_parity

    session_dir = _write_delegate_session(tmp_path)
    rows = build_parity(session_dir, [], [], session_id="sess-dlg")
    hit = next(row for row in rows if row.kind == "delegate")
    assert hit.span == MISSING
    assert hit.status == "missing"


def test_parity_failed_session_has_tool_no_invented_run(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.parity import build_parity
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    session_dir = _write_failed_session(tmp_path)
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    traces = provider.get_trace(QueryScope(session_id="sess-fail", limit=200))
    rows = build_parity(
        session_dir,
        traces.items,
        provider._load_messages("sess-fail") or [],
        session_id="sess-fail",
    )
    assert any(row.kind == "tool_call" and "bash_exec" in row.name for row in rows)
    assert not any(row.kind in {"delegate", "spawn", "confirm"} for row in rows)


def test_parity_model_usage_from_assistant(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.parity import MISSING, PRESENT, build_parity
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    dlg_dir = _write_delegate_session(tmp_path)
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    dlg_rows = build_parity(
        dlg_dir,
        provider.get_trace(QueryScope(session_id="sess-dlg", limit=200)).items,
        provider._load_messages("sess-dlg") or [],
        session_id="sess-dlg",
    )
    assert next(row for row in dlg_rows if row.kind == "model").usage == PRESENT

    fail_dir = _write_failed_session(tmp_path)
    fail_rows = build_parity(
        fail_dir,
        provider.get_trace(QueryScope(session_id="sess-fail", limit=200)).items,
        provider._load_messages("sess-fail") or [],
        session_id="sess-fail",
    )
    model = next(row for row in fail_rows if row.kind == "model")
    assert model.usage == MISSING
    assert model.usage != PRESENT


def test_parity_gateway_jsonl_optional(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.parity import MISSING, PRESENT, build_parity
    from agenticx.ops.query import QueryScope

    _isolate(tmp_path, monkeypatch)
    session_dir = _write_failed_session(tmp_path)
    usage_path = tmp_path / "usage.jsonl"
    usage_path.write_text(
        json.dumps({"session_id": "sess-fail", "input_tokens": 3}) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("AGENTICX_GATEWAY_USAGE_JSONL", str(usage_path))
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    traces = provider.get_trace(QueryScope(session_id="sess-fail", limit=200))
    messages = provider._load_messages("sess-fail") or []
    rows = build_parity(session_dir, traces.items, messages, session_id="sess-fail")
    assert next(row for row in rows if row.kind == "model").usage == PRESENT
    monkeypatch.delenv("AGENTICX_GATEWAY_USAGE_JSONL", raising=False)
    rows_off = build_parity(session_dir, traces.items, messages, session_id="sess-fail")
    assert next(row for row in rows_off if row.kind == "model").usage == MISSING


def test_dispatch_get_trace_parity_not_configured_scope():
    from agenticx.ops.tools import dispatch_ops_tool

    body = json.loads(dispatch_ops_tool("get_trace_parity", {}, session=None))
    assert body["reason"] == "invalid_scope"
    assert body["items"] == []


def test_dispatch_get_trace_parity_omits_task_text(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _isolate(tmp_path, monkeypatch)
    _write_delegate_session(tmp_path)
    raw = dispatch_ops_tool("get_trace_parity", {"session_id": "sess-dlg"}, session=None)
    assert "SECRET_TASK_TEXT" not in raw
    body = json.loads(raw)
    assert body["reason"] == ""
    dumped = json.dumps(body)
    assert "question" not in dumped
    assert "task" not in dumped


def test_ingest_copies_run_attrs(tmp_path, monkeypatch):
    from agenticx.ops.umodel.ingest import ingest_session
    from agenticx.ops.umodel.store import FileObjectStore

    _isolate(tmp_path, monkeypatch)
    _write_delegate_session(tmp_path)
    store = FileObjectStore(tmp_path / "umodel.json")
    ingest_session("sess-dlg", store=store, sessions_root=tmp_path / "sessions")
    obj = store.get("tool_call", "call-dlg")
    assert obj is not None
    assert obj.attrs["agenticx.run.id"] == "dlg-1"


def test_get_trace_parity_description():
    from agenticx.ops.tools import OPS_TOOLS

    spec = next(t for t in OPS_TOOLS if t["function"]["name"] == "get_trace_parity")
    desc = spec["function"]["description"]
    assert "Read-only." in desc
    assert "Never invent" in desc
    assert "Missing is not a root cause" in desc
    assert "Not the health score" in desc
