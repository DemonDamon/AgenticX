"""Tests for inline payload summaries of large replay ledger events.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.contracts import (
    MAX_INLINE_PAYLOAD_BYTES,
    PAYLOAD_SUMMARY_HEAD_BYTES,
    canonical_json_bytes,
    is_payload_summary,
)
from agenticx.runtime.replay_ledger.export import export_run_markdown
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder


def _recorder(tmp_path: Path) -> tuple[ReplayLedgerStore, ReplayLedgerRecorder]:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-payload",
        agent_id="meta",
        provider="test",
        model="test-model",
    )
    return store, recorder


def _events_jsonl(tmp_path: Path) -> Path:
    return next(tmp_path.rglob("events.jsonl"))


def test_oversized_mapped_event_keeps_only_summary_inline(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-payload", user_input="go")
    text = "x" * (MAX_INLINE_PAYLOAD_BYTES + 1)
    recorder.observe(RuntimeEvent("error", {"text": text}), session=StudioSession())

    events, _has_more = store.read_events(run_id)
    event = next(item for item in events if item.type == "error")

    assert is_payload_summary(event.payload) is True
    assert set(event.payload) == {"truncated", "head", "length", "digest"}
    assert event.payload["length"] == MAX_INLINE_PAYLOAD_BYTES + 1 + len('{"text":""}')
    assert event.payload["head"] == '{"text":"' + "x" * (
        PAYLOAD_SUMMARY_HEAD_BYTES - len('{"text":"')
    )
    assert event.payload_ref == event.payload["digest"]
    assert store.resolve_payload(event) == {"text": text}
    line = _events_jsonl(tmp_path).read_text(encoding="utf-8").splitlines()[-1]
    assert len(line.encode("utf-8")) < MAX_INLINE_PAYLOAD_BYTES


def test_small_payload_stays_inline_without_blob(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-small", user_input="go")
    recorder.observe(RuntimeEvent("error", {"text": "boom"}), session=StudioSession())

    events, _has_more = store.read_events(run_id)
    event = next(item for item in events if item.type == "error")

    assert event.payload == {"text": "boom"}
    assert event.payload_ref is None
    assert store.resolve_payload(event) == {"text": "boom"}


def test_large_user_message_moves_full_text_to_blob(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    long_input = "需求说明。" * 2000
    run_id = recorder.start_turn(turn_id="turn-user", user_input=long_input)

    events, _has_more = store.read_events(run_id)
    event = next(item for item in events if item.type == "user_message")

    assert is_payload_summary(event.payload) is True
    resolved = store.resolve_payload(event)
    assert resolved["text"] == long_input
    assert event.payload["length"] == len(canonical_json_bytes(resolved))


def test_capped_structured_payloads_are_never_summarized(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-structured", user_input="go")
    preview = "结" * 500
    recorder.observe(
        RuntimeEvent(
            "tool_call",
            {"name": "file_read", "arguments": {"path": "a"}, "tool_call_id": "c1"},
        ),
        session=StudioSession(),
    )
    recorder.observe(
        RuntimeEvent("tool_result", {"name": "file_read", "result": preview, "tool_call_id": "c1"}),
        session=StudioSession(),
    )

    events, _has_more = store.read_events(run_id)
    call = next(item for item in events if item.type == "tool_call")
    result = next(item for item in events if item.type == "tool_result")

    assert call.payload["name"] == "file_read"
    assert call.payload["source_tool_call_id"] == "c1"
    assert result.payload["name"] == "file_read"
    assert "preview" in result.payload and "status" in result.payload
    assert is_payload_summary(call.payload) is False
    assert is_payload_summary(result.payload) is False


def test_markdown_export_reads_large_user_message_from_blob(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    long_input = "需求说明。" * 2000
    run_id = recorder.start_turn(turn_id="turn-export", user_input=long_input)
    recorder.finish("completed")
    events, _has_more = store.read_events(run_id, limit=10)

    markdown = export_run_markdown(
        store.get_run(run_id),
        events,
        resolve_payload=lambda blob_ref: store.read_blob(run_id, blob_ref),
    )

    # The row only holds a summary envelope; the exporter must render the
    # text stored in the blob, never the envelope itself.
    assert "需求说明。" * 100 in markdown
    assert "truncated" not in markdown
