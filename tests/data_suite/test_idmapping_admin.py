"""H7: ID-Mapping admin — two fake ID types, associate/merge, conflict adjudication."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from agenticx.data_suite.idmapping.admin import (
    SAMPLE_PROFILE_NAME,
    SAMPLE_RECORDS,
    IdMappingAdminService,
)
from agenticx.data_suite.idmapping.profile import load_profile, profile_to_dict


def test_profile_crud_yaml_and_json(tmp_path: Path):
    svc = IdMappingAdminService(tmp_path)
    profile = svc.save_profile(
        {
            "name": "fake_two",
            "id_types": [
                {"name": "phone", "priority": 10},
                {"name": "email", "priority": 20},
            ],
            "merge": {"priority": ["email", "phone"], "on_conflict": "prefer_priority"},
        },
        fmt="yaml",
    )
    assert [t.name for t in profile.id_types] == ["phone", "email"]
    assert "fake_two" in svc.list_profiles()
    loaded = svc.get_profile("fake_two")
    assert profile_to_dict(loaded)["merge"]["priority"] == ["email", "phone"]

    # JSON round-trip
    svc.save_profile(profile_to_dict(loaded), fmt="json")
    assert (tmp_path / "idmapping" / "profiles" / "fake_two.json").is_file()
    again = load_profile(tmp_path / "idmapping" / "profiles" / "fake_two.json")
    assert again.name == "fake_two"
    assert len(again.id_types) == 2


def test_merge_associate_and_conflict_adjudication(tmp_path: Path):
    svc = IdMappingAdminService(tmp_path)
    svc.ensure_sample_profile()
    assert SAMPLE_PROFILE_NAME in svc.list_profiles()

    # Two fake ID types (phone + email); shared phone + conflicting emails → conflict
    result = svc.merge(SAMPLE_PROFILE_NAME, SAMPLE_RECORDS)
    assert result.snapshot_id
    assert result.conflicts, "expected email conflict on shared phone"
    assert any(c.get("id_type") == "email" for c in result.conflicts)

    # Associated: rows sharing phone land under one subject (prefer_priority still merges)
    phone_rows = [r for r in result.records if r.get("phone") == "138****0001"]
    assert len(phone_rows) == 2
    assert len({r["subject_id"] for r in phone_rows}) == 1

    open_conflicts = svc.list_conflicts(status="open")
    assert len(open_conflicts) >= 1
    cfl = open_conflicts[0]
    chosen = cfl.values[0]
    resolved = svc.resolve_conflict(
        cfl.id,
        decision="keep_value",
        chosen_value=chosen,
        note="人工选择主邮箱",
    )
    assert resolved.status == "resolved"
    assert resolved.decision == "keep_value"
    assert resolved.chosen_value == chosen
    assert resolved.resolved_at

    still_open = svc.list_conflicts(status="open")
    assert all(c.id != cfl.id for c in still_open)

    # reject_merge path on a second merge batch
    result2 = svc.merge(
        SAMPLE_PROFILE_NAME,
        [
            {"phone": "137****0099", "email": "x1***@example.com"},
            {"phone": "137****0099", "email": "x2***@example.com"},
        ],
    )
    assert result2.conflicts
    open2 = [c for c in svc.list_conflicts(status="open") if c.snapshot_id == result2.snapshot_id]
    assert open2
    rejected = svc.resolve_conflict(open2[0].id, decision="reject_merge", note="放弃合并")
    assert rejected.status == "resolved"
    assert rejected.decision == "reject_merge"
    assert rejected.chosen_value is None


def test_snapshot_compare(tmp_path: Path):
    svc = IdMappingAdminService(tmp_path)
    svc.ensure_sample_profile()
    a = svc.merge(
        SAMPLE_PROFILE_NAME,
        [{"phone": "130****0001", "email": "one***@example.com"}],
    )
    b = svc.merge(
        SAMPLE_PROFILE_NAME,
        [
            {"phone": "130****0001", "email": "one***@example.com"},
            {"phone": "131****0002", "email": "two***@example.com"},
        ],
    )
    assert a.snapshot_id != b.snapshot_id
    ids = svc.list_snapshots()
    assert a.snapshot_id in ids and b.snapshot_id in ids

    diff = svc.compare_snapshots(a.snapshot_id, b.snapshot_id)
    assert diff.left_id == a.snapshot_id
    assert diff.right_id == b.snapshot_id
    assert diff.only_right_subject_ids or diff.shared_subject_link_changes is not None
    # right has an extra subject (second phone)
    assert len(diff.only_right_subject_ids) >= 1


def test_sample_profile_yaml_on_disk(tmp_path: Path):
    svc = IdMappingAdminService(tmp_path)
    svc.ensure_sample_profile()
    path = tmp_path / "idmapping" / "profiles" / f"{SAMPLE_PROFILE_NAME}.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert data["name"] == SAMPLE_PROFILE_NAME
    assert len(data["id_types"]) == 2
    names = {t["name"] for t in data["id_types"]}
    assert names == {"phone", "email"}
