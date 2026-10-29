"""K3-2: source-object index + affected resolution."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.index import SourceObjectIndex
from agenticx.knowledge.graphers.incremental.sources import ChangeSet


def test_link_and_query(tmp_path: Path) -> None:
    idx = SourceObjectIndex(tmp_path)
    idx.link("src-a", "obj-1")
    idx.link("src-a", "obj-2")
    idx.link("src-b", "obj-2")
    assert idx.objects_for("src-a") == ["obj-1", "obj-2"]
    assert idx.sources_for("obj-2") == ["src-a", "src-b"]


def test_replace_links(tmp_path: Path) -> None:
    idx = SourceObjectIndex(tmp_path)
    idx.replace_links("src-a", ["obj-1", "obj-2"])
    idx.replace_links("src-a", ["obj-3"])
    assert idx.objects_for("src-a") == ["obj-3"]
    assert idx.sources_for("obj-1") == []
    assert idx.sources_for("obj-3") == ["src-a"]


def test_resolve_affected_changed_and_retire(tmp_path: Path) -> None:
    idx = SourceObjectIndex(tmp_path)
    idx.link("src-a", "obj-1")
    idx.link("src-b", "obj-2")
    idx.link("src-b", "obj-shared")
    idx.link("src-c", "obj-shared")

    change = ChangeSet(added=["src-d"], changed=["src-a"], removed=["src-b"], unchanged=["src-c"])
    affected = idx.resolve_affected(change)
    assert affected.source_ids == ["src-d", "src-a"]
    assert "obj-1" in affected.object_ids
    assert "obj-2" in affected.object_ids
    assert "obj-shared" in affected.object_ids
    # obj-2 only linked to src-b → retire candidate; obj-shared still has src-c
    assert "obj-2" in affected.retire_candidates
    assert "obj-shared" not in affected.retire_candidates


def test_persist_reload(tmp_path: Path) -> None:
    idx = SourceObjectIndex(tmp_path)
    idx.link("s", "o")
    idx2 = SourceObjectIndex(tmp_path)
    assert idx2.objects_for("s") == ["o"]
