#!/usr/bin/env python3
"""Tests for SDK RunState persistence.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.reliability import run_state as run_state_mod
from agenticx.reliability.run_state import (
    PendingCall,
    RunState,
    RunStateStore,
)


def test_roundtrip() -> None:
    state = RunState(
        run_id="r1",
        session_id="s1",
        query="hello",
        messages=[{"role": "user", "content": "hello"}],
        iteration=2,
        phase="tools_dispatched",
        pending_calls=[
            PendingCall(
                call_id="c1",
                tool_name="echo",
                arguments={"text": "hi"},
                canonical_key="echo:abc",
            )
        ],
        created_at=1.0,
        updated_at=2.0,
    )
    restored = RunState.from_dict(state.to_dict())
    assert restored == state


def test_save_load_clear(tmp_path: Path) -> None:
    store = RunStateStore("sess-1", root=tmp_path)
    state = RunState(run_id="r1", session_id="sess-1", query="q")
    store.save(state)
    loaded = store.load()
    assert loaded is not None
    assert loaded.run_id == "r1"
    assert loaded.query == "q"
    store.clear()
    assert store.load() is None


def test_load_missing_returns_none(tmp_path: Path) -> None:
    assert RunStateStore("sess-1", root=tmp_path).load() is None


def test_future_schema_rejected(tmp_path: Path) -> None:
    path = tmp_path / "sess-1"
    path.mkdir()
    (path / "run_state.json").write_text(
        json.dumps({"schema_version": 999, "run_id": "r", "session_id": "sess-1"}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        RunStateStore("sess-1", root=tmp_path).load()


def test_save_failure_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*_args, **_kwargs) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(run_state_mod, "atomic_write_json", _boom)
    store = RunStateStore("sess-1", root=tmp_path)
    with pytest.raises(OSError):
        store.save(RunState(run_id="r1", session_id="sess-1"))


def test_atomic_no_partial_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = RunStateStore("sess-1", root=tmp_path)
    original = RunState(run_id="keep-me", session_id="sess-1", query="ok")
    store.save(original)

    def _boom(*_args, **_kwargs) -> None:
        raise OSError("mid-write")

    monkeypatch.setattr(run_state_mod, "atomic_write_json", _boom)
    with pytest.raises(OSError):
        store.save(RunState(run_id="new", session_id="sess-1", query="nope"))
    loaded = store.load()
    assert loaded is not None
    assert loaded.run_id == "keep-me"
    assert loaded.query == "ok"


def test_path_traversal_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        RunStateStore("../evil", root=tmp_path)
