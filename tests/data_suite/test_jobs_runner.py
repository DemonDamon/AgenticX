import pytest
from pathlib import Path

from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.idmapping.engine import IdMappingEngine
from agenticx.data_suite.jobs.dsl import load_job
from agenticx.data_suite.jobs.runner import run_job

FIXTURE = Path(__file__).parent / "fixtures" / "sample_job.yaml"
PROFILE = Path(__file__).parent / "fixtures" / "idmap_profile.yaml"


@pytest.mark.asyncio
async def test_run_sample_job_e2e():
    grants = WriteGrantStore(grants={"g_load": {"channel": "dst", "table": "users_out"}})
    src = FakeChannel(
        name="src",
        tables={
            "raw_users": [
                {"id": 1, "phone": "100", "crm_id": "c1"},
                {"id": None, "phone": "200", "crm_id": None},
                {"id": 2, "phone": "100", "crm_id": None},
            ]
        },
    )
    dst = FakeChannel(name="dst", tables={"users_out": []}, grants=grants)
    reg = ChannelRegistry()
    reg.register(src)
    reg.register(dst)

    spec = load_job(FIXTURE)
    engine = IdMappingEngine.from_yaml(PROFILE)
    result = await run_job(spec, channels=reg, idmaps={"default": engine})
    assert result.ok is True, result.error
    assert result.written == 2
    assert len(dst.tables["users_out"]) == 2
    # shared phone "100" → same subject_id after real idmap
    subjects = {r.get("subject_id") for r in dst.tables["users_out"]}
    assert len(subjects) == 1
    assert all(s and str(s).startswith("crm_id:") for s in subjects)
    assert len(result.lineage.events) >= 5
    assert result.snapshot_id
