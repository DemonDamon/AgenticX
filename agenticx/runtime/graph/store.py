#!/usr/bin/env python3
"""Persistence for GraphRun snapshots under ~/.agenticx/graph_runs.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional

from agenticx.runtime.graph.models import GraphRun

_log = logging.getLogger(__name__)


def default_graph_runs_root() -> Path:
    override = str(os.environ.get("AGX_GRAPH_RUNS_ROOT") or "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".agenticx" / "graph_runs"


class GraphRunStore:
    """Atomic JSON persistence for WorkGraph runs."""

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root) if root is not None else default_graph_runs_root()
        self.root.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, run_id: str) -> Path:
        safe = str(run_id).strip().replace("/", "_").replace("..", "_")
        return self.root / safe

    def _run_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / "run.json"

    def save(self, run: GraphRun, *, bump_version: bool = True) -> GraphRun:
        if bump_version:
            run.version = int(run.version or 0) + 1
        path = self._run_path(run.run_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(run.to_dict(), ensure_ascii=False, indent=2)
        fd, tmp_name = tempfile.mkstemp(
            prefix=".run.",
            suffix=".json",
            dir=str(path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
        return run

    def load(self, run_id: str) -> Optional[GraphRun]:
        path = self._run_path(run_id)
        if not path.is_file():
            return None
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            _log.warning("Failed to load graph run %s: %s", run_id, exc)
            return None
        if not isinstance(raw, dict):
            return None
        return GraphRun.from_dict(raw)

    def list_by_session(self, session_id: str) -> List[GraphRun]:
        sid = str(session_id or "").strip()
        if not sid or not self.root.is_dir():
            return []
        found: List[GraphRun] = []
        for child in sorted(self.root.iterdir()):
            if not child.is_dir():
                continue
            path = child / "run.json"
            if not path.is_file():
                continue
            run = self.load(child.name)
            if run is not None and run.session_id == sid:
                found.append(run)
        found.sort(key=lambda r: r.version, reverse=True)
        return found

    def list_by_group_id(self, group_id: str) -> List[GraphRun]:
        """List runs for a group, including legacy mis-bound session_id==group_id."""
        gid = str(group_id or "").strip()
        if not gid or not self.root.is_dir():
            return []
        found: List[GraphRun] = []
        for child in sorted(self.root.iterdir()):
            if not child.is_dir():
                continue
            path = child / "run.json"
            if not path.is_file():
                continue
            run = self.load(child.name)
            if run is None:
                continue
            if str(run.group_id or "").strip() == gid or str(run.session_id or "").strip() == gid:
                found.append(run)
        found.sort(key=lambda r: r.version, reverse=True)
        return found


_default_store: Optional[GraphRunStore] = None


def get_default_store() -> GraphRunStore:
    global _default_store
    if _default_store is None:
        _default_store = GraphRunStore()
    return _default_store
