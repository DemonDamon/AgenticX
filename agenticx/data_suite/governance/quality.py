from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml


@dataclass
class QualitySnapshot:
    day: str
    metrics: Dict[str, float]
    meta: Dict[str, Any] = field(default_factory=dict)


class QualityRollup:
    def __init__(self) -> None:
        self._metrics: List[Dict[str, Any]] = []

    def load_metrics(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._metrics = list(data.get("metrics") or [])

    def load_metric_defs(self, metrics: List[Dict[str, Any]]) -> None:
        """Load metric definitions from in-memory dicts (e.g. QualityMetricStore)."""
        self._metrics = [dict(m) for m in metrics]

    def compute_day(
        self,
        day: str,
        rows: List[Dict[str, Any]],
        *,
        quarantine: Optional[List[Dict[str, Any]]] = None,
    ) -> QualitySnapshot:
        quarantine = quarantine or []
        n = len(rows)
        denom = max(n, 1)
        out: Dict[str, float] = {}
        for m in self._metrics:
            mid = str(m["id"])
            mtype = str(m.get("type") or "")
            fname = str(m.get("field") or "")
            if mtype == "null_rate":
                nulls = sum(1 for r in rows if r.get(fname) is None or r.get(fname) == "")
                out[mid] = nulls / denom
            elif mtype == "distinct_count":
                vals = {r.get(fname) for r in rows if r.get(fname) is not None and r.get(fname) != ""}
                out[mid] = float(len(vals))
            elif mtype == "rule_fail_rate":
                out[mid] = len(quarantine) / denom
            else:
                out[mid] = 0.0
        return QualitySnapshot(day=day, metrics=out, meta={"row_count": n, "quarantine_count": len(quarantine)})

    def save(self, snap: QualitySnapshot, path: Union[str, Path]) -> None:
        payload = {"day": snap.day, "metrics": snap.metrics, "meta": snap.meta}
        Path(path).write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")

    def load_day(self, path: Union[str, Path]) -> QualitySnapshot:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        return QualitySnapshot(
            day=str(data.get("day") or ""),
            metrics={str(k): float(v) for k, v in (data.get("metrics") or {}).items()},
            meta=dict(data.get("meta") or {}),
        )
