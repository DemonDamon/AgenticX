#!/usr/bin/env python3
"""长时程 SLO 报告（SP30 T5）：人工干预率 / 断点恢复率 / 未采集率。

用法:
    python3 scripts/rsi_slo_report.py --store <dir> [--out datasets/slo]

指标从轨迹 metadata 算（保留键约定见 learning/trajectory/schema.py）；
replay_ledger join 属后续增强（recorder 事件流与轨迹 join 需统一 run_id，
本期缺键一律 unknown 上报，不造假）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.store import TrajectoryStore        # noqa: E402
from agenticx.ops.rsi_slo import compute_slo, render_markdown         # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="长时程 SLO 报告（SP30 T5）")
    ap.add_argument("--store", required=True, help="TrajectoryStore 根目录")
    ap.add_argument("--out", default="datasets/slo/rsi_slo.md")
    args = ap.parse_args()

    store = TrajectoryStore(Path(args.store))
    trajs = list(store.iter_trajectories())
    slo = compute_slo(trajs)

    print(f"轨迹 {slo.total} 条，长任务 {slo.long_task_count} 条"
          f"（代理口径：≥40 次工具调用或墙钟 ≥4h）")
    print(f"人工干预率: {slo.intervention_rate}  "
          f"未采集率: {slo.unknown_rate}  "
          f"断点恢复率: {slo.resume_success_rate}")
    if slo.underpowered:
        print(f"[样本不足] 长任务 {slo.long_task_count} < 10，指标标灰仅供参考")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_markdown(slo), encoding="utf-8")
    print(f"落盘: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
