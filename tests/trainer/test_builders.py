# tests/trainer/test_builders.py
import pytest
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
from agenticx.trainer.heldout import heldout_split
from agenticx.trainer.builders import build_sft, build_dpo

def _traj(task: str, status: str, content: str = "answer", label: float | None = None):
    lbl = {"pass": 1.0, "fail": 0.0, "partial": 0.5}.get(status, -1.0) if label is None else label
    return RSITrajectory(
        source="harbor-tb40", task_id=task, session_id=f"s-{task}-{status}", model="m",
        status=status, reward=RewardRecord(label=lbl),
        messages=[{"role": "user", "content": f"do {task}"},
                  {"role": "assistant", "content": content}],
    )

def test_build_sft_pass_only_with_guard(tmp_path):
    split = heldout_split(["t1", "t2"], seed="v1", ratio=0.0)  # 全部可训练
    samples = build_sft([_traj("t1", "pass"), _traj("t1", "fail")], split)
    assert len(samples) == 1                          # 只收 pass
    conv = samples[0]["conversations"]
    assert conv[0]["from"] == "human" and conv[1]["from"] == "gpt"

def test_build_sft_rejects_heldout():
    split = heldout_split(["t1", "t2"], seed="v1", ratio=1.0)  # 全 heldout，确定性
    trajs = [_traj(t, "pass") for t in ["t1", "t2"]]
    from agenticx.trainer.heldout import HeldoutViolation
    with pytest.raises(HeldoutViolation):
        build_sft(trajs, split)

def test_build_sft_skips_unlabeled():
    split = heldout_split(["t1"], seed="v1", ratio=0.0)
    assert build_sft([_traj("t1", "unlabeled")], split) == []

def test_build_dpo_pairs_same_task():
    split = heldout_split(["t1"], seed="v1", ratio=0.0)
    pairs = build_dpo([_traj("t1", "pass", "good"), _traj("t1", "fail", "bad")], split)
    assert len(pairs) == 1
    assert pairs[0]["chosen"]["value"] == "good"
    assert pairs[0]["rejected"]["value"] == "bad"

def test_build_dpo_no_pair_without_fail():
    split = heldout_split(["t1"], seed="v1", ratio=0.0)
    assert build_dpo([_traj("t1", "pass")], split) == []
