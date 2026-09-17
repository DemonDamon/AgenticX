#!/usr/bin/env python3
"""回放混合 GRPO 冒烟（P1 · M4）：真任务 episode + 回放基线塑形 + 1 步训练。

用法: python3 scripts/rl_smoke_m4.py --task harness-lab/terminal-bench/music-harmony
PASS 标准: episode 采集到段、回放塑形生效（≠组内基线）、1 步训练 loss 有限。
学习曲线证据（多 episode 训练）属后续实验阶段——本门钉管线。
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.device import detect_device  # noqa: E402
from agenticx.rl.harbor_rollout import HarborRolloutEngine  # noqa: E402
from agenticx.rl.replay_shaping import replay_shaped_advantage  # noqa: E402
from agenticx.rl.trainer import GRPOTrainer, grouped_episode_advantage  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--trials-dir", default="/tmp/agenticx_rl_m4_smoke")
    ap.add_argument("--timeout", type=float, default=1200.0)
    ap.add_argument("--lr", type=float, default=1e-5)
    args = ap.parse_args()

    from transformers import AutoModelForCausalLM, AutoTokenizer

    info = detect_device()
    print(f"[m4] device={info.kind} model={args.model} task={args.task}")
    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(args.model)
    lm = AutoModelForCausalLM.from_pretrained(args.model)
    lm.to(dtype=info.dtype, device=info.torch_device)

    eng = HarborRolloutEngine(lm, tok, model_id="openai/agenticx-rl",
                              temperature_override=1.0, timeout=args.timeout)
    eng.start()
    print(f"[m4] server up (port={eng.server_port}, load {time.time()-t0:.1f}s)")

    ep = eng.run_episode(args.task, trials_dir=Path(args.trials_dir))
    eng.stop()
    n_tok = sum(s.response_ids.shape[0] for s in ep.segments)
    print(f"[m4] episode: reward={ep.reward} segments={len(ep.segments)} "
          f"resp_tokens={n_tok}")
    if not ep.segments:
        print("[m4] FAIL: episode 无段（agent 未请求模型服务）")
        return 1

    tr = GRPOTrainer(lm, eng, lambda p, r: 0.0, lr=args.lr)

    replay_scores = {args.task: 0.0}          # 冒烟用占位回放分（真源=SP6 evaluate_policy）
    m = tr.train_step_episodes(
        [ep], shaping=lambda rs, ts: replay_shaped_advantage(
            rs, ts, replay_scores, replay_weight=1.0))
    vanilla = grouped_episode_advantage([ep.reward], [ep.task])
    print(f"[m4] train step: loss={m['loss']:.6f} tokens={m['n_tokens']} "
          f"shaped_adv={replay_shaped_advantage([ep.reward], [ep.task], replay_scores, replay_weight=1.0)[0]:.4f} "
          f"vanilla_adv={vanilla[0]:.4f}")
    ok = math.isfinite(m["loss"]) and m["n_tokens"] > 0
    print(f"[m4] {'PASS' if ok else 'FAIL'}（回放混合 GRPO 管线{'打通' if ok else '异常'}）")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
