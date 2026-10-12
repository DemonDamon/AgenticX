#!/usr/bin/env python3
"""RL 训练核冒烟：TinyLM + GRPO 在探测到的设备上真跑（本机=MPS）。

用法: python3 scripts/rl_smoke.py [--steps 30] [--device auto]
退出码 0 = 冒烟门通过（reward 显著上升）；非 0 = 失败。
真模型路径（0.xB）由 M2 vLLM rollout 接入后启用，本脚本钉设备无关训练核。
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import autocast_for, detect_device  # noqa: E402
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=60)
    ap.add_argument("--n-samples", type=int, default=8)
    ap.add_argument("--max-new-tokens", type=int, default=6)
    ap.add_argument("--target-token", type=int, default=7)
    ap.add_argument("--device", default="auto",
                    help="auto|cpu|cuda|npu|mps")
    args = ap.parse_args()

    info = detect_device(None if args.device == "auto" else args.device)
    print(f"[smoke] device={info.kind} name={info.name!r} "
          f"dtype={info.dtype} bf16={info.bf16}")
    dev = info.torch_device

    torch.manual_seed(0)
    lm = TinyLM().to(dev)
    eng = LocalRolloutEngine(lm)
    target = args.target_token

    def reward_fn(p, r):
        return float((r == target).sum().item())

    tr = GRPOTrainer(lm, eng, reward_fn, lr=5e-3)
    prompts = [[1, 2, 3], [4, 5]]

    t0 = time.time()
    first = last = None
    for i in range(args.steps):
        with autocast_for(info, enabled=False):
            m = tr.train_step(prompts, n_samples=args.n_samples,
                              max_new_tokens=args.max_new_tokens)
        first = first if first is not None else m
        last = m
        if (i + 1) % 5 == 0 or i == 0:
            print(f"[smoke] step {i + 1:3d}/{args.steps} "
                  f"loss={m['loss']:.4f} reward_mean={m['reward_mean']:.3f}")
    dt = time.time() - t0

    gain = last["reward_mean"] - first["reward_mean"]
    print(f"[smoke] done in {dt:.1f}s on {info.kind}: "
          f"reward {first['reward_mean']:.3f} -> {last['reward_mean']:.3f} "
          f"(gain={gain:+.3f})")
    if gain > 0.5:
        print("[smoke] PASS")
        return 0
    print("[smoke] FAIL: reward 未显著上升")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
