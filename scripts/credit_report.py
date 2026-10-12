#!/usr/bin/env python3
"""经验贡献归因报告（SP30 T2）：读轨迹库 → 归因账本 → 落盘 + 摘要打印。

用法:
    python3 scripts/credit_report.py --store ~/.agenticx/trajectories \
        [--out datasets/attribution] [--strict-unknown-pct 30]

held-out 守卫：账本构造时注入 datasets/task_split.json 的 heldout 名单，
遇考试题轨迹直接抛 HeldoutViolation（红线，不是跳过）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.attribution import AttributionLedger          # noqa: E402
from agenticx.learning.trajectory.store import TrajectoryStore       # noqa: E402
from agenticx.learning.trajectory.task_split import load_split       # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="经验贡献归因报告（SP30 T2）")
    ap.add_argument("--store", required=True, help="TrajectoryStore 根目录")
    ap.add_argument("--out", default="datasets/attribution", help="账本输出目录")
    ap.add_argument("--strict-unknown-pct", type=float, default=None,
                    help="unknown 版本占比超此百分比时 exit 2（CI 可选）")
    args = ap.parse_args()

    heldout: set[str] = set()
    try:
        heldout = set(load_split()["heldout"])
    except (OSError, ValueError):
        print("[warn] datasets/task_split.json 不可读，held-out 守卫未生效")

    store = TrajectoryStore(Path(args.store))
    ledger = AttributionLedger(heldout_tasks=heldout)
    n_traj, n_labeled = 0, 0
    for t in store.iter_trajectories():
        n_traj += 1
        if t.reward.label < 0:
            continue                      # 未标注轨迹静默跳过（合法，不算红线）
        n_labeled += 1
        ledger.credit(t)

    out_dir = Path(args.out)
    ledger.save(out_dir)

    unk_pct = ledger.unknown_version_ratio * 100
    print(f"轨迹 {n_traj} 条（已标注 {n_labeled}），经验条目 {len(ledger.rows)}")
    print(f"unknown 版本占比 {unk_pct:.1f}%")
    top = sorted([r for r in ledger.rows if not r.underpowered],
                 key=lambda r: -r.winrate)[:5]
    low = sorted([r for r in ledger.rows if not r.underpowered],
                 key=lambda r: r.winrate)[:5]
    if top:
        print("\n[top 经验]")
        for r in top:
            print(f"  {r.ref:<40} uses={r.uses:<4} winrate={r.winrate:.3f}")
    if low:
        print("[拖后腿经验]")
        for r in low:
            print(f"  {r.ref:<40} uses={r.uses:<4} winrate={r.winrate:.3f}")
    print(f"\n落盘: {out_dir}/ledger.json + ledger.md")

    if (args.strict_unknown_pct is not None
            and unk_pct > args.strict_unknown_pct):
        print(f"[exit 2] unknown 占比 {unk_pct:.1f}% 超阈值 "
              f"{args.strict_unknown_pct}%")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
