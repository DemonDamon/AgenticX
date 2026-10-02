# SP5: TrialForest 轨迹森林（P0.5 · 对齐 Dream-RSI 之数据底座）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 TrajectoryStore 中的线性轨迹组织成"任务→attempt"两级森林，并为每条轨迹抽取迭代级（逐步）特征序列——回放模拟器（SP6）与策略演化（SP8）的数据底座。

**Architecture:** 纯离线、零推理成本。`forest.py` 新模块：`extract_step_features` 从 RSITrajectory.messages 逐步抽取特征（累计 token 估算/工具成功率/连续失败/进展停滞轮数），`AttemptNode`/`TaskTree`/`TrialForest` 组装森林并支持 jsonl 序列化。依赖链：schema → forest → (SP6 replay) → (SP7 policy) → (SP8 evolution)。

**Tech Stack:** Python 3.12 stdlib（dataclasses/json/re），pytest。前置：SP1 已合入（RSITrajectory、TrajectoryStore）。

**设计决策（对齐论文原则）:**
- 不做文件系统/Docker 快照——消息级特征足以支撑 continue/abort 决策（论文的 fork 续跑动作属 P1）
- token 级逐步数据不可得（totals 只有轨迹级），`est_tokens` 用 `累计字符数//4` 粗估，仅作相对比较
- 进展（progress）定义：工具结果无 error 标记，或 assistant 消息有非空文本

---

### Task 1: 迭代级特征抽取

**Files:**
- Create: `agenticx/learning/trajectory/forest.py`
- Test: `tests/trajectory/test_forest.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_forest.py
from agenticx.learning.trajectory.forest import StepFeatures, extract_step_features
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord

def _traj(messages):
    return RSITrajectory(
        source="harbor-tb40", task_id="t", session_id="s", model="m",
        status="pass", reward=RewardRecord(label=1.0), messages=messages,
    )

def test_features_empty_assistant_counts_progress():
    msgs = [
        {"role": "user", "content": "solve"},
        {"role": "assistant", "content": ""},
        {"role": "assistant", "content": "done"},
    ]
    fs = extract_step_features(_traj(msgs))
    assert len(fs) == 3
    assert fs[0].n_messages == 1 and fs[0].est_tokens == len("solve") // 4
    assert fs[1].rounds_since_progress == 1          # 空 assistant 无进展
    assert fs[2].rounds_since_progress == 0          # 非空文本=进展

def test_features_tool_success_and_streak():
    msgs = [
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "bash", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "a", "content": "error: boom"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "b", "type": "function", "function": {"name": "bash", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "b", "content": "ok"},
    ]
    fs = extract_step_features(_traj(msgs))
    assert fs[1].n_tool_calls == 1                    # assistant 发起 1 次
    assert fs[2].consecutive_failures == 1            # error 结果 → streak=1
    assert fs[2].tool_success_rate == 0.0
    assert fs[4].consecutive_failures == 0            # ok 结果重置
    assert fs[4].tool_success_rate == 0.5
    assert fs[2].rounds_since_progress == 2           # user 后无进展直至 step2 仍无
    assert fs[4].rounds_since_progress == 0           # ok 工具结果=进展

def test_features_no_tool_calls_rate_is_sentinel():
    fs = extract_step_features(_traj([{"role": "user", "content": "x"}]))
    assert fs[0].tool_success_rate == -1.0
    assert fs[0].n_tool_calls == 0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_forest.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/forest.py
"""TrialForest：把线性轨迹组织为任务→attempt 森林（P0.5 回放底座）。

对齐 Dream-RSI（arXiv 2609.14858）的"发现树持久化"：我们不存工作区快照，
而存消息级逐步特征——策略只做 continue/abort 决策时，前缀特征即足够。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from .schema import RSITrajectory

_ERROR_MARK = "error"

@dataclass
class StepFeatures:
    step: int                      # 消息索引
    n_messages: int                # 含当前消息
    n_tool_calls: int              # 截至当前已发起的工具调用数
    tool_success_rate: float       # 成功/(成功+失败)；-1.0=尚无工具结果
    consecutive_failures: int     # 连续 error 工具结果数
    rounds_since_progress: int     # 距最近一次进展的消息数
    est_tokens: int                # 累计 content 字符数//4 的粗估

def _is_error_result(content: str) -> bool:
    return _ERROR_MARK in content.lower()[:200]

def extract_step_features(traj: RSITrajectory) -> list[StepFeatures]:
    n_calls = successes = failures = streak = stall = est = 0
    out: list[StepFeatures] = []
    for i, m in enumerate(traj.messages):
        if not isinstance(m, dict):
            continue
        content = str(m.get("content") or "")
        est += len(content) // 4
        progressed = False
        if m.get("role") == "assistant":
            calls = m.get("tool_calls") or []
            n_calls += len(calls)
            if content:
                progressed = True
        elif m.get("role") == "tool":
            if _is_error_result(content):
                failures += 1
                streak += 1
            else:
                successes += 1
                streak = 0
                progressed = True
        if progressed:
            stall = 0
        else:
            stall += 1
        total = successes + failures
        out.append(StepFeatures(
            step=i, n_messages=i + 1, n_tool_calls=n_calls,
            tool_success_rate=(successes / total) if total else -1.0,
            consecutive_failures=streak, rounds_since_progress=stall,
            est_tokens=est,
        ))
    return out
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_forest.py -v -o addopts="--import-mode=importlib"`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/forest.py tests/trajectory/test_forest.py
git commit -m "feat(rsi): per-step trajectory feature extraction for replay simulation"
```

---

### Task 2: AttemptNode / TaskTree / TrialForest

**Files:**
- Modify: `agenticx/learning/trajectory/forest.py`（追加类）
- Test: `tests/trajectory/test_forest.py`（追加测试）

- [ ] **Step 1: 写失败测试（追加到 test_forest.py）**

```python
from agenticx.learning.trajectory.forest import (
    AttemptNode, TaskTree, TrialForest,
)

