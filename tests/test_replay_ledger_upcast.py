"""Tests for read-time upcast of persisted replay ledger event rows.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import agenticx.runtime.replay_ledger.upcast as upcast_module
from agenticx.runtime.replay_ledger import ReplayLedgerStore, ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.contracts import SCHEMA_VERSION
from agenticx.runtime.replay_ledger.upcast import UPGCAST_STEPS, upcast_event_row


def _store_with_run(tmp_path: Path) -> tuple[ReplayLedgerStore, ReplayRunRecord]:
    store = ReplayLedgerStore(tmp_path)
    record = store.open_run(
        ReplayRunRecord(
            run_id="run-upcast",
            session_id="session-upcast",
            turn_id="turn-upcast",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    return store, record


def _row(record: ReplayRunRecord) -> RunEvent:
    return RunEvent(
        event_id="evt-1",
        run_id=record.run_id,
        session_id=record.session_id,
        turn_id=record.turn_id,
        seq=1,
        ts=1.0,
        type="round_started",
        agent_id="meta",
        payload={"round": 1},
        branchable=True,
    )


@pytest.mark.parametrize("raw_version", [None, "", "  ", 0])
def test_missing_or_zero_version_is_upcast_to_current(raw_version) -> None:
    row = {"seq": 1, "type": "round_started", "branchable": True}
    if raw_version is not None:
        row["schema_version"] = raw_version

    upgraded = upcast_event_row(row, target_version=SCHEMA_VERSION)

    assert upgraded["schema_version"] == SCHEMA_VERSION
    assert upgraded["branchable"] is True


def test_versionless_row_on_disk_is_upcast_at_read_and_never_rewritten(tmp_path: Path) -> None:
    store, record = _store_with_run(tmp_path)
    stored = store.append_event(record.run_id, _row(record))
    events_path = next(tmp_path.rglob("events.jsonl"))
    raw_row = json.loads(events_path.read_text(encoding="utf-8").splitlines()[0])
    assert raw_row["schema_version"] == SCHEMA_VERSION  # the writer always stamps the version
    del raw_row["schema_version"]
    events_path.write_text(json.dumps(raw_row, ensure_ascii=False) + "\n", encoding="utf-8")
    before = events_path.read_bytes()

    events, _has_more = store.read_events(record.run_id)

    assert [event.event_id for event in events] == [stored.event_id]
    assert events[0].schema_version == SCHEMA_VERSION
    assert events[0].branchable is True
    assert events[0].unbranchable_reason is None
    assert events_path.read_bytes() == before


def test_newer_version_is_returned_untouched() -> None:
    row = {"seq": 1, "schema_version": SCHEMA_VERSION + 5, "payload": {"k": "v"}}

    assert upcast_event_row(row, target_version=SCHEMA_VERSION) == row


def test_missing_step_stops_the_chain_and_keeps_the_row_readable() -> None:
    # The registry stays empty for the whole test: with the real {0: step} in
    # place a v0 row would be upgraded to v1 on read.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(upcast_module, "UPGCAST_STEPS", {})
        upgraded = upcast_event_row({"seq": 1}, target_version=SCHEMA_VERSION)
        assert upgraded["schema_version"] == 0

        event = RunEvent.from_dict(
            dict(
                upgraded,
                event_id="evt-1",
                run_id="run-1",
                session_id="session-1",
                turn_id="turn-1",
                type="round_started",
            )
        )
    assert event.schema_version == 0
    assert event.branchable is False
    assert event.unbranchable_reason == "unsupported_schema_version"


def test_every_version_below_current_has_an_upcast_step() -> None:
    assert set(UPGCAST_STEPS) == set(range(SCHEMA_VERSION))


def test_chain_runs_every_step_in_order() -> None:
    seen: list[int] = []

    def step_from_v1(row):
        seen.append(row["schema_version"])
        row["saw_v1"] = True
        return row

    with pytest.MonkeyPatch.context() as patch:
        patch.setitem(UPGCAST_STEPS, SCHEMA_VERSION, step_from_v1)
        upgraded = upcast_event_row({"seq": 1}, target_version=SCHEMA_VERSION + 1)

    assert seen == [SCHEMA_VERSION]
    assert upgraded["schema_version"] == SCHEMA_VERSION + 1
    assert upgraded["saw_v1"] is True


def test_non_object_row_is_rejected() -> None:
    with pytest.raises(ValueError):
        upcast_event_row(["not", "an", "object"], target_version=SCHEMA_VERSION)
