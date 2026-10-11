#!/usr/bin/env python3
"""SP23: 多域任务池生成——MiMo code/cyber parquet → datasets/task_pool.json。

general 域 925 环境为逐目录文件形态（4 万+ 文件）, 本版不整仓拉取,
仅登记 manifest 驱动的采样清单（SP24 再决定整域接入规模）。

产物:
- datasets/task_pool.json         统一任务池清单（summary + tasks）
- 控制台打印分布矩阵（域 × verifier）
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.task_pool import (  # noqa: E402
    parse_code_parquet,
    parse_cyber_parquet,
    write_pool_manifest,
)

_ROOT = Path(__file__).resolve().parent.parent
_MIMO = _ROOT / "datasets" / "mimo-rl-oss"


def main() -> int:
    tasks = []
    code_path = _MIMO / "code.parquet"
    cyber_path = _MIMO / "cyber.parquet"
    if not code_path.exists():
        print(f"缺 {code_path}——先跑 hf-mirror 下载（见 SP23 计划文档）")
        return 1

    tasks += parse_code_parquet(code_path)
    print(f"code 域: {len(tasks)} 任务")

    if cyber_path.exists():
        cyber = parse_cyber_parquet(cyber_path)
        print(f"cyber 域: {len(cyber)} 任务")
        tasks += cyber

    # 去重保险（instance_id 撞车时保留首条）
    seen, uniq = set(), []
    for t in tasks:
        if t.task_id in seen:
            continue
        seen.add(t.task_id)
        uniq.append(t)
    tasks = uniq

    summary = write_pool_manifest(tasks, _ROOT / "datasets" / "task_pool.json")
    print("\n=== 任务池分布 ===")
    print(f"total: {summary['total']}")
    for d, n in sorted(summary["by_domain"].items()):
        print(f"  {d:8} {n:5}")
    print("verifier:", summary["by_verifier"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
