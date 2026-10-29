"""KnowledgeObjectFileStore persistence."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.knowledge.lifecycle.model import (
    KnowledgeObject,
    KnowledgeStatus,
    KnowledgeTransitionError,
)
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore


def test_empty_store_lists(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    assert store.list_objects() == []


def test_upsert_list_get_persist_reload(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    store.upsert_object(
        KnowledgeObject(
            id="obj-a",
            kind="entity",
            attrs={"name": "Alpha"},
            source_ids=["ext:1"],
        )
    )
    store.upsert_object(KnowledgeObject(id="obj-b", kind="entity", attrs={"name": "Beta"}))
    assert [o.id for o in store.list_objects()] == ["obj-a", "obj-b"]

    got = store.get_object("obj-a")
    assert got.attrs["name"] == "Alpha"
    assert got.version == 1
    assert got.source_ids == ["ext:1"]

    store.upsert_object(
        KnowledgeObject(id="obj-a", kind="entity", attrs={"name": "Alpha v2"}),
        bump_version=True,
    )
    assert store.get_object("obj-a").version == 2
    assert store.get_object("obj-a").attrs["name"] == "Alpha v2"

    disk = json.loads((tmp_path / "objects.json").read_text(encoding="utf-8"))
    assert len(disk["objects"]) == 2

    reloaded = KnowledgeObjectFileStore(tmp_path)
    assert reloaded.get_object("obj-a").version == 2
    assert reloaded.get_object("obj-a").attrs["name"] == "Alpha v2"


def test_get_missing_raises(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    with pytest.raises(KeyError):
        store.get_object("missing")


def test_list_filter_by_status(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    store.upsert_object(KnowledgeObject(id="d1", kind="entity"))
    store.upsert_object(KnowledgeObject(id="d2", kind="entity"))
    store.transition("d1", KnowledgeStatus.PENDING_REVIEW)
    store.transition("d1", KnowledgeStatus.PUBLISHED)
    published = store.list_objects(status=KnowledgeStatus.PUBLISHED)
    assert [o.id for o in published] == ["d1"]
    drafts = store.list_objects(status=KnowledgeStatus.DRAFT)
    assert [o.id for o in drafts] == ["d2"]


def test_transition_path(tmp_path: Path) -> None:
    store = KnowledgeObjectFileStore(tmp_path)
    store.upsert_object(KnowledgeObject(id="r1", kind="entity"))
    store.transition("r1", KnowledgeStatus.PENDING_REVIEW)
    published = store.transition("r1", KnowledgeStatus.PUBLISHED)
    assert published.status is KnowledgeStatus.PUBLISHED
    retired = store.transition("r1", KnowledgeStatus.RETIRED)
    assert retired.status is KnowledgeStatus.RETIRED

    store.upsert_object(KnowledgeObject(id="r2", kind="entity"))
    with pytest.raises(KnowledgeTransitionError):
        store.transition("r2", KnowledgeStatus.PUBLISHED)


def test_store_dir_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR", str(tmp_path))
    store = KnowledgeObjectFileStore()
    store.upsert_object(KnowledgeObject(id="env-1", kind="entity", attrs={"name": "From env"}))
    assert (tmp_path / "objects.json").is_file()
