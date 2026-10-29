#!/usr/bin/env python3
"""验证器漂移报告（SP30 T3）：只读监控，不改奖励。

用法:
    python3 scripts/verifier_drift_report.py --store <dir>            # 读基线比对
    python3 scripts/verifier_drift_report.py --store <dir> --update-baseline
    python3 scripts/verifier_drift_report.py --store <dir> \
        --heldout-judge judge.json                                     # held-out 双判别验收

基线快照 datasets/verifier_baseline.json：一次性生成、显式 --update-baseline
才覆盖（对齐 SP18 task_split.json 的 checked-in 模式）。报警 exit 2（可接 CI）。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.store import TrajectoryStore        # noqa: E402
from agenticx.learning.trajectory.task_split import (                # noqa: E402
    load_split, normalize_task_id)
from agenticx.learning.verifier_drift import DriftConfig, drift_report  # noqa: E402

BASELINE_PATH = Path("datasets/verifier_baseline.json")


def _percentile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(int(q * (len(sorted_vals) - 1)), len(sorted_vals) - 1)
    return sorted_vals[idx]


def _load_labeled(store: TrajectoryStore, heldout: set[str]):
    train, heldout_trajs = [], []
    for t in store.iter_trajectories():
        if t.reward.label < 0:
            continue
        in_heldout = normalize_task_id(t.task_id) in heldout
        (heldout_trajs if in_heldout else train).append(t)
    return train, heldout_trajs


def _make_baseline(trajs) -> dict:
    outs = sorted(float((t.token_usage or {}).get("output_tokens", 0))
                  for t in trajs)
    pass_rate = (sum(1.0 for t in trajs if t.reward.label >= 1.0)
                 / len(trajs)) if trajs else None
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "n_labeled": len(trajs),
        "length_p50": _percentile(outs, 0.5),
        "length_p90": _percentile(outs, 0.9),
        "pass_rate": round(pass_rate, 4) if pass_rate is not None else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="验证器漂移报告（SP30 T3）")
    ap.add_argument("--store", required=True, help="TrajectoryStore 根目录")
    ap.add_argument("--update-baseline", action="store_true",
                    help="用当前 train 区数据覆盖基线快照（显式操作）")
    ap.add_argument("--heldout-judge", default=None,
                    help="held-out 独立判别结果 JSON（仅出验收表，不进任何训练侧）")
    ap.add_argument("--baseline", default=str(BASELINE_PATH))
    args = ap.parse_args()

    heldout: set[str] = set()
    try:
        heldout = set(load_split()["heldout"])
    except (OSError, ValueError):
        print("[warn] task_split.json 不可读，未做 train/held-out 分区")

    store = TrajectoryStore(Path(args.store))
    train, heldout_trajs = _load_labeled(store, heldout)
    baseline_path = Path(args.baseline)

    if args.update_baseline:
        baseline = _make_baseline(train)
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(baseline, ensure_ascii=False,
                                            indent=2), encoding="utf-8")
        print(f"[baseline] 已覆盖: {baseline_path} "
              f"(n={baseline['n_labeled']}, pass_rate={baseline['pass_rate']})")
    else:
        try:
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            baseline = {}
            print(f"[warn] 基线 {baseline_path} 不可读，长度/通过率漂移指标停用")

    cfg = DriftConfig(
        length_p50_baseline=baseline.get("length_p50", 0.0),
        length_p90_baseline=baseline.get("length_p90", 0.0),
        pass_rate_baseline=baseline.get("pass_rate"),
    )
    report = drift_report(train, cfg)

    print(f"[train 区] 已标注轨迹 {report.sample_count} 条（held-out 剔除 "
          f"{len(heldout_trajs)} 条不进本报告）")
    print(f"pass_rate={report.pass_rate}  p50={report.length_p50:.0f}  "
          f"p90={report.length_p90:.0f}  p90_ratio={report.length_p90_ratio}  "
          f"templating={report.templating}")
    # RSI-Index 归一化增益（RSIGym 口径）：相对基线的含金量，跨版本可比
    from agenticx.learning.rsi_index import rsi_index
    if (report.pass_rate is not None
            and isinstance(baseline.get("pass_rate"), (int, float))):
        gain = rsi_index(report.pass_rate, baseline["pass_rate"])
        print(f"RSI-Index（相对基线 pass_rate）: "
              f"{'N/A' if gain is None else f'{gain:+.3f}'}")
    if report.dual_judge_gap is None:
        print("双判别 gap: 未接入（reward.components 无 independent_judge）")
    else:
        print(f"双判别 gap: {report.dual_judge_gap:.3f}")
    for a in report.alerts:
        print(f"  ⚠ {a}")

    # held-out 双判别验收（held-out 数据在本 SP 的唯一合法用途）
    if args.heldout_judge and heldout_trajs:
        judge = json.loads(Path(args.heldout_judge).read_text(encoding="utf-8"))
        print(f"\n[held-out 双判别验收] n={len(heldout_trajs)}")
        agree = 0
        for t in heldout_trajs:
            j = judge.get(t.task_id)
            if j is None:
                continue
            verifier_pass = t.reward.label >= 1.0
            judge_pass = float(j) >= 0.5
            agree += 1 if verifier_pass == judge_pass else 0
        print(f"  verifier/独立判别一致率: {agree}/{len(heldout_trajs)}")

    return 2 if report.alerts else 0


if __name__ == "__main__":
    raise SystemExit(main())
