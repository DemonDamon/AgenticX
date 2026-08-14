#!/usr/bin/env python3
"""Synthesize interrupted-turn tool closers for crash resume.

Keeps provider tool-call pairing legal while telling the model whether a
dangling call was never started or was dispatched with an unknown outcome.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Sequence

NOT_STARTED_CONTENT = (
    "[中断] 该工具调用在运行时中断前尚未开始执行，没有产生任何副作用。"
    "如果这一步仍然必要，可以安全地重新调用。"
)
OUTCOME_UNKNOWN_CONTENT = (
    "[中断] 该工具调用已经发出，但运行时在拿到结果前中断，执行结果未知。"
    "禁止直接重试写入类操作；先用只读方式核验外部状态（文件是否已存在、命令是否已生效），"
    "确认未生效后再决定是否重做。"
)
KIND_NOT_STARTED = "interrupted_tool_not_started"
KIND_OUTCOME_UNKNOWN = "interrupted_tool_outcome_unknown"


def _call_name(call: Dict[str, Any]) -> str:
    function = call.get("function")
    if isinstance(function, dict):
        name = str(function.get("name", "") or "").strip()
        if name:
            return name
    name = str(call.get("name", "") or "").strip()
    return name or "unknown"


def close_interrupted_tool_calls(
    messages: Sequence[Dict[str, Any]],
    *,
    dispatched_call_ids: Iterable[str] = (),
) -> List[Dict[str, Any]]:
    """Insert synthetic tool rows for unpaired assistant tool_calls.

    Pure function: does not mutate ``messages``. Empty call ids are ignored.
    Already-closed ids (either a real tool row or a closer kind) are not
    synthesized again.
    """
    dispatched = {str(cid).strip() for cid in dispatched_call_ids if str(cid).strip()}
    rows = [msg for msg in messages if isinstance(msg, dict)]
    out: List[Dict[str, Any]] = []
    idx = 0
    total = len(rows)

    while idx < total:
        msg = rows[idx]
        role = str(msg.get("role", ""))
        tool_calls = msg.get("tool_calls") or []
        if role != "assistant" or not tool_calls:
            out.append(msg)
            idx += 1
            continue

        expected_ids: list[str] = []
        call_by_id: Dict[str, Dict[str, Any]] = {}
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if not cid:
                continue
            expected_ids.append(cid)
            call_by_id[cid] = call

        j = idx + 1
        contiguous_tool_rows: List[Dict[str, Any]] = []
        responded_ids: set[str] = set()
        while j < total:
            next_msg = rows[j]
            if str(next_msg.get("role", "")) != "tool":
                break
            contiguous_tool_rows.append(next_msg)
            cid = str(next_msg.get("tool_call_id", "")).strip()
            if cid:
                responded_ids.add(cid)
            j += 1

        out.append(msg)
        out.extend(contiguous_tool_rows)
        for cid in expected_ids:
            if cid in responded_ids:
                continue
            unknown = cid in dispatched
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": cid,
                    "name": _call_name(call_by_id[cid]),
                    "content": OUTCOME_UNKNOWN_CONTENT if unknown else NOT_STARTED_CONTENT,
                    "metadata": {
                        "kind": KIND_OUTCOME_UNKNOWN if unknown else KIND_NOT_STARTED,
                    },
                }
            )
        idx = j

    return out
