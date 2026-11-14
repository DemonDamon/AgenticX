# agenticx/rl/promotion_audit.py
"""假晋升率审计（playbook §4.2-5 / §7.7）：零假设下的置换检验。

REUSE 实测现有 RSI 系统假晋升率 20.7%（名义 α=0.1）——我们的核心度量。
零假设 = 新旧版本同分布：配对场景下把每对 (b_i, c_i) 以 0.5 概率交换，
重新走一遍门控，被误接受的比例即经验 FPR。判据（playbook §8 风险表）：
FPR > 2×名义 α → 冻结晋升，检查预算扣减是否生效。

用与 PromotionGatekeeper 同一条检验路径（exact_sign / wilcoxon），
保证审计测的就是线上跑的，不是另一套近似。
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Sequence

from .acceptance import wilcoxon_gate
from .promotion_gate import exact_sign_p, is_binary


@dataclass
class AuditResult:
    fpr: float                     # 经验假晋升率
    nominal_alpha: float
    n_perm: int
    n_accepted: int
    test: str                      # exact_sign | wilcoxon
    status: str                    # ok | warn（FPR > 2α 冻结线）

    def to_json(self) -> dict:
        return dict(fpr=round(self.fpr, 4), nominal_alpha=self.nominal_alpha,
                    n_perm=self.n_perm, n_accepted=self.n_accepted,
                    test=self.test, status=self.status)


def _gate_pvalue(baseline: Sequence[float], candidate: Sequence[float],
                 alpha: float, *, test: str) -> bool:
    """单次门控判定（只判显著性，不做 min_improve——审计只关心误接受）。"""
    if test == "exact_sign":
        diffs = [(b, c) for b, c in zip(baseline, candidate) if b != c]
        m, n_plus = len(diffs), sum(1 for _, c in diffs if c > 0)
        if m < 2:
            return False
        return exact_sign_p(n_plus, m) < alpha
    d = wilcoxon_gate(baseline, candidate, alpha=alpha)
    return d.accepted


def audit_false_promotion(baseline: Sequence[float],
                          candidate: Sequence[float], *,
                          nominal_alpha: float = 0.1,
                          n_perm: int = 1000, seed: int = 0) -> AuditResult:
    """零假设置换审计：FPR_hat = #(门控误接受) / n_perm。

    baseline/candidate 只取其「配对结构」（差值分布），交换方向随机——
    零假设下这不改变联合分布。二值走精确符号检验，连续走 Wilcoxon，
    与 PromotionGatekeeper 的分流一致。
    """
    if len(baseline) != len(candidate) or not baseline:
        raise ValueError(f"配对长度不一致或空: {len(baseline)} vs {len(candidate)}")
    test = ("exact_sign" if is_binary(baseline) and is_binary(candidate)
            else "wilcoxon")
    pairs = list(zip(baseline, candidate))
    rng = random.Random(seed)
    accepted = 0
    for _ in range(n_perm):
        b2, c2 = [], []
        for b, c in pairs:
            if rng.random() < 0.5:
                b, c = c, b                   # 零假设下交换不变
            b2.append(b)
            c2.append(c)
        if _gate_pvalue(b2, c2, nominal_alpha, test=test):
            accepted += 1
    fpr = accepted / n_perm
    return AuditResult(fpr=fpr, nominal_alpha=nominal_alpha, n_perm=n_perm,
                       n_accepted=accepted, test=test,
                       status="warn" if fpr > 2 * nominal_alpha else "ok")
