# tests/trajectory/test_task_pool.py
"""SP23 多域任务池: 解析器 + 守卫扩展测试。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.learning.trajectory import task_pool
from agenticx.learning.trajectory.task_pool import (
    PooledTask,
    parse_code_parquet,
    parse_cyber_parquet,
    parse_general_manifest,
    write_pool_manifest,
)
from agenticx.learning.trajectory.task_split import (
    assert_trainable_task,
    load_split,
)


@pytest.fixture
def code_parquet(tmp_path: Path) -> Path:
    import pandas as pd

    row = {
        "data_source": "opensource-code",
        "ability": "swe",
        "agent_name": "mimo_swe_agent",
        "prompt": [{"role": "user", "content": "Fix the bug in utils.py"}],
        "reward_model": {"ground_truth": "", "style": "rule"},
        "extra_info": {
            "dataset_type": "opensource-code",
            "index": 1,
            "instance_id": "demo-001",
            "instance_json": json.dumps({
                "cwd": "/testbed",
                "dataset_type": "opensource-code",
                "docker_image": "demo-img:latest",
                "instance_id": "demo-001",
                "problem_statement": "fix bug",
                "test_command": "bash /testbed/run_tests.sh",
                "test_patch": "diff --git a/x b/x",
                "verifier_timeout_sec": 600,
            }),
        },
    }
    p = tmp_path / "code.parquet"
    pd.DataFrame([row]).to_parquet(p)
    return p


@pytest.fixture
def cyber_parquet(tmp_path: Path) -> Path:
    import pandas as pd

    row = {
        "data_source": "arvo",
        "agent_name": "mimo_swe_agent",
        "prompt": [{"role": "user", "content": "Reproduce CVE in dnsmasq"}],
        "reward_model": {"style": "rule", "ground_truth": ""},
        "extra_info": {
            "index": 0,
            "instance_id": "arvo_1",
            "dataset_type": "arvo",
            "instance_json": json.dumps({
                "instance_id": "arvo_1",
                "docker_image": "arvo-rl:v1-arvo-1",
                "dataset_type": "arvo",
                "cwd": "/home/agent",
                "problem_statement": "heap overflow",
                "description": "AddressSanitizer in rfc1035.c",
            }),
        },
    }
    p = tmp_path / "cyber.parquet"
    pd.DataFrame([row]).to_parquet(p)
    return p


def test_parse_code_parquet(code_parquet: Path):
    tasks = parse_code_parquet(code_parquet)
    assert len(tasks) == 1
    t = tasks[0]
    assert t.task_id == "code-demo-001"
    assert t.domain == "code"
    assert t.verifier_type == "executable"
    assert t.verifier_ref == "bash /testbed/run_tests.sh"
    assert t.docker_image == "demo-img:latest"
    assert t.instruction == "Fix the bug in utils.py"
    assert t.extras["timeout_sec"] == 600


def test_parse_cyber_parquet(cyber_parquet: Path):
    tasks = parse_cyber_parquet(cyber_parquet)
    assert len(tasks) == 1
    t = tasks[0]
    assert t.task_id == "cyber-arvo_1"
    assert t.domain == "cyber"
    assert t.verifier_type == "rule"


def test_general_manifest_judge_rejected(tmp_path: Path):
    """run_verify.py 若以 agent_judge 为主路径（无默认关闭）→ 拒收。"""
    env = tmp_path / "env_judge"
    env.mkdir()
    (env / "manifest.json").write_text(json.dumps({"cwd": "/work/workspace"}))
    (env / "run_verify.py").write_text(
        "VERIFY_AGENT_JUDGE = os.environ.get('VERIFY_AGENT_JUDGE', '1')\n")
    (env / "instruction.md").write_text("Do the thing")
    assert parse_general_manifest(env / "manifest.json", "env_judge") is None


def test_general_manifest_deterministic_ok(tmp_path: Path):
    """deterministic 默认开、judge 默认关（'0'）→ 收, 且匿名化生效。"""
    env = tmp_path / "env_ok"
    env.mkdir()
    (env / "manifest.json").write_text(json.dumps({"cwd": "/work/workspace"}))
    (env / "run_verify.py").write_text(
        "VERIFY_DETERMINISTIC=1 (default) — include deterministic rubrics\n"
        "VERIFY_AGENT_JUDGE=0   (default) — skip agent_judge rubrics\n")
    (env / "instruction.md").write_text(
        "Query the KPMG tax modeling hub and update SharePoint library")
    t = parse_general_manifest(env / "manifest.json", "env_ok")
    assert t is not None
    assert t.domain == "general"
    assert t.verifier_type == "rule"
    assert "KPMG" not in t.instruction
    assert "consulting-firm-a" in t.instruction


def test_anonymization_map():
    out = task_pool._sanitize("SharePoint + Salesforce + dealcloud")
    assert "SharePoint" not in out
    assert "collab-platform-a" in out and "crm-suite-a" in out


def test_write_pool_manifest(tmp_path: Path, code_parquet: Path, cyber_parquet: Path):
    tasks = parse_code_parquet(code_parquet) + parse_cyber_parquet(cyber_parquet)
    out = tmp_path / "pool.json"
    summary = write_pool_manifest(tasks, out)
    assert summary["total"] == 2
    assert summary["by_domain"] == {"code": 1, "cyber": 1}
    assert summary["by_verifier"] == {"executable": 1, "rule": 1}
    data = json.loads(out.read_text())
    assert {t["task_id"] for t in data["tasks"]} == {"code-demo-001", "cyber-arvo_1"}


def test_guard_accepts_pool_task(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """多域池任务（带前缀）过守卫: 不在 TB 拆分名单, 但在池内 → 放行。"""
    pool = tmp_path / "task_pool.json"
    pool.write_text(json.dumps({
        "summary": {"total": 1},
        "tasks": [{"task_id": "code-demo-001", "domain": "code"}],
    }))
    monkeypatch.setattr("agenticx.learning.trajectory.task_split._DEFAULT_POOL", pool)
    split = {"seed": "tb40-v1", "ratio": 0.2,
             "train": ["tb-task-a"], "heldout": ["tb-task-b"]}
    # 池内任务放行（不在 heldout）
    assert_trainable_task("code-demo-001", split)
    # TB 训练题放行
    assert_trainable_task("tb-task-a", split)
    # 未知任务拒绝
    with pytest.raises(ValueError, match="不在任务名单"):
        assert_trainable_task("ghost-task", split)


def test_guard_heldout_still_blocks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """TB held-out 拦截语义不受池扩展影响。"""
    pool = tmp_path / "task_pool.json"
    pool.write_text(json.dumps({"summary": {"total": 0}, "tasks": []}))
    monkeypatch.setattr("agenticx.learning.trajectory.task_split._DEFAULT_POOL", pool)
    split = {"seed": "tb40-v1", "ratio": 0.2,
             "train": ["tb-task-a"], "heldout": ["tb-task-b"]}
    from agenticx.trainer.heldout import HeldoutViolation
    with pytest.raises(HeldoutViolation):
        assert_trainable_task("tb-task-b", split)


def test_real_pool_split_no_overlap():
    """真实数据: 池任务与 TB held-out 零交集（前缀隔离）。"""
    pool_path = task_pool.__dict__.get("Path")  # noqa: F841 仅为引用模块
    from agenticx.learning.trajectory.task_split import load_pool_tasks
    split = load_split()
    pool = load_pool_tasks()
    if not pool:
        pytest.skip("datasets/task_pool.json 未生成")
    overlap = pool & set(split["heldout"]) & set(split["train"])
    assert not overlap
    assert all(t.startswith(("code-", "cyber-", "general-")) for t in pool)
