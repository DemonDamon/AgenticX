"""RSI 轨迹归一化模型（②采集层）。

设计原则（飞书规划 2.3 节）：
- 决策沿袭：decision_lineage 记录知识引用/工具序列/验证/修正，不是裸三元组
- 复合 reward：components 为多源信号预留（P0 仅 verifier，运营商场景扩展 user/structural/kpi）
- label=-1.0 为"未标注"哨兵：session 轨迹无验证器，进库待标注，构建器只消费已标注轨迹
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass
class RewardRecord:
    label: float                                   # 0.0~1.0；-1.0=未标注
    source: str = "verifier"                       # verifier | user | composite
    components: dict[str, float] = field(default_factory=dict)

    @classmethod
    def unlabeled(cls) -> "RewardRecord":
        return cls(label=-1.0, source="user")

@dataclass
class ToolCallRecord:
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    ok: bool | None = None
    result_summary: str = ""                        # 截断至 500 字符

@dataclass
class DecisionStep:
    kind: str                                      # knowledge_ref|tool_call|verification|correction
    ref: str
    note: str = ""

@dataclass
class RSITrajectory:
    source: str                                    # harbor-tb40 | agenticx-session
    task_id: str
    session_id: str
    model: str
    status: str                                    # pass | fail | partial | unlabeled
    reward: RewardRecord
    messages: list[dict[str, Any]]
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    decision_lineage: list[DecisionStep] = field(default_factory=list)
    token_usage: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def trajectory_id(self) -> str:
        basis = f"{self.source}|{self.session_id}|{self.task_id}|{self.model}"
        return hashlib.sha256(basis.encode()).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["trajectory_id"] = self.trajectory_id
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "RSITrajectory":
        d = {k: v for k, v in d.items() if k != "trajectory_id"}
        d["reward"] = RewardRecord(**d["reward"])
        d["tool_calls"] = [ToolCallRecord(**t) for t in d.get("tool_calls", [])]
        d["decision_lineage"] = [DecisionStep(**s) for s in d.get("decision_lineage", [])]
        return cls(**d)
