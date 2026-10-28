from pathlib import Path

import pytest

from agenticx.data_suite.jobs.dsl import JobDslError, load_job

FIXTURE = Path(__file__).parent / "fixtures" / "sample_job.yaml"


def test_load_sample_job():
    spec = load_job(FIXTURE)
    assert spec.name == "sample_oneid_job"
    assert spec.node_types == ["extract", "clean", "transform", "load", "snapshot"]
    assert spec.schedule == "0 2 * * *"
    assert spec.nodes[3].grant_id == "g_load"
    assert spec.nodes[2].idmap == "default"


def test_reject_unknown_node_type(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("name: x\nnodes:\n  - id: a\n    type: magic\n", encoding="utf-8")
    with pytest.raises(JobDslError, match="unknown node type"):
        load_job(p)
