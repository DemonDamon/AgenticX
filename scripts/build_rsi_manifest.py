#!/usr/bin/env python3
"""构建 RSI 开训用的 train/eval manifest。

用法:
    python3 scripts/build_rsi_manifest.py                 # 默认输出 datasets/rsi/manifest.json
    python3 scripts/build_rsi_manifest.py --exclude-solved
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agenticx.learning.trajectory.train_manifest import (  # noqa: E402
    MEDIUM_MAX,
    SHORT_MAX,
    build_manifest,
    collect_durations,
    write_manifest,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results", help="calibration 结果根目录")
    ap.add_argument("--pool", default=None)
    ap.add_argument("--split", default=None)
    ap.add_argument("--out", default="datasets/rsi/manifest.json")
    ap.add_argument("--short-max", type=float, default=SHORT_MAX)
    ap.add_argument("--medium-max", type=float, default=MEDIUM_MAX)
    ap.add_argument("--exclude-solved", action="store_true")
    args = ap.parse_args()

    durations = collect_durations(args.results)
    manifest = build_manifest(
        durations,
        pool_path=args.pool,
        split_path=args.split,
        short_max=args.short_max,
        medium_max=args.medium_max,
        exclude_solved=args.exclude_solved,
    )
    path = write_manifest(manifest, args.out)

    s = manifest["summary"]
    print(f"写入 {path}")
    print(f"  训练: {s['train']} | 评测(held-out): {s['eval']}")
    print(f"  分层: short={s['short']} medium={s['medium']} long={s['long']} "
          f"未实测={s['unmeasured']}")
    print(f"  排除: {s['excluded']}")
    if s["short"] == 0:
        print("  注意: short 层为空——需先跑长度探测（见 docs/rsi-training-playbook）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
