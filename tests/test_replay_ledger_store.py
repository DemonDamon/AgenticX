#!/usr/bin/env python3
"""Tests for the durable replay event ledger.

Author: Damon Li
"""

from __future__ import annotations

import gzip
import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import agenticx.runtime.replay_ledger.store as replay_store_module
from agenticx.runtime.replay_ledger import ReplayLedgerStore, ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.contracts import validate_ledger_id
from agenticx.runtime.replay_ledger.effects import classify_tool_effect


def _record(session_id: str = "session-a", run_id: str = "run-a") -> ReplayRunRecord:
    return ReplayRunRecord(
        run_id=run_id,
        session_id=session_id,
        turn_id="turn-a",
        agent_id="meta",
        status="running",
        created_at=10.0,
        updated_at=10.0,
    )


def _event(run_id: str = "run-a", event_id: str = "event-a", seq: int = 0) -> RunEvent:
    return RunEvent(
        event_id=event_id,
        run_id=run_id,
        session_id="session-a",
        turn_id="turn-a",
        seq=seq,
        ts=11.0,
        type="round_started",
        agent_id="meta",
    )


def test_run_event_roundtrip() -> None:
    event = _event(seq=1)
    assert RunEvent.from_dict(event.to_dict()) == event


@pytest.mark.parametrize("value", ["*", "?", "[x]", "a/b", "a\\b", ".", "..", "../x"])
def test_ledger_id_rejects_glob_and_path_syntax(value: str) -> None:
    with pytest.raises(ValueError, match="invalid ledger id"):
        validate_ledger_id(value, "run_id")


@pytest.mark.parametrize(
    "value",
    [
        "550e8400-e29b-41d4-a716-446655440000",
        "automation:task_1.2",
    ],
)
def test_ledger_id_accepts_uuid_and_automation_style(value: str) -> None:
    assert validate_ledger_id(value, "run_id") == value


def test_get_run_rejects_glob_id_before_search(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())

    with pytest.raises(ValueError, match="invalid ledger id"):
        store.get_run("*")


def test_run_event_rejects_invalid_sequence() -> None:
    with pytest.raises(ValueError, match="seq"):
        RunEvent.from_dict(_event(seq=0).to_dict())


def test_unknown_effect_class_becomes_unknown() -> None:
    payload = _event(seq=1).to_dict()
    payload["effect_class"] = "future-effect"
    assert RunEvent.from_dict(payload).effect_class == "unknown"


def test_future_schema_event_is_readable_but_not_branchable() -> None:
    payload = _event(seq=1).to_dict()
    payload.update({"schema_version": 99, "branchable": True})
    event = RunEvent.from_dict(payload)
    assert event.type == "round_started"
    assert event.branchable is False
    assert event.unbranchable_reason == "unsupported_schema_version"


