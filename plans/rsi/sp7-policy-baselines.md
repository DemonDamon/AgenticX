# SP7: Policy 框架与基线策略（P0.5 · 对齐 Dream-RSI 之策略层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 定义策略标准接口（输入=前缀特征+调度上下文，输出=continue/abort），实现论文"固定探索基线"等价物与 3 个启发式早停基线，并产出 train/held-out 双区策略对比报告（复用 SP2 的评测隔离，证明策略未过拟合）。

**Architecture:** `policy.py` 新模块：`Policy` 为 duck-typing 协议（SP6 评测器已按 `.act(obs, ctx)` 调用）；4 个基线策略纯特征驱动；`policy_report` 用 `agenticx.trainer.heldout.heldout_split` 做训练/评测物理隔离——**held-out 只用于验收报告，绝不参与策略选择**（论文严谨性 + 我们的 ③隔离原则）。依赖链：forest → replay → policy（本模块导入前两者，无环）。

**Tech Stack:** Python 3.12 stdlib, pytest。前置：SP5、SP6。

---

### Task 1: Policy 协议 + 4 个基线策略

**Files:**
- Create: `agenticx/learning/trajectory/policy.py`
- Test: `tests/trajectory/test_policy.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_policy.py
from agenticx.learning.trajectory.forest import StepFeatures
from agenticx.learning.trajectory.policy import (
    NeverAbortPolicy, FixedHorizonPolicy, ErrorStreakPolicy, ProgressStallPolicy,
)
from agenticx.learning.trajectory.replay import AttemptContext

def _obs(step=0, streak=0, stall=0):
    return StepFeatures(step=step, n_messages=step + 1, n_tool_calls=0,
                        tool_success_rate=-1.0, consecutive_failures=streak,
                        rounds_since_progress=stall, est_tokens=100)

def _ctx():
    return AttemptContext(task_id="t", attempt_index=0,
                          attempts_remaining=1, spent_so_far=0)

def test_never_abort_is_paper_baseline():
    p = NeverAbortPolicy()
    assert p.name == "never_abort"
    assert all(p.act(_obs(step=i), _ctx()) == "continue" for i in range(50))

def test_fixed_horizon_aborts_after_max_steps():
    p = FixedHorizonPolicy(max_steps=5)
    assert p.act(_obs(step=4), _ctx()) == "continue"
    assert p.act(_obs(step=5), _ctx()) == "abort"
    assert p.name == "fixed_horizon_5"

def test_error_streak_aborts_on_consecutive_failures():
    p = ErrorStreakPolicy(max_streak=3)
    assert p.act(_obs(streak=2), _ctx()) == "continue"
    assert p.act(_obs(streak=3), _ctx()) == "abort"
    assert p.name == "error_streak_3"

def test_progress_stall_aborts_when_no_progress():
    p = ProgressStallPolicy(max_stall=8)
    assert p.act(_obs(stall=7), _ctx()) == "continue"
    assert p.act(_obs(stall=8), _ctx()) == "abort"
    assert p.name == "progress_stall_8"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_policy.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_policy.py -v -o addopts="--import-mode=importlib"`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/policy.py tests/trajectory/test_policy.py
git commit -m "feat(rsi): policy protocol with four baseline early-abort strategies"
```

---

### Task 2: train/held-out 双区策略报告

**Files:**
- Modify: `agenticx/learning/trajectory/policy.py`（追加）
- Test: `tests/trajectory/test_policy.py`（追加）

- [ ] **Step 1: 写失败测试（追加到 test_policy.py）**

```python
from agenticx.learning.trajectory.forest import AttemptNode, TaskTree, TrialForest
from agenticx.learning.trajectory.policy import policy_report, baseline_policies

def _tree(task, labels, tokens=100):
    attempts = []
    for i, label in enumerate(labels):
        n = max(1, len(labels))
        steps = [StepFeatures(step=k, n_messages=k + 1, n_tool_calls=0,
                              tool_success_rate=-1.0, consecutive_failures=0,
                              rounds_since_progress=0,
                              est_tokens=tokens * (k + 1)) for k in range(n)]
        attempts.append(AttemptNode(
            attempt_id=f"{task}-a{i}", task_id=task, model="m",
            status="pass" if label >= 1 else "fail", reward_label=label,
            n_steps=n, total_est_tokens=tokens * n, steps=steps))
    return TaskTree(task_id=task, attempts=attempts)

def test_policy_report_splits_train_and_heldout():
    forest = TrialForest(trees={f"t{i}": _tree(f"t{i}", [1.0] if i % 2 == 0 else [0.0])
                                for i in range(40)})
    report = policy_report(baseline_policies(), forest, seed="v1")
    assert set(report["train"]) == {p.name for p in baseline_policies()}
    assert set(report["heldout"]) == set(report["train"])
    assert 0 < len(report["heldout_tasks"]) < 40
    # never_abort 全程执行 → train 上 pass_rate = 20/40
    assert report["train"]["never_abort"]["pass_rate"] == 0.5
    # heldout 任务列表与 seed 确定
    assert report["heldout_tasks"] == sorted(report["heldout_tasks"])

def test_policy_report_heldout_isolated_from_selection():
    forest = TrialForest(trees={f"t{i}": _tree(f"t{i}", [1.0]) for i in range(30)})
    report = policy_report(baseline_policies(), forest, seed="v1")
    train_ids = set(report["train"].keys())
    heldout_ids = set(report["heldout"].keys())
    assert train_ids == heldout_ids               # 同一组策略在两个区都有成绩
    # 但报告结构必须把两区分开, 演化循环只允许读 train 区（由 SP8 保证）
    assert report["train"] is not report["heldout"]

def test_baseline_policies_catalog():
    names = [p.name for p in baseline_policies()]
    assert "never_abort" in names
    assert len(names) >= 4
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_policy.py -v -o addopts="--import-mode=importlib"`
Expected: 新增 3 FAIL（ImportError）

- [ ] **Step 3: 最小实现（追加到 policy.py）**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_policy.py -v -o addopts="--import-mode=importlib"`
Expected: 7 PASS。全量回归：`python3 -m pytest tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q` 无新增失败。

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/policy.py tests/trajectory/test_policy.py
git commit -m "feat(rsi): train/heldout policy report reusing evaluation isolation"
```
