# tests/rl/test_replay_bridge.py
import json

from agenticx.learning.trajectory.forest import TrialForest
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory
from agenticx.rl.replay_bridge import (
    task_replay_scores, task_replay_scores_from_jobs,
)


def _traj(task, label):
    return RSITrajectory(
        source="harbor-tb40", task_id=task, session_id=f"s-{task}-{label}",
        model="m", status="pass" if label >= 1 else "fail",
        reward=RewardRecord(label=label, source="verifier",
                            components={"verifier": label}),
        messages=[], tool_calls=[], decision_lineage=[], token_usage={},
        created_at="", metadata={},
    )


def test_task_replay_scores_pass_rate():
    f = TrialForest.from_trajectories(
        [_traj("terminal-bench/a", 1.0), _traj("terminal-bench/a", 0.0),
         _traj("terminal-bench/b", 1.0)])
    s = task_replay_scores(f)
    assert s["terminal-bench/a"] == 0.5
    assert s["terminal-bench/b"] == 1.0


def test_task_replay_scores_empty_forest():
    assert task_replay_scores(TrialForest.from_trajectories([])) == {}


def test_task_replay_scores_partial_reward_counts():
    # partial（0.5）按连续值平均，不是 0/1
    f = TrialForest.from_trajectories(
        [_traj("t/a", 0.5), _traj("t/a", 1.0)])
    assert task_replay_scores(f)["t/a"] == 0.75


def _make_job(jobs, task_name, label):
    d = jobs / "job-tb40" / f"{task_name}__h{abs(hash(task_name + str(label))) % 9999:04x}"
    (d / "agent").mkdir(parents=True)
    (d / "result.json").write_text(json.dumps({
        "task_name": f"terminal-bench/{task_name}",
        "verifier_result": {"rewards": {"reward": label}}}))
    (d / "config.json").write_text(json.dumps(
        {"task": {"name": f"terminal-bench/{task_name}"}}))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps(
        {"agent": "agenticx", "model": "m", "success": label >= 1,
         "messages": [], "totals": {}}))
    return d


def test_task_replay_scores_from_jobs(tmp_path):
    _make_job(tmp_path, "alpha", 1.0)
    _make_job(tmp_path, "alpha", 0.0)
    _make_job(tmp_path, "beta", 1.0)
    s = task_replay_scores_from_jobs(tmp_path)
    assert s["terminal-bench/alpha"] == 0.5
    assert s["terminal-bench/beta"] == 1.0


def test_task_replay_scores_from_jobs_pattern(tmp_path):
    _make_job(tmp_path, "alpha", 1.0)
    d = tmp_path / "job-other" / "gamma__h0001"
    (d / "agent").mkdir(parents=True)
    (d / "result.json").write_text(json.dumps({
        "task_name": "terminal-bench/gamma",
        "verifier_result": {"rewards": {"reward": 1.0}}}))
    (d / "config.json").write_text(json.dumps({"task": {"name": "x"}}))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps(
        {"messages": [], "totals": {}}))
    s = task_replay_scores_from_jobs(tmp_path)                # 默认 *tb40*
    assert "terminal-bench/gamma" not in s
    s2 = task_replay_scores_from_jobs(tmp_path, job_pattern="*other*")
    assert "terminal-bench/gamma" in s2


def test_bridge_feeds_replay_shaping_end_to_end():
    """桥接输出直接可作 replay_shaped_advantage 的 replay_scores。"""
    from agenticx.rl.replay_shaping import replay_shaped_advantage
    f = TrialForest.from_trajectories(
        [_traj("t/a", 1.0), _traj("t/a", 0.0)])
    scores = task_replay_scores(f)
    adv = replay_shaped_advantage([1.0, 0.0], ["t/a", "t/a"], scores,
                                  replay_weight=1.0)
    assert adv.shape == (2,)          # 基线 0.5：+0.5/-0.5（std=0.5 → [1,-1]）
    assert adv[0] > 0 > adv[1]