def test_append_assigns_strictly_monotonic_seq(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    first = store.append_event("run-a", _event(event_id="e1"))
    second = store.append_event("run-a", _event(event_id="e2"))
    assert [first.seq, second.seq] == [1, 2]


def test_duplicate_event_id_is_idempotent(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    first = store.append_event("run-a", _event(event_id="same"))
    second = store.append_event("run-a", _event(event_id="same"))
    assert second == first
    assert store.get_run("run-a").event_count == 1


def test_parallel_append_has_no_duplicate_sequence(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())

    def _append(index: int) -> int:
        return store.append_event("run-a", _event(event_id=f"e-{index}")).seq

    with ThreadPoolExecutor(max_workers=8) as pool:
        seqs = list(pool.map(_append, range(40)))
    assert sorted(seqs) == list(range(1, 41))


def test_cold_restart_preserves_run_and_events(tmp_path: Path) -> None:
    first = ReplayLedgerStore(tmp_path)
    first.open_run(_record())
    first.append_event("run-a", _event(event_id="e1"))
    second = ReplayLedgerStore(tmp_path)
    assert second.get_run("run-a").run_id == "run-a"
    assert [item.event_id for item in second.read_events("run-a")[0]] == ["e1"]


def test_independent_store_append_preserves_idempotency_and_sequence(
    tmp_path: Path,
) -> None:
    first = ReplayLedgerStore(tmp_path)
    first.open_run(_record())
    original = first.append_event("run-a", _event(event_id="shared"))
    second = ReplayLedgerStore(tmp_path)

    duplicate = second.append_event("run-a", _event(event_id="shared"))
    appended = second.append_event("run-a", _event(event_id="next"))

    assert duplicate == original
    assert appended.seq == 2
    assert [row.event_id for row in second.read_events("run-a")[0]] == [
        "shared",
        "next",
    ]


def test_append_recovers_sequence_when_metadata_lags_jsonl(tmp_path: Path) -> None:
    first = ReplayLedgerStore(tmp_path)
    first.open_run(_record())
    first.append_event("run-a", _event(event_id="e1"))
    first.append_event("run-a", _event(event_id="e2"))
    run_path = tmp_path / "session-a" / "runs" / "run-a" / "run.json"
    metadata = json.loads(run_path.read_text(encoding="utf-8"))
    metadata.update({"last_seq": 1, "event_count": 1})
    run_path.write_text(json.dumps(metadata), encoding="utf-8")

    restarted = ReplayLedgerStore(tmp_path)
    assert restarted.get_run("run-a").last_seq == 2
    appended = restarted.append_event("run-a", _event(event_id="e3"))

    assert appended.seq == 3
    assert [event.seq for event in restarted.read_events("run-a")[0]] == [1, 2, 3]


def test_continuous_append_rebuilds_event_index_only_once(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    scans = 0
    original = ReplayLedgerStore._scan_event_index

    def _counted_scan(self, events_path):
        nonlocal scans
        scans += 1
        return original(self, events_path)

    monkeypatch.setattr(ReplayLedgerStore, "_scan_event_index", _counted_scan)
    for index in range(1000):
        store.append_event("run-a", _event(event_id=f"e-{index}"))

    assert scans <= 2
    assert store.get_run("run-a").last_seq == 1000


def test_independent_stores_share_run_lock_during_tail_write(tmp_path: Path) -> None:
    writer_store = ReplayLedgerStore(tmp_path)
    reader_store = ReplayLedgerStore(tmp_path)
    writer_store.open_run(_record())
    run_dir = tmp_path / "session-a" / "runs" / "run-a"
    events_path = run_dir / "events.jsonl"
    raw_line = json.dumps(_event(event_id="tail", seq=1).to_dict()) + "\n"
    midpoint = len(raw_line) // 2
    tail_open = threading.Event()
    release_tail = threading.Event()
    reader_started = threading.Event()

    def _write_tail() -> None:
        with writer_store._locked(run_dir, "run-a"):
            with events_path.open("a", encoding="utf-8") as handle:
                handle.write(raw_line[:midpoint])
                handle.flush()
                tail_open.set()
                assert release_tail.wait(timeout=2)
                handle.write(raw_line[midpoint:])
                handle.flush()

    def _read_tail():
        reader_started.set()
        return reader_store.read_events("run-a")

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(_write_tail)
        assert tail_open.wait(timeout=2)
        reader = pool.submit(_read_tail)
        assert reader_started.wait(timeout=2)
        time.sleep(0.05)
        assert not reader.done()
        release_tail.set()
        writer.result(timeout=2)
        rows, has_more = reader.result(timeout=2)

    assert has_more is False
    assert [row.event_id for row in rows] == ["tail"]
    assert reader_store.get_run("run-a").completeness == "complete"


def test_corrupt_line_marks_partial_and_keeps_readable_rows(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    store.append_event("run-a", _event(event_id="e1"))
    events_path = tmp_path / "session-a" / "runs" / "run-a" / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write("{broken\n")
    store.append_event("run-a", _event(event_id="e2"))
    rows, _ = store.read_events("run-a")
    assert [row.event_id for row in rows] == ["e1", "e2"]
    record = store.get_run("run-a")
    assert record.completeness == "partial"
    assert record.gap_reason == "corrupt_event_line"


def test_corrupt_run_metadata_recovers_correct_session_id(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record(session_id="correct-session"))
    run_path = tmp_path / "correct-session" / "runs" / "run-a" / "run.json"
    run_path.write_text("{broken", encoding="utf-8")

    recovered = ReplayLedgerStore(tmp_path).get_run("run-a")

    assert recovered is not None
    assert recovered.session_id == "correct-session"


def test_blob_content_addressing_deduplicates_payload(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    first = store.write_blob("run-a", {"b": 2, "a": 1})
    second = store.write_blob("run-a", {"a": 1, "b": 2})
    assert first == second
    assert store.read_blob("run-a", first) == {"a": 1, "b": 2}


@pytest.mark.parametrize(
    "blob_ref",
    [
        "../x",
        "/tmp/x",
        "g" * 64,
        "A" * 64,
        "abc123",
    ],
)
def test_read_blob_rejects_invalid_sha256_ref(
    tmp_path: Path,
    blob_ref: str,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())

    assert store.read_blob("run-a", blob_ref) is None
    record = store.get_run("run-a")
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "invalid_payload_blob_ref"


def test_read_blob_accepts_lowercase_sha256_ref(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    blob_ref = store.write_blob("run-a", {"safe": True})

    assert len(blob_ref) == 64
    assert blob_ref == blob_ref.lower()
    assert store.read_blob("run-a", blob_ref) == {"safe": True}


def test_read_blob_rejects_high_compression_payload_before_json_decode(
    tmp_path: Path,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    raw = json.dumps({"result": "x" * 10_000}, separators=(",", ":")).encode()
    digest = hashlib.sha256(raw).hexdigest()
    blob_path = (
        tmp_path / "session-a" / "runs" / "run-a" / "blobs" / f"{digest}.json.gz"
    )
    blob_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(blob_path, "wb") as handle:
        handle.write(raw)

    assert store.read_blob("run-a", digest, max_uncompressed_bytes=128) is None
    record = store.get_run("run-a")
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "payload_blob_too_large"


def test_closed_run_cache_entries_are_bounded(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    for index in range(100):
        run_id = f"closed-{index}"
        store.open_run(_record(run_id=run_id))
        store.append_event(run_id, _event(run_id=run_id, event_id=f"event-{index}"))
        store.close_run(run_id, "completed", 12.0)

    root_key = str(tmp_path.resolve())
    assert not [
        key for key in replay_store_module._SHARED_EVENT_INDEXES if key[0] == root_key
    ]
    assert (
        len(
            [key for key in replay_store_module._SHARED_RUN_LOCKS if key[0] == root_key]
        )
        <= 1
    )


def test_blob_write_fsyncs_file_and_parent_directory(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    calls: list[int] = []
    original_fsync = __import__("os").fsync

    def _record_fsync(fd: int) -> None:
        calls.append(fd)
        original_fsync(fd)

    monkeypatch.setattr("agenticx.runtime.replay_ledger.store.os.fsync", _record_fsync)

    store.write_blob("run-a", {"durable": True})

    assert len(calls) >= 2


def test_blob_write_tolerates_unsupported_directory_fsync(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    attempted = False
    original_open = __import__("os").open

    def _unsupported_directory_open(path, flags):
        nonlocal attempted
        if Path(path).name == "blobs":
            attempted = True
            raise OSError("directory fsync unsupported")
        return original_open(path, flags)

    monkeypatch.setattr(
        "agenticx.runtime.replay_ledger.store.os.open",
        _unsupported_directory_open,
    )

    blob_ref = store.write_blob("run-a", {"durable": True})

    assert attempted is True
    assert store.read_blob("run-a", blob_ref) == {"durable": True}


def test_delete_session_runs_removes_only_target_session(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record("session-a", "run-a"))
    store.open_run(_record("session-b", "run-b"))
    store.delete_session_runs("session-a")
    assert store.get_run("run-a") is None
    assert store.get_run("run-b") is not None


@pytest.mark.parametrize(
    ("tool_name", "arguments", "expected"),
    [
        ("file_read", {"path": "a.txt"}, "read"),
        ("file_edit", {"path": "a.txt"}, "local_write"),
        ("bash_exec", {"command": "git push origin HEAD"}, "external_write"),
        ("mcp_call", {"server": "x"}, "unknown"),
        ("send_message", {"text": "hello"}, "external_write"),
    ],
)
def test_tool_effect_classes(tool_name: str, arguments: dict, expected: str) -> None:
    assert classify_tool_effect(tool_name, arguments) == expected


@pytest.mark.parametrize(
    "command",
    [
        "echo hi > local.txt",
        "printf x >> local.txt",
        "sed -i.bak 's/a/b/' local.txt",
        "touch local.txt",
    ],
)
def test_shell_local_writes_are_never_classified_read(command: str) -> None:
    assert classify_tool_effect("bash_exec", {"command": command}) in {
        "local_write",
        "unknown",
    }


@pytest.mark.parametrize(
    "command",
    [
        "echo ping > /dev/tcp/example.com/443",
        "printf ping > /dev/udp/127.0.0.1/53",
        "echo ping >/dev/tcp/example.com/443",
        "echo ping 2>/dev/udp/example.com/53",
        "echo ping >>/dev/tcp/example.com/443",
        "echo ping 2> /dev/udp/example.com/53",
    ],
)
def test_shell_network_device_redirect_is_external_write(command: str) -> None:
    assert classify_tool_effect("bash_exec", {"command": command}) == "external_write"


@pytest.mark.parametrize(
    "command",
    [
        'echo value >"$OUT"',
        "echo value >$target",
        "echo value 2>>${path}",
    ],
)
def test_shell_dynamic_redirect_target_is_unknown(command: str) -> None:
    assert classify_tool_effect("bash_exec", {"command": command}) == "unknown"


@pytest.mark.parametrize(
    "command",
    [
        "echo value >&$FD",
        "echo value 2>&${fd}",
        'echo value >&"$FD"',
    ],
)
def test_shell_dynamic_fd_redirect_is_unknown(command: str) -> None:
    assert classify_tool_effect("bash_exec", {"command": command}) == "unknown"


def test_shell_static_fd_redirect_remains_read() -> None:
    assert (
        classify_tool_effect(
            "bash_exec",
            {"command": "echo value 2>&1"},
        )
        == "read"
    )


@pytest.mark.parametrize(
    "command",
    [
        "echo value > output.txt",
        "echo value >>./logs/output.txt",
        "echo value 2>/tmp/output.log",
    ],
)
def test_shell_static_redirect_target_is_local_write(command: str) -> None:
    assert classify_tool_effect("bash_exec", {"command": command}) == "local_write"


def test_missing_payload_blob_marks_run_partial(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    blob_ref = store.write_blob("run-a", {"value": "present"})
    blob_path = (
        tmp_path / "session-a" / "runs" / "run-a" / "blobs" / f"{blob_ref}.json.gz"
    )
    blob_path.unlink()

    assert store.read_blob("run-a", blob_ref) is None
    record = store.get_run("run-a")
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "payload_blob_missing"


@pytest.mark.parametrize("mode", ["bad_gzip", "bad_json", "hash_mismatch"])
def test_corrupt_payload_blob_marks_run_partial(tmp_path: Path, mode: str) -> None:
    store = ReplayLedgerStore(tmp_path)
    store.open_run(_record())
    blob_ref = store.write_blob("run-a", {"value": "original"})
    blob_path = (
        tmp_path / "session-a" / "runs" / "run-a" / "blobs" / f"{blob_ref}.json.gz"
    )
    if mode == "bad_gzip":
        blob_path.write_bytes(b"not-gzip")
    else:
        with gzip.open(blob_path, "wb") as handle:
            handle.write(b"{broken" if mode == "bad_json" else b'{"value":"changed"}')

    assert store.read_blob("run-a", blob_ref) is None
    record = store.get_run("run-a")
    assert record is not None
    assert record.completeness == "partial"
    assert record.gap_reason == "payload_blob_corrupt"
