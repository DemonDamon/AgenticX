"""Source → knowledge-object index and affected-set resolution."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Union

from agenticx.knowledge.graphers.incremental.sources import ChangeSet, resolve_incremental_store_dir


@dataclass
class AffectedSet:
    source_ids: List[str] = field(default_factory=list)
    object_ids: List[str] = field(default_factory=list)
    retire_candidates: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "source_ids": list(self.source_ids),
            "object_ids": list(self.object_ids),
            "retire_candidates": list(self.retire_candidates),
        }


class SourceObjectIndex:
    """Bidirectional map between source documents and knowledge object ids."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_incremental_store_dir(root)
        self._path = self.root / "source_index.json"
        self._forward: Dict[str, Set[str]] = {}
        self._reverse: Dict[str, Set[str]] = {}
        self._load()

    def _load(self) -> None:
        self._forward.clear()
        self._reverse.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        links = raw.get("links") or {}
        for sid, oids in links.items():
            for oid in oids or []:
                self.link(str(sid), str(oid), persist=False)
        # loaded without persist; ensure reverse consistent

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "links": {
                sid: sorted(oids) for sid, oids in sorted(self._forward.items()) if oids
            }
        }
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def link(self, source_id: str, object_id: str, *, persist: bool = True) -> None:
        sid = str(source_id or "").strip()
        oid = str(object_id or "").strip()
        if not sid or not oid:
            raise ValueError("source_id and object_id are required")
        self._forward.setdefault(sid, set()).add(oid)
        self._reverse.setdefault(oid, set()).add(sid)
        if persist:
            self._persist()

    def unlink(self, source_id: str, object_id: str) -> None:
        sid = str(source_id)
        oid = str(object_id)
        if sid in self._forward:
            self._forward[sid].discard(oid)
            if not self._forward[sid]:
                del self._forward[sid]
        if oid in self._reverse:
            self._reverse[oid].discard(sid)
            if not self._reverse[oid]:
                del self._reverse[oid]
        self._persist()

    def replace_links(self, source_id: str, object_ids: List[str]) -> None:
        sid = str(source_id or "").strip()
        if not sid:
            raise ValueError("source_id is required")
        old = set(self._forward.get(sid, set()))
        new = {str(x).strip() for x in (object_ids or []) if str(x).strip()}
        for oid in old - new:
            self.unlink(sid, oid)
        for oid in new - old:
            self.link(sid, oid, persist=False)
        # ensure forward exact
        if new:
            self._forward[sid] = set(new)
            for oid in new:
                self._reverse.setdefault(oid, set()).add(sid)
        elif sid in self._forward:
            del self._forward[sid]
        self._persist()

    def objects_for(self, source_id: str) -> List[str]:
        return sorted(self._forward.get(str(source_id), set()))

    def sources_for(self, object_id: str) -> List[str]:
        return sorted(self._reverse.get(str(object_id), set()))

    def drop_source(self, source_id: str) -> List[str]:
        """Remove all links for a source; return orphaned object ids (no remaining sources)."""
        sid = str(source_id)
        oids = list(self._forward.get(sid, set()))
        orphans: List[str] = []
        for oid in oids:
            self.unlink(sid, oid)
            if not self.sources_for(oid):
                orphans.append(oid)
        return sorted(orphans)

    def resolve_affected(self, change: ChangeSet) -> AffectedSet:
        if not isinstance(change, ChangeSet):
            raise TypeError("change must be a ChangeSet")
        source_ids = list(change.needs_extract)
        object_ids: Set[str] = set()
        for sid in source_ids:
            object_ids.update(self.objects_for(sid))
        for sid in change.removed:
            object_ids.update(self.objects_for(sid))
        retire: Set[str] = set()
        # Objects that would have zero sources if removed sources were dropped
        for sid in change.removed:
            for oid in self.objects_for(sid):
                remaining = set(self.sources_for(oid)) - set(change.removed)
                if not remaining:
                    retire.add(oid)
        return AffectedSet(
            source_ids=source_ids,
            object_ids=sorted(object_ids),
            retire_candidates=sorted(retire),
        )
