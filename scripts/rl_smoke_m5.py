#!/usr/bin/env python3
"""多卡训练冒烟（P1 · M5）：torchrun 入口，验证分布式 GRPO 训练路径。

用法:
  任意机器 CPU 双进程（含 Mac，真·DDP 数据并行最小闭环）:
    torchrun --standalone --nproc-per-node=2 scripts/rl_smoke_m5.py --cpu
  8 卡 GPU 机（真机验证清单第一步，详见 plans/rsi/sp15-multi-gpu.md 尾部）:
    torchrun --standalone --nproc-per-node=8 scripts/rl_smoke_m5.py \
        --model Qwen/Qwen3-0.6B --strategy fsdp
    torchrun --standalone --nproc-per-node=8 scripts/rl_smoke_m5.py \
        --model Qwen/Qwen3.8-27B --lora --strategy fsdp

PASS 标准: 全部 loss 有限 + 通信自检（all_reduce_mean(rank)==(world-1)/2）
+ --lora 时训练后基座权重逐位不变。
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.distributed import (  # noqa: E402
    all_reduce_mean, barrier, init_distributed, is_main, shutdown,
)
from agenticx.rl.lora import (  # noqa: E402
    inject_lora, mark_only_lora_trainable, trainable_parameters,
)
from agenticx.rl.parallel import shard, wrap_model  # noqa: E402
from agenticx.rl.rollout import LocalRolloutEngine, TinyLM  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer  # noqa: E402


def _full_state_dict(module, strategy: str) -> dict:
    """收集完整 state_dict（键名与原始模块一致）。

    fsdp: 需要全 rank 集体调用 FULL_STATE_DICT 上下文（返回原始键名）。
    ddp: state_dict() 键带 'module.' 前缀，取内层模块去前缀。
    """
    if strategy == "fsdp":
        from torch.distributed.fsdp import (FullyShardedDataParallel as FSDP,
                                            StateDictType)
        with FSDP.state_dict_type(module, StateDictType.FULL_STATE_DICT):
            return module.state_dict()
    inner = getattr(module, "module", module)          # DDP 去前缀
    return inner.state_dict()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpu", action="store_true", help="TinyLM CPU 模式（任何机器可跑）")
    ap.add_argument("--model", default=None, help="HF 模型 id（GPU 模式）")
    ap.add_argument("--lora", action="store_true")
    ap.add_argument("--strategy", default=None, choices=["none", "ddp", "fsdp"])
    ap.add_argument("--steps", type=int, default=5)
    ap.add_argument("--n-samples", type=int, default=8)
    ap.add_argument("--max-new-tokens", type=int, default=6)
    ap.add_argument("--lr", type=float, default=5e-3)
    ap.add_argument("--out", default="/tmp/rl_smoke_m5_ckpt.pt")
    args = ap.parse_args()

    d = init_distributed()                     # auto: nccl(CUDA) / gloo(CPU)
    tag = f"[m5 r{d.rank}/{d.world_size}]"

    comm = all_reduce_mean(float(d.rank), d)   # 通信自检
    assert abs(comm - (d.world_size - 1) / 2.0) < 1e-6, f"{tag} 通信自检失败: {comm}"
    if is_main(d):
        print(f"{tag} dist ok backend={d.backend} comm_check={comm}")

    if args.cpu or args.model is None:
        lm = TinyLM(hidden=64)
        target = 7
        prompts = [[1, 2, 3], [4, 5], [6, 7], [8, 9]]
        lora_patterns = ("head",)
    else:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(args.model)
        lm = AutoModelForCausalLM.from_pretrained(args.model,
                                                  torch_dtype=torch.bfloat16)
        target = tok.encode(" the", add_special_tokens=False)[0]
        prompts = [tok.encode("The secret password is", add_special_tokens=False),
                   tok.encode("My favorite word is", add_special_tokens=False)]
        lora_patterns = ("q_proj", "k_proj", "v_proj", "o_proj")

    base_snapshot = None
    if args.lora:
        n = inject_lora(lm, rank=16, target_patterns=lora_patterns)
        mark_only_lora_trainable(lm)
        base_snapshot = {k: v.detach().clone()
                         for k, v in lm.state_dict().items() if "lora_" not in k}
        if is_main(d):
            print(f"{tag} lora injected: {n} layers")

    strategy = args.strategy
    if strategy is None:
        if args.cpu:
            strategy = "ddp" if d.distributed else "none"
        else:
            strategy = "fsdp" if d.distributed else "none"
    lm = wrap_model(lm, strategy, d, bf16=torch.cuda.is_available() and not args.cpu)
    if is_main(d):
        print(f"{tag} strategy={strategy} lora={args.lora}")

    my_prompts = shard(prompts, d) or prompts[:1]     # 卡多于 prompt 时兜底

    def reward_fn(p, r):
        return float((r == target).sum().item())

    params = trainable_parameters(lm) if args.lora else lm.parameters()
    tr = GRPOTrainer(lm, LocalRolloutEngine(lm), reward_fn, lr=args.lr,
                     optimizer=torch.optim.AdamW(params, lr=args.lr))

    t0 = time.time()
    metrics = {"loss": 0.0, "reward_mean": 0.0}
    for i in range(args.steps):
        m = tr.train_step(my_prompts, n_samples=args.n_samples,
                          max_new_tokens=args.max_new_tokens)
        metrics = {k: all_reduce_mean(v, d) for k, v in m.items()}
        if is_main(d):
            print(f"{tag} step {i+1}/{args.steps} loss={metrics['loss']:.4f} "
                  f"reward_mean={metrics['reward_mean']:.3f}")

    ok = all(math.isfinite(v) for v in metrics.values())
    if args.lora and base_snapshot is not None:
        cur = _full_state_dict(lm, strategy)     # fsdp: 集体调用，全 rank 都执行
        if is_main(d):
            bad = [k for k, v in base_snapshot.items()
                   if not torch.equal(cur[k].detach().cpu(), v)]
            if bad:
                ok = False
                print(f"{tag} FAIL: 基座权重被改动: {bad[:3]}")
            else:
                torch.save({k: v for k, v in cur.items() if "lora_" in k}, args.out)
                print(f"{tag} adapter 已保存: {args.out}")
    barrier(d)
    if is_main(d):
        print(f"{tag} {'PASS' if ok else 'FAIL'} "
              f"({time.time()-t0:.1f}s, strategy={strategy}, backend={d.backend})")
    shutdown(d)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
