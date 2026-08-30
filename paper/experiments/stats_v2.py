#!/usr/bin/env python3
"""TeamBench 统计工具链 v2【FIX-5 / AC-5，修 B8/M6/M7】

要点（对照 03-实验手册 §5）：
- CTR 用几何均值 + log 域 bootstrap CI（比值指标不能对均值直接做 t 检验）
- 多重比较用 BH-FDR 校正
- 效应量报告 Cliff's delta（非参、对 15 任务小样本稳健）
- TMS 二元通过率用 McNemar（同任务配对）
- required_n 给出 power=0.8 下的最小样本量
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
from scipy import stats


def bootstrap_ci(x: np.ndarray, stat=np.mean, n_boot: int = 10000, alpha: float = 0.05,
                 rng: np.random.Generator | None = None) -> Tuple[float, float, float]:
    """通用 bootstrap 置信区间。返回 (点估计, 下界, 上界)。"""
    rng = rng or np.random.default_rng(0)
    x = np.asarray(x, dtype=float)
    point = float(stat(x))
    idx = rng.integers(0, len(x), size=(n_boot, len(x)))
    boots = stat(x[idx], axis=1)
    lo, hi = np.percentile(boots, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    return point, float(lo), float(hi)


def log_ratio_ctr(q_team: np.ndarray, q_single: np.ndarray, n_boot: int = 10000,
                  alpha: float = 0.05, rng: np.random.Generator | None = None) -> Dict:
    """CTR 的几何均值 + log 域配对 bootstrap CI。

    CTR_i = Q_team,i / Q_single,i；几何均值 = exp(mean(log(CTR)))。
    每次重采样同步抽取 (team, single) 配对，保持任务级配对结构。
    """
    rng = rng or np.random.default_rng(0)
    qt = np.asarray(q_team, dtype=float)
    qs = np.asarray(q_single, dtype=float)
    assert qt.shape == qs.shape, "team/single 必须按任务配对"
    if (qs <= 0).any():
        raise ValueError("存在 Q_single <= 0，log-ratio CTR 未定义（检查打分器是否给了全 0 分）")
    ctr = qt / qs
    log_ctr = np.log(ctr)
    geo = float(np.exp(log_ctr.mean()))
    n = len(ctr)
    idx = rng.integers(0, n, size=(n_boot, n))
    boots = np.exp(log_ctr[idx].mean(axis=1))
    lo, hi = np.percentile(boots, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    # 配对符号检验（log CTR 是否系统偏离 0）
    stat_w, p_w = stats.wilcoxon(log_ctr) if (log_ctr != 0).any() else (0.0, 1.0)
    return {
        "geo_mean_CTR": geo, "ci_low": float(lo), "ci_high": float(hi),
        "n": n, "median_CTR": float(np.median(ctr)),
        "wilcoxon_p": float(p_w),
    }


def cliffs_delta(x: np.ndarray, y: np.ndarray) -> float:
    """Cliff's delta：P(X>Y) - P(X<Y)。∈[-1,1]，0 表示无差异。"""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    gt = int((x[:, None] > y[None, :]).sum())
    lt = int((x[:, None] < y[None, :]).sum())
    return float((gt - lt) / (len(x) * len(y)))


def bh_fdr(pvals: List[float]) -> Tuple[np.ndarray, List[bool]]:
    """Benjamini-Hochberg FDR 校正。返回 (调整后 p, 是否显著 @ q=0.05)。"""
    p = np.asarray(pvals, dtype=float)
    n = len(p)
    order = np.argsort(p)
    ranked = p[order] * n / (np.arange(n) + 1)
    adjusted = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.minimum(adjusted, 1.0)
    sig = [bool(q < 0.05) for q in out]
    return out, sig


def mcnemar(b: int, c: int) -> float:
    """McNemar 精确检验（二元 TMS 配对）。b/c 为 discordant pair 计数。"""
    n = b + c
    if n == 0:
        return 1.0
    return float(stats.binomtest(min(b, c), n, 0.5).pvalue)


def required_n(effect_d: float, power: float = 0.8, alpha: float = 0.05) -> int:
    """Wilcoxon/Mann-Whitney 双侧检验在给定效应量下达到目标 power 的每组样本量。

    用正态逼近 + aretes 效率转换（Wilcoxon 对正态替代 ≈ 0.955×t 检验 power）。
    """
    if effect_d <= 0:
        raise ValueError("效应量必须为正")
    z_a = stats.norm.ppf(1 - alpha / 2)
    z_b = stats.norm.ppf(power)
    # 单样本配对近似（Wilcoxon signed-rank, ARE=0.955 → 有效样本放大 1/√0.955）
    n = ((z_a + z_b) / effect_d) ** 2
    return int(np.ceil(n / 0.955))


def paired_ctr_report(qt: np.ndarray, qs: np.ndarray) -> Dict:
    """一次性输出配对 CTR 分析（几何均值/CI/Wilcoxon/Cliff's d），供 summary 脚本调用。"""
    r = log_ratio_ctr(qt, qs)
    r["cliffs_delta_team_vs_single"] = cliffs_delta(qt, qs)
    return r


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    qs = rng.uniform(0.6, 0.9, 60)
    qt = qs * rng.normal(1.05, 0.08, 60)
    r = log_ratio_ctr(qt, qs)
    print("geo-mean CTR=%.3f CI=[%.3f, %.3f] n=%d" % (r["geo_mean_CTR"], r["ci_low"], r["ci_high"], r["n"]))
    adj, sig = bh_fdr([0.001, 0.02, 0.04, 0.3, 0.8])
    print("BH-adj:", np.round(adj, 4), " 显著:", sig)
    print("Cliff's d =", round(cliffs_delta(qt, qs), 3))
    print("d=0.3 达到 power=0.8 所需 n =", required_n(0.3))
    print("✓ 统计工具链可用")
