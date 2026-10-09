# tests/rl/test_acceptance.py
"""飞轮接受门控: AIDE² §5 教训——噪声复合下晋升必须过统计门。"""
import pytest

from agenticx.rl.acceptance import mannwhitney_gate, wilcoxon_gate


def test_wilcoxon_accepts_strong_consistent_gain():
    # 10 任务全 0 → 8 个翻 1: 均值大升且方向一致
    base = [0.0] * 10
    cand = [1.0] * 8 + [0.0, 0.0]
    d = wilcoxon_gate(base, cand)
    assert d.accepted
    assert d.reason == "significant_gain"
    assert d.n_pairs == 8
    assert d.mean_candidate > d.mean_baseline


def test_wilcoxon_rejects_no_difference():
    base = [1.0, 0.0, 1.0, 0.0]
    d = wilcoxon_gate(base, list(base))
    assert not d.accepted
    assert d.reason == "insufficient_nonzero_pairs"   # 全零差对


def test_wilcoxon_rejects_noise_flip_flop():
    # 均值相同的一对一翻转: 非零对多但无方向性
    base = [1.0, 0.0, 1.0, 0.0, 1.0, 0.0]
    cand = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0]
    d = wilcoxon_gate(base, cand)
    assert not d.accepted


def test_wilcoxon_rejects_mean_regression():
    base = [1.0, 1.0, 1.0, 0.0]
    cand = [0.0, 0.0, 1.0, 1.0]        # 均值 0.5 < 0.75
    d = wilcoxon_gate(base, cand)
    assert not d.accepted
    assert d.reason == "no_mean_gain"


def test_wilcoxon_requires_min_improve():
    base = [0.0] * 8
    cand = [1.0, 1.0] + [0.0] * 6          # 2 非零对, 均值升 0.25 < 门槛 0.5
    d = wilcoxon_gate(base, cand, min_improve=0.5)
    assert not d.accepted
    assert d.reason == "no_mean_gain"


def test_wilcoxon_length_mismatch_raises():
    with pytest.raises(ValueError, match="配对长度不一致"):
        wilcoxon_gate([0.0, 1.0], [1.0])


def test_wilcoxon_empty_raises():
    with pytest.raises(ValueError, match="空样本"):
        wilcoxon_gate([], [])


def test_mannwhitney_accepts_shift():
    base = [0.0] * 12
    cand = [1.0] * 12
    d = mannwhitney_gate(base, cand)
    assert d.accepted


def test_mannwhitney_rejects_same_distribution():
    base = [1.0, 0.0, 1.0, 0.0, 1.0, 0.0]
    cand = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0]
    d = mannwhitney_gate(base, cand)
    assert not d.accepted
