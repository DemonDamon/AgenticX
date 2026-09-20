# agenticx/rl/mint_backend.py
"""MinT 远端算力后端（P1 · 算力双轨）。

本地 CPU 写训练脚本，rollout + 梯度更新全在 Mind Lab 的 GPU 集群上跑。
设计原则：
  - 我们拥有训练循环、reward、经验层、GRPO 数学（core_algos）
  - MinT 拥有 GPU / 分布式 / LoRA 权重管理 / 常驻基座
  - 两端通过 SDK 解耦：mint 是可选软依赖，不可用时本模块 import 失败但不影响本地栈
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .core_algos import grpo_outcome_advantage
from .rollout import RolloutSample

try:
    import mint  # noqa: F401
    from mint import types as mint_types
    _HAVE_MINT = True
except ImportError:
    _HAVE_MINT = False
    mint_types = None  # type: ignore[assignment]


def require_mint() -> None:
    if not _HAVE_MINT:
        raise ImportError(
            "mint 未安装: pip install git+https://github.com/MindLab-Research/mindlab-toolkit.git")


# ---------------------------------------------------------------------------
# Rollout 引擎：实现 RolloutEngine 协议，包一层 sampling_client.sample
# ---------------------------------------------------------------------------
class MintRolloutEngine:
    """用 MinT sampling_client 做 rollout。

    generate 的返回顺序与 LocalRolloutEngine 一致：
    for prompt: for sample in range(n_samples)，供 grpo_outcome_advantage 按组解析。
    """

    def __init__(self, sampling_client: Any, *, eos_id: int | None = None):
        require_mint()
        self._client = sampling_client
        self._eos_id = eos_id

    def generate(self, prompts: list[list[int]], *, n_samples: int,
                 max_new_tokens: int, temperature: float = 1.0,
                 eos_id: int | None = None) -> list[RolloutSample]:
        samples: list[RolloutSample] = []
        for prompt in prompts:
            result = self._client.sample(
                prompt=mint_types.ModelInput.from_ints(tokens=prompt),
                num_samples=n_samples,
                sampling_params=mint_types.SamplingParams(
                    max_tokens=max_new_tokens, temperature=temperature,
                ),
            ).result()
            for seq in result.sequences:
                tokens = list(seq.tokens)
                logprobs = [float(x) for x in (seq.logprobs or [])]
                # 去掉 EOS 及其后的 token（若有 eos_id）
                eos = eos_id if eos_id is not None else self._eos_id
                if eos is not None and eos in tokens:
                    idx = tokens.index(eos)
                    tokens = tokens[:idx]
                    logprobs = logprobs[:idx]
                samples.append(RolloutSample(
                    prompt_ids=prompt, response_ids=tokens,
                    old_logprobs=logprobs,
                ))
        return samples


# ---------------------------------------------------------------------------
# GRPO 训练步：把核心数学喂给远端 forward_backward(loss_fn="importance_sampling")
# ---------------------------------------------------------------------------
@dataclass
class MintGrpoStepResult:
    loss: float
    metrics: dict[str, float]


def mint_grpo_step(training_client: Any, samples: list[RolloutSample],
                   rewards: list[float], *, group_size: int,
                   clip_eps: float = 0.2, kl_beta: float = 0.0,
                   replay_baselines: list[float] | None = None,
                   replay_weight: float = 0.0,
                   ) -> MintGrpoStepResult:
    """一个 GRPO 训练步：本地算优势 → 远端 importance_sampling loss。

    优势 = w * replay_baseline + (1-w) * 组均值（M4 回放塑形）。
    kl_beta>0 时由远端用常驻基座做 KL 惩罚（我们不重复实现 ref forward）。
    """
    require_mint()
    # ---- 本地：优势计算（纯 CPU，含 M4 回放塑形）----
    if replay_baselines is not None and replay_weight > 0:
        raw = np.asarray(rewards, dtype=np.float64)
        rl = np.asarray(replay_baselines, dtype=np.float64)
        baseline = replay_weight * rl + (1.0 - replay_weight) * raw.mean()
        adv = (raw - baseline) / max(raw.std(), 1e-4)
    else:
        adv = grpo_outcome_advantage(rewards, group_size=group_size)

    # ---- 构造 Datum 序列 ----
    data = []
    for sample, a in zip(samples, adv):
        prompt = list(sample.prompt_ids)
        resp = list(sample.response_ids)
        full = prompt + resp
        lp = len(prompt)
        lr = len(resp)
        if lr == 0:
            continue
        # target = full[1:]，长度 lp+lr-1；completion 目标位置 = [lp-1, lp+lr-2]
        target_tokens = full[1:]
        weights = [0.0] * (lp - 1) + [1.0] * lr
        old_logprobs = [0.0] * (lp - 1) + list(sample.old_logprobs)
        advantages = [0.0] * (lp - 1) + [float(a)] * lr
        data.append(mint_types.Datum(
            model_input=mint_types.ModelInput.from_ints(tokens=full[:-1]),
            loss_fn_inputs={
                "target_tokens": target_tokens,
                "weights": weights,
                "logprobs": old_logprobs,
                "advantages": advantages,
            },
        ))

    if not data:
        return MintGrpoStepResult(loss=0.0, metrics={})

    # ---- 远端：forward_backward + optim_step ----
    config: dict[str, float] = {"clip_eps": clip_eps, "kl_beta": kl_beta}
    fb_future = training_client.forward_backward(
        data, loss_fn="importance_sampling", loss_fn_config=config,
    )
    optim_future = training_client.optim_step(
        mint_types.AdamParams(learning_rate=5e-5),
    )
    fb_result = fb_future.result()
    optim_future.result()
    return MintGrpoStepResult(
        loss=float(getattr(fb_result, "loss", 0.0) or 0.0),
        metrics=dict(getattr(fb_result, "metrics", {}) or {}),
    )


def mint_save_and_get_sampler(training_client: Any, name: str) -> Any:
    """保存当前 LoRA 权重并拿到可即时采样的 sampling_client（RSI 每轮交接）。"""
    require_mint()
    return training_client.save_weights_and_get_sampling_client(name=name)
