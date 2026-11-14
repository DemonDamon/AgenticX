# agenticx/rl/promotion_gate.py
"""晋升门控（playbook §4.2-2）：wilcoxon_gate + 全局 α 预算 → 每轮强制关卡。

REUSE（arXiv 全局 α 预算）的工程落地：逐轮独立用 α=0.1 会在多轮飞轮中
膨胀假阳性（名义 5 轮只测一次 α 变成 1-0.9^5≈41%）。本模块把「第 t 轮
第 p 类晋升的有效显著性水平」从全局预算里分配出来，每次检验（无论接受
与否）都扣减，判定与账本原子写入 gate.json。

配对二值结果下 Wilcoxon 退化为精确符号检验（playbook §7.5）：
    p = 2 · Σ_{k=n+}^{M} C(M,k) · 0.5^M
M 为非零配对对数，n+ 为提升方向翻转数。二值下用精确解而非 scipy 近似，
小样本（12 题 held-out）下更保守也更可复现。
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from .acceptance import AcceptDecision, wilcoxon_gate

DEFAULT_TOTAL_ALPHA = 0.10
DEFAULT_DECAY = 0.9          # 轮次权重衰减：w_t ∝ decay^t
DEFAULT_MAX_ROUNDS = 10      # 超过此轮次按末轮权重取（预算早已见底是常态信号）


def exact_sign_p(n_plus: int, m: int) -> float:
    """二值配对的精确双侧符号检验 p 值（含 cap 到 1.0）。

    n+ <= m/2 时上尾和 >= 0.5，2× 上尾 >= 1 → 直接判不显著（p=1）。
    """
    if m <= 0 or n_plus < 0 or n_plus > m:
        raise ValueError(f"非法参数: n_plus={n_plus}, m={m}")
    if n_plus * 2 <= m:
        return 1.0
    tail = sum(math.comb(m, k) for k in range(n_plus, m + 1)) * 0.5 ** m
    return min(1.0, 2.0 * tail)


def is_binary(rewards: Sequence[float], *, tol: float = 1e-9) -> bool:
    return all(abs(float(r)) < tol or abs(float(r) - 1.0) < tol for r in rewards)


@dataclass
class AlphaBudget:
    """全局 α 预算：α_{t,p} = w_t · v_p · α_total（w_t 按 decay^t 归一化）。

    spend 只在检验发生时调用（接受与拒绝都算花掉——花的是「检验机会」，
    不是「通过证书」）。remaining 是硬约束：不够本次分配就拒绝且不花。
    """

    total_alpha: float = DEFAULT_TOTAL_ALPHA
    decay: float = DEFAULT_DECAY
    max_rounds: int = DEFAULT_MAX_ROUNDS
    spent: float = 0.0
    log: list[dict] = field(default_factory=list)

    def round_weight(self, round_idx: int) -> float:
        """第 round_idx 轮（从 1 计）的权重；越界按末轮（幂和已收敛）。"""
        if self.decay <= 0:
            return 1.0 / self.max_rounds
        n = min(round_idx, self.max_rounds)
        denom = sum(self.decay ** t for t in range(1, self.max_rounds + 1))
        return self.decay ** n / denom

    def allocate(self, round_idx: int, ptype: str, *, n_ptypes: int = 1) -> float:
        """本轮本类晋升的有效 α（v_p 均分；不同 ptype 数量在调用侧数清）。"""
        v = 1.0 / max(1, n_ptypes)
        return self.total_alpha * self.round_weight(round_idx) * v

    def effective_alpha(self, round_idx: int, ptype: str, *, n_ptypes: int = 1) -> float:
        """分配值再与剩余预算取 min——预算见底时自动收紧。"""
        return min(self.allocate(round_idx, ptype, n_ptypes=n_ptypes),
                   self.remaining)

    def spend(self, round_idx: int, ptype: str, amount: float) -> None:
        if amount < 0:
            raise ValueError("spend 金额非负")
        self.spent += amount
        self.log.append({"round": round_idx, "ptype": ptype, "amount": amount,
                         "remaining": self.remaining})

    @property
    def remaining(self) -> float:
        return max(0.0, self.total_alpha - self.spent)

    def to_json(self) -> dict:
        return {"total_alpha": self.total_alpha, "decay": self.decay,
                "max_rounds": self.max_rounds, "spent": self.spent,
                "remaining": self.remaining, "log": self.log}


class PromotionGatekeeper:
    """每轮晋升的强制关卡：决策 + 账本（gate.json）一体，无 bypass。

    用法（飞轮外循环，接 AdapterRegistry.promote/rollback）：
        gate = PromotionGatekeeper("runs/rsi-27b/gate.json")
        d = gate.decide(round_idx=1, ptype="adapter",
                        baseline=[...], candidate=[...])
        if d["accepted"]:
            registry.promote(alias, version_id)
        else:
            registry.rollback(alias)   # 保留上一轮 adapter
    """

    def __init__(self, path: str | Path, *, total_alpha: float = DEFAULT_TOTAL_ALPHA,
                 decay: float = DEFAULT_DECAY, max_rounds: int = DEFAULT_MAX_ROUNDS,
                 min_improve: float = 0.0):
        self.path = Path(path)
        self.min_improve = min_improve
        if self.path.exists():
            data = json.loads(self.path.read_text())
            b = data.get("budget", {})
            self.budget = AlphaBudget(
                total_alpha=float(b.get("total_alpha", total_alpha)),
                decay=float(b.get("decay", decay)),
                max_rounds=int(b.get("max_rounds", max_rounds)),
                spent=float(b.get("spent", 0.0)),
                log=list(b.get("log", [])))
            self.entries: list[dict] = list(data.get("entries", []))
        else:
            self.budget = AlphaBudget(total_alpha=total_alpha, decay=decay,
                                     max_rounds=max_rounds)
            self.entries = []
            self._save()

    # ------------------------------------------------------------------ 判定
    def decide(self, round_idx: int, ptype: str,
               baseline: Sequence[float], candidate: Sequence[float],
               *, n_ptypes: int = 1) -> dict:
        """一次晋升检验：预算不足直接拒；否则跑检验并扣减 α。

        返回 dict（同步落 gate.json）：accepted / p_value / effective_alpha /
        reason / test（"exact_sign" | "wilcoxon"）/ budget_remaining。
        """
        alpha = self.budget.effective_alpha(round_idx, ptype, n_ptypes=n_ptypes)
        if self.budget.remaining <= 0.0:
            return self._record(round_idx, ptype, baseline, candidate,
                                accepted=False, p_value=1.0, alpha=0.0,
                                reason="alpha_exhausted", test="none")
        if len(baseline) != len(candidate) or not baseline:
            raise ValueError(
                f"配对长度不一致或空: {len(baseline)} vs {len(candidate)}")

        both_binary = is_binary(baseline) and is_binary(candidate)
        if both_binary:
            diffs = [(b, c) for b, c in zip(baseline, candidate) if b != c]
            m, n_plus = len(diffs), sum(1 for _, c in diffs if c > 0)
            mb = sum(baseline) / len(baseline)
            mc = sum(candidate) / len(candidate)
            if m < 2:
                d = AcceptDecision(False, 0.0, 1.0, mb, mc, m,
                                   "insufficient_nonzero_pairs")
            elif mc < mb + self.min_improve:
                d = AcceptDecision(False, 0.0, 1.0, mb, mc, m, "no_mean_gain")
            else:
                p = exact_sign_p(n_plus, m)
                d = AcceptDecision(p < alpha, 0.0, p, mb, mc, m,
                                   "significant_gain" if p < alpha
                                   else "not_significant")
            test = "exact_sign"
        else:
            d = wilcoxon_gate(baseline, candidate, alpha=alpha,
                              min_improve=self.min_improve)
            test = "wilcoxon"

        self.budget.spend(round_idx, ptype, alpha)
        return self._record(round_idx, ptype, baseline, candidate,
                            accepted=d.accepted, p_value=d.p_value, alpha=alpha,
                            reason=d.reason, test=test)

    # ------------------------------------------------------------------ 账本
    def _record(self, round_idx, ptype, baseline, candidate, *,
                accepted, p_value, alpha, reason, test) -> dict:
        entry = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "round": round_idx, "ptype": ptype, "test": test,
            "n_pairs": len(baseline), "p_value": round(float(p_value), 6),
            "effective_alpha": round(alpha, 6), "accepted": bool(accepted),
            "reason": reason,
            "mean_baseline": sum(baseline) / len(baseline) if baseline else None,
            "mean_candidate": sum(candidate) / len(candidate) if candidate else None,
            "budget_remaining": round(self.budget.remaining, 6),
        }
        self.entries.append(entry)
        self._save()
        return entry

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"budget": self.budget.to_json(),
                                   "entries": self.entries},
                                  ensure_ascii=False, indent=2))
        tmp.replace(self.path)                     # 原子写：断电不留半个账本
