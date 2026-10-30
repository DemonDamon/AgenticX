"""H6: DataFlow schedule_run ops — bind, tick, history, rerun, fail alert."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.idmapping.engine import IdMappingEngine
from agenticx.data_suite.jobs.dsl import JobNode, JobSpec, load_job
from agenticx.data_suite.jobs.ops import FAIL_WEBHOOK_KIND, DataJobOpsService
from agenticx.managed.templates.data_suite.webhook import FakeWebhookSink

FIXTURE = Path(__file__).parent / "fixtures" / "sample_job.yaml"
PROFILE = Path(__file__).parent / "fixtures" / "idmap_profile.yaml"


def _registry() -> tuple[ChannelRegistry, FakeChannel]:
    grants = WriteGrantStore(grants={"g_load": {"channel": "dst", "table": "users_out"}})
    src = FakeChannel(
        name="src",
        tables={
            "raw_users": [
                {"id": 1, "phone": "100", "crm_id": "c1"},
                {"id": 2, "phone": "200", "crm_id": "c2"},
            ]
        },
    )
    dst = FakeChannel(name="dst", tables={"users_out": []}, grants=grants)
    reg = ChannelRegistry()
    reg.register(src)
    reg.register(dst)
    return reg, dst


@pytest.mark.asyncio
async def test_bind_tick_records_history_and_rerun():
    reg, dst = _registry()
    spec = load_job(FIXTURE)
    engine = IdMappingEngine.from_yaml(PROFILE)
    sink = FakeWebhookSink()
    ops = DataJobOpsService(sink=sink)
    ops.register_job(spec)
    sched = ops.bind_schedule(spec.name, cron="0 3 * * *", schedule_id="sch_sample")

    tick_runs = await ops.tick(
        datetime(2026, 10, 30, 3, 0),
        channels=reg,
        idmaps={"default": engine},
    )
    assert len(tick_runs) == 1
    run = tick_runs[0]
    assert run.trigger == "schedule"
    assert run.status == "succeeded"
    assert run.schedule_id == sched.id
    assert run.snapshot_id
    assert run.written >= 1
    assert len(dst.tables["users_out"]) == run.written

    history = ops.list_runs(job_id=spec.name)
    assert len(history) == 1
    assert history[0].id == run.id

    # not due at 04:00
    none = await ops.tick(
        datetime(2026, 10, 30, 4, 0),
        channels=reg,
        idmaps={"default": engine},
    )
    assert none == []

    rerun = await ops.rerun(spec.name, channels=reg, idmaps={"default": engine})
    assert rerun.trigger == "manual"
    assert rerun.status == "succeeded"
    assert len(ops.list_runs(job_id=spec.name)) == 2
    assert sink.events == []


@pytest.mark.asyncio
async def test_backfill_and_replay_entry():
    reg, _ = _registry()
    spec = load_job(FIXTURE)
    engine = IdMappingEngine.from_yaml(PROFILE)
    ops = DataJobOpsService(sink=FakeWebhookSink())
    ops.register_job(spec)
    ops.bind_schedule(spec.name, cron="0 3 * * *")

    first = await ops.rerun(spec.name, channels=reg, idmaps={"default": engine})
    assert first.snapshot_id

    bf = await ops.backfill(
        spec.name,
        scheduled_for=datetime(2026, 10, 1, 3, 0),
        channels=reg,
        idmaps={"default": engine},
    )
    assert bf.trigger == "backfill"
    assert bf.status == "succeeded"
    assert bf.scheduled_for is not None

    replay = await ops.replay_snapshot(
        spec.name,
        snapshot_id=first.snapshot_id,
        channels=reg,
        idmaps={"default": engine},
    )
    assert replay.trigger == "replay"
    assert replay.status == "succeeded"
    assert replay.replay_of_snapshot_id == first.snapshot_id


@pytest.mark.asyncio
async def test_failed_run_emits_webhook():
    reg = ChannelRegistry()
    # missing channels → extract fails
    broken = JobSpec(
        name="broken_job",
        schedule="* * * * *",
        nodes=[
            JobNode(id="e", type="extract", channel="missing", statement="SELECT 1"),
        ],
    )
    sink = FakeWebhookSink()
    ops = DataJobOpsService(sink=sink)
    ops.register_job(broken)
    ops.bind_schedule("broken_job", cron="* * * * *", schedule_id="sch_broken")

    runs = await ops.tick(datetime(2026, 10, 30, 12, 0), channels=reg)
    assert len(runs) == 1
    assert runs[0].status == "failed"
    assert runs[0].error
    assert len(sink.events) == 1
    assert sink.events[0].kind == FAIL_WEBHOOK_KIND
    assert sink.events[0].payload["job_id"] == "broken_job"
    assert sink.events[0].payload["run_id"] == runs[0].id


def test_bind_unknown_job_raises():
    ops = DataJobOpsService()
    with pytest.raises(KeyError):
        ops.bind_schedule("nope", cron="0 3 * * *")


def test_bind_bad_cron_raises():
    ops = DataJobOpsService()
    ops.register_job(JobSpec(name="j", nodes=[JobNode(id="n", type="clean")]))
    with pytest.raises(ValueError):
        ops.bind_schedule("j", cron="bad")
