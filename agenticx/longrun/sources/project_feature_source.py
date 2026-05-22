#!/usr/bin/env python3
"""Project feature TaskSource for the long-run orchestrator.

Streams pending features from a project_state store into LongRunOrchestrator,
one task per feature. Each emitted task carries enough metadata for the
orchestrator-side ``submit_fn`` to spin up a feature_loop worker session.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict, Iterable, List

from agenticx.project_state.feature_list import select_next_pending
from agenticx.project_state.schema import FEATURE_PENDING
from agenticx.project_state.store import ProjectStateError, ProjectStore


def _project_id_for(store: ProjectStore) -> str:
    try:
        status = store.load_status()
    except ProjectStateError:
        return store.root.parent.name
    return status.project_id or store.root.parent.name


def _build_payload(store: ProjectStore, feature_dict: Dict[str, Any]) -> Dict[str, Any]:
    project_id = _project_id_for(store)
    fid = str(feature_dict.get("id") or "").strip()
    if not fid:
        raise ProjectStateError("feature payload missing id")
    return {
        "id": f"feature::{project_id}::{fid}",
        "kind": "project_feature",
        "project_id": project_id,
        "project_root": str(store.root),
        "feature_id": fid,
        "feature_title": str(feature_dict.get("title", "") or ""),
        "feature_priority": int(feature_dict.get("priority", 100) or 100),
        "session_mode": "feature_loop",
        "queued_at": time.time(),
    }


class ProjectFeatureSource:
    """Emit pending features from one or more project stores as longrun tasks.

    The source is **read-only**: it does not mutate the project store. The
    orchestrator's ``submit_fn`` is expected to call ``feature_select`` /
    ``feature_complete`` inside the worker session, which is the single writer.
    """

    def __init__(
        self,
        stores: Iterable[ProjectStore],
        *,
        max_per_tick: int = 1,
    ) -> None:
        self._stores: List[ProjectStore] = list(stores)
        if max_per_tick < 1:
            raise ValueError("max_per_tick must be >= 1")
        self._max_per_tick = int(max_per_tick)
        self._emitted_ids: set[str] = set()
        self._completed_ids: set[str] = set()

    @classmethod
    def from_workspace_roots(
        cls,
        workspace_roots: Iterable[Path],
        *,
        max_per_tick: int = 1,
    ) -> "ProjectFeatureSource":
        stores: List[ProjectStore] = []
        for root in workspace_roots:
            try:
                stores.append(ProjectStore.open(Path(root)))
            except ProjectStateError:
                continue
        return cls(stores, max_per_tick=max_per_tick)

    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]:
        emitted: List[Dict[str, Any]] = []
        for store in self._stores:
            if len(emitted) >= self._max_per_tick:
                break
            try:
                payload = store.load_feature_list()
            except ProjectStateError:
                continue
            if not any(f.status == FEATURE_PENDING for f in payload.features):
                continue
            feat = select_next_pending(payload)
            if feat is None:
                continue
            try:
                task = _build_payload(store, feat.to_dict())
            except ProjectStateError:
                continue
            tid = task["id"]
            if tid in self._emitted_ids or tid in self._completed_ids:
                continue
            self._emitted_ids.add(tid)
            emitted.append(task)
        return emitted

    async def mark_task_done(self, task_id: str) -> None:
        self._emitted_ids.discard(task_id)
        self._completed_ids.add(task_id)
