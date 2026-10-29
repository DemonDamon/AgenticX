# agenticx/learning/rsi_index.py
"""RSI-Index 归一化增益（RSIGym 口径）。

gain = (final - initial) / (1 - initial)

对外叙事标尺：裸 pass_rate 跨任务/跨版本不可比（40%→43% 与 90%→93% 同为
+3pp 但含金量差 6 倍），归一化增益是行业已建立的口径（RSIGym 用其给六个
研究 Agent 排名）。drift/SLO 报告的消费方见 verifier_drift_report /
rsi_slo_report。

边界纪律：initial >= 1.0（无提升空间）或 < 0（无效基线）→ None，不造假。
"""
from __future__ import annotations


def rsi_index(final: float, initial: float) -> float | None:
    """归一化增益。返回 None 表示无效输入（调用方按 N/A 呈现）。"""
    if initial is None or final is None:
        return None
    if initial < 0 or initial >= 1.0:
        return None
    return (final - initial) / (1.0 - initial)
