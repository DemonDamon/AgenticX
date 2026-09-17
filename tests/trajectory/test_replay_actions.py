# tests/trajectory/test_replay_actions.py
"""inject_hint 动作语义: 回放中 hint 不改变已记录的未来, 只按 len//4 计价。"""
import pytest

from agenticx.learning.trajectory.forest import (
    AttemptNode, StepFeatures, TaskTree, TrialForest,
)
from agenticx.learning.trajectory.replay import ReplayAttempt, evaluate_policy


def _node(n_steps: int = 4, passed: bool = True) -> AttemptNode:
    steps = [StepFeatures(step=i, n_messages=i + 1, n_tool_calls=1,
                          tool_success_rate=1.0, consecutive_failures=0,
                          rounds_since_progress=0, est_tokens=100 * (i + 1))
             for i in range(n_steps)]
    return AttemptNode(attempt_id="a1", task_id="t1", model="m", status="pass",
                       reward_label=1.0 if passed else 0.0, n_steps=n_steps,
                       total_est_tokens=400, steps=steps)


class HintThenFinishPolicy:
    name = "hint_then_finish"

    def act(self, obs, ctx) -> str:
        if obs.step == 0:
            return "inject_hint::check the config file path before retrying"
        return "continue"


class AbortAfterHintPolicy:
    name = "abort_after_hint"

    def act(self, obs, ctx) -> str:
        if obs.step == 0:
            return "inject_hint::short"
        return "abort"


def test_hint_policy_reaches_same_reward_but_pays_cost():
    r = ReplayAttempt(_node())
    obs = r.reset()
    while True:
        obs = r.step(HintThenFinishPolicy().act(obs, None))
        if obs is None:
            break
    res = r.result
    assert res.achieved_reward == 1.0                    # 与纯 continue 同 reward
    assert res.virtual_cost > 400                        # 基线 total_est_tokens
    assert res.hint_tokens == len("check the config file path before retrying") // 4
    assert not res.aborted


def test_hint_then_abort_accounting():
    r = ReplayAttempt(_node())
    obs = r.reset()
    while True:
        obs = r.step(AbortAfterHintPolicy().act(obs, None))
        if obs is None:
            break
    res = r.result
    assert res.aborted and res.abort_step == 1
    assert res.virtual_cost == 200 + len("short") // 4   # abort 处 est_tokens + hint
    assert res.achieved_reward == 0.0


def test_unknown_action_still_rejected():
    r = ReplayAttempt(_node())
    r.reset()
    with pytest.raises(ValueError):
        r.step("fork_workspace")                          # P1 之外的动作仍拒绝


def test_empty_hint_is_free_continue():
    r = ReplayAttempt(_node())
    obs = r.reset()
    obs = r.step("inject_hint::")
    assert obs is not None                                # 等价 continue
    while obs is not None:
        obs = r.step("continue")
    res_after_full = r.result
    assert res_after_full.hint_tokens == 0


def test_evaluate_policy_accepts_hint_policy():
    """集成: evaluate_policy 全链路接受发 hint 的策略（forest_score 可计算）。"""
    # 直接手工组树（避免依赖 TrialForest 内部构建 API）:
    forest = TrialForest()
    tree = TaskTree(task_id="t1")
    tree.attempts = [_node()]
    forest.trees["t1"] = tree
    scores = evaluate_policy(HintThenFinishPolicy(), forest)
    assert scores[0].passed and scores[0].total_cost > 400
