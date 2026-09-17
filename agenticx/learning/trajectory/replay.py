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
