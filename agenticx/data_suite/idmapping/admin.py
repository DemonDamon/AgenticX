"""ID-Mapping admin surface: profile CRUD, conflict queue, snapshot compare.

Main-repo admission: configurable ID types only; sample phones/emails/member_ids;
no customer ID schemas.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Union

from agenticx.data_suite.idmapping.engine import IdMappingEngine, MergeResult
from agenticx.data_suite.idmapping.profile import (
    IdMapProfile,
    IdMapProfileError,
    IdTypeDef,
    dump_profile,
    load_profile,
    load_profile_dict,
    profile_to_dict,
)
from agenticx.data_suite.idmapping.store import SnapshotStore

Decision = Literal["keep_value", "reject_merge"]
ConflictStatus = Literal["open", "resolved"]

SAMPLE_PROFILE_NAME = "demo_fake_ids"

SAMPLE_PROFILE_DICT: Dict[str, Any] = {
    "name": SAMPLE_PROFILE_NAME,
    "id_types": [
        {"name": "phone", "priority": 10},
        {"name": "email", "priority": 20},
    ],
    "merge": {
        "priority": ["email", "phone"],
        "on_conflict": "prefer_priority",
    },
}

# Desensitized fake rows for demos / e2e (not real PII).
SAMPLE_RECORDS: List[Dict[str, Any]] = [
    {"phone": "138****0001", "email": "alice***@example.com", "label": "a"},
    {"phone": "138****0001", "email": "alice.alt***@example.com", "label": "b"},
    {"phone": "139****0002", "email": "bob***@example.com", "label": "c"},
]


@dataclass
class ConflictRecord:
    id: str
    snapshot_id: str
    profile_name: str
    id_type: str
    values: List[Any]
    rows: List[int]
    status: ConflictStatus = "open"
    decision: Optional[Decision] = None
    chosen_value: Any = None
    note: Optional[str] = None
    resolved_at: Optional[str] = None


@dataclass
class SnapshotDiff:
    left_id: str
    right_id: str
    only_left_subject_ids: List[str] = field(default_factory=list)
    only_right_subject_ids: List[str] = field(default_factory=list)
    shared_subject_link_changes: List[Dict[str, Any]] = field(default_factory=list)
    left_conflicts: int = 0
    right_conflicts: int = 0


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _subjects(payload: Dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for row in payload.get("records") or []:
        sid = row.get("subject_id")
        if sid:
            out.add(str(sid))
    return out


def _links_by_subject(payload: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for link in payload.get("links") or []:
        sid = str(link.get("subject_id") or "")
        if not sid:
            continue
        grouped.setdefault(sid, []).append(
            {
                "id_type": link.get("id_type"),
                "id_value": link.get("id_value"),
            }
        )
    return grouped


def compare_snapshot_payloads(
    left_id: str,
    left: Dict[str, Any],
    right_id: str,
    right: Dict[str, Any],
) -> SnapshotDiff:
    left_subs = _subjects(left)
    right_subs = _subjects(right)
    left_links = _links_by_subject(left)
    right_links = _links_by_subject(right)
    changes: List[Dict[str, Any]] = []
    for sid in sorted(left_subs & right_subs):
        lset = {(x["id_type"], x["id_value"]) for x in left_links.get(sid, [])}
        rset = {(x["id_type"], x["id_value"]) for x in right_links.get(sid, [])}
        if lset != rset:
            changes.append(
                {
                    "subject_id": sid,
                    "only_left": [{"id_type": a, "id_value": b} for a, b in sorted(lset - rset)],
                    "only_right": [{"id_type": a, "id_value": b} for a, b in sorted(rset - lset)],
                }
            )
    return SnapshotDiff(
        left_id=left_id,
        right_id=right_id,
        only_left_subject_ids=sorted(left_subs - right_subs),
        only_right_subject_ids=sorted(right_subs - left_subs),
        shared_subject_link_changes=changes,
        left_conflicts=len(left.get("conflicts") or []),
        right_conflicts=len(right.get("conflicts") or []),
    )


class IdMappingAdminService:
    """File-backed admin ops for ID-Mapping profiles, conflicts, snapshots."""

    def __init__(self, root: Union[str, Path]) -> None:
        self.root = Path(root)
        self.profiles_dir = self.root / "idmapping" / "profiles"
        self.snapshots = SnapshotStore(root=self.root / "idmapping" / "snapshots")
        self.conflicts_path = self.root / "idmapping" / "conflicts.json"
        self.profiles_dir.mkdir(parents=True, exist_ok=True)
        (self.root / "idmapping" / "snapshots").mkdir(parents=True, exist_ok=True)

    def _load_conflicts(self) -> List[ConflictRecord]:
        if not self.conflicts_path.is_file():
            return []
        raw = json.loads(self.conflicts_path.read_text(encoding="utf-8")) or {}
        rows = raw.get("conflicts") or []
        out: List[ConflictRecord] = []
        for row in rows:
            out.append(
                ConflictRecord(
                    id=str(row["id"]),
                    snapshot_id=str(row.get("snapshot_id") or ""),
                    profile_name=str(row.get("profile_name") or ""),
                    id_type=str(row.get("id_type") or ""),
                    values=list(row.get("values") or []),
                    rows=list(row.get("rows") or []),
                    status=row.get("status") or "open",  # type: ignore[arg-type]
                    decision=row.get("decision"),
                    chosen_value=row.get("chosen_value"),
                    note=row.get("note"),
                    resolved_at=row.get("resolved_at"),
                )
            )
        return out

    def _save_conflicts(self, conflicts: List[ConflictRecord]) -> None:
        self.conflicts_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"conflicts": [asdict(c) for c in conflicts]}
        self.conflicts_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def ensure_sample_profile(self) -> IdMapProfile:
        existing = self.list_profiles()
        if SAMPLE_PROFILE_NAME in existing:
            return self.get_profile(SAMPLE_PROFILE_NAME)
        return self.save_profile(SAMPLE_PROFILE_DICT, fmt="yaml")

    def save_profile(
        self,
        profile: Union[IdMapProfile, Dict[str, Any]],
        *,
        fmt: str = "yaml",
    ) -> IdMapProfile:
        if isinstance(profile, dict):
            parsed = load_profile_dict(profile)
        else:
            parsed = profile
        if len(parsed.id_types) < 1:
            raise IdMapProfileError("id_types required")
        ext = "json" if fmt == "json" else "yaml"
        # remove alternate extension if present
        for other in ("yaml", "yml", "json"):
            alt = self.profiles_dir / f"{parsed.name}.{other}"
            if alt.exists() and other != ext:
                alt.unlink()
        path = self.profiles_dir / f"{parsed.name}.{ext}"
        dump_profile(parsed, path, fmt=ext)
        return parsed

    def list_profiles(self) -> List[str]:
        names: set[str] = set()
        for path in self.profiles_dir.glob("*"):
            if path.suffix.lower() in (".yaml", ".yml", ".json"):
                names.add(path.stem)
        return sorted(names)

    def get_profile(self, name: str) -> IdMapProfile:
        for ext in ("yaml", "yml", "json"):
            path = self.profiles_dir / f"{name}.{ext}"
            if path.is_file():
                return load_profile(path)
        raise KeyError(f"unknown profile: {name}")

    def get_profile_dict(self, name: str) -> Dict[str, Any]:
        return profile_to_dict(self.get_profile(name))

    def merge(
        self,
        profile_name: str,
        records: List[Dict[str, Any]],
        *,
        as_of: Optional[str] = None,
    ) -> MergeResult:
        profile = self.get_profile(profile_name)
        engine = IdMappingEngine(profile, store=self.snapshots)
        result = engine.merge(records, as_of=as_of)
        conflicts = self._load_conflicts()
        for c in result.conflicts:
            conflicts.append(
                ConflictRecord(
                    id=f"cfl_{uuid.uuid4().hex[:10]}",
                    snapshot_id=result.snapshot_id,
                    profile_name=profile_name,
                    id_type=str(c.get("id_type") or ""),
                    values=list(c.get("values") or []),
                    rows=list(c.get("rows") or []),
                    status="open",
                )
            )
        self._save_conflicts(conflicts)
        return result

    def list_conflicts(self, *, status: Optional[str] = None) -> List[ConflictRecord]:
        rows = self._load_conflicts()
        if status:
            return [c for c in rows if c.status == status]
        return rows

    def resolve_conflict(
        self,
        conflict_id: str,
        *,
        decision: str,
        chosen_value: Any = None,
        note: Optional[str] = None,
    ) -> ConflictRecord:
        if decision not in ("keep_value", "reject_merge"):
            raise ValueError("decision must be keep_value|reject_merge")
        conflicts = self._load_conflicts()
        found: Optional[ConflictRecord] = None
        for c in conflicts:
            if c.id == conflict_id:
                found = c
                break
        if found is None:
            raise KeyError(f"unknown conflict: {conflict_id}")
        if found.status == "resolved":
            return found
        if decision == "keep_value":
            if chosen_value is None:
                raise ValueError("chosen_value required for keep_value")
            if chosen_value not in found.values:
                raise ValueError("chosen_value must be one of conflict values")
        found.status = "resolved"
        found.decision = decision  # type: ignore[assignment]
        found.chosen_value = chosen_value if decision == "keep_value" else None
        found.note = note
        found.resolved_at = _utc_now()
        self._save_conflicts(conflicts)
        return found

    def list_snapshots(self) -> List[str]:
        return self.snapshots.list_ids()

    def load_snapshot(self, snapshot_id: str) -> Dict[str, Any]:
        return self.snapshots.load(snapshot_id)

    def compare_snapshots(self, left_id: str, right_id: str) -> SnapshotDiff:
        left = self.snapshots.load(left_id)
        right = self.snapshots.load(right_id)
        return compare_snapshot_payloads(left_id, left, right_id, right)


__all__ = [
    "ConflictRecord",
    "IdMappingAdminService",
    "SAMPLE_PROFILE_DICT",
    "SAMPLE_PROFILE_NAME",
    "SAMPLE_RECORDS",
    "SnapshotDiff",
    "compare_snapshot_payloads",
]
