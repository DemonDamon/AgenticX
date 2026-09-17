# tests/trajectory/test_forest.py
from agenticx.learning.trajectory.forest import StepFeatures, extract_step_features
from agenticx.learning.trajectory.forest import (
    AttemptNode, TaskTree, TrialForest,
)
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord

def _traj(messages):
    return RSITrajectory(
        source="harbor-tb40", task_id="t", session_id="s", model="m",
        status="pass", reward=RewardRecord(label=1.0), messages=messages,
    )

def test_features_empty_assistant_counts_progress():
    msgs = [
        {"role": "user", "content": "solve"},
        {"role": "assistant", "content": ""},
        {"role": "assistant", "content": "done"},
    ]
    fs = extract_step_features(_traj(msgs))
    assert len(fs) == 3
    assert fs[0].n_messages == 1 and fs[0].est_tokens == len("solve") // 4
    assert fs[1].rounds_since_progress == 1          # 空 assistant 无进展
    assert fs[2].rounds_since_progress == 0          # 非空文本=进展

def test_features_tool_success_and_streak():
    msgs = [
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "bash", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "a", "content": "error: boom"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "b", "type": "function", "function": {"name": "bash", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "b", "content": "ok"},
    ]
    fs = extract_step_features(_traj(msgs))
    assert fs[1].n_tool_calls == 1                    # assistant 发起 1 次
    assert fs[2].consecutive_failures == 1            # error 结果 → streak=1
    assert fs[2].tool_success_rate == 0.0
    assert fs[4].consecutive_failures == 0            # ok 结果重置
    assert fs[4].tool_success_rate == 0.5
    assert fs[2].rounds_since_progress == 2           # user 后无进展直至 step2 仍无
    assert fs[4].rounds_since_progress == 0           # ok 工具结果=进展

def test_features_no_tool_calls_rate_is_sentinel():
    fs = extract_step_features(_traj([{"role": "user", "content": "x"}]))
    assert fs[0].tool_success_rate == -1.0
    assert fs[0].n_tool_calls == 0

def _node(task, aid, label, msgs=None):
    msgs = msgs or [{"role": "user", "content": "x"}]
    return RSITrajectory(
        source="harbor-tb40", task_id=task, session_id=aid, model="m",
        status="pass" if label >= 1 else "fail", reward=RewardRecord(label=label),
        messages=msgs,
    )

def test_forest_groups_attempts_by_task():
    forest = TrialForest.from_trajectories([
        _node("t1", "a1", 0.0), _node("t1", "a2", 1.0), _node("t2", "b1", 0.0),
    ])
    assert set(forest.trees) == {"t1", "t2"}
    assert len(forest.trees["t1"].attempts) == 2
    a1, a2 = forest.trees["t1"].attempts
    assert a1.attempt_id != a2.attempt_id and a2.passed and not a1.passed
    assert a1.n_steps == 1 and a1.steps[0].step == 0
    assert a1.total_est_tokens == a1.steps[-1].est_tokens

def test_forest_stats():
    forest = TrialForest.from_trajectories([
        _node("t1", "a1", 0.0), _node("t1", "a2", 1.0), _node("t2", "b1", 0.0),
    ])
    s = forest.stats()
    assert s["n_tasks"] == 2 and s["n_attempts"] == 3
    assert s["tasks_with_pass"] == 1 and s["avg_attempts"] == 1.5

def test_forest_save_load_roundtrip(tmp_path):
    forest = TrialForest.from_trajectories([_node("t1", "a1", 1.0)])
    p = tmp_path / "forest.jsonl"
    forest.save(p)
    loaded = TrialForest.load(p)
    assert loaded.trees["t1"].attempts[0].attempt_id == forest.trees["t1"].attempts[0].attempt_id
    assert loaded.trees["t1"].attempts[0].steps[0].est_tokens == \
        forest.trees["t1"].attempts[0].steps[0].est_tokens
