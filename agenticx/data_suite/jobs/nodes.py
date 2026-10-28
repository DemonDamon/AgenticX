from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from agenticx.data_suite.channels.base import ChannelQueryResult
from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.jobs.dsl import JobNode
from agenticx.data_suite.jobs.lineage import LineageLog


@runtime_checkable
class IdMapLike(Protocol):
    def map_records(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]: ...


class PassthroughIdMap:
    """Placeholder until A3 IdMappingEngine lands."""

    def map_records(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for r in records:
            row = dict(r)
            row.setdefault("subject_id", row.get("id"))
            out.append(row)
        return out


def _rows_to_dicts(result: ChannelQueryResult) -> List[Dict[str, Any]]:
    return [dict(zip(result.columns, row)) for row in result.rows]


def run_extract(node: JobNode, *, channels: ChannelRegistry, lineage: LineageLog) -> List[Dict[str, Any]]:
    if not node.channel or not node.statement:
        raise ValueError(f"extract node {node.id} requires channel + statement")
    ch = channels.get(node.channel)
    result = ch.query(node.statement)
    rows = _rows_to_dicts(result)
    lineage.record(node.id, inputs={"channel": node.channel}, outputs={"row_count": len(rows)})
    return rows


def run_clean(node: JobNode, *, records: List[Dict[str, Any]], lineage: LineageLog) -> List[Dict[str, Any]]:
    before = len(records)
    keys = node.drop_null or []
    cleaned = [
        r for r in records
        if all(r.get(k) is not None and r.get(k) != "" for k in keys)
    ]
    lineage.record(
        node.id,
        inputs={"row_count": before},
        outputs={"row_count": len(cleaned)},
        meta={"drop_null": keys},
    )
    return cleaned


def run_transform(
    node: JobNode,
    *,
    records: List[Dict[str, Any]],
    idmaps: Dict[str, IdMapLike],
    lineage: LineageLog,
) -> List[Dict[str, Any]]:
    key = node.idmap or "default"
    engine = idmaps.get(key) or PassthroughIdMap()
    mapped = engine.map_records(records)
    lineage.record(
        node.id,
        inputs={"row_count": len(records)},
        outputs={"row_count": len(mapped)},
        meta={"idmap": key},
    )
    return mapped


def run_load(
    node: JobNode,
    *,
    records: List[Dict[str, Any]],
    channels: ChannelRegistry,
    lineage: LineageLog,
) -> int:
    if not node.channel or not node.table or not node.grant_id:
        raise ValueError(f"load node {node.id} requires channel + table + grant_id")
    ch = channels.get(node.channel)
    n = ch.write_rows(node.table, records, grant_id=node.grant_id)
    lineage.record(
        node.id,
        inputs={"row_count": len(records)},
        outputs={"written": n},
        meta={"channel": node.channel, "table": node.table},
    )
    return n


def run_snapshot(
    node: JobNode,
    *,
    records: List[Dict[str, Any]],
    lineage: LineageLog,
    snapshots: Dict[str, Any],
) -> str:
    snap_id = f"snap-{node.id}-{len(lineage.events)}"
    snapshots[snap_id] = {
        "target": node.target or "memory",
        "records": [dict(r) for r in records],
    }
    lineage.record(
        node.id,
        inputs={"row_count": len(records)},
        outputs={"snapshot_id": snap_id},
    )
    return snap_id
