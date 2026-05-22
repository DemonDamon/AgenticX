#!/usr/bin/env python3
"""Smoke tests for the project_state harness (P0 store + tools + prompts).

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path

import pytest

from agenticx.project_state.feature_list import (
    commit_active_feature,
    select_next_pending,
    transition_feature,
)
from agenticx.project_state.prompts import build_project_state_blocks
from agenticx.project_state.schema import (
    FEATURE_COMMITTED,
    FEATURE_IN_PROGRESS,
    FEATURE_PENDING,
    FEATURE_VERIFIED,
    Feature,
    FeatureListV1,
    PHASE_INITIALIZE,
    StatusV1,
)
from agenticx.project_state.store import (
    ProjectStateError,
    ProjectStore,
    locate_project_root,
)
from agenticx.project_state.tools import (
    dispatch_project_state_tool,
    project_state_tool_schemas,
)
from agenticx.runtime.session_mode import (
    FEATURE_LOOP,
    VALID_MODES,
    is_feature_loop,
    normalize_session_mode,
)


class _Session:
    def __init__(self, workspace: Path, mode: str = "feature_loop") -> None:
        self.session_mode = mode
        self.workspace_dir = str(workspace)
        self.taskspaces = []


@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    (tmp_path / "src").mkdir()
    return tmp_path


# ---------- schema / state machine ----------

def test_feature_list_round_trip() -> None:
    payload = FeatureListV1(features=[Feature(id="f1", title="title")])
    raw = payload.to_dict()
    rebuilt = FeatureListV1.from_dict(raw)
    assert rebuilt.features[0].id == "f1"


def test_feature_list_rejects_duplicate_ids() -> None:
    raw = {
        "schema_version": 1,
        "features": [
            {"id": "f1", "title": "a"},
            {"id": "f1", "title": "b"},
        ],
    }
    with pytest.raises(ValueError):
        FeatureListV1.from_dict(raw)


def test_invalid_status_phase_rejected() -> None:
    with pytest.raises(ValueError):
        StatusV1.from_dict({"schema_version": 1, "phase": "bogus"})


def test_illegal_transition_blocked() -> None:
    payload = FeatureListV1(features=[Feature(id="f1", title="a")])
    with pytest.raises(ProjectStateError):
        # pending -> verified is not allowed
        transition_feature(payload, "f1", FEATURE_VERIFIED)


def test_committed_is_terminal() -> None:
    payload = FeatureListV1(features=[Feature(id="f1", title="a", status=FEATURE_COMMITTED)])
    with pytest.raises(ProjectStateError):
        transition_feature(payload, "f1", FEATURE_IN_PROGRESS)


def test_select_next_pending_respects_dependencies() -> None:
    payload = FeatureListV1(
        features=[
            Feature(id="a", title="a", priority=10, status=FEATURE_PENDING),
            Feature(id="b", title="b", priority=1, depends_on=["a"], status=FEATURE_PENDING),
        ]
    )
    picked = select_next_pending(payload)
    assert picked is not None and picked.id == "a"


# ---------- store: atomic writes + lock ----------

def test_store_round_trip(workspace: Path) -> None:
    store = ProjectStore.open(workspace, create=True)
    payload = FeatureListV1(features=[Feature(id="f1", title="a")])
    store.save_feature_list(payload)
    status = StatusV1(phase=PHASE_INITIALIZE, project_id="demo")
    store.save_status(status)
    assert store.is_initialized()
    reread = ProjectStore.open(workspace).load_feature_list()
    assert reread.features[0].title == "a"


def test_store_locate_falls_back(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_global = workspace / "_fake_global"
    fake_global.mkdir()
    monkeypatch.setattr(
        "agenticx.project_state.store.GLOBAL_FALLBACK_ROOT", fake_global
    )
    # repo root has no .agx/project, fallback should create under fake_global.
    root = locate_project_root(workspace, create=True)
    assert (workspace / ".agx" / "project").is_dir() or root.is_relative_to(fake_global)


def test_store_lock_serialization(workspace: Path) -> None:
    store = ProjectStore.open(workspace, create=True)
    counter = {"value": 0}

    def _hammer() -> None:
        with store.lock(timeout_sec=10):
            current = counter["value"]
            time.sleep(0.02)
            counter["value"] = current + 1

    threads = [threading.Thread(target=_hammer) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert counter["value"] == 5


def test_store_safe_relative_rejects_escape(workspace: Path) -> None:
    store = ProjectStore.open(workspace, create=True)
    with pytest.raises(ProjectStateError):
        store.safe_relative(workspace.parent / "outside.txt")


# ---------- tools end-to-end ----------

def test_tool_schemas_have_all_six_names() -> None:
    names = {s["function"]["name"] for s in project_state_tool_schemas()}
    assert names == {
        "project_init",
        "project_status",
        "feature_select",
        "feature_complete",
        "progress_append",
        "verify_run",
    }


def _payload(out: str) -> dict:
    return json.loads(out)


def test_project_init_creates_artifacts(workspace: Path) -> None:
    session = _Session(workspace)
    out = dispatch_project_state_tool(
        "project_init",
        {
            "project_id": "demo",
            "description": "smoke project",
            "features": [
                {"id": f"f{i}", "title": f"feature {i}", "priority": i}
                for i in range(1, 6)
            ],
        },
        session,
    )
    data = _payload(out)
    assert data["ok"] is True
    project_root = workspace / ".agx" / "project"
    assert (project_root / "feature_list.json").is_file()
    assert (project_root / "status.json").is_file()
    assert (project_root / "init.sh").is_file()
    assert (project_root / "verify.yaml").is_file()
    assert (project_root / "progress.md").is_file()


def test_project_status_after_init(workspace: Path) -> None:
    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {
            "features": [{"id": "f1", "title": "feature 1"}],
        },
        session,
    )
    out = dispatch_project_state_tool("project_status", {}, session)
    data = _payload(out)
    assert data["ok"] is True
    assert data["counts"]["total"] == 1
    assert data["phase"] == PHASE_INITIALIZE


def test_feature_select_and_commit_flow(workspace: Path) -> None:
    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {
            "features": [
                {"id": "f1", "title": "first", "priority": 1},
                {"id": "f2", "title": "second", "priority": 2},
            ],
        },
        session,
    )
    sel = _payload(dispatch_project_state_tool("feature_select", {}, session))
    assert sel["ok"] is True and sel["feature"]["id"] == "f1"

    # cannot select another while one is in_progress
    blocked = _payload(
        dispatch_project_state_tool("feature_select", {"feature_id": "f2"}, session)
    )
    assert blocked["ok"] is False

    # cannot commit before verify
    no_verify = _payload(
        dispatch_project_state_tool(
            "feature_complete",
            {"feature_id": "f1", "commit_sha": "deadbeef"},
            session,
        )
    )
    assert no_verify["ok"] is False

    # manually advance the feature to verified to test commit path without running shell
    store = ProjectStore.open(workspace)
    payload = store.load_feature_list()
    transition_feature(payload, "f1", FEATURE_VERIFIED)
    store.save_feature_list(payload)
    status = store.load_status()

    completed = _payload(
        dispatch_project_state_tool(
            "feature_complete",
            {"feature_id": "f1", "commit_sha": "abcdef1234"},
            session,
        )
    )
    assert completed["ok"] is True
    archive = workspace / ".agx" / "project" / "archive" / "feature_f1.json"
    assert archive.is_file()


def test_verify_run_passes_and_advances_feature(workspace: Path) -> None:
    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {"features": [{"id": "f1", "title": "first"}]},
        session,
    )
    dispatch_project_state_tool("feature_select", {}, session)

    # Replace the templated verify.yaml with a fast no-op step.
    verify_yaml = workspace / ".agx" / "project" / "verify.yaml"
    verify_yaml.write_text(
        "schema_version: 1\nsteps:\n  - name: noop\n    type: shell\n    cmd: \"true\"\n    timeout_sec: 30\n",
        encoding="utf-8",
    )
    out = dispatch_project_state_tool("verify_run", {"feature_id": "f1"}, session)
    data = _payload(out)
    assert data["ok"] is True
    assert data["result"]["passed"] is True

    store = ProjectStore.open(workspace)
    payload = store.load_feature_list()
    feat = payload.features[0]
    assert feat.status == FEATURE_VERIFIED


def test_verify_run_failure_does_not_advance(workspace: Path) -> None:
    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {"features": [{"id": "f1", "title": "first"}]},
        session,
    )
    dispatch_project_state_tool("feature_select", {}, session)

    verify_yaml = workspace / ".agx" / "project" / "verify.yaml"
    verify_yaml.write_text(
        "schema_version: 1\nsteps:\n  - name: fail\n    type: shell\n    cmd: \"exit 7\"\n    timeout_sec: 30\n",
        encoding="utf-8",
    )
    out = dispatch_project_state_tool("verify_run", {"feature_id": "f1"}, session)
    data = _payload(out)
    assert data["ok"] is True  # tool itself ran
    assert data["result"]["passed"] is False

    store = ProjectStore.open(workspace)
    feat = store.load_feature_list().features[0]
    assert feat.status == FEATURE_IN_PROGRESS  # not advanced
    assert store.load_status().verify_fail_count >= 1


def test_progress_append_writes_line(workspace: Path) -> None:
    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {"features": [{"id": "f1", "title": "f1"}]},
        session,
    )
    dispatch_project_state_tool(
        "progress_append",
        {"message": "hello-world"},
        session,
    )
    text = (workspace / ".agx" / "project" / "progress.md").read_text(encoding="utf-8")
    assert "hello-world" in text


# ---------- session_mode ----------

def test_feature_loop_mode_registered() -> None:
    assert FEATURE_LOOP in VALID_MODES
    assert normalize_session_mode("feature_loop") == FEATURE_LOOP

    class S:
        session_mode = "feature_loop"

    assert is_feature_loop(S())


# ---------- prompt block ----------

def test_prompt_block_empty_for_other_modes(workspace: Path) -> None:
    session = _Session(workspace, mode="daily_office")
    assert build_project_state_blocks(session) == ""


def test_prompt_block_initializer_when_uninitialized(workspace: Path) -> None:
    session = _Session(workspace)
    block = build_project_state_blocks(session)
    assert "Initializer" in block


def test_project_feature_source_emits_one_per_tick(workspace: Path) -> None:
    import asyncio

    from agenticx.longrun.sources import ProjectFeatureSource

    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {
            "features": [
                {"id": "a", "title": "first", "priority": 1},
                {"id": "b", "title": "second", "priority": 2},
            ],
        },
        session,
    )
    store = ProjectStore.open(workspace)
    source = ProjectFeatureSource([store], max_per_tick=1)

    batch = asyncio.run(source.fetch_pending_tasks())
    assert len(batch) == 1
    assert batch[0]["feature_id"] == "a"
    assert batch[0]["session_mode"] == "feature_loop"

    # Same source should not re-emit the same feature in subsequent tick.
    batch2 = asyncio.run(source.fetch_pending_tasks())
    assert batch2 == []

    asyncio.run(source.mark_task_done(batch[0]["id"]))
    # After mark_task_done the feature is still pending on disk, but the source
    # remembers it has been emitted+completed; advancing to a new feature
    # requires the worker session to actually move it through the state machine.
    batch3 = asyncio.run(source.fetch_pending_tasks())
    assert batch3 == []


def test_prompt_block_coding_after_init_and_select(workspace: Path) -> None:
    session = _Session(workspace)
    dispatch_project_state_tool(
        "project_init",
        {"features": [{"id": "f1", "title": "first feature"}]},
        session,
    )
    dispatch_project_state_tool("feature_select", {}, session)
    block = build_project_state_blocks(session)
    assert "Coding" in block
    assert "first feature" in block
