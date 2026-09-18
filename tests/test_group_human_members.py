#!/usr/bin/env python3
"""Group room human member roster.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from agenticx.avatar.group_chat import GroupChatRegistry
from agenticx.avatar.group_members import (
    make_human_member_id,
    normalize_human_member,
    parse_human_member_id,
)
from agenticx.studio.server import create_studio_app


def test_make_human_member_id_feishu() -> None:
    assert make_human_member_id("feishu", "ou_1") == "human:feishu:ou_1"


def test_make_human_member_id_platform_case_insensitive() -> None:
    assert make_human_member_id("Feishu", "ou_1") == "human:feishu:ou_1"


@pytest.mark.parametrize(
    "platform,external_id",
    [
        ("slack", "u1"),
        ("feishu", ""),
        ("feishu", "ou:1"),
        ("feishu", "ou/1"),
    ],
)
def test_make_human_member_id_rejects_invalid(platform: str, external_id: str) -> None:
    with pytest.raises(ValueError):
        make_human_member_id(platform, external_id)


def test_parse_human_member_id() -> None:
    assert parse_human_member_id("human:wechat:wx_9") == ("wechat", "wx_9")


def test_normalize_generates_id_when_missing() -> None:
    member = normalize_human_member(
        {"platform": "wecom", "external_id": "u2", "display_name": "乙"},
        avatar_ids=[],
    )
    assert member["id"] == "human:wecom:u2"
    assert member["display_name"] == "乙"


def test_normalize_rejects_avatar_id_collision() -> None:
    with pytest.raises(ValueError, match="collides"):
        normalize_human_member(
            {"id": "human:feishu:ou_1"},
            avatar_ids=["human:feishu:ou_1"],
        )


def test_normalize_rejects_non_human_id() -> None:
    with pytest.raises(ValueError, match="invalid human member id"):
        normalize_human_member({"id": "abc"}, avatar_ids=["abc"])


def test_create_group_persists_empty_human_members(tmp_path: Path) -> None:
    registry = GroupChatRegistry(root=tmp_path / "groups")
    group = registry.create_group(name="花名册", avatar_ids=["abc"])
    assert group.human_members == []
    raw = yaml.safe_load((tmp_path / "groups" / group.id / "group.yaml").read_text(encoding="utf-8"))
    assert raw["human_members"] == []


def test_add_human_member_dedupes_and_updates_name(tmp_path: Path) -> None:
    registry = GroupChatRegistry(root=tmp_path / "groups")
    group = registry.create_group(name="花名册", avatar_ids=["abc"])
    first = registry.add_human_member(
        group.id,
        {"platform": "feishu", "external_id": "ou_1", "display_name": "甲"},
    )
    assert first is not None
    assert len(first.human_members) == 1
    second = registry.add_human_member(
        group.id,
        {"platform": "feishu", "external_id": "ou_1", "display_name": "甲改名"},
    )
    assert second is not None
    assert len(second.human_members) == 1
    assert second.human_members[0]["display_name"] == "甲改名"
    assert second.human_members[0]["id"] == "human:feishu:ou_1"


def test_add_human_member_rejects_avatar_collision(tmp_path: Path) -> None:
    registry = GroupChatRegistry(root=tmp_path / "groups")
    group = registry.create_group(name="花名册", avatar_ids=["human:feishu:ou_1"])
    with pytest.raises(ValueError, match="collides"):
        registry.add_human_member(group.id, {"id": "human:feishu:ou_1"})


def test_add_human_member_missing_group(tmp_path: Path) -> None:
    registry = GroupChatRegistry(root=tmp_path / "groups")
    assert registry.add_human_member("missing", {"platform": "feishu", "external_id": "ou_1"}) is None


def _client_and_group() -> tuple[TestClient, str]:
    app = create_studio_app()
    client = TestClient(app)
    avatar = app.state.avatar_registry.create_avatar(name="测试成员", role="Engineer")
    group = app.state.group_registry.create_group(
        name="测试群",
        avatar_ids=[avatar.id],
        routing="intelligent",
    )
    return client, group.id


def test_human_members_api_unknown_group_404() -> None:
    client, _ = _client_and_group()
    resp = client.post(
        "/api/groups/does-not-exist/human-members",
        json={"platform": "feishu", "external_id": "ou_1", "display_name": "甲"},
    )
    assert resp.status_code == 404


def test_human_members_api_create_and_list() -> None:
    client, gid = _client_and_group()
    created = client.post(
        f"/api/groups/{gid}/human-members",
        json={"platform": "feishu", "external_id": "ou_1", "display_name": "甲"},
    )
    assert created.status_code == 200
    members = created.json()["group"]["human_members"]
    assert len(members) == 1
    assert members[0]["id"] == "human:feishu:ou_1"
    listed = client.get("/api/groups")
    assert listed.status_code == 200
    row = next(g for g in listed.json()["groups"] if g["id"] == gid)
    assert row["human_members"][0]["id"] == "human:feishu:ou_1"


def test_human_members_api_invalid_payload_400() -> None:
    client, gid = _client_and_group()
    resp = client.post(
        f"/api/groups/{gid}/human-members",
        json={"platform": "feishu", "external_id": ""},
    )
    assert resp.status_code == 400
