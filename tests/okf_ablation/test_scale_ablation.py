"""规模化消融的常规可复核断言：结论恒定性 + 关键趋势。"""

from __future__ import annotations

import pytest

try:
    from tests.okf_ablation.run_scale_ablation import run_scale_ablation, check_stability
except ImportError:
    from run_scale_ablation import run_scale_ablation, check_stability


@pytest.fixture(scope="module")
def results():
    return run_scale_ablation(scales=[15, 60, 200])


def test_scales_present(results):
    assert list(results.keys()) == [15, 60, 200]
    # 规模、查询数、分布记录齐全
    assert results[15]["n_docs"] == 15 and results[60]["n_docs"] == 60
    assert results[200]["n_queries"] == 160
    assert sum(results[200]["domains"].values()) == 200


def test_trap_filtering_stable_across_scales(results):
    """恒定性一：各规模 A2 陷阱率均为 0，A1 存在陷阱命中（防御有必要性）。"""
    for scale, r in results.items():
        assert r["summary"]["A2"]["trap_hit_rate"] == 0.0, scale
        assert r["summary"]["A1"]["trap_hit_rate"] > 0.0, scale
        assert r["n_trap_hit_a1"] > 0, scale


def test_token_economy_stable_across_scales(results):
    """恒定性二：A4/A0 token 比各规模均 < 0.5。"""
    for scale, r in results.items():
        ratio = r["summary"]["A4"]["token_chars_per_query"] / \
            r["summary"]["A0"]["token_chars_per_query"]
        assert ratio < 0.5, (scale, ratio)


def test_filter_recall_lossless_across_scales(results):
    """恒定性三：过滤无损（A2 recall ≥ A1）各规模成立。"""
    for scale, r in results.items():
        assert r["summary"]["A2"]["recall@10"] >= r["summary"]["A1"]["recall@10"], scale


def test_mrr_gap_widens_with_scale(results):
    """趋势：A4−A0 的 MRR 差随规模递增（结构边界价值随库容放大）。"""
    gaps = [
        r["summary"]["A4"]["mrr"] - r["summary"]["A0"]["mrr"]
        for r in results.values()
    ]
    assert gaps[-1] > gaps[0]
    assert gaps[-1] > 0.05


def test_stability_checks_consistent(results):
    """check_stability 输出与 summary 自洽。"""
    checks = check_stability(results)
    for scale, c in checks.items():
        s = results[scale]["summary"]
        assert c["filter_eliminates_traps"] == (s["A2"]["trap_hit_rate"] == 0.0)
        assert c["token_ratio_a4_a0"] == round(
            s["A4"]["token_chars_per_query"] / s["A0"]["token_chars_per_query"], 3
        )
