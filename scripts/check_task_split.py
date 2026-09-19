#!/usr/bin/env python3
"""任务集拆分自检（SP18）：两份名单 + 数量 + 交集空 + 目录存在性。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.task_split import load_split  # noqa: E402


def main() -> int:
    split = load_split()
    src = Path(split["source_dir"])
    train, heldout = set(split["train"]), set(split["heldout"])
    overlap = train & heldout
    missing = [t for t in train | heldout if not (src / t).is_dir()]

    print(f"seed={split['seed']} ratio={split['ratio']}")
    print(f"训练题 {len(train)} 个 / 考试题 {len(heldout)} 个 / 合计 {len(train | heldout)}")
    print(f"\n[考试题·held-out·禁止训练]")
    for t in sorted(heldout):
        print(f"  {t}")
    print(f"\n[交集] {sorted(overlap) if overlap else '空 ✓'}")
    print(f"[目录缺失] {missing if missing else '无 ✓'}")
    return 1 if (overlap or missing) else 0


if __name__ == "__main__":
    raise SystemExit(main())
