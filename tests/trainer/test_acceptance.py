# tests/trainer/test_acceptance.py
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "trajectory"))
from test_schema import _traj  # noqa: E402

from agenticx.learning.trajectory.store import TrajectoryStore
from agenticx.trainer.builders import build_sft
from agenticx.trainer.exporters import export_llama_factory, write_card
from agenticx.trainer.heldout import heldout_split
from agenticx.trainer.registry import ModelRegistry

def test_acceptance_pipeline_synthetic(tmp_path):
    # ② 采集入库
    store = TrajectoryStore(tmp_path / "store")
    assert store.append(_traj()) == "written"
    # ④ 蒸馏 + 导出（ratio=0 → 无 heldout）
    trajs = list(store.iter_trajectories())
    split = heldout_split([t.task_id for t in trajs], ratio=0.0)
    samples = build_sft(trajs, split)
    assert samples, "SFT 构建不得为空"
    export_llama_factory(samples, tmp_path / "ds", "acc-sft")
    info = json.load(open(tmp_path / "ds" / "dataset_info.json"))
    assert info["acc-sft"]["formatting"] == "sharegpt"   # LLaMA-Factory 可加载
    # ③ card 溯源
    write_card(tmp_path / "ds", name="acc-sft", kind="sft", n_samples=len(samples),
               tasks=list(split.train), heldout=list(split.heldout), scrub_hits=0)
    assert (tmp_path / "ds" / "acc-sft.card.md").exists()
    # ⑥ 注册表生命周期
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("agent-coding-v1", model_spec="openai/glm-5.3-flash-sft-v1")
    reg.promote("agent-coding-v1")
    assert reg.resolve("agent-coding-v1")["model"] == "openai/glm-5.3-flash-sft-v1"
    reg.rollback("agent-coding-v1")  # 单版本回滚后无 promoted → 可 LookupError，不 crash 流程

def test_heldout_guard_blocks_contamination(tmp_path):
    store = TrajectoryStore(tmp_path / "store")
    store.append(_traj())            # task_id=fin-saccr-rwa
    trajs = list(store.iter_trajectories())
    split = heldout_split([t.task_id for t in trajs], seed="force-heldout", ratio=1.0)
    from agenticx.trainer.heldout import HeldoutViolation
    import pytest
    with pytest.raises(HeldoutViolation):
        build_sft(trajs, split)      # held-out 任务必须被硬性拒绝
