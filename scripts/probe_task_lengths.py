#!/usr/bin/env python3
"""RSI 长度探测 CLI（playbook §2.4）：抽 200 题未实测任务跑单 seed 记墙钟。

用法（两步，建议都在目标训练机上跑）：
  # 1. 只出清单不跑（本机也能做，看抽样是否合意）
  python3 scripts/probe_task_lengths.py --manifest datasets/rsi/manifest.json \
      --n 200 --dry-run

  # 2. 真跑（需要 Docker + harbor + 远端 API key；DS V4.1 Flash，预算 ¥150-250）
  python3 scripts/probe_task_lengths.py --manifest datasets/rsi/manifest.json \
      --n 200 --model ds-v4.1-flash --base-url "$DS_BASE_URL" \
      --api-key-env DS_API_KEY --out results/probe-dsflash

跑完无需额外处理：build_rsi_manifest.py 会 glob results/*/summary.json
自动把 probe 结果算进分层。

注意：--max-episode-sec 是墙钟上限（防长尾烧 API 钱），超时记 reward=0、
duration=上限值——这些题天然是 long/unmeasured，不影响分层正确性。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.learning.trajectory.length_probe import (  # noqa: E402
    append_row, load_existing, stratified_sample, write_summary)
from agenticx.rl.harbor_reward import run_harbor_trial  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="RSI 长度探测")
    ap.add_argument("--manifest", default="datasets/rsi/manifest.json")
    ap.add_argument("--n", type=int, default=200, help="抽样题数")
    ap.add_argument("--out", default="results/probe-dsflash",
                    help="输出目录（summary.json 与 trial 目录的父目录）")
    ap.add_argument("--model", default=None, help="如 ds-v4.1-flash")
    ap.add_argument("--base-url", default=None, help="远端 API base_url")
    ap.add_argument("--api-key-env", default="DS_API_KEY",
                    help="API key 的环境变量名（不落盘）")
    ap.add_argument("--task-root", default="datasets/tasks",
                    help="任务池目录（找 task 路径用）")
    ap.add_argument("--timeout", type=float, default=2400.0,
                    help="单题墙钟上限（默认 2400s，防长尾烧钱）")
    ap.add_argument("--start", type=int, default=0, help="从清单第几题开始")
    ap.add_argument("--limit", type=int, default=None, help="本次最多跑几题")
    ap.add_argument("--dry-run", action="store_true", help="只出清单不跑")
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text())
    unmeasured = manifest.get("tiers", {}).get("unmeasured", [])
    if not unmeasured:
        print("[ERROR] manifest 无 unmeasured 任务——先跑 build_rsi_manifest.py")
        return 1

    sampled = stratified_sample(unmeasured, n=args.n)
    flat: list[str] = [t for dom in sampled for t in sampled[dom]]
    print(f"[PLAN] 未实测 {len(unmeasured)} 题 → 抽 {len(flat)} 题 "
          f"({', '.join(f'{d}:{len(v)}' for d, v in sampled.items())})")

    out_dir = Path(args.out)
    if args.dry_run:
        plan = out_dir / "probe_plan.json"
        plan.parent.mkdir(parents=True, exist_ok=True)
        plan.write_text(json.dumps(
            {"n": len(flat), "by_domain": sampled, "tasks": flat},
            ensure_ascii=False, indent=2))
        print(f"[DRY-RUN] 清单已写 {plan}；确认后去掉 --dry-run 真跑")
        return 0

    if not args.model or not args.base_url:
        print("[ERROR] 真跑需要 --model 与 --base-url（key 从 "
              f"${args.api_key_env} 读）")
        return 1

    done = load_existing(out_dir)
    todo = flat[args.start:]
    if args.limit is not None:
        todo = todo[:args.limit]
    print(f"[RESUME] 已完成 {len(done)} 题，本次待跑 {len(todo)} 题")
    if not todo:
        return 0

    import os
    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        print(f"[ERROR] 环境变量 {args.api_key_env} 未设置")
        return 1

    task_root = Path(args.task_root)
    for i, task in enumerate(todo, start=1):
        if task in done:
            continue
        task_path = _find_task_path(task_root, task)
        if task_path is None:
            print(f"[SKIP] {task}: 任务目录不存在", flush=True)
            continue
        trials_dir = out_dir / "trials" / task
        t0 = time.monotonic()
        try:
            reward, trial_dir = run_harbor_trial(
                task_path, args.model, args.base_url,
                trials_dir=trials_dir, timeout=args.timeout, api_key=api_key)
        except Exception as e:                       # noqa: BLE001 单题失败不中断
            print(f"[WARN] {task}: {type(e).__name__}: {e}（记 timeout 行）",
                  flush=True)
            append_row(out_dir, model=args.model, task=task, reward=0.0,
                       duration_sec=args.timeout, trial_dir=str(trials_dir),
                       total_planned=len(flat))
            continue
        wall = time.monotonic() - t0
        append_row(out_dir, model=args.model, task=task, reward=reward,
                   duration_sec=wall, trial_dir=str(trial_dir),
                   total_planned=len(flat))
        print(f"[{i}/{len(todo)}] {task}: reward={reward:.0f} "
              f"wall={wall:.0f}s", flush=True)

    n = len(load_existing(out_dir))
    print(f"[DONE] {n}/{len(flat)} 题已回填 {out_dir}/summary.json，"
          f"重跑 build_rsi_manifest.py 即可更新分层")
    return 0


def _find_task_path(task_root: Path, task_id: str) -> str | None:
    """任务池目录里定位 task 目录（code-xxx → code/xxx 或直接同名）。"""
    cands = [task_root / task_id,
             task_root / task_id.replace("-", "/", 1),
             *[p for p in task_root.rglob(task_id) if p.is_dir()]]
    for c in cands:
        if c.is_dir():
            return str(c)
    return None


if __name__ == "__main__":
    raise SystemExit(main())
