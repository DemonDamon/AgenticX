"""Stage: DataFlow schedule bind → tick → history → rerun (H6)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Union

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.idmapping.engine import IdMappingEngine
from agenticx.data_suite.jobs.dsl import load_job
from agenticx.data_suite.jobs.ops import DataJobOpsService, runs_as_dicts
from agenticx.managed.templates.data_suite.webhook import FakeWebhookSink

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


async def run_ops_stage(
    *,
    registry: ChannelRegistry,
    job_path: Union[str, Path, None] = None,
    idmap_path: Union[str, Path, None] = None,
    tick_at: Optional[datetime] = None,
    schedule_id: str = "golden_path_sch",
    sink: Optional[FakeWebhookSink] = None,
) -> Dict[str, Any]:
    """Bind golden job to its YAML cron, fire one schedule tick, then manual rerun."""
    job = Path(job_path) if job_path is not None else SEED / "job.yaml"
    profile = Path(idmap_path) if idmap_path is not None else SEED / "idmap_profile.yaml"
    spec = load_job(job)
    engine = IdMappingEngine.from_yaml(profile)

    webhook = sink if sink is not None else FakeWebhookSink()
    ops = DataJobOpsService(sink=webhook)
    ops.register_job(spec)
    cron = spec.schedule or "0 3 * * *"
    sched = ops.bind_schedule(
        spec.name,
        cron=cron,
        schedule_id=schedule_id,
        enabled=True,
    )

    # Default tick matches seed job.yaml ``0 3 * * *``
    when = tick_at or datetime(2026, 10, 30, 3, 0)
    tick_runs = await ops.tick(when, channels=registry, idmaps={"default": engine})
    rerun = await ops.rerun(spec.name, channels=registry, idmaps={"default": engine})

    return {
        "job_id": spec.name,
        "schedule_id": sched.id,
        "cron": sched.cron,
        "tick_runs": runs_as_dicts(tick_runs),
        "rerun": runs_as_dicts([rerun])[0],
        "history": runs_as_dicts(ops.list_runs(job_id=spec.name)),
        "webhook_kinds": [getattr(e, "kind", None) for e in webhook.events],
        "webhook_count": len(webhook.events),
        "ops": ops,
        "sink": webhook,
    }
