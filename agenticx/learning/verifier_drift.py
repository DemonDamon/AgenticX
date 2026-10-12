# agenticx/learning/verifier_drift.py
"""验证器漂移监控（SP30 T3）——只读、只报警，不自动改奖励。

设计纪律（MASTER-PLAN P0.6）：监控结论进报告，是否修验证器由人决策——
防止用一个失真的判别器去自动替换另一个。四个指标全部在报告里写清样本量，
样本不足标 N/A 不许编数字。

对标信号：
- MiniMax MaxProof：训练期高分但独立判别器低分的误报率 2.9%→8.0%，输出
  变长 + 模板化 = 奖励劫持典型特征
- 华泰研报：验证器决定 RSI 上限，验证误差在多轮迭代中累积
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .trajectory.schema import RSITrajectory


def templating_ratio(text: str, ngram: int = 8) -> float:
    """最终回复 n-gram 重复率：重复 n-gram 数 / 总 n-gram 数。空文本返回 0。"""
    text = (text or "").strip()
    if len(text) < ngram * 2:
        return 0.0
    grams = [text[i:i + ngram] for i in range(len(text) - ngram + 1)]
    if not grams:
        return 0.0
    seen, dup = set(), 0
    for g in grams:
        if g in seen:
            dup += 1
        seen.add(g)
    return dup / len(grams)


def _percentile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(int(q * (len(sorted_vals) - 1)), len(sorted_vals) - 1)
    return sorted_vals[idx]


@dataclass
class DriftConfig:
    length_p50_baseline: float = 0.0        # 基线快照注入；0=未设
    length_p90_baseline: float = 0.0
    length_ratio_alert: float = 1.5
    templating_ngram: int = 8
    templating_ratio_alert: float = 0.25
    pass_rate_baseline: float | None = None
    pass_rate_alert: float = 0.2
    dual_judge_alert: float = 0.08          # 误报率 >8% 报警（MaxProof 教训阈值）
    min_sample: int = 10


@dataclass
class DriftReport:
    sample_count: int
    pass_rate: float | None = None
    length_p50: float = 0.0
    length_p90: float = 0.0
    length_p50_ratio: float | None = None
    length_p90_ratio: float | None = None
    templating: float | None = None
    dual_judge_gap: float | None = None     # None=未接入双判别
    alerts: list[str] = field(default_factory=list)
    generated_at: str = ""
    metrics: dict[str, Any] = field(default_factory=dict)


def drift_report(trajs: list[RSITrajectory], cfg: DriftConfig) -> DriftReport:
    """对一批已标注轨迹计算四指标。绝不修改输入轨迹（调用方可依赖此不变量）。"""
    labeled = [t for t in trajs if t.reward.label >= 0]
    r = DriftReport(sample_count=len(labeled),
                    generated_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    if not labeled:
        r.alerts.append("[N/A] 无已标注轨迹，全部指标不可用")
        return r
    underpowered = len(labeled) < cfg.min_sample

    # 1) 通过率
    labels = [t.reward.label for t in labeled]
    r.pass_rate = sum(1.0 if x >= 1.0 else 0.0 for x in labels) / len(labels)
    if cfg.pass_rate_baseline is not None:
        delta = abs(r.pass_rate - cfg.pass_rate_baseline)
        if delta > cfg.pass_rate_alert:
            r.alerts.append(
                f"[通过率异动] {r.pass_rate:.3f} vs 基线 {cfg.pass_rate_baseline:.3f}"
                f"（|Δ|={delta:.3f} > {cfg.pass_rate_alert}）")
    if underpowered:
        r.alerts.append(f"[样本不足] n={len(labeled)} < {cfg.min_sample}，"
                        f"以下指标仅供趋势参考")

    # 2) 长度漂移
    outs = sorted(float((t.token_usage or {}).get("output_tokens", 0))
                  for t in labeled)
    r.length_p50 = _percentile(outs, 0.5)
    r.length_p90 = _percentile(outs, 0.9)
    if cfg.length_p50_baseline > 0:
        r.length_p50_ratio = r.length_p50 / cfg.length_p50_baseline
    if cfg.length_p90_baseline > 0:
        r.length_p90_ratio = r.length_p90 / cfg.length_p90_baseline
        if r.length_p90_ratio > cfg.length_ratio_alert:
            r.alerts.append(
                f"[长度漂移] p90 {r.length_p90:.0f} / 基线 "
                f"{cfg.length_p90_baseline:.0f} = {r.length_p90_ratio:.2f}x"
                f"（>{cfg.length_ratio_alert}x，疑似奖励劫持）")

    # 3) 模板化（最终 assistant 回复）
    finals = []
    for t in labeled:
        for m in reversed(t.messages):
            if isinstance(m, dict) and m.get("role") == "assistant":
                finals.append(str(m.get("content") or ""))
                break
    if finals:
        r.templating = (sum(templating_ratio(f, cfg.templating_ngram)
                            for f in finals) / len(finals))
        if r.templating > cfg.templating_ratio_alert:
            r.alerts.append(
                f"[模板化] 平均 {cfg.templating_ngram}-gram 重复率 "
                f"{r.templating:.3f} > {cfg.templating_ratio_alert}")

    # 4) 双判别 gap（误报代理）：label==1 且 independent_judge<0.5
    judged = [t for t in labeled
              if "independent_judge" in (t.reward.components or {})]
    if judged:
        false_pos = sum(
            1 for t in judged
            if t.reward.label >= 1.0
            and float(t.reward.components.get("independent_judge", 1.0)) < 0.5)
        r.dual_judge_gap = false_pos / len(judged)
        if r.dual_judge_gap > cfg.dual_judge_alert:
            r.alerts.append(
                f"[双判别gap] verifier 通过但独立判别低分占比 "
                f"{r.dual_judge_gap:.3f} > {cfg.dual_judge_alert}"
                f"（n={len(judged)}，MaxProof 教训阈值）")

    r.metrics = {
        "pass_rate": r.pass_rate, "length_p50": r.length_p50,
        "length_p90": r.length_p90, "length_p90_ratio": r.length_p90_ratio,
        "templating": r.templating, "dual_judge_gap": r.dual_judge_gap,
        "n_judged": len(judged), "underpowered": underpowered,
    }
    return r
