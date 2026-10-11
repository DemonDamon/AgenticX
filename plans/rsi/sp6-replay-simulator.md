# SP6: ReplaySimulator 回放模拟器（P0.5 · 对齐 Dream-RSI 之 Evolving World）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 论文核心资产的等价物——在已记录轨迹上的零成本回放：策略逐步观察前缀特征、做 continue/abort 决策，回放器揭示已记录的后继；再在任务树上做预算内多 attempt 调度评测。

**Architecture:** `replay.py` 新模块：`ReplayAttempt` 单轨迹回放（abort=止损，代价=已烧 token 估算；continue 到终局=承担全程代价换取记录在案的 outcome）；`evaluate_policy*` 在 TaskTree 上按序重放 attempt（pass 即停），产出 `PolicyScore`。**关键性质：零推理成本、完全确定性**——这是 Dream-RSI "回放不调用底层模型"的同构物。动作空间 P0.5 = {continue, abort}（fork/switch 属 P1，需快照）。

**Tech Stack:** Python 3.12 stdlib, pytest。前置：SP5（forest.py 的 AttemptNode/TaskTree/TrialForest/StepFeatures）。

**回放计分语义（对齐论文"最优节点得分 − 累计算力开销"）:**
- abort 于第 k 步：achieved_reward=0，virtual_cost=steps[k].est_tokens（止损）
- continue 至终局：achieved_reward=1.0 若该 attempt pass 否则 0.0，virtual_cost=total_est_tokens
- 任务级：按 attempt_id 顺序逐个重放（≤max_attempts），任一 attempt 得 1.0 即任务 pass

---

### Task 1: ReplayAttempt 单轨迹回放

**Files:**
- Create: `agenticx/learning/trajectory/replay.py`
- Test: `tests/trajectory/test_replay.py`

- [ ] **Step 1: 写失败测试**

```python
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
    with pytest.raises(RuntimeError):
        _ = r.result if False else r.result      # result 可读
    r2 = ReplayAttempt(_node(n=2)); r2.reset(); r2.step("abort")
    with pytest.raises(RuntimeError):
        r2.step("continue")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_replay.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_replay.py -v -o addopts="--import-mode=importlib"`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/replay.py tests/trajectory/test_replay.py
git commit -m "feat(rsi): ReplayAttempt — zero-cost replay of recorded trajectories with abort semantics"
```

---

### Task 2: 任务树/森林上的策略评测

**Files:**
- Modify: `agenticx/learning/trajectory/replay.py`（追加）
- Test: `tests/trajectory/test_replay.py`（追加）

- [ ] **Step 1: 写失败测试（追加到 test_replay.py）**

```python
from agenticx.learning.trajectory.forest import StepFeatures as SF
from agenticx.learning.trajectory.replay import (
    AttemptContext, PolicyScore, evaluate_policy_on_tree,
    evaluate_policy, summarize, forest_score,
)

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_replay.py -v -o addopts="--import-mode=importlib"`
Expected: 新增 6 FAIL（ImportError）

- [ ] **Step 3: 最小实现（追加到 replay.py）**

```python
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_replay.py -v -o addopts="--import-mode=importlib"`
Expected: 10 PASS。全量回归无新增失败。

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/replay.py tests/trajectory/test_replay.py
git commit -m "feat(rsi): forest-level policy replay evaluation with budget-aware scoring"
```
