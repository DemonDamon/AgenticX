#!/usr/bin/env python3
"""能力缺口派发 CLI（SP30 T4）：失败聚类 × 账本覆盖判定 → 提案队列。

只写 datasets/gap_queue/<proposal_id>.json（幂等，重跑不重复），不接任务池、
不触发训练——提案由人 review 后决定去向。

用法:
    python3 scripts/gap_dispatch.py --store <dir> [--ledger datasets/attribution] \
        [--dry-run] [--min-cluster 3]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.attribution import AttributionLedger          # noqa: E402
from agenticx.learning.gap_dispatch import find_gaps                 # noqa: E402
from agenticx.learning.trajectory.store import TrajectoryStore       # noqa: E402

QUEUE_DIR = Path("datasets/gap_queue")


def main() -> int:
    ap = argparse.ArgumentParser(description="能力缺口派发（SP30 T4）")
    ap.add_argument("--store", required=True, help="TrajectoryStore 根目录")
    ap.add_argument("--ledger", default="datasets/attribution",
                    help="归因账本目录（读 ledger.json；缺失则空账本）")
    ap.add_argument("--out", default=str(QUEUE_DIR))
    ap.add_argument("--min-cluster", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true", help="只打印不落盘")
    args = ap.parse_args()

    ledger_path = Path(args.ledger) / "ledger.json"
    if ledger_path.exists():
        ledger = AttributionLedger.load(Path(args.ledger))
        print(f"[ledger] 载入 {len(ledger.rows)} 条经验")
    else:
        ledger = AttributionLedger()
        print("[warn] 归因账本不存在，覆盖判定退化为『全部无覆盖』")

    store = TrajectoryStore(Path(args.store))
    trajs = list(store.iter_trajectories())
    proposals = find_gaps(trajs, ledger, min_cluster=args.min_cluster)

    by_action: dict[str, int] = {}
    for p in proposals:
        by_action[p.suggested_action] = by_action.get(p.suggested_action, 0) + 1
    print(f"\n轨迹 {len(trajs)} 条 → 提案 {len(proposals)} 个"
          f"（min_cluster={args.min_cluster}）")
    for a, n in sorted(by_action.items()):
        print(f"  {a}: {n}")
    for p in proposals[:10]:
        print(f"  [{p.suggested_action}] {p.cluster_key} ×{p.failure_count}"
              f"（tasks={len(p.task_ids)}）")

    if args.dry_run:
        print("\n[dry-run] 未落盘")
        return 0
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    written, skipped = 0, 0
    for p in proposals:
        f = out_dir / f"{p.proposal_id}.json"
        if f.exists():
            skipped += 1                     # 幂等：重跑不产生重复提案
            continue
        f.write_text(json.dumps(p.to_dict(), ensure_ascii=False, indent=2),
                     encoding="utf-8")
        written += 1
    print(f"\n落盘: 新增 {written} / 跳过已存在 {skipped} → {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
