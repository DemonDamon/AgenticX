from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from agenticx.data_suite.dashboard.binder import ChartSeries, bind_widget
from agenticx.data_suite.dashboard.spec import WidgetSpec


@dataclass
class DrillPath:
    levels: List[str]
    values: List[str] = field(default_factory=list)


def apply_drill(rows: List[Dict[str, Any]], path: DrillPath) -> List[Dict[str, Any]]:
    out = list(rows)
    for level, value in zip(path.levels, path.values):
        out = [r for r in out if str(r.get(level) or "") == str(value)]
    return out


def next_group_field(path: DrillPath) -> Optional[str]:
    idx = len(path.values)
    if idx >= len(path.levels):
        return None
    return path.levels[idx]


def compare_series(
    widget: WidgetSpec,
    rows: List[Dict[str, Any]],
    *,
    left_filters: Dict[str, Any],
    right_filters: Dict[str, Any],
    left_label: str = "A",
    right_label: str = "B",
) -> List[ChartSeries]:
    left = bind_widget(widget, rows, filters=left_filters)
    right = bind_widget(widget, rows, filters=right_filters)
    left.title = f"{widget.title} ({left_label})"
    right.title = f"{widget.title} ({right_label})"
    left.meta = {**left.meta, "compare": left_label}
    right.meta = {**right.meta, "compare": right_label}
    return [left, right]
