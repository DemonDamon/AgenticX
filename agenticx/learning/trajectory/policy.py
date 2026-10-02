# agenticx/learning/trajectory/policy.py
"""策略层（P0.5 · Dream-RSI 的探索策略等价物）。

策略 = 纯决策函数：输入逐步特征 + 调度上下文, 输出 continue/abort。
P0.5 提供启发式基线; SP8 的演化循环产出 LLM 重写的策略源码变体。
"""
from __future__ import annotations

from typing import Any, Protocol

from .forest import StepFeatures
from .replay import AttemptContext, TrialForest, evaluate_policy, summarize


class Policy(Protocol):
    name: str

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str: ...


class NeverAbortPolicy:
    """论文"固定探索基线"等价物：永不止损, 全程执行。"""
    name = "never_abort"

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return "continue"


class FixedHorizonPolicy:
    """超过固定步数即止损。"""
    def __init__(self, max_steps: int = 10):
        self.max_steps = max_steps
        self.name = f"fixed_horizon_{max_steps}"

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return "abort" if obs.step >= self.max_steps else "continue"


class ErrorStreakPolicy:
    """连续 k 次工具失败 → 大概率死循环, 止损。"""
    def __init__(self, max_streak: int = 3):
        self.max_streak = max_streak
        self.name = f"error_streak_{max_streak}"

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return "abort" if obs.consecutive_failures >= self.max_streak else "continue"


class ProgressStallPolicy:
    """k 轮无任何进展（无成功工具结果/无实质文本）→ 止损。"""
    def __init__(self, max_stall: int = 8):
        self.max_stall = max_stall
        self.name = f"progress_stall_{max_stall}"

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return "abort" if obs.rounds_since_progress >= self.max_stall else "continue"


from agenticx.trainer.heldout import heldout_split  # noqa: E402  (③评测隔离复用)


def baseline_policies() -> list[Policy]:
    """基线策略目录：论文基线 + 3 个启发式早停。"""
    return [
        NeverAbortPolicy(),
        FixedHorizonPolicy(max_steps=10),
        ErrorStreakPolicy(max_streak=3),
        ProgressStallPolicy(max_stall=8),
    ]


def policy_report(policies: list[Policy], forest: TrialForest,
                  seed: str = "v1", ratio: float = 0.2,
                  max_attempts: int = 3) -> dict[str, Any]:
    """train/held-out 双区评测报告。

    纪律（对齐论文严谨性）：held-out 区成绩仅用于验收报告,
    策略演化与选择（SP8）只允许引用 train 区——防止"策略过拟合历史树"。
    """
    split = heldout_split(sorted(forest.trees), seed=seed, ratio=ratio)
    out: dict[str, Any] = {
        "seed": seed,
        "max_attempts": max_attempts,
        "heldout_tasks": list(split.heldout),
        "train": {},
        "heldout": {},
    }
    for p in policies:
        out["train"][p.name] = summarize(
            evaluate_policy(p, forest, task_ids=list(split.train), max_attempts=max_attempts))
        out["heldout"][p.name] = summarize(
            evaluate_policy(p, forest, task_ids=list(split.heldout), max_attempts=max_attempts))
    return out
