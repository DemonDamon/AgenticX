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

from .arvo import (LengthPenaltyConfig, apply_tool_penalty,
                   episode_signals, grouped_length_penalty)
from .core_algos import grpo_outcome_advantage
from .rollout import RolloutEngine, RolloutSample


def response_logprobs(lm: nn.Module, samples: list[RolloutSample],
                      device: torch.device) -> torch.Tensor:
    """当前 lm 对各 sample response 段的 token logp（带梯度，拼接为 (ΣLr,)）。

    批量实现: 右侧 padding 到同长一次前向（因果模型下 padding 不影响
    前缀位置 logits）。位置对齐: logits[i] 预测 token i+1，response token j
    （全局位置 P+j）的 logp 取自位置 P+j-1 的 log_softmax。
    DDP 契约: 每次 backward 只对应一个带梯度 forward——逐样本循环 forward
    会触发 DDP "Expected to have finished reduction" 错误，故必须批量化。
    """
    if not samples:
        return torch.zeros(0, device=device)
    lens = [s.prompt_ids.shape[0] + s.response_ids.shape[0] for s in samples]
    max_len = max(lens)
    ids = torch.zeros(len(samples), max_len, dtype=torch.long)      # 0 = pad
    for i, s in enumerate(samples):
        seq = torch.cat([s.prompt_ids, s.response_ids])
        ids[i, : seq.shape[0]] = seq
    ids = ids.to(device)
    logits = lm(ids)
    if hasattr(logits, "logits"):      # HF ModelOutput → (B, L, V)
        logits = logits.logits
    outs = []
    for i, s in enumerate(samples):
        logp = torch.log_softmax(logits[i, :-1], dim=-1)
        p, t = s.prompt_ids.shape[0], s.response_ids.shape[0]
        seg = logp[p - 1: p + t - 1]                   # (t, V)
        tgt = s.response_ids.to(device).unsqueeze(1)   # (t, 1)
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
                 optimizer: torch.optim.Optimizer | None = None,
                 length_penalty: LengthPenaltyConfig | None = None,
                 tool_penalty_kappa: float | None = None):
        self.lm = lm
        self.rollout = rollout
        self.reward_fn = reward_fn
        self.clip_eps = clip_eps
        self.kl_beta = kl_beta
        self.ref_lm = ref_lm
        self.opt = optimizer or torch.optim.AdamW(lm.parameters(), lr=lr)
        self.length_penalty = length_penalty          # SP20 ARVO：改 reward（优势前）
        self.tool_penalty_kappa = tool_penalty_kappa  # SP20 ARVO：改 advantage（优势后）

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

    def train_step_episodes(self, episodes, *, shaping=None,
                            tool_error_segments=None, is_infra=None) -> dict:
        """episode 级 GRPO：优势在 episode 粒度（按任务分组），广播到段内全部 token。

        episodes: list[harbor_rollout.Episode]（segments 为 RolloutSample，鸭子类型）。
        shaping: Callable[[rewards, task_ids], advantages]，替换默认分组优势
        （M4 回放基线塑形从这里注入）。
        tool_error_segments: list[bool] per segment（按 samples 拼接顺序），
        标记该生成段是否含工具调用错误；配置 tool_penalty_kappa 后生效。
        is_infra: list[bool] per episode，infra 失败的 episode 不施加工具惩罚
        （与工程约定"infra 重试到消除"对齐，惩罚只学真错）。

        ARVO 管线（SP20）: 长度惩罚 delta 先加到 reward（M4 shaping 之前，
        二者天然复合）→ 优势计算 → adv_signed 工具惩罚改 token 优势 → loss。
        """
        device = next(self.lm.parameters()).device
        rewards = [float(e.reward) for e in episodes]
        task_ids = [e.task for e in episodes]

        arvo_metrics = {}
        if self.length_penalty is not None:
            deltas = grouped_length_penalty(
                rewards, task_ids, episode_signals(episodes), self.length_penalty)
            rewards = [r + d for r, d in zip(rewards, deltas)]
            arvo_metrics["arvo/length_penalty_sum"] = -float(sum(deltas))

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
        if self.tool_penalty_kappa is not None and tool_error_segments is not None:
            # 工具错误段 → 该段全部生成 token 标记 hit；infra episode 的段豁免
            seg_lens = [s.response_ids.shape[0] for s in samples]
            hit_tok = np.zeros(sum(seg_lens))
            off = 0
            infra_eps = (set() if is_infra is None
                         else {i for i, f in enumerate(is_infra) if bool(f)})
            errs = list(map(bool, tool_error_segments))
            assert len(errs) == len(samples), "tool_error_segments 须逐段给出"
            for k in range(len(samples)):
                n = seg_lens[k]
                if errs[k] and ep_of_sample[k] not in infra_eps:
                    hit_tok[off: off + n] = 1.0
                off += n
            tok_adv, arvo_metrics = apply_tool_penalty(
                tok_adv, hit_tok, kappa=self.tool_penalty_kappa)
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
                "n_tokens": int(mask.sum().item()), **arvo_metrics}
