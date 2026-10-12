# agenticx/learning/trajectory/replay_spans.py
"""replay_spans 派生（SP30 T7）：从 decision_lineage 派生学习相关消息区间。

对标 LongStraw（只重放参与学习的响应片段）与 AReaL-DTA（共享前缀复用）——
两个独立来源收敛到「选择性重放」。纯派生量不进存储 schema：
P1 长轨迹 RL 消费，避免全轨迹重放的显存/计算浪费。

锚定规则（消息级，token 级偏移属后续）：
- failed_tool：tool 角色消息按序与 tool_calls 位置配对，ok=False 的那条
  及其后一条 assistant 消息（修正响应）构成区间
- correction：lineage 修正事件的 ref 尾部数字（如 step-5）解析出锚点 ±1；
  解析不出则锚到最后一个 failed_tool 区间或轨迹末尾
- verification：验证事件锚到轨迹末条消息（harbor collector 的验证步
  追加在 lineage 尾部，天然对应最终态）
- 重叠区间合并；纯寒暄/顺利执行的窗口不选
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .schema import RSITrajectory

REASONS = ("correction", "failed_tool", "verification")
_REF_IDX = re.compile(r"(\d+)\s*$")


@dataclass(frozen=True)
class ReplaySpan:
    start_msg: int
    end_msg: int
    reason: str


def _merge(spans: list[ReplaySpan]) -> list[ReplaySpan]:
    if not spans:
        return []
    spans = sorted(spans, key=lambda s: (s.start_msg, s.end_msg))
    out = [spans[0]]
    for s in spans[1:]:
        last = out[-1]
        if s.start_msg <= last.end_msg + 1:      # 相邻或重叠 → 合并
            out[-1] = ReplaySpan(last.start_msg, max(last.end_msg, s.end_msg),
                                 last.reason if last.reason == s.reason
                                 else _reason_rank(last.reason, s.reason))
        else:
            out.append(s)
    return out


def _reason_rank(a: str, b: str) -> str:
    """合并区间的原因标签：correction > failed_tool > verification。"""
    order = {"correction": 0, "failed_tool": 1, "verification": 2}
    return a if order.get(a, 9) <= order.get(b, 9) else b


def derive_replay_spans(traj: RSITrajectory) -> list[ReplaySpan]:
    """纯函数：轨迹 → 学习相关消息区间列表（不修改输入）。"""
    msgs = traj.messages or []
    n = len(msgs)
    if n == 0:
        return []
    spans: list[ReplaySpan] = []

    # 1) failed_tool：tool 角色消息与 tool_calls 按位置配对
    tool_msg_idx = [i for i, m in enumerate(msgs)
                    if isinstance(m, dict) and m.get("role") == "tool"]
    calls = traj.tool_calls or []
    for pos, idx in enumerate(tool_msg_idx):
        if pos < len(calls) and calls[pos].ok is False:
            end = idx + 1 if idx + 1 < n else idx   # 含其后一条响应
            spans.append(ReplaySpan(idx, end, "failed_tool"))

    # 2) correction / verification：lineage 事件锚定
    last_failed_end = max((s.end_msg for s in spans), default=n - 1)
    for step in traj.decision_lineage or []:
        if step.kind == "correction":
            m = _REF_IDX.search(step.ref or "")
            anchor = int(m.group(1)) if m else last_failed_end
            anchor = max(0, min(anchor, n - 1))
            spans.append(ReplaySpan(max(0, anchor - 1),
                                    min(n - 1, anchor + 1), "correction"))
        elif step.kind == "verification":
            spans.append(ReplaySpan(max(0, n - 2), n - 1, "verification"))

    return _merge(spans)
