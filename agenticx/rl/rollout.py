# agenticx/rl/rollout.py
"""Rollout 层（P1 · M1）：协议 + TinyLM 本地 rollout（CPU 单测 / MPS 冒烟）。

M2 将提供 vLLM rollout 引擎实现同一协议，训练核代码零改动。
分组约定: generate 按 `for prompt: for _ in range(n_samples)` 连续排列，
trainer 的 grpo_outcome_advantage(rewards, group_size=n_samples) 依赖此顺序。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import torch
from torch import nn


@dataclass
class RolloutSample:
    prompt_ids: torch.Tensor      # (Lp,) long, cpu
    response_ids: torch.Tensor    # (Lr,) long, cpu
    old_logprobs: torch.Tensor    # (Lr,) float32, cpu —— 采样时记录，供 ratio 用
    reward: float = 0.0


class RolloutEngine(Protocol):
    def generate(self, prompts: list[list[int]], *, n_samples: int,
                 max_new_tokens: int, temperature: float = 1.0,
                 eos_id: int | None = None) -> list[RolloutSample]: ...


class TinyLM(nn.Module):
    """最小可训练 LM（GRU）：vocab=32，CPU 毫秒级，用于单测与设备冒烟。"""

    vocab_size = 32

    def __init__(self, hidden: int = 64):
        super().__init__()
        self.emb = nn.Embedding(self.vocab_size, hidden, padding_idx=0)
        self.gru = nn.GRU(hidden, hidden, batch_first=True)
        self.head = nn.Linear(hidden, self.vocab_size)

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        """(B, L) -> logits (B, L, V)。"""
        out, _ = self.gru(self.emb(ids))
        return self.head(out)


class LocalRolloutEngine:
    """对任意 nn.Module LM 做朴素逐 token rollout：multinomial 采样并记录 logp。"""

    def __init__(self, lm: nn.Module):
        self.lm = lm

    @torch.no_grad()
    def generate(self, prompts, *, n_samples, max_new_tokens,
                 temperature=1.0, eos_id=None) -> list[RolloutSample]:
        device = next(self.lm.parameters()).device
        was_training = self.lm.training
        self.lm.eval()
        try:
            out: list[RolloutSample] = []
            for prompt in prompts:
                for _ in range(n_samples):
                    ids = torch.tensor(prompt, dtype=torch.long, device=device)
                    logps: list[float] = []
                    resp: list[int] = []
                    for _ in range(max_new_tokens):
                        logits = self.lm(ids.unsqueeze(0))[0, -1]
                        logp = torch.log_softmax(logits / temperature, dim=-1)
                        nxt = int(torch.multinomial(logp.exp(), 1).item())
                        logps.append(float(logp[nxt].item()))
                        resp.append(nxt)
                        if eos_id is not None and nxt == eos_id:
                            break
                        ids = torch.cat([ids, torch.tensor([nxt], device=device)])
                    out.append(RolloutSample(
                        prompt_ids=ids[: len(prompt)].detach().cpu(),
                        response_ids=torch.tensor(resp, dtype=torch.long),
                        old_logprobs=torch.tensor(logps, dtype=torch.float32),
                    ))
            return out
        finally:
            self.lm.train(was_training)
