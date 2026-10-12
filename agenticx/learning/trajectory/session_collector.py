"""AgenticX 会话目录 → RSITrajectory（②采集层，session 源）。

会话无验证器：reward=unlabeled 哨兵（-1.0），进库等待标注（运营商场景将接入
用户采纳/修正信号后回填 label）。observation 格式对齐 learning/observer.py。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from .schema import (
    DecisionStep,
    RewardRecord,
    RSITrajectory,
    ToolCallRecord,
    classify_routing_tool,
    routing_step,          # SP30 T1：主动埋点入口，re-export 供上层调用
    ROUTING_KINDS,
)

__all__ = ["collect_session", "collect_sessions", "routing_step", "ROUTING_KINDS"]

def _load_json(path: Path, default):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return default

def collect_session(session_dir: Path) -> RSITrajectory | None:
    session_dir = Path(session_dir)
    messages = _load_json(session_dir / "messages.json", None)
    if not isinstance(messages, list) or not messages:
        return None
    observations = _load_json(session_dir / "tool_call_observations.json", [])
    tool_calls = [
        ToolCallRecord(
            name=o.get("tool_name", "unknown"),
            arguments=o.get("arguments") or {},
            ok=bool(o.get("success")),
            result_summary=str(o.get("result", ""))[:500],
        )
        for o in observations if isinstance(o, dict)
    ]
    lineage = []
    for c in tool_calls:
        r = classify_routing_tool(c.name, c.arguments)   # SP30 T1：路由工具升级为路由事件
        lineage.append(r if r is not None else DecisionStep(kind="tool_call", ref=c.name))
    for o in observations:
        if isinstance(o, dict) and o.get("success") is False:
            lineage.append(DecisionStep(kind="correction", ref=o.get("tool_name", "?"),
                                        note="工具调用失败后重试/修正"))
            break
    return RSITrajectory(
        source="agenticx-session",
        task_id="",
        session_id=session_dir.name,
        model="unknown",                     # messages.json 不含模型信息，后续由 metadata 补
        status="unlabeled",
        reward=RewardRecord.unlabeled(),
        messages=[m for m in messages if isinstance(m, dict)],
        tool_calls=tool_calls,
        decision_lineage=lineage,
        metadata={"observations_available": bool(observations)},
    )

def collect_sessions(sessions_dir: Path) -> Iterator[RSITrajectory]:
    for d in sorted(Path(sessions_dir).iterdir()):
        if d.is_dir():
            t = collect_session(d)
            if t is not None:
                yield t
