# agenticx/rl/contamination.py
"""污染率埋点（playbook §4.2-4）：训练侧聚合 harness 干预 token 占比。

数据源已具备：response_mask（trainer 的 token 掩码）+ generation_spans
（hints 注入段 / 经验回放段的 span 记录）。本模块只做训练侧聚合——
每步算一个污染率，跨步攒成序列，落 JSON 供实验表"污染率"列直接取数。

参考 RSR 教训（playbook §2.5）：源轨迹 29.6% harness 私有命令直接 SFT
会让 TB2 倒退 7.9pp——污染率是一等观测指标，不是调试日志。
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Sequence


def contamination_ratio(response_mask: Sequence[float],
                        intervention_mask: Sequence[float]) -> float:
    """干预段 token 占 response token 的比例。

    两掩码等长逐 token 对齐（由调用侧保证，长度不等直接抛——错位比率高更危险）。
    response 为 0 时返回 0.0（无训练 token，谈不上污染）。
    """
    if len(response_mask) != len(intervention_mask):
        raise ValueError(f"掩码长度不一致: {len(response_mask)} vs "
                         f"{len(intervention_mask)}")
    n_resp = sum(float(m) for m in response_mask)
    if n_resp <= 0:
        return 0.0
    n_hit = sum(float(r) * float(i)
                for r, i in zip(response_mask, intervention_mask))
    return n_hit / n_resp


class ContaminationTracker:
    """跨步聚合器：per-step 污染率 → 序列 + 报告 JSON。

    record 的粒度是「一个训练 step」：masks 可传 batch 拼接后的长向量，
    也可传多个 sample 的掩码列表（逐个求和再算总比例，等价于拼接）。
    """

    def __init__(self, *, warn_threshold: float = 0.30):
        self.warn_threshold = warn_threshold
        self.steps: list[dict] = []

    def record(self, step: int, response_masks, intervention_masks) -> float:
        """记录一步并返回该步污染率。masks 可为嵌套列表（batch 维）。"""
        resp_flat = _flatten_masks(response_masks)
        intv_flat = _flatten_masks(intervention_masks)
        ratio = contamination_ratio(resp_flat, intv_flat)
        self.steps.append({
            "step": step,
            "ratio": round(ratio, 6),
            "response_tokens": int(sum(resp_flat)),
            "intervention_tokens": int(sum(r * i for r, i in
                                            zip(resp_flat, intv_flat))),
        })
        return ratio

    @property
    def total_ratio(self) -> float:
        """全程聚合污染率（token 加权，不是各步均值）。"""
        n_resp = sum(s["response_tokens"] for s in self.steps)
        n_hit = sum(s["intervention_tokens"] for s in self.steps)
        return n_hit / n_resp if n_resp > 0 else 0.0

    def status(self) -> str:
        return "warn" if self.total_ratio > self.warn_threshold else "ok"

    def report(self) -> dict:
        return {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "total_ratio": round(self.total_ratio, 6),
            "warn_threshold": self.warn_threshold,
            "status": self.status(),
            "n_steps": len(self.steps),
            "steps": self.steps,
        }

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.report(), ensure_ascii=False, indent=2))
        return p


def _flatten_masks(masks):
    """嵌套（batch of lists / tensors）→ 一维 float 列表。"""
    out: list[float] = []

    def _walk(x):
        if hasattr(x, "detach"):                 # torch.Tensor 无依赖取数
            x = x.detach().tolist()
        if isinstance(x, (list, tuple)):
            for item in x:
                _walk(item)
        else:
            out.append(float(x))

    _walk(masks)
    return out
