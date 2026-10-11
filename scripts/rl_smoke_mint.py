#!/usr/bin/env python3
"""MinT 远端 GRPO 冒烟：Qwen3-0.6B 上跑通 rollout → reward → importance_sampling → 再采样。

用法:
  export MINT_API_KEY=sk-...
  export MINT_BASE_URL=https://mint.macaron.im
  python3 scripts/rl_smoke_mint.py --steps 3 --group-size 4
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from agenticx.rl.mint_backend import (
    MintRolloutEngine, mint_grpo_step, mint_save_and_get_sampler,
)
from agenticx.rl.core_algos import grpo_outcome_advantage

PROMPT = "3 * 7 ="
TARGET = "21"


def synthetic_reward(text: str) -> float:
    """合成 reward：包含目标数字 21 得 1.0，否则 0.0。"""
    return 1.0 if TARGET in text else 0.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--steps", type=int, default=3)
    ap.add_argument("--group-size", type=int, default=4)
    ap.add_argument("--max-new-tokens", type=int, default=16)
    ap.add_argument("--temperature", type=float, default=0.8)
    args = ap.parse_args()

    api_key = os.environ.get("MINT_API_KEY")
    base_url = os.environ.get("MINT_BASE_URL", "https://mint.macaron.im/train")
    # SDK 要求 base_url 带 /train 后缀，缺则补
    if base_url and not base_url.rstrip("/").endswith("/train"):
        base_url = base_url.rstrip("/") + "/train"
    if not api_key:
        print("ERROR: MINT_API_KEY 未设置", file=sys.stderr)
        return 1

    import mint
    from mint import types

    print(f"[config] base_url={base_url} base_model={args.base_model} "
          f"steps={args.steps} G={args.group_size}")

    service_client = mint.ServiceClient(base_url=base_url, timeout=600)
    training_client = service_client.create_lora_training_client(
        base_model=args.base_model, rank=8,
        train_mlp=True, train_attn=True, train_unembed=False,
    )
    print("[create] training client ready")

    # 初始采样器 = 基座（无 LoRA）
    sampler = service_client.create_sampling_client(base_model=args.base_model)
    engine = MintRolloutEngine(sampler)

    tokenizer = training_client.get_tokenizer()
    prompt_ids = tokenizer.encode(PROMPT)
    print(f"[prompt] '{PROMPT}' -> {len(prompt_ids)} tokens")

    for step in range(1, args.steps + 1):
        samples = engine.generate(
            [prompt_ids], n_samples=args.group_size,
            max_new_tokens=args.max_new_tokens, temperature=args.temperature,
        )
        texts = [tokenizer.decode(s.response_ids) for s in samples]
        rewards = [synthetic_reward(t) for t in texts]
        adv = grpo_outcome_advantage(rewards, group_size=args.group_size)
        print(f"\n[step {step}] rewards={rewards} adv={adv.tolist()}")
        for i, t in enumerate(texts):
            print(f"  sample {i}: {t!r}")

        result = mint_grpo_step(
            training_client, samples, rewards, group_size=args.group_size,
        )
        print(f"[step {step}] loss={result.loss:.4f} metrics={result.metrics}")

        # RSI 交接：保存权重 → 新采样器 → 下一轮 rollout 用新策略
        sampler = mint_save_and_get_sampler(training_client, name=f"smoke-step-{step}")
        engine = MintRolloutEngine(sampler)

    print("\n[done] MinT GRPO 冒烟通过: rollout → reward → importance_sampling → 权重交接")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
