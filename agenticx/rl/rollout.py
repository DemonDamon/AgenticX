# agenticx/rl/rollout.py
"""Rollout 层（P1 · M1）：协议 + TinyLM 本地 rollout（CPU 单测 / MPS 冒烟）。

M2 将提供 vLLM rollout 引擎实现同一协议，训练核代码零改动。
分组约定: generate 按 `for prompt: for _ in range(n_samples)` 连续排列，
trainer 的 grpo_outcome_advantage(rewards, group_size=n_samples) 依赖此顺序。

Token-native 轨迹层（SP24，设计规格移植自 JAZ RolloutRecorder，refs/jaz）：
采集时冻结线上真实 token + loss_mask + logprob，训练样本为"真值"而非事后重分词。
thinking 模型多轮轨迹天然非单调（每轮推理段从下轮上下文剥离），按轮导出。
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol

import torch
from torch import nn


class NonMonotoneRolloutError(RuntimeError):
    """flat 导出要求上下文未被中途编辑；触发时改用 to_pieces()/to_turn_samples()。"""


@dataclass(frozen=True)
class TokenStamp:
    """一次消息渲染的冻结 token 戳。

    message_id 为每次渲染生成的 UUID——单调性判断用身份比较而非内容比较：
    同内容两次渲染被视为不同 stamp（上下文被编辑过的证据），见 _extends()。
    """

    message_id: str
    role: str
    ids: tuple[int, ...]

    @staticmethod
    def mint(role: str, ids) -> "TokenStamp":
        return TokenStamp(message_id=str(uuid.uuid4()), role=role, ids=tuple(ids))


@dataclass(frozen=True)
class TurnRecord:
    """一轮 LLM 调用的 token 真值：本轮发送的完整上下文 + 新采样段。

    sent 中每条 stamp 的 ids 是引擎实际发送的 token（非事后重分词）。
    sampled 为 None 表示该轮非策略采样（如 few-shot 示例消息）——loss mask 恒 0，
    训练不会对其计分。
    """

    turn: int
    sent: tuple[TokenStamp, ...]
    sampled: TokenStamp | None = None
    logprobs: tuple[float, ...] = ()

    def __post_init__(self) -> None:
        # 标量容错：logprobs=(-0.3) 是 float 而非元组，归一化后校验
        if isinstance(self.logprobs, (int, float)):
            object.__setattr__(self, "logprobs", (float(self.logprobs),))
        if self.sampled is not None and len(self.logprobs) != len(self.sampled.ids):
            raise ValueError(
                f"turn {self.turn}: logprobs({len(self.logprobs)}) 与 "
                f"sampled.ids({len(self.sampled.ids)}) 长度不一致"
            )


def _extends(prev: TurnRecord, cur: TurnRecord) -> bool:
    """cur 的上下文是否单调延伸了 prev（同一发送前缀 + prev 的采样段）。

    按 stamp 身份（message_id）比较而非 token/文本值：引用列表即"发送了什么"
    的记录，两次同内容渲染不得链成单调（JAZ 同款判据）。
    """
    expected = prev.sent if prev.sampled is None else (*prev.sent, prev.sampled)
    return len(cur.sent) >= len(expected) and all(
        a.message_id == b.message_id for a, b in zip(expected, cur.sent, strict=False)
    )


@dataclass(frozen=True)
class FlatSample:
    """一条平坦掩码序列——经典 RL/SFT 训练样本。

    loss_mask[i]==1 当且仅当 ids[i] 为策略采样；logprobs[i] 为采样 logprob，
    其余为 0.0。
    """

    ids: tuple[int, ...]
    loss_mask: tuple[int, ...]
    logprobs: tuple[float, ...]
    rollout_id: str
    model: str
    finished: str

    def to_dict(self) -> dict:
        return {
            "ids": list(self.ids),
            "loss_mask": list(self.loss_mask),
            "logprobs": list(self.logprobs),
            "rollout_id": self.rollout_id,
            "model": self.model,
            "finished": self.finished,
        }


@dataclass(frozen=True)
class TurnSample:
    """单轮样本：条件（该轮发送的全部 token）+ 采样段 + logprob。

    thinking 模型多轮 rollout 的指定导出——每轮推理段被剥离，上下文天然
    非单调，to_flat() 会抛错，本投影永远可解。
    """

    turn: int
    condition_ids: tuple[int, ...]
    sampled_ids: tuple[int, ...]
    logprobs: tuple[float, ...]
    rollout_id: str
    model: str


@dataclass
class TokenRollout:
    """一次 rollout 的 token 真值记录（累积器，非校验器：记录即真值）。

    刻意不含 reward 字段：轨迹是事实，reward 是判断，其 shape 因算法而异
    （GRPO 终值 / PPO 逐轮 / 多目标向量）。reward 由训练驱动侧按
    rollout_id 对齐——与 RSITrajectory.rollout_id 的对齐键一致。
    部分轨迹（finished="aborted:<reason>"）仍可导出，是否消费由 trainer 决定。
    """

    rollout_id: str
    model: str
    turns: list[TurnRecord] = field(default_factory=list)
    finished: str = "completed"

    def add_turn(self, sent: tuple[TokenStamp, ...], sampled: TokenStamp | None,
                 logprobs: tuple[float, ...] = ()) -> TurnRecord:
        rec = TurnRecord(turn=len(self.turns), sent=sent, sampled=sampled,
                         logprobs=logprobs)
        self.turns.append(rec)
        return rec

    def to_flat(self) -> FlatSample:
        """单条平坦序列。任一轮上下文非单调延伸即抛 NonMonotoneRolloutError。"""
        ids: list[int] = []
        mask: list[int] = []
        logps: list[float] = []
        if not self.turns:
            return FlatSample((), (), (), self.rollout_id, self.model, self.finished)

        def _append_stamp(s: TokenStamp, is_sampled: bool, lps=()) -> None:
            ids.extend(s.ids)
            if is_sampled:
                mask.extend([1] * len(s.ids))
                logps.extend(lps)
            else:
                mask.extend([0] * len(s.ids))
                logps.extend([0.0] * len(s.ids))

        prev: TurnRecord | None = None
        for cur in self.turns:
            if prev is not None:
                if not _extends(prev, cur):
                    raise NonMonotoneRolloutError(
                        f"rollout {self.rollout_id}: turn {cur.turn} 的上下文不是 "
                        f"turn {prev.turn} 的单调延伸（被编辑/剥离）；"
                        f"改用 to_pieces() 或 to_turn_samples()"
                    )
                prefix = prev.sent if prev.sampled is None else (*prev.sent, prev.sampled)
                for stamp in cur.sent[len(prefix):]:
                    _append_stamp(stamp, is_sampled=False)
            else:
                for stamp in cur.sent:
                    _append_stamp(stamp, is_sampled=False)
            if cur.sampled is not None:
                _append_stamp(cur.sampled, is_sampled=True, lps=cur.logprobs)
            prev = cur
        return FlatSample(tuple(ids), tuple(mask), tuple(logps),
                          self.rollout_id, self.model, self.finished)

    def to_pieces(self) -> list[FlatSample]:
        """按单调段切分：上下文被编辑处开新段，每段一条平坦样本。"""
        pieces: list[FlatSample] = []
        run: list[TurnRecord] = []
        prev: TurnRecord | None = None
        for cur in self.turns:
            if prev is not None and not _extends(prev, cur):
                pieces.append(TokenRollout(self.rollout_id, self.model, run,
                                           self.finished).to_flat())
                run = []
            run.append(cur)
            prev = cur
        if run:
            pieces.append(TokenRollout(self.rollout_id, self.model, run,
                                       self.finished).to_flat())
        return pieces

    def to_turn_samples(self) -> list[TurnSample]:
        """逐轮导出：每轮独立条件/采样/logprob 三元组，永远可解。"""
        out: list[TurnSample] = []
        for cur in self.turns:
            cond: list[int] = []
            for stamp in cur.sent:
                cond.extend(stamp.ids)
            out.append(TurnSample(
                turn=cur.turn,
                condition_ids=tuple(cond),
                sampled_ids=cur.sampled.ids if cur.sampled else (),
                logprobs=cur.logprobs,
                rollout_id=self.rollout_id,
                model=self.model,
            ))
        return out


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
