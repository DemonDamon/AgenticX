"""晋升门控: 全局 α 预算 + gate.json 账本 + 二值精确符号检验（playbook §7.5）。"""
import json
import math

import pytest

from agenticx.rl.promotion_gate import (AlphaBudget, PromotionGatekeeper,
                                        exact_sign_p, is_binary)


def test_exact_sign_p_matches_binomial_sum():
    # n+=8, M=8: p = 2·(1/256) = 1/128
    assert abs(exact_sign_p(8, 8) - 2 * 0.5 ** 8) < 1e-12
    # n+=5, M=8: 上尾 = (C(8,5)+C(8,6)+C(8,7)+C(8,8))/256
    tail = sum(math.comb(8, k) for k in range(5, 9)) * 0.5 ** 8
    assert abs(exact_sign_p(5, 8) - min(1.0, 2 * tail)) < 1e-12


def test_exact_sign_p_minority_direction_is_one():
    assert exact_sign_p(2, 8) == 1.0          # 提升方向占少数 → 不显著
    assert exact_sign_p(4, 8) == 1.0         # 平局也归不显著


def test_exact_sign_p_all_positive_pairs():
    # 3/5 提升方向: p=2·Σ_{k=3..5}C(5,k)/32 = 2·0.5 = 1.0（少数派不显著）
    assert exact_sign_p(3, 5) == 1.0
    # 4/5: p = 2·(C(5,4)+C(5,5))/32 = 2·6/32 = 0.375
    assert abs(exact_sign_p(4, 5) - 0.375) < 1e-12


def test_exact_sign_p_invalid_args():
    with pytest.raises(ValueError):
        exact_sign_p(3, 0)
    with pytest.raises(ValueError):
        exact_sign_p(9, 8)


def test_is_binary():
    assert is_binary([0.0, 1.0, 0])
    assert not is_binary([0.5])


def test_budget_round_weights_sum_to_one():
    b = AlphaBudget(total_alpha=0.1, decay=0.9, max_rounds=10)
    assert abs(sum(b.round_weight(t) for t in range(1, 11)) - 1.0) < 1e-9
    assert b.round_weight(1) > b.round_weight(9)     # 越早的轮预算越多
    assert b.round_weight(99) == b.round_weight(10)  # 越界按末轮


def test_budget_allocate_and_spend():
    b = AlphaBudget(total_alpha=0.1)
    a1 = b.allocate(1, "adapter", n_ptypes=1)
    assert a1 == pytest.approx(0.1 * b.round_weight(1))
    b.spend(1, "adapter", a1)
    assert b.remaining == pytest.approx(0.1 - a1)
    assert b.effective_alpha(2, "adapter") == pytest.approx(
        min(b.allocate(2, "adapter"), b.remaining))


def test_gatekeeper_accepts_clean_gain(tmp_path):
    gate = PromotionGatekeeper(tmp_path / "gate.json")
    base = [0.0] * 12
    cand = [1.0] * 12
    d = gate.decide(1, "adapter", base, cand)
    assert d["accepted"]
    assert d["test"] == "exact_sign"
    assert d["p_value"] == pytest.approx(2 * 0.5 ** 12, abs=1e-6)  # 账本存 6 位小数
    assert d["effective_alpha"] > 0
    assert d["budget_remaining"] < gate.budget.total_alpha   # 扣过了


def test_gatekeeper_rejects_flip_flop(tmp_path):
    gate = PromotionGatekeeper(tmp_path / "gate.json")
    base = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
    cand = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
    d = gate.decide(1, "adapter", base, cand)
    assert not d["accepted"]
    assert d["reason"] == "not_significant"


def test_gatekeeper_spends_even_on_reject(tmp_path):
    """检验机会本身花预算——拒绝也扣（REUSE 语义）。"""
    gate = PromotionGatekeeper(tmp_path / "gate.json")
    before = gate.budget.remaining
    gate.decide(1, "adapter", [1, 0] * 6, [0, 1] * 6)
    assert gate.budget.remaining < before


def test_gatekeeper_alpha_exhausted(tmp_path):
    """预算花光后：不检验直接拒，且不再扣减。"""
    gate = PromotionGatekeeper(tmp_path / "gate.json")
    gate.budget.spend(99, "adapter", gate.budget.total_alpha)   # 模拟历史轮次花光
    d = gate.decide(1, "adapter", [0.0] * 12, [1.0] * 12)
    assert d["reason"] == "alpha_exhausted"
    assert not d["accepted"]
    assert d["effective_alpha"] == 0.0
    assert gate.budget.remaining == 0.0


def test_gatekeeper_persists_and_reloads(tmp_path):
    """账本跨进程持久：重启后 spent 与 entries 都在。"""
    g1 = PromotionGatekeeper(tmp_path / "gate.json")
    g1.decide(1, "adapter", [0.0] * 12, [1.0] * 12)
    g2 = PromotionGatekeeper(tmp_path / "gate.json")
    assert g2.budget.spent == g1.budget.spent
    assert len(g2.entries) == 1
    # 账本就是普通 JSON，人可读
    data = json.loads((tmp_path / "gate.json").read_text())
    assert data["entries"][0]["accepted"] is True


def test_gatekeeper_insufficient_nonzero_pairs(tmp_path):
    gate = PromotionGatekeeper(tmp_path / "gate.json")
    base = [0.0] * 12
    cand = [1.0] + [0.0] * 11
    d = gate.decide(1, "adapter", base, cand)
    assert not d["accepted"]
    assert d["reason"] == "insufficient_nonzero_pairs"


def test_gatekeeper_continuous_rewards_fall_back_to_wilcoxon(tmp_path):
    gate = PromotionGatekeeper(tmp_path / "gate.json")
    base = [0.0] * 12
    cand = [0.9] * 12
    d = gate.decide(1, "adapter", base, cand)
    assert d["test"] == "wilcoxon"
    assert d["accepted"]
