# agenticx/learning/trajectory/decision_policy.py
"""DecisionHeadPolicy：把决策头接入回放策略层（SP27）。

TrialForest 的 Policy 协议（continue/abort）是判断层在飞轮内的第一个
生产宿主：SP26 已证当前 TB 数据 bash-only（tool_selection 退化），
continue_stop 是有真实数据支撑的决策类型——AttemptNode.steps 的
StepFeatures 逐步特征即决策 state。

state 同构纪律：state_builder 是 StepFeatures+AttemptContext 的确定性
纯函数，版本 step-features-v1；fail-open → continue（早停错杀的代价
是任务直接失败，宁可多跑）。
"""
from __future__ import annotations

import uuid

from agenticx.rl.decision import DecisionQuestion, DecisionRecord
from agenticx.rl.decision_scorers import Scorer

from .forest import StepFeatures
from .replay import AttemptContext

STATE_COMPRESSOR = "step-features-v1"


def render_step_state(obs: StepFeatures, ctx: AttemptContext) -> str:
    """StepFeatures + AttemptContext → 确定性文本 state（版本随常量走）。"""
    rate = ("n/a" if obs.tool_success_rate < 0
            else f"{obs.tool_success_rate:.2f}")
    return (
        f"task: {ctx.task_id}\n"
        f"attempt: {ctx.attempt_index + 1}/{ctx.attempt_index + ctx.attempts_remaining} "
        f"(remaining: {ctx.attempts_remaining})\n"
        f"step: {obs.step} of {obs.n_messages} messages\n"
        f"tool_calls: {obs.n_tool_calls} (success_rate: {rate})\n"
        f"consecutive_failures: {obs.consecutive_failures}\n"
        f"rounds_since_progress: {obs.rounds_since_progress}\n"
        f"est_tokens_so_far: {obs.est_tokens} (budget_spent: {ctx.spent_so_far})")


class DecisionHeadPolicy:
    """决策头驱动的 continue/abort 早停策略。

    对每步问一个 yes_no：'该 attempt 是否应立即止损'；p(yes)≥tau_abort
    才 abort。任何异常 → continue（fail-open）+ degraded 计数。
    """

    def __init__(self, scorer: Scorer, *, tau_abort: float = 0.6,
                 name: str = ""):
        self.scorer = scorer
        self.tau_abort = tau_abort
        self.name = name or f"decision_head_tau{tau_abort}"
        self.n_calls = 0
        self.n_degraded = 0

    def _p_abort(self, obs: StepFeatures, ctx: AttemptContext) -> float:
        self.n_calls += 1
        q = DecisionQuestion(qid="q_abort", type="yes_no",
                             question="该尝试已无成功希望，应立即止损放弃吗？")
        rec = DecisionRecord(
            decision_id=f"pol-{uuid.uuid4().hex[:12]}",
            rollout_id=f"{ctx.task_id}#{ctx.attempt_index}",
            turn=obs.step, task_id=ctx.task_id, decision_type="continue_stop",
            state=render_step_state(obs, ctx),
            state_compressor=STATE_COMPRESSOR, questions=(q,), created_at="")
        try:
            probs = self.scorer(rec)["q_abort"]
            return probs[0]              # symbols 固定 (yes, no)
        except Exception:
            self.n_degraded += 1
            return 0.0                   # fail-open → continue

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return "abort" if self._p_abort(obs, ctx) >= self.tau_abort else "continue"
