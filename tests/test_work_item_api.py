#!/usr/bin/env python3
"""Studio REST for group work items.

Author: Damon Li
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from agenticx.runtime.work_items import get_work_item_store
from agenticx.studio.server import create_studio_app


def _client_and_group() -> tuple[TestClient, str, str]:
    app = create_studio_app()
    client = TestClient(app)
    avatar = app.state.avatar_registry.create_avatar(name="测试成员", role="Engineer")
    group = app.state.group_registry.create_group(
        name="测试群",
        avatar_ids=[avatar.id],
        routing="intelligent",
    )
    return client, group.id, avatar.id


def test_unknown_group_404() -> None:
    client, _, _ = _client_and_group()
    resp = client.get("/api/groups/does-not-exist/work-items")
    assert resp.status_code == 404


def test_create_and_list_one_item() -> None:
    client, gid, _ = _client_and_group()
    created = client.post(
        f"/api/groups/{gid}/work-items",
        json={"title": "方案第一节", "definition_of_done": "可演示"},
    )
    assert created.status_code == 200
    item = created.json()["item"]
    assert item["title"] == "方案第一节"
    assert item["status"] == "open"
    listed = client.get(f"/api/groups/{gid}/work-items")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    assert listed.json()["items"][0]["id"] == item["id"]


def test_avatar_owner_must_be_member() -> None:
    client, gid, _ = _client_and_group()
    resp = client.post(
        f"/api/groups/{gid}/work-items",
        json={"title": "外人", "owner_kind": "avatar", "owner_id": "not-a-member"},
    )
    assert resp.status_code == 400


def test_patch_stale_version_409() -> None:
    client, gid, _ = _client_and_group()
    item = client.post(
        f"/api/groups/{gid}/work-items",
        json={"title": "v1"},
    ).json()["item"]
    ok = client.patch(
        f"/api/groups/{gid}/work-items/{item['id']}",
        json={"expected_version": item["version"], "title": "v2"},
    )
    assert ok.status_code == 200
    stale = client.patch(
        f"/api/groups/{gid}/work-items/{item['id']}",
        json={"expected_version": item["version"], "title": "stale"},
    )
    assert stale.status_code == 409


def test_patch_status_rejected() -> None:
    client, gid, _ = _client_and_group()
    item = client.post(
        f"/api/groups/{gid}/work-items",
        json={"title": "不可 PATCH 状态"},
    ).json()["item"]
    resp = client.patch(
        f"/api/groups/{gid}/work-items/{item['id']}",
        json={"expected_version": item["version"], "status": "accepted"},
    )
    assert resp.status_code == 400


def test_accept_pause_resume_via_dedicated_posts() -> None:
    client, gid, _ = _client_and_group()
    item = client.post(
        f"/api/groups/{gid}/work-items",
        json={"title": "验收链路"},
    ).json()["item"]
    store = get_work_item_store()
    progressing = store.mark_in_progress(gid, item["id"], expected_version=item["version"])
    submitted = store.submit(gid, item["id"], expected_version=progressing.version)
    accepted = client.post(
        f"/api/groups/{gid}/work-items/{item['id']}/accept",
        json={"expected_version": submitted.version},
    )
    assert accepted.status_code == 200
    assert accepted.json()["item"]["status"] == "accepted"

    other = client.post(
        f"/api/groups/{gid}/work-items",
        json={"title": "可暂停"},
    ).json()["item"]
    other_ip = store.mark_in_progress(gid, other["id"], expected_version=other["version"])
    paused = client.post(
        f"/api/groups/{gid}/work-items/{other['id']}/pause",
        json={"expected_version": other_ip.version},
    )
    assert paused.status_code == 200
    assert paused.json()["item"]["status"] == "paused"
    resumed = client.post(
        f"/api/groups/{gid}/work-items/{other['id']}/resume",
        json={"expected_version": paused.json()["item"]["version"]},
    )
    assert resumed.status_code == 200
    assert resumed.json()["item"]["status"] == "in_progress"
