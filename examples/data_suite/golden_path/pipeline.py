"""Stage 2: DataFlow job + OneID over golden-path FakeChannels."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Union

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


def dst_rows(registry: ChannelRegistry, table: str = "members_out") -> list[dict[str, Any]]:
    ch = registry.get("dst")
    tables = getattr(ch, "tables", {})
    return list(tables.get(table, []))
