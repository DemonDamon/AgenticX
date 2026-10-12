# tests/trajectory/test_replay.py
import pytest
from agenticx.learning.trajectory.forest import (
    AttemptNode, StepFeatures, TaskTree, TrialForest,
)
from agenticx.learning.trajectory.replay import (
    ReplayAttempt, ReplayResult,
    AttemptContext, PolicyScore, evaluate_policy_on_tree,
    evaluate_policy, summarize, forest_score,
)

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

# ---- Task 2: 任务树/森林上的策略评测 ----
from agenticx.learning.trajectory.forest import StepFeatures as SF

def _attempt(aid, label, n=2, tokens=100):
    steps = [SF(step=i, n_messages=i + 1, n_tool_calls=0, tool_success_rate=-1.0,
                consecutive_failures=0, rounds_since_progress=0,
                est_tokens=tokens * (i + 1)) for i in range(n)]
    return AttemptNode(attempt_id=aid, task_id="t", model="m",
                       status="pass" if label >= 1 else "fail",
                       reward_label=label, n_steps=n,
                       total_est_tokens=tokens * n, steps=steps)

class AlwaysAbort:                                # 第一步就止损
    name = "always_abort"
    def act(self, obs, ctx): return "abort"

class AlwaysContinue:                             # 永不放弃（论文固定探索基线）
    name = "always_continue"
    def act(self, obs, ctx): return "continue"

class AbortOnStep2:
    name = "abort_on_step2"
    def act(self, obs, ctx): return "abort" if obs.step >= 1 else "continue"

def test_tree_pass_via_second_attempt():
    tree = TaskTree(task_id="t", attempts=[_attempt("a1", 0.0), _attempt("a2", 1.0)])
    s = evaluate_policy_on_tree(AlwaysContinue(), tree, max_attempts=3)
    assert s.passed and s.n_attempts_used == 2
    assert s.total_cost == 400                     # 200(失败全程)+200(成功全程)

def test_tree_abort_saves_cost_but_no_pass():
    tree = TaskTree(task_id="t", attempts=[_attempt("a1", 1.0, n=3, tokens=100)])
    s = evaluate_policy_on_tree(AlwaysAbort(), tree, max_attempts=3)
    assert not s.passed and s.total_cost == 100    # 每个 attempt 只烧第 0 步
    assert s.n_attempts_used == 1

def test_tree_partial_then_pass_with_mid_policy():
    tree = TaskTree(task_id="t", attempts=[
        _attempt("a1", 0.0, n=5, tokens=100), _attempt("a2", 1.0, n=1, tokens=100)])
    s = evaluate_policy_on_tree(AbortOnStep2(), tree, max_attempts=3)
    # a1: continue→step1, abort → cost 200; a2: 单步,continue 即终局 pass → cost 100
    assert s.passed and s.total_cost == 300 and s.n_attempts_used == 2

def test_max_attempts_caps_scheduling():
    tree = TaskTree(task_id="t", attempts=[
        _attempt(f"a{i}", 0.0, n=1, tokens=50) for i in range(5)])
    s = evaluate_policy_on_tree(AlwaysContinue(), tree, max_attempts=2)
    assert not s.passed and s.total_cost == 100 and s.n_attempts_used == 2

def test_evaluate_policy_and_summarize():
    forest = TrialForest(trees={
        "t1": TaskTree("t1", [_attempt("a", 1.0, n=1, tokens=100)]),
        "t2": TaskTree("t2", [_attempt("b", 0.0, n=1, tokens=100)]),
    })
    scores = evaluate_policy(AlwaysContinue(), forest, max_attempts=3)
    assert {s.task_id: s.passed for s in scores} == {"t1": True, "t2": False}
    summ = summarize(scores)
    assert summ["n_tasks"] == 2 and summ["pass_rate"] == 0.5
    assert summ["total_cost"] == 200
    assert forest_score(scores) == 1 * 10000 - 200

def test_context_carries_scheduling_state():
    seen = []
    class Spy:
        name = "spy"
        def act(self, obs, ctx):
            seen.append((ctx.attempt_index, ctx.attempts_remaining, ctx.spent_so_far))
            return "abort"
    tree = TaskTree("t", [_attempt("a1", 0.0, n=1, tokens=10),
                          _attempt("a2", 0.0, n=1, tokens=20)])
    evaluate_policy_on_tree(Spy(), tree, max_attempts=3)
    assert seen[0] == (0, 1, 0) and seen[1] == (1, 0, 10)
