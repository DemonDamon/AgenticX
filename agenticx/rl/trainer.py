# agenticx/rl/trainer.py
"""GRPO torch 训练核（P1 · M1）：后端无关主循环，消费 M0 core_algos 语义。

数值纪律: torch_grpo_loss 与 core_algos.grpo_loss 的等价性由对拍测试钉死
（tests/rl/test_trainer.py::test_torch_loss_matches_numpy_core_algos）；
优势计算直接复用 numpy 版 grpo_outcome_advantage。
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import torch
from torch import nn

from .core_algos import grpo_outcome_advantage
from .rollout import RolloutEngine, RolloutSample


def response_logprobs(lm: nn.Module, samples: list[RolloutSample],
                      device: torch.device) -> torch.Tensor:
    """当前 lm 对各 sample response 段的 token logp（带梯度，拼接为 (ΣLr,)）。

    位置对齐: logits[i] 预测 token i+1，response token j（全局位置 P+j）
    的 logp 取自位置 P+j-1 的 log_softmax。
    """
    outs = []
    for s in samples:
        ids = torch.cat([s.prompt_ids, s.response_ids]).to(device).unsqueeze(0)
        logits = lm(ids)
        if hasattr(logits, "logits"):      # HF ModelOutput → (B, L, V)
            logits = logits.logits
        logits = logits[0]                                   # (L, V)
        logp = torch.log_softmax(logits[:-1], dim=-1)
        seg = logp[len(s.prompt_ids) - 1: ids.shape[1] - 1]
        tgt = s.response_ids.to(device).unsqueeze(1)
        outs.append(seg.gather(1, tgt).squeeze(1))
    return torch.cat(outs)


def torch_grpo_loss(logprobs, old_logprobs, ref_logprobs, advantages, response_mask, *,
                    clip_eps: float = 0.2, kl_beta: float = 0.0) -> torch.Tensor:
    """core_algos.grpo_loss 的 torch 版（k3 KL，带梯度）。"""
    ratio = torch.exp(logprobs - old_logprobs)
    surr1 = ratio * advantages
    surr2 = torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps) * advantages
    pg = -torch.minimum(surr1, surr2)
    if kl_beta:
        d = ref_logprobs - logprobs
        kl = torch.exp(d) - d - 1.0                          # k3，恒非负
        per_tok = pg + kl_beta * kl
    else:
        per_tok = pg
    m = response_mask.to(logprobs.dtype)
    return (per_tok * m).sum() / m.sum().clamp_min(1.0)


def grouped_episode_advantage(rewards, task_ids) -> np.ndarray:
    """按任务分组的 episode 级优势（组内归一化，grpo_outcome_advantage 语义）。"""
    rewards = list(rewards)
    task_ids = list(task_ids)
    adv = np.zeros(len(rewards))
    for task in dict.fromkeys(task_ids):               # 保序去重
        idx = [i for i, t in enumerate(task_ids) if t == task]
        adv[idx] = grpo_outcome_advantage([rewards[i] for i in idx],
                                          group_size=len(idx))
    return adv


class GRPOTrainer:
    """单进程 GRPO：rollout → reward → 组归一化优势 → torch loss → AdamW。

    设备无关: lm 在哪个 device（cuda/npu/mps/cpu），采样与训练就在哪跑。
    ref_lm=None 时 KL 参照退化为 rollout 策略（ref=old，首轮 KL=0）。
    """

    def __init__(self, lm: nn.Module, rollout: RolloutEngine,
                 reward_fn: Callable[[torch.Tensor, torch.Tensor], float], *,
                 lr: float = 1e-3, clip_eps: float = 0.2, kl_beta: float = 0.0,
                 ref_lm: nn.Module | None = None,
                 optimizer: torch.optim.Optimizer | None = None):
        self.lm = lm
        self.rollout = rollout
        self.reward_fn = reward_fn
        self.clip_eps = clip_eps
        self.kl_beta = kl_beta
        self.ref_lm = ref_lm
        self.opt = optimizer or torch.optim.AdamW(lm.parameters(), lr=lr)

    def train_step(self, prompts: list[list[int]], *, n_samples: int = 4,
                   max_new_tokens: int = 8, temperature: float = 1.0,
                   eos_id: int | None = None) -> dict:
        device = next(self.lm.parameters()).device
        samples = self.rollout.generate(
            prompts, n_samples=n_samples, max_new_tokens=max_new_tokens,
            temperature=temperature, eos_id=eos_id)
        rewards = [self.reward_fn(s.prompt_ids, s.response_ids) for s in samples]
        for s, r in zip(samples, rewards):
            s.reward = r

        adv = grpo_outcome_advantage(rewards, group_size=n_samples)  # numpy M0

        logprobs = response_logprobs(self.lm, samples, device)
        with torch.no_grad():
            old = torch.cat([s.old_logprobs for s in samples]).to(device)
            ref = (response_logprobs(self.ref_lm, samples, device)
                   if self.ref_lm is not None else old.clone())
        # 序列级优势广播到 token 级（core_algos 契约：序列内所有 token 共享同一优势）
        lens = np.array([s.response_ids.shape[0] for s in samples])
        adv_t = torch.tensor(np.repeat(adv, lens), dtype=logprobs.dtype, device=device)
        mask = torch.ones_like(logprobs)

        loss = torch_grpo_loss(logprobs, old, ref, adv_t, mask,
                               clip_eps=self.clip_eps, kl_beta=self.kl_beta)
        self.opt.zero_grad(set_to_none=True)
        loss.backward()
        self.opt.step()
        sync = getattr(self.rollout, "sync_weights", None)   # vLLM 离线模式热同步
        if callable(sync):
            sync(self.lm)
        return {"loss": float(loss.detach()),
                "reward_mean": float(np.mean(rewards)),
                "n_samples": len(samples)}

    def train_step_episodes(self, episodes, *, shaping=None) -> dict:
        """episode 级 GRPO：优势在 episode 粒度（按任务分组），广播到段内全部 token。

        episodes: list[harbor_rollout.Episode]（segments 为 RolloutSample，鸭子类型）。
        shaping: Callable[[rewards, task_ids], advantages]，替换默认分组优势
        （M4 回放基线塑形从这里注入）。
        """
        device = next(self.lm.parameters()).device
        rewards = [float(e.reward) for e in episodes]
        task_ids = [e.task for e in episodes]
        if shaping is not None:
            adv = np.asarray(shaping(rewards, task_ids), dtype=np.float64)
        else:
            adv = grouped_episode_advantage(rewards, task_ids)

        samples, ep_of_sample = [], []
        for i, e in enumerate(episodes):
            samples.extend(e.segments)
            ep_of_sample.extend([i] * len(e.segments))
        if not samples:
            return {"loss": 0.0, "reward_mean": float(np.mean(rewards)) if rewards else 0.0,
                    "n_episodes": len(episodes), "n_tokens": 0}

        logprobs = response_logprobs(self.lm, samples, device)
        with torch.no_grad():
            old = torch.cat([s.old_logprobs for s in samples]).to(device)
            ref = (response_logprobs(self.ref_lm, samples, device)
                   if self.ref_lm is not None else old.clone())
        # episode 优势 → 段 → token 广播
        tok_adv = np.concatenate([
            np.repeat(adv[ep_of_sample[k]], s.response_ids.shape[0])
            for k, s in enumerate(samples)])
        adv_t = torch.tensor(tok_adv, dtype=logprobs.dtype, device=device)
        mask = torch.ones_like(logprobs)
        loss = torch_grpo_loss(logprobs, old, ref, adv_t, mask,
                               clip_eps=self.clip_eps, kl_beta=self.kl_beta)
        self.opt.zero_grad(set_to_none=True)
        loss.backward()
        self.opt.step()
        sync = getattr(self.rollout, "sync_weights", None)
        if callable(sync):
            sync(self.lm)
        return {"loss": float(loss.detach()),
                "reward_mean": float(np.mean(rewards)),
                "n_episodes": len(episodes),
                "n_tokens": int(mask.sum().item())}
