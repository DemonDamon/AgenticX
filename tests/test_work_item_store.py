#!/usr/bin/env python3
"""WorkItemStore persistence and state machine.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

import agenticx.runtime.work_items as work_items
from agenticx.runtime.work_items import WorkItemError, WorkItemStore


@pytest.fixture()
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> WorkItemStore:
    root = tmp_path / "groups"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(work_items, "_groups_root", lambda: root)
    return WorkItemStore()


def test_create_and_list_isolated_by_group(store: WorkItemStore, tmp_path: Path) -> None:
    a = store.create_item("g1", title="方案第一节")
    store.create_item("g2", title="别的群事项")
    g1 = store.list_items("g1")
    g2 = store.list_items("g2")
    assert [i.id for i in g1] == [a.id]
    assert g1[0].title == "方案第一节"
    assert len(g2) == 1
    assert g2[0].id != a.id
    assert work_items.work_items_path("g1") == tmp_path / "groups" / "g1" / "work_items.json"
    assert (tmp_path / "groups" / "g1" / "work_items.json").is_file()


def test_illegal_transition_rejected(store: WorkItemStore) -> None:
    item = store.create_item("g-illegal", title="终态")
    item = store.mark_in_progress("g-illegal", item.id, expected_version=item.version)
    item = store.submit("g-illegal", item.id, expected_version=item.version)
    item = store.accept("g-illegal", item.id, expected_version=item.version)
    assert item.status == "accepted"
    with pytest.raises(WorkItemError) as exc:
        store.mark_in_progress("g-illegal", item.id, expected_version=item.version)
    assert exc.value.status_code == 400
    assert "illegal transition" in str(exc.value)


def test_expected_version_conflict(store: WorkItemStore) -> None:
    item = store.create_item("g-ver", title="v1")
    assert item.version == 1
    updated = store.patch_item("g-ver", item.id, expected_version=1, title="v2")
    assert updated.version == 2
    assert updated.title == "v2"
    with pytest.raises(WorkItemError) as exc:
        store.patch_item("g-ver", item.id, expected_version=1, title="stale")
    assert exc.value.status_code == 409


def test_accept_only_from_human_action(store: WorkItemStore) -> None:
    item = store.create_item("g-acc", title="待验收")
    item = store.mark_in_progress("g-acc", item.id, expected_version=item.version)
    item = store.submit("g-acc", item.id, expected_version=item.version)
    accepted = store.accept("g-acc", item.id, expected_version=item.version)
    assert accepted.status == "accepted"
    assert hasattr(store, "accept")
    assert not hasattr(work_items, "auto_accept")


def test_pause_and_resume_restore_prior_status(store: WorkItemStore) -> None:
    item = store.create_item("g-pause", title="进行中暂停")
    item = store.mark_in_progress("g-pause", item.id, expected_version=item.version)
    paused = store.pause("g-pause", item.id, expected_version=item.version)
    assert paused.status == "paused"
    assert paused.resume_status == "in_progress"
    resumed = store.resume("g-pause", paused.id, expected_version=paused.version)
    assert resumed.status == "in_progress"


def test_blocked_by_not_ready_until_accepted(store: WorkItemStore) -> None:
    blocker = store.create_item("g-blk", title="前置")
    child = store.create_item(
        "g-blk",
        title="后续",
        blocked_by=[blocker.id],
        owner_kind="avatar",
        owner_id="wen",
    )
    assert store.blockers_accepted("g-blk", child) is False
    assert store.dispatch_blocked_reason("g-blk", "wen") == "blocked_by_unaccepted"
    blocker = store.mark_in_progress("g-blk", blocker.id, expected_version=blocker.version)
    blocker = store.submit("g-blk", blocker.id, expected_version=blocker.version)
    blocker = store.accept("g-blk", blocker.id, expected_version=blocker.version)
    child = store.get_item("g-blk", child.id)
    assert child is not None
    assert store.blockers_accepted("g-blk", child) is True
    assert store.dispatch_blocked_reason("g-blk", "wen") == ""
