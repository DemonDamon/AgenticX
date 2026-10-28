"""Quality patrol runner over QualityRollup."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union

import yaml

from agenticx.data_suite.governance.quality import QualityRollup, QualitySnapshot
from agenticx.managed.templates.data_suite.webhook import WebhookNotifier


@dataclass(frozen=True)
class QualityPatrolConfig:
    metrics_yaml: Path
    thresholds: Mapping[str, float]
    day: str

    @classmethod
    def load(cls, path: Union[str, Path], *, fixtures_dir: Optional[Path] = None) -> "QualityPatrolConfig":
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        metrics_ref = str(raw.get("metrics_ref") or "")
        base = fixtures_dir or Path(path).parent
        metrics_yaml = Path(metrics_ref)
        if not metrics_yaml.is_absolute():
            metrics_yaml = base / metrics_ref
        thresholds = {str(k): float(v) for k, v in (raw.get("thresholds") or {}).items()}
        return cls(
            metrics_yaml=metrics_yaml,
            thresholds=thresholds,
            day=str(raw.get("day") or ""),
        )


@dataclass
class QualityPatrolRunner:
    config: QualityPatrolConfig
    notifier: WebhookNotifier
    _rollup: QualityRollup = field(default_factory=QualityRollup, init=False, repr=False)

    def __post_init__(self) -> None:
        self._rollup.load_metrics(self.config.metrics_yaml)

    def run(
        self,
        rows: List[Dict[str, Any]],
        *,
        quarantine: Optional[List[Dict[str, Any]]] = None,
    ) -> QualitySnapshot:
        snap = self._rollup.compute_day(self.config.day, rows, quarantine=quarantine)
        for metric_id, ceiling in self.config.thresholds.items():
            value = float(snap.metrics.get(metric_id, 0.0))
            if value > float(ceiling):
                self.notifier.emit(
                    "quality_alert",
                    metric=metric_id,
                    value=value,
                    ceiling=float(ceiling),
                    day=snap.day,
                )
        return snap
