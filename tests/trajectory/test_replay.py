# tests/trajectory/test_replay.py
import pytest
from agenticx.learning.trajectory.forest import AttemptNode, StepFeatures
from agenticx.learning.trajectory.replay import ReplayAttempt, ReplayResult

def _node(n=3, passed=True, tokens=100):
    steps = [StepFeatures(step=i, n_messages=i + 1, n_tool_calls=0,
                          tool_success_rate=-1.0, consecutive_failures=0,
                          rounds_since_progress=0, est_tokens=tokens * (i + 1))
             for i in range(n)]
    return AttemptNode(attempt_id="a1", task_id="t", model="m",
                       status="pass" if passed else "fail",
                       reward_label=1.0 if passed else 0.0,
                       n_steps=n, total_est_tokens=tokens * n, steps=steps)

def test_reset_returns_step0():
    r = ReplayAttempt(_node())
    obs = r.reset()
    assert obs.step == 0 and obs.est_tokens == 100

def test_continue_to_end_collects_recorded_outcome():
    r = ReplayAttempt(_node(n=3, passed=True, tokens=100))
    r.reset()
    assert r.step("continue").step == 1
    assert r.step("continue").step == 2
    assert r.step("continue") is None            # 终局
    res = r.result
    assert res.aborted is False and res.achieved_reward == 1.0
    assert res.virtual_cost == 300

def test_abort_stops_cost_at_current_step():
    r = ReplayAttempt(_node(n=3, passed=True, tokens=100))
    r.reset()
    r.step("continue")                           # 到 step1, est=200
    assert r.step("abort") is None
    res = r.result
    assert res.aborted and res.abort_step == 1
    assert res.achieved_reward == 0.0            # 止损=无产出
    assert res.virtual_cost == 200               # 只付已烧掉的部分

def test_invalid_action_and_terminal_guard():
    r = ReplayAttempt(_node(n=2))
    r.reset()
    with pytest.raises(ValueError):
        r.step("fork")                           # P0.5 无此动作
    r.step("continue"); r.step("continue")       # 终局
    with pytest.raises(RuntimeError):
        r.step("continue")                       # 已终结不可再 step
    res = r.result                               # 终局后 result 可读
    assert res.aborted is False
    r2 = ReplayAttempt(_node(n=2)); r2.reset(); r2.step("abort")
    with pytest.raises(RuntimeError):
        r2.step("continue")
    r3 = ReplayAttempt(_node(n=2)); r3.reset()    # 未终局时 result 不可读
    with pytest.raises(RuntimeError):
        _ = r3.result
