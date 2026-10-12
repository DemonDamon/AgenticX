# agenticx/rl/replay_shaping.py
"""回放基线优势塑形（P1 · M4）：TrialForest 回放分数 → GRPO 优势基线。

混合基线: baseline_j = w·replay_score(task_j) + (1-w)·组均值
        adv_j = (r_j - baseline_j) / max(组std, eps)
回放分数缺失的任务回退纯组内归一化（w 视为 0）。
收益: 单条真实 rollout 也有信号（基线来自零成本回放）；方差更低。
回放分数来源（SP6 evaluate_policy 等）由调用方注入，本模块零 forest 依赖。
"""
from __future__ import annotations

import numpy as np

from .core_algos import grpo_outcome_advantage


def replay_shaped_advantage(rewards, task_ids, replay_scores: dict,
                            *, replay_weight: float = 0.5,
                            eps: float = 1e-4) -> np.ndarray:
    if not 0.0 <= replay_weight <= 1.0:
        raise ValueError(f"replay_weight 须在 [0,1]，got {replay_weight}")
    rewards = np.asarray(rewards, dtype=np.float64)
    task_ids = list(task_ids)
    out = np.zeros(len(rewards))
    for task in dict.fromkeys(task_ids):
        idx = [i for i, t in enumerate(task_ids) if t == task]
        r = rewards[idx]
        score = replay_scores.get(task)
        if score is None:
            out[idx] = grpo_outcome_advantage(r, group_size=len(idx), eps=eps)
            continue
        w = replay_weight
        baseline = w * float(score) + (1.0 - w) * float(r.mean())
        std = max(float(r.std()), eps)
        out[idx] = (r - baseline) / std
    return out
