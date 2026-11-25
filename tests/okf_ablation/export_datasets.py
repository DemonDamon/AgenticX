"""把消融实验数据集落盘到 datasets/okf_ablation/（供开源协作者直接取用与验证）。

导出内容（四个规模）：
- bundle_v2_15/：单库 fixture（15 概念，人工标注 12 条查询）
- scale_60/ scale_200/ scale_600/：生成器规模化库（领域分布与状态比例一致）
- 每个规模目录内：OKF Bundle 目录树（.md 概念文件） + queries.jsonl（标注）

用法：python3 tests/okf_ablation/export_datasets.py
"""

from __future__ import annotations

import json
from pathlib import Path

try:
    from tests.okf_ablation.fixture_v2 import CONCEPTS, ANNOTATED_QUERIES, write_bundle_v2
    from tests.okf_ablation.scale_fixture import build_scale_fixture
except ImportError:
    from fixture_v2 import CONCEPTS, ANNOTATED_QUERIES, write_bundle_v2
    from scale_fixture import build_scale_fixture

DATASET_ROOT = Path(__file__).resolve().parents[2] / "datasets" / "okf_ablation"
SCALES = [60, 200, 600]


def _write_queries(path: Path, queries):
    """查询标注落盘为 jsonl：每行 query / relevant / excluded。"""
    with path.open("w", encoding="utf-8") as f:
        for query, relevant, excluded in queries:
            f.write(json.dumps(
                {"query": query, "relevant": relevant, "excluded": excluded},
                ensure_ascii=False,
            ) + "\n")


def export_all():
    DATASET_ROOT.mkdir(parents=True, exist_ok=True)

    # 单库 fixture v2（15 概念，人工标注）
    bundle15 = write_bundle_v2(DATASET_ROOT / "bundle_v2_15")
    _write_queries(bundle15 / "queries.jsonl", ANNOTATED_QUERIES)
    print(f"bundle_v2_15: {len(CONCEPTS)} concepts, 12 queries")

    # 规模化库（生成器，seed 固定与测试一致）
    for scale in SCALES:
        root = DATASET_ROOT / f"scale_{scale}"
        bundle_root, queries, concepts = build_scale_fixture(scale, root)
        _write_queries(root / "queries.jsonl", queries)
        print(f"scale_{scale}: {len(concepts)} concepts, {len(queries)} queries")


if __name__ == "__main__":
    export_all()
    print(f"Dataset written to {DATASET_ROOT}")
