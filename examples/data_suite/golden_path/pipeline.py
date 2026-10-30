"""Stage 2: DataFlow job + OneID over golden-path channels."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.idmapping.engine import IdMappingEngine
from agenticx.data_suite.jobs.dsl import load_job
from agenticx.data_suite.jobs.runner import JobRunResult, run_job

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


async def run_job_stage(
    *,
    registry: ChannelRegistry,
    job_path: Union[str, Path, None] = None,
    idmap_path: Union[str, Path, None] = None,
    idmap_engine: Optional[IdMappingEngine] = None,
) -> JobRunResult:
    """Load JobSpec + IdMappingEngine and run extract→…→load on registry."""
    job = Path(job_path) if job_path is not None else SEED / "job.yaml"
    spec = load_job(job)
    engine = idmap_engine
    if engine is None:
        profile = Path(idmap_path) if idmap_path is not None else SEED / "idmap_profile.yaml"
        engine = IdMappingEngine.from_yaml(profile)
    return await run_job(spec, channels=registry, idmaps={"default": engine})


def dst_rows(
    registry: ChannelRegistry, table: str = "members_out"
) -> List[Dict[str, Any]]:
    """Read dst table rows; works for Fake / File / Hive channels.

    Prefer ``SELECT *`` via channel.query (dict-shaped when possible);
    fall back to FakeChannel ``.tables`` for older call sites.
    """
    ch = registry.get("dst")
    # FakeChannel keeps an in-memory dict table
    tables = getattr(ch, "tables", None)
    if isinstance(tables, dict) and table in tables:
        return list(tables.get(table, []))

    try:
        result = ch.query(f"SELECT * FROM {table}", limit=100_000)
    except Exception:  # noqa: BLE001 — empty / unsupported → []
        return []

    columns = list(getattr(result, "columns", []) or [])
    rows = list(getattr(result, "rows", []) or [])
    if not rows:
        return []
    if columns:
        return [
            {columns[i]: (row[i] if i < len(row) else None) for i in range(len(columns))}
            for row in rows
        ]
    # Already dict-shaped rows (some Fake paths)
    if rows and isinstance(rows[0], dict):
        return [dict(r) for r in rows]
    return []
