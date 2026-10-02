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


def clipped_policy_loss(logprobs, old_logprobs, advantages, *,
                        clip_eps: float = 0.2) -> np.ndarray:
    """PPO 式 clip surrogate（GRPO 无 critic，无 value 项）。返回 per-token loss。"""
    logp = np.asarray(logprobs, dtype=np.float64)
    old = np.asarray(old_logprobs, dtype=np.float64)
    adv = np.asarray(advantages, dtype=np.float64)
    ratio = np.exp(logp - old)
    surr1 = ratio * adv
    surr2 = np.clip(ratio, 1 - clip_eps, 1 + clip_eps) * adv
    return -np.minimum(surr1, surr2)


def kl_k1(logprobs, ref_logprobs) -> np.ndarray:
    """朴素 KL 估计 k1 = ref - logp（可负，高方差）。"""
    return np.asarray(ref_logprobs, dtype=np.float64) - np.asarray(logprobs, dtype=np.float64)


def kl_k3(logprobs, ref_logprobs) -> np.ndarray:
    """低方差无偏 k3 = exp(ref-logp) - (ref-logp) - 1，恒非负（verl 默认）。"""
    d = np.asarray(ref_logprobs, dtype=np.float64) - np.asarray(logprobs, dtype=np.float64)
    return np.exp(d) - d - 1.0


def masked_mean(values, mask) -> float:
    """token 级掩码均值（response_mask 忽略 padding/prompt 段）。"""
    m = np.asarray(mask, dtype=np.float64)
    v = np.asarray(values, dtype=np.float64)
    return float((v * m).sum() / max(m.sum(), 1.0))


def grpo_loss(logprobs, old_logprobs, ref_logprobs, advantages, response_mask, *,
              clip_eps: float = 0.2, kl_beta: float = 0.0,
              kl_estimator=kl_k3) -> float:
    """GRPO 总损失 = masked_mean( clip PG + beta * KL )。"""
    pg = clipped_policy_loss(logprobs, old_logprobs, advantages, clip_eps=clip_eps)
    if kl_beta:
        kl = kl_estimator(logprobs, ref_logprobs)
        return masked_mean(pg + kl_beta * kl, response_mask)
    return masked_mean(pg, response_mask)
