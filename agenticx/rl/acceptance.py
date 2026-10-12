# agenticx/rl/acceptance.py
"""飞轮接受门控（AIDE² arXiv:2609.26457 §5 教训的工程落地）。

AIDE² 的核心警示: 双层优化中噪声复合（内循环轨迹方差 × 评估方差）,
单次噪声比较 falsely accepted 的改写会成为新 incumbent, 带偏外循环
后续全部搜索——且其点火测试因只有 3 seeds 而无法下结论。

因此所有"新变体是否优于现任"的晋升决策（checkpoint / hints / 策略
改写 / 飞轮轮次接受）统一走本模块:
  wilcoxon_gate    配对任务（同任务集合上跑两变体, 逐任务配对）
  mannwhitney_gate 非配对（不同 trial 采样, 任务不一一对应）
接受准则 = 均值提升 ≥ min_improve 且 p < alpha。仓库统计约定即
Wilcoxon/Mann-Whitney（工程惯例）, 这里只是把它变成晋升硬门。
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Sequence


@dataclass
class AcceptDecision:
    """晋升判定: accepted=True 才允许变体成为新 incumbent。"""

    accepted: bool
    statistic: float
    p_value: float
    mean_baseline: float
    mean_candidate: float
    n_pairs: int
    reason: str                     # "significant_gain" / 拒绝原因

    def to_json(self) -> dict:
        return asdict(self)


def _means(baseline: Sequence[float], candidate: Sequence[float]) -> tuple[float, float]:
    mb = sum(baseline) / len(baseline)
    mc = sum(candidate) / len(candidate)
    return mb, mc


def wilcoxon_gate(baseline: Sequence[float], candidate: Sequence[float],
                  *, alpha: float = 0.1, min_improve: float = 0.0
                  ) -> AcceptDecision:
    """配对 Wilcoxon 符号秩门控（任务名对齐的两列 reward）。

    零差对剔除（zero_method="wilcox"）; 全零差 → 不显著拒绝。样本量
    不足（<2 个非零对）→ 拒绝（AIDE² 点火测试教训: 宁可漏接受, 不可
    噪声接受）。alpha 默认 0.1: 飞轮轮次的筛选情境, 漏检代价高于误检。
    """
    from scipy.stats import wilcoxon

    if len(baseline) != len(candidate):
        raise ValueError(
            f"配对长度不一致: baseline={len(baseline)} candidate={len(candidate)}")
    if len(baseline) == 0:
        raise ValueError("空样本无法门控")
    mb, mc = _means(baseline, candidate)

    diffs = [c - b for b, c in zip(baseline, candidate) if c != b]
    n_pairs = len(diffs)
    if n_pairs < 2:
        return AcceptDecision(False, 0.0, 1.0, mb, mc, n_pairs,
                              "insufficient_nonzero_pairs")
    if mc < mb + min_improve:
        stat, p = wilcoxon(candidate, baseline, zero_method="wilcox")
        return AcceptDecision(False, float(stat), float(p), mb, mc, n_pairs,
                              "no_mean_gain")
    stat, p = wilcoxon(candidate, baseline, zero_method="wilcox")
    accepted = bool(p < alpha)     # scipy 返回 np.float64 → np.bool_ 不可 JSON
    return AcceptDecision(
        accepted, float(stat), float(p), mb, mc, n_pairs,
        "significant_gain" if accepted else "not_significant")


def mannwhitney_gate(baseline: Sequence[float], candidate: Sequence[float],
                     *, alpha: float = 0.1, min_improve: float = 0.0
                     ) -> AcceptDecision:
    """非配对 Mann-Whitney U 门控（任务集合不对齐时用, 检验方向: 候选更大）。"""
    from scipy.stats import mannwhitneyu

    if not baseline or not candidate:
        raise ValueError("空样本无法门控")
    mb, mc = _means(baseline, candidate)
    stat, p = mannwhitneyu(candidate, baseline, alternative="greater")
    n_pairs = min(len(baseline), len(candidate))
    if mc < mb + min_improve:
        return AcceptDecision(False, float(stat), float(p), mb, mc, n_pairs,
                              "no_mean_gain")
    accepted = bool(p < alpha)     # scipy 返回 np.float64 → np.bool_ 不可 JSON
    return AcceptDecision(
        accepted, float(stat), float(p), mb, mc, n_pairs,
        "significant_gain" if accepted else "not_significant")
