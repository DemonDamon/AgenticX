"""Incremental graph sync orchestrator: fingerprint → extract → review → publish."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.knowledge.graphers.incremental.extract import Extractor, apply_extraction
from agenticx.knowledge.graphers.incremental.index import SourceObjectIndex
from agenticx.knowledge.graphers.incremental.publish import (
    merge_published_into_graph,
    publish_objects,
    publish_to_store,
    retire_from_store,
    submit_for_review,
)
from agenticx.knowledge.graphers.incremental.sources import (
    SourceChangeTracker,
    SourceDocument,
    resolve_incremental_store_dir,
)
from agenticx.knowledge.graphers.models import KnowledgeGraph
from agenticx.knowledge.lifecycle.model import KnowledgeStatus, utc_now_iso
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.knowledge.lifecycle.trail import ChangeTrailStore


@dataclass
class SyncReport:
    run_id: str
    added: List[str] = field(default_factory=list)
    changed: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    unchanged: List[str] = field(default_factory=list)
    extracted_source_ids: List[str] = field(default_factory=list)
    touched_object_ids: List[str] = field(default_factory=list)
    published_object_ids: List[str] = field(default_factory=list)
    retired_object_ids: List[str] = field(default_factory=list)
    graph_stats: Dict[str, Any] = field(default_factory=dict)
    at: str = ""

    def __post_init__(self) -> None:
        if not self.run_id:
            self.run_id = str(uuid.uuid4())
        if not self.at:
            self.at = utc_now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "added": list(self.added),
            "changed": list(self.changed),
            "removed": list(self.removed),
            "unchanged": list(self.unchanged),
            "extracted_source_ids": list(self.extracted_source_ids),
            "touched_object_ids": list(self.touched_object_ids),
            "published_object_ids": list(self.published_object_ids),
            "retired_object_ids": list(self.retired_object_ids),
            "graph_stats": dict(self.graph_stats),
            "at": self.at,
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "SyncReport":
        return cls(
            run_id=str(raw.get("run_id") or ""),
            added=list(raw.get("added") or []),
            changed=list(raw.get("changed") or []),
            removed=list(raw.get("removed") or []),
            unchanged=list(raw.get("unchanged") or []),
            extracted_source_ids=list(raw.get("extracted_source_ids") or []),
            touched_object_ids=list(raw.get("touched_object_ids") or []),
            published_object_ids=list(raw.get("published_object_ids") or []),
            retired_object_ids=list(raw.get("retired_object_ids") or []),
            graph_stats=dict(raw.get("graph_stats") or {}),
            at=str(raw.get("at") or ""),
        )


class SyncRunStore:
    """Append-only sync_runs.json under the incremental store root."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_incremental_store_dir(root)
        self._path = self.root / "sync_runs.json"
        self._runs: List[SyncReport] = []
        self._load()

    def _load(self) -> None:
        self._runs.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("runs") or []:
            self._runs.append(SyncReport.from_dict(row))

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"runs": [r.to_dict() for r in self._runs]}
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def append(self, report: SyncReport) -> SyncReport:
        stored = SyncReport.from_dict(report.to_dict())
        self._runs.append(stored)
        self._persist()
        return stored

    def list_runs(self) -> List[SyncReport]:
        return list(self._runs)


class IncrementalGraphSync:
    """Orchestrate fingerprint → affected → extract → optional publish → graph merge."""

    def __init__(
        self,
        root: Optional[Union[str, Path]] = None,
        *,
        extractor: Extractor,
        object_store: Optional[KnowledgeObjectFileStore] = None,
        trail: Optional[ChangeTrailStore] = None,
        graph: Optional[KnowledgeGraph] = None,
        graph_store: Optional[Any] = None,
        actor: str = "sync",
        auto_publish: bool = False,
        mirror_knowledge_graph: bool = True,
    ) -> None:
        self.root = resolve_incremental_store_dir(root)
        self.extractor = extractor
        self.actor = str(actor or "sync")
        self.auto_publish = bool(auto_publish)
        self.tracker = SourceChangeTracker(self.root)
        self.index = SourceObjectIndex(self.root)
        self.runs = SyncRunStore(self.root)
        self.trail = trail if trail is not None else ChangeTrailStore(self.root)
        self.object_store = (
            object_store
            if object_store is not None
            else KnowledgeObjectFileStore(self.root, trail=self.trail, actor=self.actor)
        )
        self.graph = graph if graph is not None else KnowledgeGraph(name="incremental")
        self.graph_store = graph_store
        self.mirror_knowledge_graph = bool(mirror_knowledge_graph)

    def sync(self, docs: List[SourceDocument]) -> SyncReport:
        docs = list(docs)
        change = self.tracker.commit(docs)
        affected = self.index.resolve_affected(change)

        by_id = {d.id: d for d in docs}
        to_extract = [by_id[sid] for sid in change.needs_extract if sid in by_id]

        touched: List[str] = []
        if to_extract:
            upserted = apply_extraction(
                to_extract,
                extractor=self.extractor,
                object_store=self.object_store,
                index=self.index,
                actor=self.actor,
            )
            touched = [o.id for o in upserted]

        retired: List[str] = []
        for sid in change.removed:
            orphans = self.index.drop_source(sid)
            for oid in orphans:
                try:
                    obj = self.object_store.get_object(oid)
                except KeyError:
                    continue
                if obj.status is KnowledgeStatus.PUBLISHED:
                    self.object_store.transition(oid, KnowledgeStatus.RETIRED)
                    retired.append(oid)
                elif obj.status is KnowledgeStatus.DRAFT:
                    self.object_store.transition(oid, KnowledgeStatus.RETIRED)
                    retired.append(oid)
                elif obj.status is KnowledgeStatus.PENDING_REVIEW:
                    self.object_store.transition(oid, KnowledgeStatus.RETIRED)
                    retired.append(oid)

        published: List[str] = []
        graph_stats: Dict[str, Any] = {}
        if self.auto_publish and touched:
            submit_for_review(self.object_store, touched)
            published_objs = publish_objects(self.object_store, touched)
            published = [o.id for o in published_objs]
            if self.graph_store is not None:
                graph_stats = publish_to_store(
                    self.object_store, self.graph_store, object_ids=published
                )
                if self.mirror_knowledge_graph:
                    merge_published_into_graph(
                        self.object_store, self.graph, object_ids=published
                    )
            else:
                # Backward-compatible path: in-memory KnowledgeGraph only
                graph_stats = merge_published_into_graph(
                    self.object_store, self.graph, object_ids=published
                )
                graph_stats = {
                    **graph_stats,
                    "store_backend": "knowledge_graph_memory",
                    "entity_count": len(self.graph.entities),
                    "relationship_count": len(self.graph.relationships),
                }
        elif touched:
            # still record affected prior objects from index resolution
            pass

        if retired and self.graph_store is not None:
            retire_stats = retire_from_store(
                self.object_store, self.graph_store, retired
            )
            graph_stats = {**graph_stats, "retire": retire_stats}

        # Include previously affected ids for audit completeness
        all_touched = sorted(set(touched) | set(affected.object_ids))

        report = SyncReport(
            run_id=str(uuid.uuid4()),
            added=list(change.added),
            changed=list(change.changed),
            removed=list(change.removed),
            unchanged=list(change.unchanged),
            extracted_source_ids=[d.id for d in to_extract],
            touched_object_ids=all_touched,
            published_object_ids=published,
            retired_object_ids=retired,
            graph_stats=graph_stats,
        )
        self.runs.append(report)
        return report
