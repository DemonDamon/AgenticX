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
