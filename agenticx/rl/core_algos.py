# agenticx/rl/core_algos.py
"""GRPO 核心数学（P1 · M0）：自 verl core_algos 移植，纯 numpy 零 torch。

移植来源对照（verl trainer/ppo/core_algos.py）:
  grpo_outcome_advantage ← compute_grpo_outcome_advantage
  clipped_policy_loss    ← compute_policy_loss
  kl_k1 / kl_k3          ← kl_penalty 的 k1/k3 估计器
SP10 的 torch trainer 消费本模块；数值语义由本目录测试钉死。
"""
from __future__ import annotations

import numpy as np


def grpo_outcome_advantage(rewards, group_size: int, *,
                           center: bool = True,
                           normalize_by_std: bool = True,
                           eps: float = 1e-4) -> np.ndarray:
    """outcome reward → sequence 级优势（组内归一化，verl GRPO 语义）。

    A_j = (r_j - mean_g) / max(std_g, eps)；std 为总体标准差（ddof=0）。
    序列内所有 token 共享同一优势（由 trainer 层广播到 token 级）。
    """
    r = np.asarray(rewards, dtype=np.float64).reshape(-1, group_size)
    adv = (r - r.mean(axis=1, keepdims=True)) if center else r.copy()
    if normalize_by_std:
        std = r.std(axis=1, keepdims=True)
        adv = adv / np.maximum(std, eps)
    return adv.reshape(-1)
