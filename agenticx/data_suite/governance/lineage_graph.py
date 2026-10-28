from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Set, Tuple

from agenticx.data_suite.jobs.lineage import LineageLog


@dataclass
class LineageGraph:
    """Table-level lineage graph derived from job LineageLog events."""

    nodes: List[str] = field(default_factory=list)
    edges: List[Tuple[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"nodes": list(self.nodes), "edges": [list(e) for e in self.edges]}


def build_lineage_graph(log: LineageLog) -> LineageGraph:
    nodes: Set[str] = set()
    edges: Set[Tuple[str, str]] = set()
    for ev in log.events:
        meta = ev.get("meta") or {}
        tables_in = _as_str_list(meta.get("tables_in"))
        tables_out = _as_str_list(meta.get("tables_out"))
        for t in tables_in + tables_out:
            nodes.add(t)
        for src in tables_in:
            for dst in tables_out:
                if src != dst:
                    edges.add((src, dst))
    return LineageGraph(nodes=sorted(nodes), edges=sorted(edges))


def _as_str_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Iterable):
        return [str(x) for x in value]
    return [str(value)]
