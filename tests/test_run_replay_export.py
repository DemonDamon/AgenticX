#!/usr/bin/env python3
"""Tests for deterministic replay exports.

Author: Damon Li
"""

from __future__ import annotations

import json

import pytest

from agenticx.runtime.replay_ledger import ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.export import export_run_json, export_run_markdown


def _record(*, partial: bool = False) -> ReplayRunRecord:
    return ReplayRunRecord(
        run_id="run-export",
        session_id="session-export",
        turn_id="turn-export",
        agent_id="meta",
        status="completed",
        created_at=100.0,
        updated_at=110.0,
        completed_at=110.0,
        completeness="partial" if partial else "complete",
        gap_reason="corrupt_event_line" if partial else None,
    )


def _event(
    seq: int,
    event_type: str,
    payload: dict | None = None,
    *,
    tool_call_id: str | None = None,
    ts: float | None = None,
) -> RunEvent:
    return RunEvent(
        event_id=f"event-{seq}",
        run_id="run-export",
        session_id="session-export",
        turn_id="turn-export",
        seq=seq,
        ts=100.0 + seq if ts is None else ts,
        type=event_type,
        agent_id="meta",
        tool_call_id=tool_call_id,
        payload=payload or {},
    )


def test_same_input_exports_byte_identically() -> None:
    events = [_event(1, "user_message", {"text": "hello"})]
    first = export_run_markdown(_record(), events, resolve_payload=lambda _: None)
    second = export_run_markdown(_record(), events, resolve_payload=lambda _: None)
    assert first.encode() == second.encode()


def test_markdown_keeps_one_hundred_tool_events_ordered() -> None:
    events = [
        _event(
            index,
            "tool_call",
            {"name": "file_read", "arguments": {"path": f"{index}.txt"}},
        )
        for index in range(1, 101)
    ]
    markdown = export_run_markdown(_record(), events, resolve_payload=lambda _: None)
    positions = [markdown.index(f"{index}.txt") for index in range(1, 101)]
    assert positions == sorted(positions)


def test_default_export_redacts_secret_fields_and_bearer_tokens() -> None:
    events = [
        _event(
            1,
            "user_message",
            {"api_key": "secret-value", "text": "Authorization: Bearer abc.def.ghi"},
        )
    ]
    markdown = export_run_markdown(_record(), events, resolve_payload=lambda _: None)
    assert "secret-value" not in markdown
    assert "abc.def.ghi" not in markdown
    assert "[REDACTED]" in markdown


def test_unredacted_json_preserves_local_value() -> None:
    events = [_event(1, "user_message", {"token": "local-secret"})]
    payload = json.loads(
        export_run_json(_record(), events, resolve_payload=lambda _: None, redact=False)
    )
    assert payload["events"][0]["payload"]["token"] == "local-secret"


def test_partial_run_explicitly_reports_gap() -> None:
    markdown = export_run_markdown(
        _record(partial=True), [], resolve_payload=lambda _: None
    )
    assert "记录不完整" in markdown
    assert "corrupt_event_line" in markdown


def test_markdown_pairs_tools_by_call_id_and_reports_duration() -> None:
    events = [
        _event(
            1,
            "tool_call",
            {"name": "file_read"},
            tool_call_id="call-paired",
            ts=101.25,
        ),
        _event(
            2,
            "tool_call",
            {"name": "file_write"},
            tool_call_id="call-unpaired",
            ts=102.0,
        ),
        _event(
            3,
            "tool_result",
            {"name": "file_read", "status": "completed"},
            tool_call_id="call-paired",
            ts=103.75,
        ),
    ]

    markdown = export_run_markdown(_record(), events, resolve_payload=lambda _: None)

    assert "`call-paired` | Duration: 2.500s" in markdown
    assert "`call-unpaired` | Duration: unknown" in markdown
    assert markdown.index("`call-paired`") < markdown.index("`call-unpaired`")


def test_markdown_tool_section_has_fixed_summary_status_and_redaction() -> None:
    call = _event(
        1,
        "tool_call",
        {
            "name": "file_read",
            "arguments_summary": '{"path":"notes.txt","api_key":"hidden"}',
        },
        tool_call_id="call-fixed",
        ts=101.0,
    )
    call.payload_ref = "call-payload"
    result = _event(
        2,
        "tool_result",
        {"name": "file_read", "status": "error"},
        tool_call_id="call-fixed",
        ts=102.25,
    )
    result.payload_ref = "result-payload"
    payloads = {
        "call-payload": {
            "name": "file_read",
            "arguments": {"path": "notes.txt", "api_key": "full-secret"},
        },
        "result-payload": {"name": "file_read", "result": "ERROR: denied"},
    }

    markdown = export_run_markdown(
        _record(),
        [call, result],
        resolve_payload=payloads.get,
    )

    assert "Tool: `file_read`" in markdown
    assert 'Arguments: `{"api_key":"[REDACTED]","path":"notes.txt"}`' in markdown
    assert "Status: `error`" in markdown
    assert "Duration: 1.250s" in markdown
    assert "full-secret" not in markdown


def test_markdown_redacts_unparseable_plaintext_arguments_summary() -> None:
    call = _event(
        1,
        "tool_call",
        {
            "name": "web_fetch",
            "arguments_summary": (
                '{"url":"https://example.com","api_key":"plaintext-secret '
                "Authorization=Bearer bearer-secret"
            ),
        },
        tool_call_id="call-redact",
    )

    markdown = export_run_markdown(_record(), [call], resolve_payload=lambda _: None)

    assert "plaintext-secret" not in markdown
    assert "bearer-secret" not in markdown
    assert "api_key" in markdown
    assert "[REDACTED]" in markdown


@pytest.mark.parametrize(
    ("summary", "forbidden", "preserved"),
    [
        ('password:"my secret value', "secret value", None),
        ('password:"my secret value",region=cn', "secret value", "region=cn"),
        ("api_key=alpha beta,next=value", "alpha beta", "next=value"),
        ("password=my secret value\nregion=cn", "secret value", "region=cn"),
        ('password:"my secret value\nregion=cn', "secret value", "region=cn"),
    ],
)
def test_markdown_redacts_secret_text_until_field_boundary(
    summary: str,
    forbidden: str,
    preserved: str | None,
) -> None:
    call = _event(
        1,
        "tool_call",
        {"name": "web_fetch", "arguments_summary": summary},
        tool_call_id="call-secret-text",
    )

    markdown = export_run_markdown(_record(), [call], resolve_payload=lambda _: None)

    assert forbidden not in markdown
    if preserved is not None:
        assert preserved in markdown


def test_markdown_tool_section_preserves_cancelled_status() -> None:
    call = _event(
        1,
        "tool_call",
        {"name": "file_write", "arguments_summary": "{}"},
        tool_call_id="call-cancelled",
        ts=101.0,
    )
    result = _event(
        2,
        "tool_result",
        {"name": "file_write", "status": "cancelled"},
        tool_call_id="call-cancelled",
        ts=102.0,
    )

    markdown = export_run_markdown(
        _record(),
        [call, result],
        resolve_payload=lambda _: None,
    )

    assert "Status: `cancelled`" in markdown
