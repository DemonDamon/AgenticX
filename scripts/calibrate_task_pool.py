#!/usr/bin/env python3
"""SP23+: MiMo code 域通过率校准（DS V4.1 Flash @ aibox 网关）。

目的: 论文模型选型 + RL 甜点区筛选 + 难度分层回填（一次跑三用）。
通路: 物化任务目录 → harbor trial → agenticx agent → aibox DS Flash
      → verifier(test.sh: patch+jest) → reward 0/1。

结果: results/calibration-<ts>/
  summary.json   任务×reward×时长×token
  通过率报告打印到 stdout

用法:
  python3 scripts/calibrate_task_pool.py --tasks 10 --model deepseek-v4.1-flash
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.rl.harbor_reward import (  # noqa: E402
    read_hack_flag, run_harbor_trial,
)


def _load_provider():
    """从 ~/.agenticx/config.yaml 读 aibox 网关配置。"""
    import yaml
    cfg = yaml.safe_load(open(Path.home() / ".agenticx" / "config.yaml"))
    return cfg["providers"]["custom_openai_b300"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", type=int, default=10)
    ap.add_argument("--model", default="deepseek-v4.1-flash")
    ap.add_argument("--tasks-root", default="/tmp/mimo-harbor-tasks")
    ap.add_argument("--rounds", type=int, default=1, help="每任务重复次数")
    ap.add_argument("--timeout", type=float, default=1800.0)
    ap.add_argument("--only", default=None,
                    help="只跑名字含指定子串的任务（逗号分隔多个）")
    ap.add_argument("--baseline-dir", default=None,
                    help="既往校准结果目录: 跑完后按任务配对做 Wilcoxon 晋升"
                         "门控（AIDE² §5: 噪声复合下飞轮接受必须过统计门）")
    args = ap.parse_args()

    prov = _load_provider()
    base_url = prov["base_url"].rstrip("/")
    api_key = prov["api_key"]

    import os
    os.environ["OPENAI_BASE_URL"] = base_url
    os.environ["OPENAI_API_KEY"] = api_key

    root = Path(args.tasks_root) / "mimo"
    task_dirs = sorted([d for d in root.iterdir() if d.is_dir()])
    if args.only:
        subs = [s.strip() for s in args.only.split(",") if s.strip()]
        task_dirs = [d for d in task_dirs
                     if any(s in d.name for s in subs)]
    task_dirs = task_dirs[: args.tasks]
    if not task_dirs:
        print(f"没有物化任务（{root}）——先跑 materialize_pool")
        return 1

    out_dir = Path("results") / f"calibration-{int(time.time())}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # harbor agent: agenticx adapter 走 OPENAI_BASE_URL; 模型名带 openai/ 前缀
    model_name = f"openai/{args.model}"
    rows = []
    pass_count = 0
    hack_count = 0
    total = 0
    for td in task_dirs:
        for r in range(args.rounds):
            t0 = time.time()
            print(f"[{len(rows)+1}/{len(task_dirs)*args.rounds}] {td.name} r{r} ...",
                  flush=True)
            try:
                reward, trial_dir = run_harbor_trial(
                    str(td), model_name, base_url,
                    trials_dir=out_dir / "trials", timeout=args.timeout,
                    api_key=api_key)
                dur = time.time() - t0
                hacked = read_hack_flag(trial_dir)
                rows.append({"task": td.name, "round": r, "reward": reward,
                             "hack_flag": hacked,
                             "duration_sec": round(dur, 1),
                             "trial_dir": str(trial_dir)})
                total += 1
                pass_count += int(reward >= 1.0)
                hack_count += int(hacked)
                print(f"    reward={reward} hack={hacked} ({dur:.0f}s)", flush=True)
            except Exception as e:  # noqa: BLE001
                rows.append({"task": td.name, "round": r, "reward": None,
                             "error": str(e)[:200],
                             "duration_sec": round(time.time() - t0, 1)})
                total += 1
                print(f"    ERROR: {str(e)[:120]}", flush=True)

    rate = pass_count / total if total else 0.0
    hacking_rate = hack_count / total if total else 0.0
    summary = {
        "model": args.model,
        "n_tasks": len(task_dirs),
        "rounds": args.rounds,
        "pass_rate": round(rate, 3),
        "hacking_rate": round(hacking_rate, 3),
        "passed": pass_count,
        "hack_flagged": hack_count,
        "total": total,
        "rows": rows,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=1))
    print(f"\n=== 通过率: {pass_count}/{total} = {rate:.1%} | "
          f"hacking 标记: {hack_count}/{total} = {hacking_rate:.1%} ===")
    print(f"结果目录: {out_dir}")

    if args.baseline_dir:
        _gate_against_baseline(out_dir, summary, Path(args.baseline_dir))
    return 0


def _gate_against_baseline(out_dir: Path, summary: dict, baseline_dir: Path):
    """本次 run vs 基线 run: 按任务配对 Wilcoxon 门控, 写 gate.json。"""
    from agenticx.rl.acceptance import wilcoxon_gate

    bp = baseline_dir / "summary.json"
    if not bp.exists():
        print(f"基线缺 summary.json, 跳过门控: {bp}")
        return

    def by_task(rows):
        agg: dict[str, list[float]] = {}
        for r in rows:
            if r.get("reward") is not None:
                agg.setdefault(r["task"], []).append(float(r["reward"]))
        return {t: sum(v) / len(v) for t, v in agg.items()}

    base = by_task(json.loads(bp.read_text())["rows"])
    cand = by_task(summary["rows"])
    common = sorted(set(base) & set(cand))
    if len(common) < 2:
        print(f"配对任务不足（{len(common)}）, 无法门控")
        return
    decision = wilcoxon_gate([base[t] for t in common],
                             [cand[t] for t in common])
    (out_dir / "gate.json").write_text(json.dumps(decision.to_json(), indent=1))
    verdict = "接受晋升 ✓" if decision.accepted else f"拒绝（{decision.reason}）"
    print(f"=== 飞轮门控 vs {baseline_dir.name}: {verdict} | "
          f"mean {decision.mean_baseline:.3f} → {decision.mean_candidate:.3f} | "
          f"p={decision.p_value:.4f} (n={decision.n_pairs}) ===")


if __name__ == "__main__":
    raise SystemExit(main())
