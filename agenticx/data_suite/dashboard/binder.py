from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.data_suite.dashboard.spec import WidgetSpec


@dataclass
class ChartPoint:
    name: str
    value: float


@dataclass
class ChartSeries:
    widget_id: str
    title: str
    chart: str
    points: List[ChartPoint]
    meta: Dict[str, Any] = field(default_factory=dict)


class DatasetStore:
    def __init__(self) -> None:
        self._tables: Dict[str, List[Dict[str, Any]]] = {}

    def load_json(self, path: Union[str, Path]) -> None:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self._tables = {str(k): list(v) for k, v in data.items()}

    def rows(self, dataset_id: str) -> List[Dict[str, Any]]:
        return list(self._tables.get(dataset_id) or [])


def _apply_filters(rows: List[Dict[str, Any]], filters: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not filters:
        return list(rows)
    out = []
    for r in rows:
        if all(r.get(k) == v for k, v in filters.items()):
            out.append(r)
    return out


def _metric_value(rows: List[Dict[str, Any]], metric: str, metric_field: Optional[str]) -> float:
    if not rows:
        return 0.0
    if metric == "count":
        return float(len(rows))
    if metric_field is None:
        raise ValueError(f"metric {metric} requires metric_field")
    vals = [float(r.get(metric_field) or 0) for r in rows]
    if metric == "sum":
        return float(sum(vals))
    if metric == "avg":
        return float(sum(vals) / len(vals))
    raise ValueError(f"unknown metric {metric}")


def bind_widget(
    widget: WidgetSpec,
    rows: List[Dict[str, Any]],
    *,
    filters: Optional[Dict[str, Any]] = None,
) -> ChartSeries:
    filtered = _apply_filters(rows, filters)
    if widget.chart == "stat" or not widget.group_by:
        value = _metric_value(filtered, widget.metric, widget.metric_field)
        points = [ChartPoint(name=widget.title, value=value)]
    else:
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for r in filtered:
            key = str(r.get(widget.group_by) or "")
            groups.setdefault(key, []).append(r)
        points = [
            ChartPoint(name=name, value=_metric_value(grp, widget.metric, widget.metric_field))
            for name, grp in sorted(groups.items())
        ]
    return ChartSeries(
        widget_id=widget.id,
        title=widget.title,
        chart=widget.chart,
        points=points,
        meta={"filters": dict(filters or {}), "row_count": len(filtered)},
    )
