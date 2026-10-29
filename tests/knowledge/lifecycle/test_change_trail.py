"""ChangeTrailStore append / query / store hook."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.knowledge.lifecycle.trail import ChangeEvent, ChangeTrailStore, record_transition


def test_append_and_list_for(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    trail.append(
        ChangeEvent(id="e1", object_id="o1", action="create", actor="alice")
    )
    trail.append(
        ChangeEvent(
            id="e2",
            object_id="o1",
            action="transition",
            from_status="draft",
            to_status="pending_review",
        )
    )
    trail.append(ChangeEvent(id="e3", object_id="o2", action="create"))
    assert [e.id for e in trail.list_for("o1")] == ["e1", "e2"]
    assert len(trail.list_all()) == 3


def test_persist_reload(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    trail.append(ChangeEvent(id="e1", object_id="o1", action="update", detail={"k": 1}))
    disk = json.loads((tmp_path / "changes.json").read_text(encoding="utf-8"))
    assert len(disk["events"]) == 1
    reloaded = ChangeTrailStore(tmp_path)
    ev = reloaded.list_for("o1")[0]
    assert ev.action == "update"
    assert ev.detail["k"] == 1


def test_invalid_action_raises() -> None:
    with pytest.raises(ValueError):
        ChangeEvent(id="x", object_id="o1", action="delete")


def test_record_transition_maps_retire_reopen(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    ev = record_transition(
        trail,
        object_id="o1",
        from_status="published",
        to_status="retired",
        actor="bob",
    )
    assert ev.action == "retire"
    ev2 = record_transition(
        trail,
        object_id="o1",
        from_status="retired",
        to_status="draft",
    )
    assert ev2.action == "reopen"


def test_store_hooks_trail_on_upsert_and_transition(tmp_path: Path) -> None:
    trail = ChangeTrailStore(tmp_path)
    store = KnowledgeObjectFileStore(tmp_path, trail=trail, actor="ops")
    store.upsert_object(KnowledgeObject(id="ent-1", kind="entity", attrs={"name": "A"}))
    store.transition("ent-1", KnowledgeStatus.PENDING_REVIEW)
    store.transition("ent-1", KnowledgeStatus.PUBLISHED)
    store.transition("ent-1", KnowledgeStatus.RETIRED)
    actions = [e.action for e in trail.list_for("ent-1")]
    assert actions[0] == "create"
    assert "retire" in actions
    assert all(e.actor == "ops" for e in trail.list_for("ent-1"))
