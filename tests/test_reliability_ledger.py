#!/usr/bin/env python3
"""Tests for the append-only tool-call ledger.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.reliability.call_ledger import CallLedger, Verdict
from agenticx.reliability.errors import LedgerCorruptError, ToolCallIdentityError


def _ledger(tmp_path: Path, session_id: str = "sess-1", **kwargs) -> CallLedger:
    return CallLedger(session_id, root=tmp_path, **kwargs)


def test_fresh_when_unseen(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    result = ledger.reconcile("c1", "echo", {"text": "hi"})
    assert result.verdict is Verdict.FRESH
    assert result.record is None


def test_replay_skip_returns_stored_result(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"text": "hi"})
    ledger.record_result("c1", "OK")
    result = ledger.reconcile("c1", "echo", {"text": "hi"})
    assert result.verdict is Verdict.REPLAY_SKIP
    assert result.replay_result == "OK"


def test_ambiguous_when_dispatched_only(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"text": "hi"})
    result = ledger.reconcile("c1", "echo", {"text": "hi"})
    assert result.verdict is Verdict.AMBIGUOUS


def test_failed_becomes_fresh(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"text": "hi"})
    ledger.record_failure("c1", "boom")
    result = ledger.reconcile("c1", "echo", {"text": "hi"})
    assert result.verdict is Verdict.FRESH


def test_identity_conflict_raises(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"a": 1, "b": 2})
    with pytest.raises(ToolCallIdentityError) as excinfo:
        ledger.reconcile("c1", "echo", {"a": 1, "b": 3})
    message = str(excinfo.value)
    assert "c1" in message
    assert "b" in message


def test_reconcile_safe_does_not_raise(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"a": 1, "b": 2})
    result = ledger.reconcile_safe("c1", "echo", {"a": 1, "b": 3})
    assert result.verdict is Verdict.IDENTITY_CONFLICT


def test_large_result_not_inlined(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path, max_inline_result_bytes=8)
    ledger.record_dispatch("c1", "echo", {"text": "hi"})
    ledger.record_result("c1", "x" * 100)
    result = ledger.reconcile("c1", "echo", {"text": "hi"})
    assert result.verdict is Verdict.AMBIGUOUS
    record = ledger.lookup("c1")
    assert record is not None
    assert record.result_digest
    assert record.result_payload is None


def test_survives_reload(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"n": 1})
    ledger.record_result("c1", "one")
    ledger.record_dispatch("c2", "echo", {"n": 2})
    ledger.record_dispatch("c3", "echo", {"n": 3})
    ledger.record_failure("c3", "nope")
    ledger.close()

    restored = CallLedger.load("sess-1", root=tmp_path)
    assert restored.lookup("c1") is not None
    assert restored.lookup("c2") is not None
    assert restored.lookup("c3") is not None
    assert restored.reconcile("c1", "echo", {"n": 1}).verdict is Verdict.REPLAY_SKIP
    assert restored.reconcile("c2", "echo", {"n": 2}).verdict is Verdict.AMBIGUOUS
    assert restored.reconcile("c3", "echo", {"n": 3}).verdict is Verdict.FRESH


def test_pending_call_ids(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("a", "echo", {"n": 1})
    ledger.record_dispatch("b", "echo", {"n": 2})
    ledger.record_dispatch("c", "echo", {"n": 3})
    ledger.record_result("c", "done")
    assert set(ledger.pending_call_ids()) == {"a", "b"}


def test_write_failure_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ledger = _ledger(tmp_path)

    def _boom(_fd: int) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("os.fsync", _boom)
    with pytest.raises(OSError):
        ledger.record_dispatch("c1", "echo", {"text": "hi"})


def test_corrupt_file_raises(tmp_path: Path) -> None:
    path = tmp_path / "sess-1"
    path.mkdir()
    (path / "call_ledger.jsonl").write_text("not json\n", encoding="utf-8")
    with pytest.raises(LedgerCorruptError):
        CallLedger.load("sess-1", root=tmp_path)


def test_partial_corrupt_line_skipped(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"n": 1})
    ledger.record_dispatch("c2", "echo", {"n": 2})
    ledger.record_dispatch("c3", "echo", {"n": 3})
    ledger.close()

    file_path = tmp_path / "sess-1" / "call_ledger.jsonl"
    lines = file_path.read_text(encoding="utf-8").splitlines()
    lines[1] = "not-json-line"
    file_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    restored = CallLedger.load("sess-1", root=tmp_path)
    assert restored.lookup("c1") is not None
    assert restored.lookup("c2") is None
    assert restored.lookup("c3") is not None


def test_unknown_schema_version_skipped(tmp_path: Path) -> None:
    path = tmp_path / "sess-1"
    path.mkdir()
    (path / "call_ledger.jsonl").write_text(
        '{"v": 99, "op": "dispatch", "call_id": "c99", "tool_name": "echo"}\n',
        encoding="utf-8",
    )
    restored = CallLedger.load("sess-1", root=tmp_path)
    assert restored.lookup("c99") is None


def test_path_traversal_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        CallLedger("../evil", root=tmp_path)


def test_jsonl_is_append_only(tmp_path: Path) -> None:
    ledger = _ledger(tmp_path)
    ledger.record_dispatch("c1", "echo", {"n": 1})
    ledger.record_dispatch("c2", "echo", {"n": 2})
    ledger.record_dispatch("c3", "echo", {"n": 3})
    file_path = tmp_path / "sess-1" / "call_ledger.jsonl"
    assert len(file_path.read_text(encoding="utf-8").splitlines()) == 3
    ledger.record_result("c1", "ok")
    assert len(file_path.read_text(encoding="utf-8").splitlines()) == 4
