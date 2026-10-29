"""ExecutionFileStore unit tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.rules.execution import ExecutionFileStore, ExecutionRecord


def test_upsert_list_reload(tmp_path: Path) -> None:
    store = ExecutionFileStore(tmp_path)
    assert store.list_executions() == []
    rec = store.record_run(
        rule_id="r1",
        rule_version=1,
        nodes=[{"type": "trigger"}],
        status="completed",
    )
    assert rec.status == "completed"
    assert store.get_execution(rec.id).rule_id == "r1"
    reloaded = ExecutionFileStore(tmp_path)
    assert len(reloaded.list_executions(rule_id="r1")) == 1


def test_bad_status_raises() -> None:
    with pytest.raises(ValueError):
        ExecutionRecord(id="e1", rule_id="r1", rule_version=1, status="weird")
