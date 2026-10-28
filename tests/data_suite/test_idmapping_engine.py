from pathlib import Path

from agenticx.data_suite.idmapping.engine import IdMappingEngine
from agenticx.data_suite.idmapping.profile import load_profile
from agenticx.data_suite.idmapping.store import SnapshotStore

PROFILE = Path(__file__).parent / "fixtures" / "idmap_profile.yaml"


def test_load_profile_types_and_priority():
    p = load_profile(PROFILE)
    assert [t.name for t in p.id_types] == ["phone", "crm_id"]
    assert p.priority == ["crm_id", "phone"]
    assert p.on_conflict == "prefer_priority"


def test_shared_phone_same_subject():
    eng = IdMappingEngine.from_yaml(PROFILE)
    result = eng.merge([
        {"phone": "100", "crm_id": "c1", "name": "a"},
        {"phone": "100", "crm_id": None, "name": "b"},
    ])
    assert len({r["subject_id"] for r in result.records}) == 1
    assert result.snapshot_id
    assert all(r["subject_id"].startswith("crm_id:") for r in result.records)


def test_conflict_prefer_priority():
    eng = IdMappingEngine.from_yaml(PROFILE)
    # same phone ties rows; conflicting crm_ids → conflict logged, still merges
    result = eng.merge([
        {"phone": "100", "crm_id": "c1"},
        {"phone": "100", "crm_id": "c2"},
    ])
    assert result.conflicts
    assert len(result.records) == 2
    assert len({r["subject_id"] for r in result.records}) == 1


def test_conflict_reject():
    # build reject profile inline
    store = SnapshotStore()
    from agenticx.data_suite.idmapping.profile import IdMapProfile, IdTypeDef
    profile = IdMapProfile(
        name="rej",
        id_types=[IdTypeDef("phone", 10), IdTypeDef("crm_id", 20)],
        priority=["crm_id", "phone"],
        on_conflict="reject",
    )
    eng = IdMappingEngine(profile, store=store)
    result = eng.merge([
        {"phone": "100", "crm_id": "c1"},
        {"phone": "100", "crm_id": "c2"},
    ])
    assert result.conflicts
    assert result.records == []


def test_snapshot_replay():
    eng = IdMappingEngine.from_yaml(PROFILE)
    first = eng.merge([{"phone": "9", "crm_id": "x"}])
    second = eng.replay(first.snapshot_id)
    assert second.records == first.records
    assert second.links == first.links
