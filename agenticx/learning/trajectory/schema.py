"""RSI 轨迹归一化模型（②采集层）。

设计原则（飞书规划 2.3 节）：
- 决策沿袭：decision_lineage 记录知识引用/工具序列/验证/修正，不是裸三元组
- 复合 reward：components 为多源信号预留（P0 仅 verifier，运营商场景扩展 user/structural/kpi）
- label=-1.0 为"未标注"哨兵：session 轨迹无验证器，进库待标注，构建器只消费已标注轨迹
- token 真值对齐（SP24，设计规格移植自 JAZ RolloutRecorder）：reward 留在本记录
  （驱动侧），token-native rollout（agenticx.rl.rollout.TokenRollout）刻意不含
  reward，两者经 rollout_id 对齐——"轨迹是事实，reward 是判断"
- 长时程 SLO 保留键（SP30 T5，全部可选；缺失=unknown 不许填 0 冒充）：
  metadata["human_interventions"] int 本轨迹人工接管次数（一次就算）
  metadata["wall_seconds"] int 端到端墙钟
  metadata["checkpoints"] int 落盘检查点数（replay_ledger 口径）
  metadata["resume_attempts"] int 断点恢复尝试次数
  metadata["resume_completed"] int 恢复后最终完成（0/1）
  指标消费方：agenticx.ops.rsi_slo.compute_slo
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
                                                   # |memory_recall|skill_select|adapter_route（SP30 路由事件）
    ref: str
    note: str = ""
    version: str = ""                              # SP30：被引用经验/技能/adapter 的版本；"unknown"=采集端拿不到
    outcome: str = ""                              # SP30：used | ignored | harmful（best-effort 阶段只填 used/空）

ROUTING_KINDS = ("memory_recall", "skill_select", "adapter_route")

# 路由事件约定（SP30 T1）：Harness 层选择记忆/技能/adapter 的动作必须在 lineage
# 留痕；ref 用 URN 风格（memory:/skill:/adapter:），version 必填到能定位的粒度，
# 拿不到填 "unknown" 不许空着——归因账本会把 unknown 单列，倒逼采集补齐埋点。


def routing_step(kind: str, ref: str, *, version: str = "unknown",
                 outcome: str = "used", note: str = "") -> DecisionStep:
    """构造一条路由事件（供采集端埋点与 collector 共用）。"""
    if kind not in ROUTING_KINDS:
        raise ValueError(f"路由事件 kind 须为 {ROUTING_KINDS} 之一, got {kind!r}")
    if not version:
        version = "unknown"
    return DecisionStep(kind=kind, ref=ref, note=note, version=version, outcome=outcome)


_REF_KEYS = ("id", "key", "skill", "alias", "adapter", "name", "query")


def classify_routing_tool(name: str, arguments: dict | None) -> DecisionStep | None:
    """best-effort：从工具调用名/参数识别路由动作。识别不出返回 None（不造假）。

    名字含 memory/recall → memory_recall；skill → skill_select；adapter → adapter_route。
    ref 从参数常见键（id/key/skill/alias/name/query）取，全无则退化为工具名；
    version 取参数 version 键，取不到为 unknown。
    """
    low = (name or "").lower()
    if "memory" in low or "recall" in low:
        kind, prefix = "memory_recall", "memory"
    elif "skill" in low:
        kind, prefix = "skill_select", "skill"
    elif "adapter" in low:
        kind, prefix = "adapter_route", "adapter"
    else:
        return None
    args = arguments if isinstance(arguments, dict) else {}
    ref_val = next((str(args[k]).strip() for k in _REF_KEYS
                    if isinstance(args.get(k), str) and str(args.get(k)).strip()), "")
    ver = args.get("version")
    version = str(ver).strip() if isinstance(ver, (str, int)) and str(ver).strip() else "unknown"
    return routing_step(kind, f"{prefix}:{ref_val or low}", version=version,
                        note=f"tool:{name}")

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
    rollout_id: str = ""                               # 对齐 TokenRollout（token 真值）；空=未采集

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
