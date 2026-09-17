# agenticx/learning/trajectory/replay.py
"""回放模拟器（P0.5 · Dream-RSI 的 Evolving World 等价物）。

零推理成本：候选策略在已记录轨迹上重调度，回放只"揭开"历史数据。
P0.5 动作空间 = {continue, abort}；fork/switch 需工作区快照，属 P1。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .forest import AttemptNode, StepFeatures, TaskTree, TrialForest

Action = str  # "continue" | "abort"

@dataclass
class ReplayResult:
    aborted: bool
    abort_step: int | None
    achieved_reward: float
    virtual_cost: int

class ReplayAttempt:
    """单条轨迹的回放：观察前缀特征 → 动作 → 揭示已记录的后继。"""

    def __init__(self, node: AttemptNode):
        if node.n_steps <= 0 or not node.steps:
            raise ValueError("attempt 无可回放步骤")
        self.node = node
        self._pos = 0
        self._done = False
        self._aborted = False

    def reset(self) -> StepFeatures:
        self._pos, self._done, self._aborted = 0, False, False
        return self.node.steps[0]

    def step(self, action: Action) -> StepFeatures | None:
        if self._done:
            raise RuntimeError("episode 已终结, 请 reset")
        if action == "abort":
            self._done, self._aborted = True, True
            return None
        if action != "continue":
            raise ValueError(f"未知动作 '{action}'（P0.5 仅支持 continue/abort）")
        self._pos += 1
        if self._pos >= self.node.n_steps:
            self._done = True
            return None
        return self.node.steps[self._pos]

    @property
    def result(self) -> ReplayResult:
        if not self._done:
            raise RuntimeError("episode 未终结, 无结果")
        if self._aborted:
            return ReplayResult(True, self._pos, 0.0,
                                self.node.steps[self._pos].est_tokens)
        return ReplayResult(False, None,
                            1.0 if self.node.passed else 0.0,
                            self.node.total_est_tokens)

@dataclass
class AttemptContext:
    task_id: str
    attempt_index: int
    attempts_remaining: int
    spent_so_far: int

@dataclass
class PolicyScore:
    task_id: str
    passed: bool
    total_cost: int
    n_attempts_used: int

def evaluate_policy_on_tree(policy, tree: TaskTree, max_attempts: int = 3) -> PolicyScore:
    """按 attempt_id 顺序重放（论文的分支调度在 P0.5 退化为顺序调度）。"""
    ordered = tree.attempts[:max_attempts]
    spent = 0
    used = 0
    for i, node in enumerate(ordered):
        if node.n_steps == 0:
            continue
        used = i + 1
        ctx = AttemptContext(task_id=tree.task_id, attempt_index=i,
                             attempts_remaining=len(ordered) - i - 1,
                             spent_so_far=spent)
        r = ReplayAttempt(node)
        obs = r.reset()
        while True:
            obs = r.step(policy.act(obs, ctx))
            if obs is None:
                break
        res = r.result
        spent += res.virtual_cost
        if res.achieved_reward >= 1.0:
            return PolicyScore(tree.task_id, True, spent, used)
    return PolicyScore(tree.task_id, False, spent, used)

def evaluate_policy(policy, forest: TrialForest,
                    task_ids: list[str] | None = None,
                    max_attempts: int = 3) -> list[PolicyScore]:
    ids = sorted(task_ids) if task_ids is not None else sorted(forest.trees)
    return [evaluate_policy_on_tree(policy, forest.trees[t], max_attempts)
            for t in ids if t in forest.trees]

def summarize(scores: list[PolicyScore]) -> dict[str, Any]:
    n = len(scores)
    passed = sum(s.passed for s in scores)
    total = sum(s.total_cost for s in scores)
    return {"n_tasks": n, "pass_rate": passed / n if n else 0.0,
            "total_cost": total, "avg_cost": total / n if n else 0.0}

def forest_score(scores: list[PolicyScore]) -> float:
    """论文式复合得分：结果优先,代价为tiebreak（1 个任务通过 >> 千级 token 节省）。"""
    return sum(s.passed for s in scores) * 10000 - sum(s.total_cost for s in scores)
