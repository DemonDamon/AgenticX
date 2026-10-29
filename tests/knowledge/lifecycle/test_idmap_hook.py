"""Idmapping → knowledge object ingest hook."""

from __future__ import annotations

from pathlib import Path

from agenticx.data_suite.idmapping.engine import IdMappingEngine
from agenticx.data_suite.idmapping.profile import IdMapProfile, IdTypeDef
from agenticx.data_suite.idmapping.store import SnapshotStore
from agenticx.knowledge.lifecycle.idmap_hook import ingest_with_idmapping
from agenticx.knowledge.lifecycle.issues import IssueFileStore
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore


def _reject_engine() -> IdMappingEngine:
    profile = IdMapProfile(
        name="k2-test",
        id_types=[IdTypeDef("ext_id", 10), IdTypeDef("alt_id", 20)],
        priority=["ext_id", "alt_id"],
        on_conflict="prefer_priority",
    )
    return IdMappingEngine(profile, store=SnapshotStore())


def test_ingest_merges_shared_key(tmp_path: Path) -> None:
    eng = _reject_engine()
    store = KnowledgeObjectFileStore(tmp_path)
    result = ingest_with_idmapping(
        [
            {"ext_id": "E1", "alt_id": "A1", "name": "Alpha"},
            {"ext_id": "E1", "alt_id": None, "name": "Alpha-alias"},
        ],
        eng,
        store,
    )
    assert len(result.objects) == 1
    assert result.objects[0].attrs.get("name") == "Alpha"
    assert any(s.startswith("ext_id:") for s in result.objects[0].source_ids)
    assert store.get_object(result.objects[0].id).kind == "entity"


def test_conflict_findings_open_issues(tmp_path: Path) -> None:
    eng = _reject_engine()
    store = KnowledgeObjectFileStore(tmp_path)
    result = ingest_with_idmapping(
        [
            {"ext_id": "E1", "alt_id": "A1", "name": "One"},
            {"ext_id": "E1", "alt_id": "A2", "name": "Two"},
        ],
        eng,
        store,
    )
    assert result.findings
    assert all(f.code == "conflict" for f in result.findings)
    issues = IssueFileStore(tmp_path)
    opened = issues.open_from_findings(result.findings)
    assert opened
