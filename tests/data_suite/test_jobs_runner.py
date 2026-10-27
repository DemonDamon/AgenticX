import pytest

from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.jobs.dsl import load_job
from agenticx.data_suite.jobs.runner import run_job
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "sample_job.yaml"


@pytest.mark.asyncio
async def test_run_sample_job_e2e():
    grants = WriteGrantStore(grants={"g_load": {"channel": "dst", "table": "users_out"}})
    src = FakeChannel(
        name="src",
        tables={
            "raw_users": [
                {"id": 1, "phone": "100"},
                {"id": None, "phone": "200"},
                {"id": 2, "phone": "300"},
            ]
        },
    )
    dst = FakeChannel(name="dst", tables={"users_out": []}, grants=grants)
    reg = ChannelRegistry()
    reg.register(src)
    reg.register(dst)

    spec = load_job(FIXTURE)
    result = await run_job(spec, channels=reg)
    assert result.ok is True, result.error
    assert result.written == 2
    assert len(dst.tables["users_out"]) == 2
    assert all(r.get("subject_id") is not None for r in dst.tables["users_out"])
    assert len(result.lineage.events) >= 5
    assert result.snapshot_id
