# tests/trajectory/test_decision_policy.py
"""SP27 DecisionHeadPolicy 测试：state 渲染 / tau 决策 / fail-open /
与 policy_report 的基线可比性。"""
from __future__ import annotations

from agenticx.learning.trajectory.decision_policy import (
    DecisionHeadPolicy,
    render_step_state,
)
from agenticx.learning.trajectory.forest import StepFeatures
from agenticx.learning.trajectory.policy import baseline_policies
from agenticx.learning.trajectory.replay import AttemptContext
from agenticx.learning.trajectory.forest import TrialForest
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord


def _obs(**kw):
    base = dict(step=3, n_messages=4, n_tool_calls=2, tool_success_rate=0.5,
                consecutive_failures=1, rounds_since_progress=2, est_tokens=100)
    base.update(kw)
    return StepFeatures(**base)


def _ctx():
    return AttemptContext(task_id="t-1", attempt_index=0,
                          attempts_remaining=2, spent_so_far=50)


class TestStateRender:
    def test_deterministic_and_versioned(self):
        s1 = render_step_state(_obs(), _ctx())
        s2 = render_step_state(_obs(), _ctx())
        assert s1 == s2
        assert "consecutive_failures: 1" in s1
        assert "remaining: 2" in s1
        assert "success_rate: 0.50" in s1


def _scorer(p_abort: float | Exception):
    def scorer(rec):
        if isinstance(p_abort, Exception):
            raise p_abort
        assert rec.decision_type == "continue_stop"
        assert rec.questions[0].qid == "q_abort"
        return {"q_abort": (p_abort, 1.0 - p_abort)}
    return scorer


class TestPolicy:
    def test_abort_above_tau(self):
        p = DecisionHeadPolicy(_scorer(0.7), tau_abort=0.6)
        assert p.act(_obs(), _ctx()) == "abort"

    def test_continue_below_tau(self):
        p = DecisionHeadPolicy(_scorer(0.59), tau_abort=0.6)
        assert p.act(_obs(), _ctx()) == "continue"

    def test_fail_open_continues(self):
        p = DecisionHeadPolicy(_scorer(RuntimeError("boom")), tau_abort=0.6)
        assert p.act(_obs(), _ctx()) == "continue"
        assert p.n_degraded == 1 and p.n_calls == 1

    def test_comparable_with_baselines_in_report(self):
        def traj(task, aid, label, msgs):
            return RSITrajectory(
                source="harbor-tb40", task_id=task, session_id=aid, model="m",
                status="pass" if label >= 1 else "fail",
                reward=RewardRecord(label=label), messages=msgs)

        msgs = [{"role": "user", "content": "go"},
                {"role": "assistant", "content": "", "tool_calls": [
                    {"id": "a", "type": "function",
                     "function": {"name": "bash", "arguments": "{}"}}]},
                {"role": "tool", "tool_call_id": "a", "content": "error: x"}]
        forest = TrialForest.from_trajectories([
            traj("t1", "a1", 0.0, msgs), traj("t1", "a2", 1.0, msgs),
            traj("t2", "b1", 1.0, msgs), traj("t3", "c1", 0.0, msgs),
            traj("t4", "d1", 0.0, msgs), traj("t5", "e1", 1.0, msgs)])
        policies = baseline_policies() + [
            DecisionHeadPolicy(_scorer(0.95), tau_abort=0.9)]
        from agenticx.learning.trajectory.policy import policy_report
        report = policy_report(policies, forest)
        assert "decision_head_tau0.9" in report["train"]
        assert set(report["train"]) == {p.name for p in policies}
        # p_abort=0.95 恒超 tau → 激进 abort，与基线同表可比（成本结构差异可见）
        assert report["train"]["decision_head_tau0.9"]["n_tasks"] > 0
