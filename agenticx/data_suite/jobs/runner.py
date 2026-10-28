from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.jobs.dsl import JobSpec
from agenticx.data_suite.jobs.lineage import LineageLog
from agenticx.data_suite.jobs.nodes import (
    IdMapLike,
    PassthroughIdMap,
    run_clean,
    run_extract,
    run_load,
    run_snapshot,
    run_transform,
)


@dataclass
class JobRunResult:
    job_name: str
    ok: bool
    row_count: int = 0
    written: int = 0
    snapshot_id: Optional[str] = None
    lineage: LineageLog = field(default_factory=LineageLog)
    snapshots: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


async def run_job(
    spec: JobSpec,
    *,
    channels: ChannelRegistry,
    idmaps: Optional[Dict[str, IdMapLike]] = None,
) -> JobRunResult:
    """Execute extract → clean → transform → load → snapshot in declaration order."""
    idmaps = dict(idmaps or {})
    if "default" not in idmaps:
        idmaps["default"] = PassthroughIdMap()
    lineage = LineageLog()
    snapshots: Dict[str, Any] = {}
    records: List[Dict[str, Any]] = []
    written = 0
    snapshot_id: Optional[str] = None
    try:
        for node in spec.nodes:
            if node.type == "extract":
                records = run_extract(node, channels=channels, lineage=lineage)
            elif node.type == "clean":
                records = run_clean(node, records=records, lineage=lineage)
            elif node.type == "transform":
                records = run_transform(
                    node, records=records, idmaps=idmaps, lineage=lineage
                )
            elif node.type == "load":
                written = run_load(
                    node, records=records, channels=channels, lineage=lineage
                )
            elif node.type == "snapshot":
                snapshot_id = run_snapshot(
                    node, records=records, lineage=lineage, snapshots=snapshots
                )
            else:
                raise ValueError(f"unsupported node type: {node.type}")
        return JobRunResult(
            job_name=spec.name,
            ok=True,
            row_count=len(records),
            written=written,
            snapshot_id=snapshot_id,
            lineage=lineage,
            snapshots=snapshots,
        )
    except Exception as exc:  # noqa: BLE001
        return JobRunResult(
            job_name=spec.name,
            ok=False,
            row_count=len(records),
            written=written,
            snapshot_id=snapshot_id,
            lineage=lineage,
            snapshots=snapshots,
            error=str(exc),
        )
