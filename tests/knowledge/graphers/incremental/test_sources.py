"""K3-1: source fingerprint + change detection."""

from __future__ import annotations

from pathlib import Path

from agenticx.knowledge.graphers.incremental.sources import (
    ChangeSet,
    SourceChangeTracker,
    SourceDocument,
    content_hash,
)


def test_content_hash_stable() -> None:
    assert content_hash("hello") == content_hash("hello")
    assert content_hash("hello") != content_hash("hello!")


def test_source_document_auto_hash() -> None:
    doc = SourceDocument(id="s1", content="alpha")
    assert doc.content_hash == content_hash("alpha")


def test_empty_tracker_all_added(tmp_path: Path) -> None:
    tracker = SourceChangeTracker(tmp_path)
    docs = [
        SourceDocument(id="a", content="one"),
        SourceDocument(id="b", content="two"),
    ]
    change = tracker.diff(docs)
    assert change.added == ["a", "b"]
    assert change.changed == []
    assert change.removed == []
    assert change.unchanged == []
    assert change.needs_extract == ["a", "b"]


def test_commit_detects_changed_removed_unchanged(tmp_path: Path) -> None:
    tracker = SourceChangeTracker(tmp_path)
    tracker.commit(
        [
            SourceDocument(id="a", content="one"),
            SourceDocument(id="b", content="two"),
        ]
    )
    change = tracker.commit(
        [
            SourceDocument(id="a", content="one"),  # unchanged
            SourceDocument(id="b", content="TWO"),  # changed
            SourceDocument(id="c", content="three"),  # added
            # d removed (was never there); remove a? keep a
        ]
    )
    # removed: nothing from prior missing — wait, prior had a,b; current a,b,c → no removed
    assert change.unchanged == ["a"]
    assert change.changed == ["b"]
    assert change.added == ["c"]
    assert change.removed == []

    change2 = tracker.commit([SourceDocument(id="c", content="three")])
    assert sorted(change2.removed) == ["a", "b"]
    assert change2.unchanged == ["c"]


def test_persist_reload(tmp_path: Path) -> None:
    t1 = SourceChangeTracker(tmp_path)
    t1.commit([SourceDocument(id="x", content="payload")])
    t2 = SourceChangeTracker(tmp_path)
    assert t2.snapshot() == {"x": content_hash("payload")}
    change = t2.diff([SourceDocument(id="x", content="payload")])
    assert change.unchanged == ["x"]
