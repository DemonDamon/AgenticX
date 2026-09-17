# tests/trajectory/test_forest.py
from agenticx.learning.trajectory.forest import StepFeatures, extract_step_features
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
