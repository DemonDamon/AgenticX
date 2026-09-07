"""Smoke tests for TelemetryQuery FirstParty and Composite providers.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

FAILED_SESSION = [
    {"role": "user", "content": "deploy please", "timestamp": "2026-09-06T12:00:00+00:00"},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "c1",
                "type": "function",
                "function": {"name": "bash_exec", "arguments": '{"command":"false"}'},
            }
        ],
        "timestamp": "2026-09-06T12:00:01+00:00",
    },
    {
        "role": "tool",
        "tool_call_id": "c1",
        "name": "bash_exec",
        "content": "ERROR: exit 1",
        "timestamp": "2026-09-06T12:00:02+00:00",
    },
    {"role": "assistant", "content": "command failed", "timestamp": "2026-09-06T12:00:03+00:00"},
]


# Near Desktop persists tool rows without assistant.tool_calls.
STUDIO_SHAPED_SESSION = [
    {
        "role": "user",
        "content": "run false",
        "timestamp": 1788743730436,
    },
    {
        "role": "tool",
        "content": "ERROR: exit 1",
        "tool_call_id": "call_bash_1",
        "tool_name": "bash_exec",
        "tool_args": {"command": "false"},
        "tool_status": "done",
        "timestamp": 1788745160850,
    },
    {
        "role": "assistant",
        "content": "command failed",
        "timestamp": 1788745164000,
    },
]


OBS_ONLY_MESSAGES = [
    {"role": "user", "content": "read the doc", "timestamp": "2026-08-31T01:36:00+00:00"},
    {"role": "assistant", "content": "ok I will try", "timestamp": "2026-08-31T01:36:48+00:00"},
    {"role": "user", "content": "try again", "timestamp": "2026-08-31T02:44:00+00:00"},
    {"role": "assistant", "content": "done", "timestamp": "2026-08-31T02:45:16+00:00"},
]

OBS_FAILURES = [
    {
        "timestamp": "2026-08-31T01:37:38+00:00",
        "tool_name": "file_read",
        "result_summary": "ERROR: path escapes workspace: /other/taskspace/doc.md",
        "success": False,
        "turn_index": 1,
    },
    {
        "timestamp": "2026-08-31T01:37:40+00:00",
        "tool_name": "bash_exec",
        "result_summary": "ERROR: path escapes workspace: /other/taskspace",
        "success": False,
        "turn_index": 2,
    },
]


def _write_failed_session(root: Path) -> Path:
    session_dir = root / "sessions" / "sess-fail"
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps(FAILED_SESSION), encoding="utf-8"
    )
    return session_dir


def _write_obs_only_session(root: Path, session_id: str = "sess-obs") -> Path:
    session_dir = root / "sessions" / session_id
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps(OBS_ONLY_MESSAGES), encoding="utf-8"
    )
    (session_dir / "tool_call_observations.json").write_text(
        json.dumps(OBS_FAILURES), encoding="utf-8"
    )
    return session_dir


def test_first_party_trace_and_logs_from_failed_session(tmp_path):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _write_failed_session(tmp_path)
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    scope = QueryScope(session_id="sess-fail")
    traces = provider.get_trace(scope)
    assert traces.reason == ""
    assert any(s.name == "bash_exec" or "bash_exec" in s.name for s in traces.items)
    assert any(s.status == "error" for s in traces.items)
    logs = provider.get_logs(scope)
    assert any("ERROR: exit 1" in r.message for r in logs.items)
    changes = provider.get_recent_changes(scope)
    assert changes.items == []
    assert changes.reason == "no_change_events"


def test_first_party_trace_from_studio_tool_rows(tmp_path):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    session_dir = tmp_path / "sessions" / "sess-studio"
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps(STUDIO_SHAPED_SESSION), encoding="utf-8"
    )
    traces = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="sess-studio")
    )
    assert any(s.name == "bash_exec" for s in traces.items)
    assert any(s.status == "error" for s in traces.items)
    bash = next(s for s in traces.items if s.name == "bash_exec")
    assert bash.start_ts is not None


def test_empty_scope_is_invalid():
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    provider = FirstPartyProvider(sessions_root=Path("/tmp/unused-sessions"))
    r = provider.get_trace(QueryScope())
    assert r.items == []
    assert r.reason == "invalid_scope"


def test_missing_session_is_empty_not_raise(tmp_path):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    r = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="nope")
    )
    assert r.items == []
    assert r.reason == "no_messages"


def test_record_then_get_recent_changes(tmp_path):
    from agenticx.ops.change_log import record_change_event
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import ChangeEvent, QueryScope

    session_dir = _write_failed_session(tmp_path)
    record_change_event(
        session_dir,
        ChangeEvent(
            ts=datetime(2026, 9, 6, 12, 5, tzinfo=timezone.utc),
            deployment_id="dep-1",
            action="restart",
            summary="restarted worker",
            source="first_party",
        ),
    )
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    changes = provider.get_recent_changes(QueryScope(session_id="sess-fail"))
    assert any(ev.action == "restart" for ev in changes.items)


def test_signoz_provider_maps_spans(monkeypatch):
    from agenticx.ops.query import QueryScope
    from agenticx.ops.signoz import SigNozProvider

    w3c = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    payload = json.dumps(
        {
            "spans": [
                {"name": "chat gpt-4", "spanId": "aaa", "traceId": w3c}
            ]
        }
    ).encode("utf-8")

    class _Resp:
        status = 200

        def read(self):
            return payload

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    with patch("agenticx.ops.signoz.urlopen", return_value=_Resp()):
        provider = SigNozProvider(api_url="http://127.0.0.1:8080")
        result = provider.get_trace(QueryScope(trace_id=w3c))
    assert result.items
    assert result.items[0].source == "signoz"
    assert result.items[0].name == "chat gpt-4"


def test_composite_falls_back_to_first_party(tmp_path):
    from agenticx.ops.factory import CompositeTelemetryQuery
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryResult, QueryScope

    _write_failed_session(tmp_path)
    first_party = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    signoz = MagicMock()
    signoz.get_trace.return_value = QueryResult(items=[], source="signoz", reason="signoz_http_404")
    signoz.get_logs.return_value = QueryResult(items=[], source="signoz", reason="signoz_logs_unsupported")
    composite = CompositeTelemetryQuery(first_party=first_party, signoz=signoz)
    traces = composite.get_trace(QueryScope(session_id="sess-fail"))
    assert traces.items
    assert traces.reason == "signoz_empty_used_first_party"


def test_factory_auto_without_signoz_url(tmp_path, monkeypatch):
    from agenticx.ops.factory import get_telemetry_query
    from agenticx.ops.first_party import FirstPartyProvider

    monkeypatch.delenv("SIGNOZ_API_URL", raising=False)
    monkeypatch.setenv("AGENTICX_TELEMETRY_BACKEND", "auto")
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))
    q = get_telemetry_query()
    assert isinstance(q, FirstPartyProvider)


def test_first_party_merges_observations_when_messages_have_no_tools(tmp_path):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _write_obs_only_session(tmp_path)
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    scope = QueryScope(session_id="sess-obs")
    traces = provider.get_trace(scope)
    by_name = {s.name: s for s in traces.items if s.name in {"file_read", "bash_exec"}}
    assert set(by_name) == {"file_read", "bash_exec"}
    assert by_name["file_read"].status == "error"
    assert by_name["bash_exec"].status == "error"
    assert any(s.attributes.get("agenticx.evidence.source") == "observations" for s in traces.items)
    assert all(s.trace_id == "session:sess-obs" for s in traces.items)

    logs = provider.get_logs(scope)
    assert logs.reason == ""
    assert logs.items
    blob = " ".join(r.message for r in logs.items)
    assert "path escapes workspace" in blob


def test_first_party_dedupes_observation_span_matching_message_tool(tmp_path):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    session_dir = tmp_path / "sessions" / "sess-dedup"
    session_dir.mkdir(parents=True)
    messages = [
        {"role": "user", "content": "run", "timestamp": "2026-08-31T01:37:39+00:00"},
        {
            "role": "tool",
            "tool_name": "bash_exec",
            "content": "ERROR: path escapes workspace: /other/taskspace",
            "tool_status": "error",
            "timestamp": "2026-08-31T01:37:40+00:00",
        },
        {"role": "assistant", "content": "blocked", "timestamp": "2026-08-31T01:37:41+00:00"},
    ]
    (session_dir / "messages.json").write_text(json.dumps(messages), encoding="utf-8")
    (session_dir / "tool_call_observations.json").write_text(
        json.dumps(
            [
                {
                    "timestamp": "2026-08-31T01:37:40+00:00",
                    "tool_name": "bash_exec",
                    "result_summary": "ERROR: path escapes workspace: /other/taskspace",
                    "success": False,
                    "turn_index": 1,
                }
            ]
        ),
        encoding="utf-8",
    )
    traces = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_trace(
        QueryScope(session_id="sess-dedup")
    )
    bash = [s for s in traces.items if s.name == "bash_exec"]
    assert len(bash) == 1
