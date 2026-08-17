#!/usr/bin/env python3
"""Deterministic group-chat execution facts (read-only).

Aggregates member replies, tool rows, graph node status, and on-disk
taskspace artifacts so project-manager prompts can cite real state
instead of restating prior promises.

Author: Damon Li
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence


@dataclass
class MemberFact:
    agent_id: str
    name: str
    reply_count: int
    tool_calls: int
    last_reply_ts: float  # 0 means the member never spoke
    graph_status: str  # empty when the latest run has no node for this agent


@dataclass
class GroupExecutionFacts:
    members: list[MemberFact] = field(default_factory=list)
    artifact_paths: list[str] = field(default_factory=list)
    never_executed: list[str] = field(default_factory=list)
    has_any_execution: bool = False
    tool_call_total: int = 0


def _row_agent_id(row: Mapping[str, Any]) -> str:
    return str(row.get("agent_id") or row.get("sender_id") or "").strip()


def _row_timestamp(row: Mapping[str, Any]) -> float:
    raw = row.get("timestamp")
    if raw is None:
        raw = row.get("ts")
    try:
        return float(raw or 0)
    except (TypeError, ValueError):
        return 0.0


def _taskspace_path(item: Any) -> str:
    if isinstance(item, Mapping):
        return str(item.get("path") or "").strip()
    return str(getattr(item, "path", "") or "").strip()


def collect_artifact_paths(taskspaces: Sequence[Any] | None) -> list[str]:
    """List real files under each taskspace, excluding the memory/ subtree."""
    found: list[str] = []
    for item in taskspaces or []:
        raw = _taskspace_path(item)
        if not raw:
            continue
        root = Path(raw).expanduser()
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [name for name in dirnames if name != "memory"]
            rel = Path(dirpath).relative_to(root)
            if rel.parts and rel.parts[0] == "memory":
                continue
            for name in filenames:
                full = Path(dirpath) / name
                if full.is_file():
                    found.append(str(full))
    found.sort()
    return found


def _load_graph_status_by_agent(session_id: str) -> dict[str, str]:
    sid = str(session_id or "").strip()
    if not sid:
        return {}
    try:
        from agenticx.runtime.graph.store import get_default_store

        runs = get_default_store().list_by_session(sid)
    except Exception:
        return {}
    if not runs:
        return {}
    latest = runs[0]
    out: dict[str, str] = {}
    nodes = getattr(latest, "nodes", None) or {}
    if not isinstance(nodes, Mapping):
        return {}
    for node in nodes.values():
        aid = str(getattr(node, "agent_id", "") or "").strip()
        if not aid:
            continue
        status = getattr(node, "status", "")
        if hasattr(status, "value"):
            status = status.value
        out[aid] = str(status or "")
    return out


def build_group_execution_facts(
    *,
    chat_history: Sequence[Mapping[str, Any]] | None,
    members: Sequence[Mapping[str, str]],
    taskspaces: Sequence[Any] | None = None,
    session_id: str = "",
    graph_status_by_agent: Mapping[str, str] | None = None,
) -> GroupExecutionFacts:
    """Aggregate read-only execution facts for a group session.

    ``has_any_execution`` is True when any ``role == "tool"`` row exists or
    any non-memory taskspace file exists. Member speech alone does not count.
    """
    history = list(chat_history) if isinstance(chat_history, Sequence) and not isinstance(
        chat_history, (str, bytes)
    ) else []
    roster: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw in members or []:
        if not isinstance(raw, Mapping):
            continue
        aid = str(raw.get("id") or "").strip()
        if not aid or aid in seen:
            continue
        seen.add(aid)
        name = str(raw.get("name") or aid).strip() or aid
        roster.append((aid, name))

    status_map = (
        dict(graph_status_by_agent)
        if graph_status_by_agent is not None
        else _load_graph_status_by_agent(session_id)
    )

    tool_total = 0
    reply_counts: dict[str, int] = {aid: 0 for aid, _ in roster}
    tool_counts: dict[str, int] = {aid: 0 for aid, _ in roster}
    last_ts: dict[str, float] = {aid: 0.0 for aid, _ in roster}

    for row in history:
        if not isinstance(row, Mapping):
            continue
        role = str(row.get("role") or "").strip()
        aid = _row_agent_id(row)
        if role == "tool":
            tool_total += 1
            if aid in tool_counts:
                tool_counts[aid] += 1
            continue
        if role != "assistant" or aid not in reply_counts:
            continue
        reply_counts[aid] += 1
        ts = _row_timestamp(row)
        if ts > last_ts[aid]:
            last_ts[aid] = ts
        elif last_ts[aid] == 0.0:
            last_ts[aid] = 1.0

    artifact_paths = collect_artifact_paths(taskspaces)
    member_facts: list[MemberFact] = []
    never_executed: list[str] = []
    for aid, name in roster:
        fact = MemberFact(
            agent_id=aid,
            name=name,
            reply_count=reply_counts[aid],
            tool_calls=tool_counts[aid],
            last_reply_ts=last_ts[aid],
            graph_status=str(status_map.get(aid) or ""),
        )
        member_facts.append(fact)
        if fact.reply_count == 0 and fact.tool_calls == 0:
            never_executed.append(name)

    return GroupExecutionFacts(
        members=member_facts,
        artifact_paths=artifact_paths,
        never_executed=never_executed,
        has_any_execution=tool_total > 0 or bool(artifact_paths),
        tool_call_total=tool_total,
    )


def render_facts_block(facts: GroupExecutionFacts) -> str:
    """Deterministic Chinese fact block. Never invents completion percentages."""
    if facts.has_any_execution:
        record = (
            f"有（工具调用 {facts.tool_call_total} 次，"
            f"产出文件 {len(facts.artifact_paths)} 个）"
        )
    else:
        record = "无（工具调用 0 次，产出文件 0 个）"

    lines = [
        "[群工作台事实 · 由系统统计，非推测]",
        f"- 实际执行记录：{record}",
    ]
    if facts.never_executed:
        lines.append(
            "- 从未在本会话执行过的成员：" + "、".join(facts.never_executed)
        )
    spoken = [
        f"{item.name}（{item.reply_count} 次发言，{item.tool_calls} 次工具调用）"
        for item in facts.members
        if item.reply_count > 0
    ]
    if spoken:
        lines.append("- 已发言成员：" + "、".join(spoken))
    return "\n".join(lines)


def format_zero_exec_fallback(facts: GroupExecutionFacts) -> str:
    """Code-generated honesty line for progress queries with zero execution."""
    line = "—— 本会话暂无实际执行记录（工具调用 0 / 产出文件 0）。"
    if facts.never_executed:
        name = facts.never_executed[0]
        line += f"需要开工请点名，例如「@{name} 先搭一个能飞能撞的原型」。"
    return line
