"""Smoke: GraphRun session_id binds to studio UUID, not group_id.

Plan: 2026-08-10-graph-run-session-id-binding
Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from agenticx.runtime.graph.compiler import compile_workforce_run
from agenticx.runtime.graph.models import GraphRun
from agenticx.runtime.graph.social import ensure_presence_run
from agenticx.runtime.graph.store import GraphRunStore
from agenticx.runtime.group_router import resolve_studio_session_id


def test_resolve_prefers_private_session_id() -> None:
    s = SimpleNamespace(
        _session_id="uuid-1",
        _usage_owner_session_id="uuid-2",
        session_id="uuid-3",
    )
    assert resolve_studio_session_id(s) == "uuid-1"
    s2 = SimpleNamespace(_usage_owner_session_id="uuid-2")
    assert resolve_studio_session_id(s2) == "uuid-2"
    assert resolve_studio_session_id(SimpleNamespace()) == ""


def test_ensure_presence_backfills_empty_session_id(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = GraphRun(
        run_id="gr_pres_x",
        session_id="",
        group_id="g1",
        nodes={},
        edges=[],
        status="open",
        version=0,
        meta={"source": "presence", "ephemeral": True},
    )
    store.save(run, bump_version=True)
    again = ensure_presence_run(
        session_id="real-uuid",
        group_id="g1",
        member_ids=["a1"],
        store=store,
        existing_run_id="gr_pres_x",
    )
    assert again.session_id == "real-uuid"
    loaded = store.load("gr_pres_x")
    assert loaded is not None
    assert loaded.session_id == "real-uuid"


def test_list_by_group_id_includes_misbound_session(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="g1",  # legacy misbind
        group_id="g1",
        subtasks=[SimpleNamespace(id="t1", description="A", dependencies=[])],
        assignment_map={"t1": "w1"},
        run_id="gr_legacy",
    )
    store.save(run, bump_version=True)
    found = store.list_by_group_id("g1")
    assert any(r.run_id == "gr_legacy" for r in found)
    assert store.list_by_session("real-uuid") == []


def test_compile_workforce_keeps_uuid_not_group() -> None:
    run = compile_workforce_run(
        session_id="67dfbc40-090f-48f2-b76a-d09839996ba2",
        group_id="98c19c731b99",
        subtasks=[SimpleNamespace(id="t1", description="A", dependencies=[])],
        assignment_map={"t1": "w1"},
    )
    assert run.session_id == "67dfbc40-090f-48f2-b76a-d09839996ba2"
    assert run.group_id == "98c19c731b99"
