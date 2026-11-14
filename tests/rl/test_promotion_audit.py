"""假晋升率审计: 零假设置换检验（playbook §7.7）。"""
import random

import pytest

from agenticx.rl.promotion_audit import AuditResult, audit_false_promotion


def test_audit_binary_null_fpr_near_nominal():
    """同分布二值对（一半翻转来回摆）：FPR 应接近名义 α。"""
    base = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
    cand = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
    r = audit_false_promotion(base, cand, nominal_alpha=0.1, n_perm=2000, seed=42)
    assert r.test == "exact_sign"
    assert r.fpr < 2 * r.nominal_alpha           # 不触发冻结线
    assert r.status in ("ok", "warn")
    assert r.n_accepted / r.n_perm == pytest.approx(r.fpr)


def test_audit_binary_matches_analytic_binomial():
    """全非零二值对的 FPR 有解析解：P(Bin(12,0.5) ≤ 4) = 794/4096 ≈ 0.194。

    base=0/cand=1 全对翻转：交换 k 对后 n+=12-k，α=0.5 下 n+≥8 才被
    误接受（exact_sign_p(8,12)≈0.077<0.5, p(7,12)≈0.774>0.5），即 k≤4。
    审计器复现这条解析曲线 = 门控路径本身没 bug。
    """
    base = [0] * 12
    cand = [1] * 12
    r = audit_false_promotion(base, cand, nominal_alpha=0.5, n_perm=3000, seed=1)
    analytic = sum(__import__("math").comb(12, k) for k in range(5)) / 4096
    assert r.test == "exact_sign"
    assert abs(r.fpr - analytic) < 0.03
    assert r.status == "ok"                      # 0.194 < 2×0.5，不触发冻结线


def test_audit_continuous_falls_back_to_wilcoxon():
    base = [0.1, 0.2, 0.3, 0.4, 0.5, 0.0, 0.2, 0.1]
    cand = [0.9, 0.8, 0.7, 0.6, 0.5, 0.1, 0.3, 0.2]
    r = audit_false_promotion(base, cand, n_perm=200, seed=0)
    assert r.test == "wilcoxon"
    assert 0.0 <= r.fpr <= 1.0


def test_audit_reproducible_with_seed():
    base = [0, 1, 0, 1] * 4
    cand = [1, 0, 1, 0] * 4
    r1 = audit_false_promotion(base, cand, n_perm=300, seed=7)
    r2 = audit_false_promotion(base, cand, n_perm=300, seed=7)
    assert r1.fpr == r2.fpr


def test_audit_mismatch_raises():
    with pytest.raises(ValueError, match="配对长度不一致"):
        audit_false_promotion([1, 0], [1])
    with pytest.raises(ValueError, match="配对长度不一致"):
        audit_false_promotion([], [])


def test_audit_result_json():
    r = AuditResult(fpr=0.08, nominal_alpha=0.1, n_perm=1000,
                    n_accepted=80, test="exact_sign", status="ok")
    assert r.to_json()["fpr"] == 0.08
    assert r.to_json()["status"] == "ok"


def test_audit_random_seed_variation():
    """不同 seed 的 FPR 量级一致（方差在合理范围，不是运气值）。"""
    base = [0, 1, 0, 1] * 3
    cand = [1, 0, 1, 0] * 3
    fprs = [audit_false_promotion(base, cand, n_perm=500, seed=s).fpr
            for s in range(5)]
    assert max(fprs) < 0.6                       # 同分布下不该有 outlier seed