def _node(task, aid, label, msgs=None):
    msgs = msgs or [{"role": "user", "content": "x"}]
    return RSITrajectory(
        source="harbor-tb40", task_id=task, session_id=aid, model="m",
        status="pass" if label >= 1 else "fail", reward=RewardRecord(label=label),
        messages=msgs,
    )

def test_forest_groups_attempts_by_task():
    forest = TrialForest.from_trajectories([
        _node("t1", "a1", 0.0), _node("t1", "a2", 1.0), _node("t2", "b1", 0.0),
    ])
    assert set(forest.trees) == {"t1", "t2"}
    assert len(forest.trees["t1"].attempts) == 2
    a1, a2 = forest.trees["t1"].attempts
    assert a1.attempt_id != a2.attempt_id and a2.passed and not a1.passed
    assert a1.n_steps == 1 and a1.steps[0].step == 0
    assert a1.total_est_tokens == a1.steps[-1].est_tokens

def test_forest_stats():
    forest = TrialForest.from_trajectories([
        _node("t1", "a1", 0.0), _node("t1", "a2", 1.0), _node("t2", "b1", 0.0),
    ])
    s = forest.stats()
    assert s["n_tasks"] == 2 and s["n_attempts"] == 3
    assert s["tasks_with_pass"] == 1 and s["avg_attempts"] == 1.5

def test_forest_save_load_roundtrip(tmp_path):
    forest = TrialForest.from_trajectories([_node("t1", "a1", 1.0)])
    p = tmp_path / "forest.jsonl"
    forest.save(p)
    loaded = TrialForest.load(p)
    assert loaded.trees["t1"].attempts[0].attempt_id == forest.trees["t1"].attempts[0].attempt_id
    assert loaded.trees["t1"].attempts[0].steps[0].est_tokens == \
        forest.trees["t1"].attempts[0].steps[0].est_tokens
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_forest.py -v -o addopts="--import-mode=importlib"`
Expected: 新增 3 FAIL（ImportError）

- [ ] **Step 3: 最小实现（追加到 forest.py）**

```python
@dataclass
class AttemptNode:
    attempt_id: str                # = trajectory_id
    task_id: str
    model: str
    status: str
    reward_label: float
    n_steps: int
    total_est_tokens: int
    steps: list[StepFeatures] = field(default_factory=list)
    source: str = ""

    @property
    def passed(self) -> bool:
        return self.reward_label >= 1.0

    @classmethod
    def from_trajectory(cls, traj: RSITrajectory) -> "AttemptNode":
        steps = extract_step_features(traj)
        return cls(
            attempt_id=traj.trajectory_id, task_id=traj.task_id, model=traj.model,
            status=traj.status, reward_label=traj.reward.label,
            n_steps=len(steps),
            total_est_tokens=steps[-1].est_tokens if steps else 0,
            steps=steps, source=traj.source,
        )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("passed", None)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "AttemptNode":
        d = {k: v for k, v in d.items() if k != "passed"}
        d["steps"] = [StepFeatures(**s) for s in d.get("steps", [])]
        return cls(**d)

@dataclass
class TaskTree:
    task_id: str
    attempts: list[AttemptNode] = field(default_factory=list)

@dataclass
class TrialForest:
    trees: dict[str, TaskTree] = field(default_factory=dict)

    @classmethod
    def from_trajectories(cls, trajs: Iterable[RSITrajectory]) -> "TrialForest":
        forest = cls()
        for t in trajs:
            node = AttemptNode.from_trajectory(t)
            tree = forest.trees.setdefault(t.task_id, TaskTree(task_id=t.task_id))
            tree.attempts.append(node)
        for tree in forest.trees.values():
            tree.attempts.sort(key=lambda a: a.attempt_id)
        return forest

    def stats(self) -> dict[str, Any]:
        n_attempts = sum(len(t.attempts) for t in self.trees.values())
        with_pass = sum(any(a.passed for a in t.attempts) for t in self.trees.values())
        return {
            "n_tasks": len(self.trees),
            "n_attempts": n_attempts,
            "tasks_with_pass": with_pass,
            "avg_attempts": (n_attempts / len(self.trees)) if self.trees else 0.0,
        }

    def save(self, path) -> None:
        import json
        with open(path, "w") as f:
            for tree in self.trees.values():
                for a in tree.attempts:
                    f.write(json.dumps(a.to_dict(), ensure_ascii=False) + "\n")

    @classmethod
    def load(cls, path) -> "TrialForest":
        import json
        forest = cls()
        for line in open(path):
            line = line.strip()
            if not line:
                continue
            node = AttemptNode.from_dict(json.loads(line))
            tree = forest.trees.setdefault(node.task_id, TaskTree(task_id=node.task_id))
            tree.attempts.append(node)
        for tree in forest.trees.values():
            tree.attempts.sort(key=lambda a: a.attempt_id)
        return forest
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_forest.py -v -o addopts="--import-mode=importlib"`
Expected: 6 PASS。再跑全量：`python3 -m pytest tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q`，无回归。

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/forest.py tests/trajectory/test_forest.py
git commit -m "feat(rsi): TrialForest — group trajectories into task-attempt trees with jsonl persistence"
```
