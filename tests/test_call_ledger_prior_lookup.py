#!/usr/bin/env python3
"""Prior-call lookup on the append-only tool ledger.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from agenticx.reliability.call_identity import canonical_call_key
from agenticx.reliability.call_ledger import CallLedger

_ARGS = {"command": "git push origin main"}
_TOOL = "bash_exec"


def _key() -> str:
    return canonical_call_key(_TOOL, _ARGS)


def _dispatch_at(ledger: CallLedger, call_id: str, when: float) -> None:
    with patch("agenticx.reliability.call_ledger.time.time", return_value=when):
        ledger.record_dispatch(call_id, _TOOL, _ARGS)


def _find(
    ledger: CallLedger,
    *,
    dispatched_before: float,
    max_age_seconds: float = 10_000.0,
    now: float = 300.0,
):
    return ledger.find_prior_by_canonical_key(
        _key(),
        dispatched_before=dispatched_before,
        max_age_seconds=max_age_seconds,
        now=now,
    )


def test_ac1_returns_latest_dispatched_at(tmp_path: Path) -> None:
    ledger = CallLedger("ac1", root=tmp_path)
    _dispatch_at(ledger, "newer", 200.0)
    _dispatch_at(ledger, "older", 100.0)
    found = _find(ledger, dispatched_before=300.0)
    assert found is not None
    assert found.call_id == "newer"
    assert found.dispatched_at == 200.0


def test_ac2_cutoff_excludes_newer_records(tmp_path: Path) -> None:
    ledger = CallLedger("ac2", root=tmp_path)
    _dispatch_at(ledger, "older", 100.0)
    _dispatch_at(ledger, "newer", 200.0)
    at_150 = _find(ledger, dispatched_before=150.0)
    assert at_150 is not None
    assert at_150.call_id == "older"
    assert _find(ledger, dispatched_before=50.0) is None


def test_ac3_failed_and_reconciled_are_skipped(tmp_path: Path) -> None:
    ledger = CallLedger("ac3", root=tmp_path)
    _dispatch_at(ledger, "live", 100.0)
    _dispatch_at(ledger, "bad", 200.0)
    ledger.record_failure("bad", "boom")
    found = _find(ledger, dispatched_before=300.0)
    assert found is not None
    assert found.call_id == "live"

    only_failed = CallLedger("ac3-failed", root=tmp_path)
    _dispatch_at(only_failed, "bad", 100.0)
    only_failed.record_failure("bad", "boom")
    assert _find(only_failed, dispatched_before=300.0) is None

    ledger.mark_reconciled("live", "consumed")
    assert _find(ledger, dispatched_before=300.0) is None


def test_ac4_max_age_excludes_stale_records(tmp_path: Path) -> None:
    ledger = CallLedger("ac4", root=tmp_path)
    dispatched_at = 1_000.0
    max_age = 24 * 3600
    _dispatch_at(ledger, "stale", dispatched_at)
    assert (
        _find(
            ledger,
            dispatched_before=dispatched_at + max_age + 10,
            max_age_seconds=max_age,
            now=dispatched_at + max_age + 1,
        )
        is None
    )
    still_fresh = _find(
        ledger,
        dispatched_before=dispatched_at + max_age + 10,
        max_age_seconds=max_age,
        now=dispatched_at + max_age,
    )
    assert still_fresh is not None
    assert still_fresh.call_id == "stale"


def test_ac5_mark_reconciled_survives_reload(tmp_path: Path) -> None:
    ledger = CallLedger("ac5", root=tmp_path)
    ledger.record_dispatch("c1", _TOOL, _ARGS)
    ledger.mark_reconciled("c1", "orphan_intercepted")
    ledger.close()

    restored = CallLedger("ac5", root=tmp_path)
    record = restored.lookup("c1")
    assert record is not None
    assert record.reconciled is True


def test_ac6_old_format_defaults_reconciled_false(tmp_path: Path) -> None:
    session_dir = tmp_path / "ac6"
    session_dir.mkdir()
    dispatch = {
        "v": 1,
        "op": "dispatch",
        "ts": 10.0,
        "call_id": "c-old",
        "canonical_key": "echo:abc",
        "tool_name": "echo",
        "state": "dispatched",
        "dispatched_at": 10.0,
        "replay_safety": "unknown",
        "arguments": {"text": "hi"},
    }
    result = {
        "v": 1,
        "op": "result",
        "ts": 11.0,
        "call_id": "c-old",
        "state": "completed",
        "completed_at": 11.0,
        "result_digest": "abc",
        "result_payload": "ok",
        "error": None,
    }
    (session_dir / "call_ledger.jsonl").write_text(
        json.dumps(dispatch) + "\n" + json.dumps(result) + "\n",
        encoding="utf-8",
    )
    restored = CallLedger("ac6", root=tmp_path)
    record = restored.lookup("c-old")
    assert record is not None
    assert record.reconciled is False
    assert record.state == "completed"
    assert record.result_payload == "ok"
