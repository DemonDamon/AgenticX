from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Union

import yaml

ALLOWED_CHARTS = frozenset({"bar", "line", "donut", "stat"})


class BoardSpecError(ValueError):
    """Raised when a board YAML is invalid."""


@dataclass(frozen=True)
class WidgetSpec:
    id: str
    title: str
    chart: str
    dataset: str
    x: Optional[str] = None
    y: Optional[str] = None
    group_by: Optional[str] = None
    metric: str = "count"
    metric_field: Optional[str] = None
    row: int = 0
    col: int = 0
    w: int = 6
    h: int = 4


@dataclass(frozen=True)
class BoardSpec:
    id: str
    title: str
    widgets: List[WidgetSpec]


def load_board(path: Union[str, Path]) -> BoardSpec:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    widgets: List[WidgetSpec] = []
    for row in data.get("widgets") or []:
        chart = str(row.get("chart") or "")
        if chart not in ALLOWED_CHARTS:
            raise BoardSpecError(f"unknown chart type {chart!r}")
        widgets.append(
            WidgetSpec(
                id=str(row["id"]),
                title=str(row.get("title") or row["id"]),
                chart=chart,
                dataset=str(row["dataset"]),
                x=row.get("x"),
                y=row.get("y"),
                group_by=row.get("group_by"),
                metric=str(row.get("metric") or "count"),
                metric_field=row.get("metric_field"),
                row=int(row.get("row") or 0),
                col=int(row.get("col") or 0),
                w=int(row.get("w") or 6),
                h=int(row.get("h") or 4),
            )
        )
    return BoardSpec(
        id=str(data.get("id") or Path(path).stem),
        title=str(data.get("title") or data.get("id") or "board"),
        widgets=widgets,
    )
