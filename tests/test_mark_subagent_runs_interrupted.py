"""Regression test: the resume scan really marks crashed subagent runs.

``SubAgentRunStore.update_status`` takes ``status`` as a keyword-only
argument; passing it positionally raised a TypeError that the surrounding
handler swallowed, so the scan silently marked nothing.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.studio.session_manager import SessionManager

OWNER = "sess-interrupted-marking"


def test_resume_scan_marks_running_runs_interrupted(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore(OWNER)
    store.open_run(
        run_id="sa-running01",
        kind="spawn",
        name="w1",
        role="worker",
        task="t",
        status="running",
        started_at=1.0,
    )
    store.open_run(
        run_id="sa-done00001",
        kind="spawn",
        name="w2",
        role="worker",
        task="t",
        status="completed",
        started_at=1.0,
    )

    SessionManager()._mark_subagent_runs_interrupted(OWNER)

    assert store.get_run("sa-running01").status == "interrupted"
    assert store.get_run("sa-done00001").status == "completed"
