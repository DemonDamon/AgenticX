"""轨迹库：按 <source>/<YYYYMM>/ 分片 jsonl 追加写，trajectory_id 索引去重。"""
from __future__ import annotations

import datetime
import json
from collections import Counter
from pathlib import Path
from typing import Iterator

from .schema import RSITrajectory

class TrajectoryStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root / "_index.json"
        self._ids: set[str] = set(self._load_ids())

    def _load_ids(self) -> list[str]:
        try:
            return json.load(open(self.index_path))["ids"]
        except (OSError, json.JSONDecodeError, KeyError):
            return []

    def _save_ids(self) -> None:
        json.dump({"ids": sorted(self._ids)}, open(self.index_path, "w"))

    def _shard_path(self, traj: RSITrajectory) -> Path:
        month = (traj.created_at or "")[:7] or datetime.date.today().strftime("%Y-%m")
        d = self.root / traj.source / month
        d.mkdir(parents=True, exist_ok=True)
        return d / "traj.jsonl"

    def append(self, traj: RSITrajectory) -> str:
        tid = traj.trajectory_id
        if tid in self._ids:
            return "duplicate"
        path = self._shard_path(traj)
        with open(path, "a") as f:
            f.write(json.dumps(traj.to_dict(), ensure_ascii=False) + "\n")
        self._ids.add(tid)
        self._save_ids()
        return "written"

    def iter_trajectories(self, source: str | None = None) -> Iterator[RSITrajectory]:
        pattern = f"{source}/**/*.jsonl" if source else "**/*.jsonl"
        for path in sorted(self.root.glob(pattern)):
            for line in open(path):
                line = line.strip()
                if line:
                    yield RSITrajectory.from_dict(json.loads(line))

    def stats(self) -> dict:
        trajs = list(self.iter_trajectories())
        return {
            "total": len(trajs),
            "by_status": dict(Counter(t.status for t in trajs)),
            "by_source": dict(Counter(t.source for t in trajs)),
        }
