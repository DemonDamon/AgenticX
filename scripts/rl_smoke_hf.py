#!/usr/bin/env python3
"""真模型 GRPO 冒烟（P1 · M2）：Qwen3-0.6B + HFRolloutEngine，设备自适应（本机 MPS）。

用法: python3 scripts/rl_smoke_hf.py [--steps 30] [--model Qwen/Qwen3-0.6B]
下载（直连不通时）: HF_ENDPOINT=https://hf-mirror.com python3 -c \
  "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-0.6B')"
PASS 标准: 跑完全程且 loss 有限（真模型学习曲线证据随 M3 verifier reward 到来，
本门钉"0.xB 真模型全管线在消费级设备上能训"）。
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import detect_device  # noqa: E402
from agenticx.rl.hf_rollout import HFRolloutEngine  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--n-samples", type=int, default=6)
    ap.add_argument("--max-new-tokens", type=int, default=12)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    from transformers import AutoModelForCausalLM, AutoTokenizer

    info = detect_device(None if args.device == "auto" else args.device)
    print(f"[smoke-hf] device={info.kind} ({info.name}) dtype={info.dtype} "
          f"model={args.model}")
    dev = info.torch_device

    tok = AutoTokenizer.from_pretrained(args.model)
    target = tok.encode(" GOOD", add_special_tokens=False)[0]
    print(f"[smoke-hf] target token id={target} ({tok.decode([target])!r})")

    lm = AutoModelForCausalLM.from_pretrained(args.model)
    lm.to(dtype=info.dtype, device=dev)
    eng = HFRolloutEngine(lm)

    def reward_fn(p, r):
        return float((r == target).sum().item())

    tr = GRPOTrainer(lm, eng, reward_fn, lr=args.lr)
    prompts = [tok.encode("The secret password is", add_special_tokens=False),
               tok.encode("My favorite word is", add_special_tokens=False)]

    t0 = time.time()
    first = last = None
    for i in range(args.steps):
        m = tr.train_step(prompts, n_samples=args.n_samples,
                          max_new_tokens=args.max_new_tokens)
        first = first if first is not None else m
        last = m
        if (i + 1) % 5 == 0 or i == 0:
            print(f"[smoke-hf] step {i + 1:3d}/{args.steps} "
                  f"loss={m['loss']:.4f} reward_mean={m['reward_mean']:.3f}")
    dt = time.time() - t0

    gain = last["reward_mean"] - first["reward_mean"]
    print(f"[smoke-hf] done in {dt:.1f}s on {info.kind}: "
          f"reward {first['reward_mean']:.3f} -> {last['reward_mean']:.3f} "
          f"(gain={gain:+.3f})")
    if not (math.isfinite(first["loss"]) and math.isfinite(last["loss"])):
        print("[smoke-hf] FAIL: loss 出现 NaN/Inf")
        return 1
    verdict = "learning signal positive" if gain > 0 else "gain<=0（步数/lr 偏保守，见文档说明）"
    print(f"[smoke-hf] PASS ({verdict})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
