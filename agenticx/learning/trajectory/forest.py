# agenticx/learning/trajectory/forest.py
"""TrialForest：把线性轨迹组织为任务→attempt 森林（P0.5 回放底座）。

对齐 Dream-RSI（arXiv 2609.14858）的"发现树持久化"：我们不存工作区快照，
而存消息级逐步特征——策略只做 continue/abort 决策时，前缀特征即足够。
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from .schema import RSITrajectory

_ERROR_MARK = "error"

# SP22 错误三分类（Dream-RSI 附录规则）:
#   infra     = 可修复失误（网络/超时/容器/限流/显存/维度/编译/环境路径）,
#               单次或多次出现都不允许据此关停分支;
#   algorithm = 判真失败（断言/测试/验证器/期望不符）, 才是算法方向失败信号。
_INFRA_ERROR_RE = re.compile(
    r"networkerror|connectionerror|connection (reset|refused)|"
    r"timeout|timed out|docker|rate.?limit|pull access|"
    r"out of memory|cuda oom|"
    r"filenotfounderror|modulenotfounderror|importerror|permissionerror|"
    r"shape mismatch|size mismatch|dimension|"
    r"compilation|compile error", re.I)
_ALGO_ERROR_RE = re.compile(
    r"assertionerror|assert failed|tests? (failed|failure)|verifier|"
    r"expected.{0,60}got|wrong (answer|output|result)", re.I)


def classify_error(messages: list) -> str:
    """按消息里的报错内容做三分类: infra / algorithm / none。

    优先级 algorithm > infra > none（混合时以判真信号为准——验证器说
    错就是方向失败, 即便同时有网络抖动）。非 tool 消息不参与分类。
    """
    infra = algo = False
    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "tool":
            continue
        content = str(m.get("content") or "")
        if _ALGO_ERROR_RE.search(content):
            algo = True
        elif _INFRA_ERROR_RE.search(content):
            infra = True
    if algo:
        return "algorithm"
    if infra:
        return "infra"
    return "none"

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
        elif m.get("role") == "user":
            progressed = True                   # 新任务输入视为进展起点（重置停滞计数）
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
    error_class: str = "none"      # SP22: classify_error 三分类

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
            error_class=classify_error(traj.messages),
        )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("passed", None)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "AttemptNode":
        d = {k: v for k, v in d.items() if k != "passed"}
        d.setdefault("error_class", "none")   # 旧记录兼容
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
