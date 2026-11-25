"""FR4 — 消融实验判定门与主效应的常规可复核断言。

预注册门（G1/G2 的 Recall 15% 增量部分）在小 fixture 上受 top-10 容量效应
限制，由报告如实呈现，不做硬断言；本测试硬断言确定性成立的主效应与自洽性。
"""

from __future__ import annotations

import pytest

try:
    from tests.okf_ablation.run_ablation import run_ablation
except ImportError:
    from run_ablation import run_ablation


@pytest.fixture(scope="module")
def result():
    return run_ablation()


def test_all_arms_present(result):
    assert set(result["summary"].keys()) == {"A0", "A1", "A2", "A3", "A4"}
    assert set(result["gates"]) >= {
        "G1_pass", "G2_pass",
        "G1_recall_lift_A2_vs_A1", "G1_trap_drop_A2_vs_A1",
        "G2_recall_lift_A4_vs_A0", "G2_token_ratio_A4_vs_A0",
    }
    assert isinstance(result["gates"]["G1_pass"], bool)
    assert isinstance(result["gates"]["G2_pass"], bool)


def test_metadata_filter_eliminates_trap_hits(result):
    """主效应 1：元数据过滤完全消除陷阱误召回（A1 全中 → A2 零）。"""
    s = result["summary"]
    assert s["A1"]["trap_hit_rate"] > 0.5
    assert s["A2"]["trap_hit_rate"] == 0.0


def test_filter_is_recall_lossless(result):
    """主效应 2：过滤不损失有效召回（A2 recall ≥ A1）。"""
    s = result["summary"]
    assert s["A2"]["recall@10"] >= s["A1"]["recall@10"]
    assert s["A2"]["mrr"] >= s["A1"]["mrr"]


def test_okf_context_is_cheaper_than_raw_chunks(result):
    """主效应 3：结构化上下文成本显著低于裸 chunk（token 比 ≤ 0.5）。"""
    s = result["summary"]
    ratio = s["A4"]["token_chars_per_query"] / s["A0"]["token_chars_per_query"]
    assert ratio <= 0.5


def test_full_okf_beats_baseline_on_recall(result):
    """主效应 4：完整 OKF 臂（A4）召回不低于 baseline（A0）。"""
    s = result["summary"]
    assert s["A4"]["recall@10"] >= s["A0"]["recall@10"]


def test_gates_are_consistent_with_summary(result):
    """自洽性：预注册门布尔值与底层数字一致（无论过否）。"""
    s = result["summary"]
    g = result["gates"]
    assert g["G1_pass"] == (
        g["G1_recall_lift_A2_vs_A1"] >= 0.15 and g["G1_trap_drop_A2_vs_A1"] >= 0.5
    )
    assert g["G2_pass"] == (
        g["G2_recall_lift_A4_vs_A0"] >= 0.15 and g["G2_token_ratio_A4_vs_A0"] <= 1.05
    )
    # 陷阱下降幅度按数字直接复核
    drop = (s["A1"]["trap_hit_rate"] - s["A2"]["trap_hit_rate"]) / s["A1"]["trap_hit_rate"]
    assert drop == pytest.approx(g["G1_trap_drop_A2_vs_A1"])
