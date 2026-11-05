"""Near-side UI helpers so CB↔CC CLI children match native Agent 蜂群 chat UX.

Cross-harness orchestration never goes through the builtin ``spawn_subagent``
tool. Desktop live chat synthesizes the orange 「Agent 蜂群」 card from
``spawn_subagent`` / ``delegate_to_avatar`` *tool result* rows
(``injectLiveSubAgentClusterAnchors``), and the ``调用 N 次 · N 次 spawn_subagent``
header comes from grouped tool messages. This module publishes synthetic
spawn tool progress items (for mid-turn SSE) and builds persisted tool rows
(for reload) so both CB→CC and CC→CB look like native spawn_subagent.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

PublishFn = Callable[[str, Dict[str, Any]], None]


def spawn_tool_call_id(run_id: str) -> str:
    rid = str(run_id or "").strip() or "unknown"
    return f"near-spawn-{rid}"


def build_spawn_subagent_result(
    *,
    run_id: str,
    cluster_id: str,
    name: str,
    role: str,
    task: str,
    provider: str,
    model: str = "",
) -> Dict[str, Any]:
    """JSON body Desktop ``parseSpawnClusterRef`` / spawn formatter expect."""
    return {
        "ok": True,
        "agent_id": str(run_id or "").strip(),
        "cluster_id": str(cluster_id or "").strip(),
        "name": str(name or "").strip() or str(run_id or "").strip(),
        "role": str(role or "").strip() or "worker",
        "task": str(task or "")[:2000],
        "provider": str(provider or "").strip(),
        "model": str(model or "").strip(),
    }


def publish_synthetic_spawn_tool_events(
    publish: PublishFn,
    owner_session_id: str,
    *,
    run_id: str,
    cluster_id: str,
    name: str,
    role: str,
    task: str,
    provider: str,
    model: str = "",
    tool_group_id: str = "",
) -> None:
    """Enqueue tool_call + tool_result shaped progress for one Near CLI child."""
    sid = str(owner_session_id or "").strip()
    rid = str(run_id or "").strip()
    cid = str(cluster_id or "").strip()
    if not sid or not rid or not cid:
        return
    tid = spawn_tool_call_id(rid)
    result = build_spawn_subagent_result(
        run_id=rid,
        cluster_id=cid,
        name=name,
        role=role,
        task=task,
        provider=provider,
        model=model,
    )
    args = {
        "name": result["name"],
        "role": result["role"],
        "task": str(task or "")[:500],
        "provider": result["provider"],
        "model": result["model"],
        "cluster_id": cid,
    }
    gid = str(tool_group_id or "").strip() or cid
    publish(
        sid,
        {
            "kind": "tool_start",
            "name": "spawn_subagent",
            "tool_call_id": tid,
            "tool_group_id": gid,
            "arguments": args,
        },
    )
    publish(
        sid,
        {
            "kind": "tool_end",
            "name": "spawn_subagent",
            "tool_call_id": tid,
            "tool_group_id": gid,
            "result": result,
            "is_error": False,
        },
    )


def build_persisted_spawn_tool_row(
    *,
    run_id: str,
    cluster_id: str,
    name: str,
    role: str,
    task: str,
    provider: str,
    model: str = "",
    tool_group_id: str = "",
    timestamp: Optional[float] = None,
) -> Dict[str, Any]:
    """One chat_history tool row that reloads as a spawn_subagent ToolCallCard."""
    rid = str(run_id or "").strip()
    cid = str(cluster_id or "").strip()
    result = build_spawn_subagent_result(
        run_id=rid,
        cluster_id=cid,
        name=name,
        role=role,
        task=task,
        provider=provider,
        model=model,
    )
    gid = str(tool_group_id or "").strip() or cid
    row: Dict[str, Any] = {
        "role": "tool",
        "content": json.dumps(result, ensure_ascii=False),
        "tool_call_id": spawn_tool_call_id(rid),
        "tool_name": "spawn_subagent",
        "tool_status": "done",
        "tool_group_id": gid,
        "tool_args": {
            "name": result["name"],
            "role": result["role"],
            "task": str(task or "")[:500],
            "provider": result["provider"],
            "model": result["model"],
            "cluster_id": cid,
        },
        "tool_result_preview": f"🚀 已启动子智能体: {result['name']}",
        "metadata": {"near_synthetic_spawn": True, "cluster_id": cid},
    }
    if timestamp is not None:
        try:
            row["timestamp"] = float(timestamp)
        except (TypeError, ValueError):
            pass
    return row


def collect_spawn_tool_rows_from_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build persisted spawn tool rows from a near_*_subagents turn payload."""
    if not isinstance(payload, dict):
        return []
    cluster_id = str(payload.get("cluster_id") or "").strip()
    if not cluster_id:
        return []
    batch_source_id = str(payload.get("batch_source_id") or "").strip()
    created_at = payload.get("cluster_created_at")
    try:
        ts = float(created_at) if created_at is not None else None
    except (TypeError, ValueError):
        ts = None
    rows: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for item in list(payload.get("results") or []):
        if not isinstance(item, dict):
            continue
        run_id = str(item.get("run_id") or "").strip()
        if not run_id or run_id in seen:
            continue
        seen.add(run_id)
        rows.append(
            build_persisted_spawn_tool_row(
                run_id=run_id,
                cluster_id=cluster_id,
                name=str(item.get("name") or run_id),
                role=str(item.get("role") or "CLI subagent"),
                task=str(item.get("task") or item.get("result_text") or "")[:500],
                provider=str(item.get("provider") or ""),
                model=str(item.get("model") or ""),
                tool_group_id=batch_source_id or cluster_id,
                timestamp=ts,
            )
        )
    if rows:
        return rows
    # Fallback: run_ids only (no per-result metadata).
    for run_id_raw in list(payload.get("run_ids") or []):
        run_id = str(run_id_raw or "").strip()
        if not run_id or run_id in seen:
            continue
        seen.add(run_id)
        rows.append(
            build_persisted_spawn_tool_row(
                run_id=run_id,
                cluster_id=cluster_id,
                name=run_id,
                role="CLI subagent",
                task="",
                provider="",
                model="",
                tool_group_id=batch_source_id or cluster_id,
                timestamp=ts,
            )
        )
    return rows


__all__ = [
    "build_persisted_spawn_tool_row",
    "build_spawn_subagent_result",
    "collect_spawn_tool_rows_from_payload",
    "publish_synthetic_spawn_tool_events",
    "spawn_tool_call_id",
]
