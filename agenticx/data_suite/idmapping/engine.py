from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import uuid

from agenticx.data_suite.idmapping.profile import IdMapProfile, load_profile
from agenticx.data_suite.idmapping.store import SnapshotStore


@dataclass
class MergeResult:
    records: List[Dict[str, Any]]
    links: List[Dict[str, Any]]
    snapshot_id: str
    conflicts: List[Dict[str, Any]] = field(default_factory=list)


class IdMappingEngine:
    """Configurable ID association + merge with conflict policy and snapshot replay."""

    def __init__(self, profile: IdMapProfile, *, store: Optional[SnapshotStore] = None) -> None:
        self.profile = profile
        self.store = store or SnapshotStore()

    @classmethod
    def from_yaml(cls, path: Union[str, Path], *, store: Optional[SnapshotStore] = None) -> "IdMappingEngine":
        return cls(load_profile(path), store=store)

    def map_records(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Adapter for DataFlow transform node (IdMapLike)."""
        return self.merge(records).records

    def merge(self, records: List[Dict[str, Any]], *, as_of: Optional[str] = None) -> MergeResult:
        # Union-find over shared id-type values
        parent: Dict[str, str] = {}

        def find(x: str) -> str:
            while parent.get(x, x) != x:
                parent[x] = parent.get(parent[x], parent[x])
                x = parent[x]
            parent.setdefault(x, x)
            return x

        def union(a: str, b: str) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        type_names = [t.name for t in self.profile.id_types]
        # provisional subject per input row
        row_subjects: List[str] = []
        for i, rec in enumerate(records):
            sid = f"row-{i}"
            parent[sid] = sid
            row_subjects.append(sid)
            for t in type_names:
                val = rec.get(t)
                if val is None or val == "":
                    continue
                key = f"{t}:{val}"
                parent.setdefault(key, key)
                union(sid, key)

        # group rows by root
        groups: Dict[str, List[int]] = {}
        for i, sid in enumerate(row_subjects):
            root = find(sid)
            groups.setdefault(root, []).append(i)

        out_records: List[Dict[str, Any]] = []
        links: List[Dict[str, Any]] = []
        conflicts: List[Dict[str, Any]] = []

        for root, idxs in groups.items():
            # collect values per id type
            by_type: Dict[str, List[Any]] = {t: [] for t in type_names}
            for i in idxs:
                for t in type_names:
                    v = records[i].get(t)
                    if v is not None and v != "" and v not in by_type[t]:
                        by_type[t].append(v)

            # conflict detection: multiple distinct values for same type in one subject
            skip_group = False
            for t, vals in by_type.items():
                if len(vals) > 1:
                    conflicts.append({"id_type": t, "values": list(vals), "rows": idxs})
                    if self.profile.on_conflict == "reject":
                        skip_group = True
            if skip_group:
                continue

            # pick subject_id from highest-priority type that has a value
            subject_id = None
            for t in self.profile.priority:
                if by_type.get(t):
                    # prefer_priority: first in priority list wins when choosing canonical
                    subject_id = f"{t}:{by_type[t][0]}"
                    break
            if subject_id is None:
                subject_id = f"anon:{uuid.uuid4().hex[:8]}"

            for i in idxs:
                row = dict(records[i])
                row["subject_id"] = subject_id
                # prefer_priority: when multiple values for a type, keep the one from
                # the row that carries the higher-priority id already chosen
                out_records.append(row)
                for t in type_names:
                    v = row.get(t)
                    if v is not None and v != "":
                        links.append({
                            "subject_id": subject_id,
                            "id_type": t,
                            "id_value": v,
                        })

        snapshot_id = self.store.save({
            "as_of": as_of,
            "profile": self.profile.name,
            "records": out_records,
            "links": links,
            "conflicts": conflicts,
        })
        return MergeResult(
            records=out_records,
            links=links,
            snapshot_id=snapshot_id,
            conflicts=conflicts,
        )

    def replay(self, snapshot_id: str) -> MergeResult:
        data = self.store.load(snapshot_id)
        return MergeResult(
            records=list(data.get("records") or []),
            links=list(data.get("links") or []),
            snapshot_id=snapshot_id,
            conflicts=list(data.get("conflicts") or []),
        )
