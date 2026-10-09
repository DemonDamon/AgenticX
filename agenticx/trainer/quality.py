# agenticx/trainer/quality.py
"""轨迹质量评分：0.0~1.0 + 原因清单，阈值以下不进数据集。"""
from __future__ import annotations

from dataclasses import dataclass, field

@dataclass
class Quality:
    score: float
    reasons: list[str] = field(default_factory=list)

def score_trajectory(traj, max_reasonable_output: int = 30000) -> Quality:
    reasons, score = [], 1.0
    roles = [m.get("role") for m in traj.messages]
    if "user" not in roles:
        score -= 0.5; reasons.append("缺少用户输入")
    if roles and roles[-1] != "assistant":
        score -= 0.6; reasons.append("缺少最终回复")   # 无终答的轨迹对 SFT 无价值
    if not any(s.kind == "verification" for s in traj.decision_lineage) \
            and traj.reward.label < 0:
        score -= 0.3; reasons.append("无验证沿袭且未标注")
    out_tok = (traj.token_usage or {}).get("output_tokens", 0)
    if out_tok >= 32768:
        score -= 0.5; reasons.append(f"疑似截断（max_tokens，output={out_tok}）")
    elif out_tok > max_reasonable_output:
        score -= 0.2; reasons.append(f"输出异常长（output={out_tok}）")
    if traj.reward.label == 1.0:
        reasons.append("ok: 验证通过")
    return Quality(score=max(0.0, min(1.0, score)), reasons=reasons)
