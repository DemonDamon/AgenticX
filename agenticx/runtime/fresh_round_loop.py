#!/usr/bin/env python3
"""Context-reset loop: one fresh sub-agent per round with a bounded handoff.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

_log = logging.getLogger(__name__)

HANDOFF_MAX_CHARS = 8000
MAX_ROUNDS_HARD = 32
DEFAULT_MAX_ROUNDS = 16
DEFAULT_ROUND_TIMEOUT_SECONDS = 1200
HANDOFF_STATUSES = {"continue", "complete", "blocked"}

_FRESH_ROUND_SYSTEM_PROMPT = (
    "你是上下文复位循环中的一轮执行者。不要假设自己见过父会话的对话历史。\n"
    "工作目录是唯一事实来源。完成或推进目标后，必须在回复末尾输出一个 JSON 块，字段固定为：\n"
    '{"status":"continue|complete|blocked","summary":"...","evidence":["..."],'
    '"next_steps":["..."],"blocker":"..."}\n'
    "status=complete 表示目标已达成；continue 表示还需下一轮；blocked 表示无法继续。\n"
    "JSON 必须完整可解析，总长度不得超过 8000 字符，禁止静默截断。"
)


def clamp_max_rounds(raw: Any) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = DEFAULT_MAX_ROUNDS
    if value <= 0:
        value = DEFAULT_MAX_ROUNDS
    return min(value, MAX_ROUNDS_HARD)


def extract_handoff_report(text: str) -> Optional[Dict[str, Any]]:
    blob = str(text or "")
    for match in re.finditer(r"```(?:json)?\s*(\{.*?\})\s*```", blob, re.DOTALL):
        parsed = _try_parse_handoff(match.group(1))
        if parsed is not None:
            return parsed
    decoder = json.JSONDecoder()
    idx = 0
    while True:
        start = blob.find("{", idx)
        if start < 0:
            return None
        try:
            obj, _end = decoder.raw_decode(blob, start)
        except json.JSONDecodeError:
            idx = start + 1
            continue
        parsed = _as_handoff(obj)
        if parsed is not None:
            return parsed
        idx = start + 1


def _try_parse_handoff(raw: str) -> Optional[Dict[str, Any]]:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return _as_handoff(obj)


def _as_handoff(obj: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(obj, dict):
        return None
    status = str(obj.get("status", "") or "").strip().lower()
    if status not in HANDOFF_STATUSES:
        return None
    evidence = obj.get("evidence")
    next_steps = obj.get("next_steps")
    return {
        "status": status,
        "summary": str(obj.get("summary", "") or ""),
        "evidence": list(evidence) if isinstance(evidence, list) else [],
        "next_steps": list(next_steps) if isinstance(next_steps, list) else [],
        "blocker": str(obj.get("blocker", "") or ""),
    }


def serialize_handoff(report: Dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False)


def _build_round_task(
    *,
    objective: str,
    workspace_dir: str,
    previous_report: Optional[Dict[str, Any]],
    retry_compact: bool,
) -> str:
    parts = [
        f"目标：{objective}",
        f"工作目录：{workspace_dir}",
        "不要使用或假设任何父会话对话原文。",
    ]
    if previous_report is not None:
        parts.append("上一轮交接报告：")
        parts.append(serialize_handoff(previous_report))
    if retry_compact:
        parts.append(
            "上一份交接报告过长或无法解析。请只输出精简 JSON 交接报告，不要重复大段正文。"
        )
    return "\n".join(parts)


def _read_child_final_text(team_manager: Any, agent_id: str, spawn_res: Dict[str, Any]) -> str:
    agents = getattr(team_manager, "_agents", {}) or {}
    archived = getattr(team_manager, "_archived_agents", {}) or {}
    ctx = agents.get(agent_id) or archived.get(agent_id)
    if ctx is not None:
        return str(getattr(ctx, "final_text", "") or "")
    return str(spawn_res.get("final_text", "") or "")


def _persist_handoff(session: Any, *, round_idx: int, report: Dict[str, Any]) -> None:
    if session is None:
        return
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        try:
            session.scratchpad = {}
            scratch = session.scratchpad
        except Exception:
            scratch = None
    if isinstance(scratch, dict):
        scratch[f"fresh_round_loop:round:{round_idx}"] = report
    manager = getattr(session, "_session_manager", None)
    session_id = str(getattr(session, "session_id", "") or "").strip()
    if manager is None or not session_id:
        return
    persist = getattr(manager, "incremental_persist", None)
    if not callable(persist):
        return
    try:
        persist(session_id)
    except Exception:
        _log.exception("fresh_round_loop handoff persist failed session=%s", session_id)


async def run_fresh_round_loop(
    *,
    team_manager: Any,
    session: Any,
    objective: str,
    workspace_dir: str,
    max_rounds: Any = None,
    round_timeout_seconds: Any = None,
) -> Dict[str, Any]:
    objective_text = str(objective or "").strip()
    workspace = str(workspace_dir or "").strip()
    if not objective_text or not workspace:
        return {
            "ok": False,
            "error": "missing_fields",
            "message": "objective and workspace_dir are required",
        }
    rounds_cap = clamp_max_rounds(max_rounds if max_rounds is not None else DEFAULT_MAX_ROUNDS)
    try:
        timeout = int(round_timeout_seconds)
    except (TypeError, ValueError):
        timeout = DEFAULT_ROUND_TIMEOUT_SECONDS
    if timeout <= 0:
        timeout = DEFAULT_ROUND_TIMEOUT_SECONDS

    previous: Optional[Dict[str, Any]] = None
    last_report: Optional[Dict[str, Any]] = None
    rounds_started = 0

    for round_idx in range(1, rounds_cap + 1):
        retry_compact = False
        for _attempt in (1, 2):
            task = _build_round_task(
                objective=objective_text,
                workspace_dir=workspace,
                previous_report=previous,
                retry_compact=retry_compact,
            )
            spawn_res = await team_manager.spawn_subagent(
                name=f"fresh-round-{round_idx}",
                role="fresh_round_worker",
                task=task,
                mode="run",
                cleanup="keep",
                run_timeout_seconds=timeout,
                workspace_dir=workspace,
                system_prompt=_FRESH_ROUND_SYSTEM_PROMPT,
                parent_agent_id="meta",
                inherit_parent_context=False,
            )
            if not isinstance(spawn_res, dict) or not spawn_res.get("ok"):
                return {
                    "ok": False,
                    "error": (spawn_res or {}).get("error") if isinstance(spawn_res, dict) else "spawn_failed",
                    "message": (
                        (spawn_res or {}).get("message")
                        if isinstance(spawn_res, dict)
                        else "spawn_subagent failed"
                    ),
                    "rounds_started": rounds_started,
                    "workspace_dir": workspace,
                }
            if not retry_compact:
                rounds_started += 1
            agent_id = str(spawn_res.get("agent_id", "") or "").strip()
            tasks = getattr(team_manager, "_tasks", {}) or {}
            sub_task = tasks.get(agent_id)
            if sub_task is not None:
                await sub_task
            final_text = _read_child_final_text(team_manager, agent_id, spawn_res)
            report = extract_handoff_report(final_text)
            if report is None:
                retry_compact = True
                continue
            encoded = serialize_handoff(report)
            if len(encoded) > HANDOFF_MAX_CHARS:
                retry_compact = True
                last_report = report
                continue
            last_report = report
            _persist_handoff(session, round_idx=round_idx, report=report)
            if report["status"] == "complete":
                return {
                    "ok": True,
                    "status": "complete",
                    "rounds_started": rounds_started,
                    "report": report,
                    "workspace_dir": workspace,
                }
            if report["status"] == "blocked":
                return {
                    "ok": True,
                    "status": "blocked",
                    "rounds_started": rounds_started,
                    "report": report,
                    "workspace_dir": workspace,
                }
            previous = report
            break
        else:
            return {
                "ok": True,
                "status": "blocked",
                "rounds_started": rounds_started,
                "report": last_report
                or {
                    "status": "blocked",
                    "summary": "handoff missing or too long after one retry",
                    "evidence": [],
                    "next_steps": [],
                    "blocker": "handoff_invalid",
                },
                "workspace_dir": workspace,
            }

    return {
        "ok": True,
        "status": "budget_limited",
        "rounds_started": rounds_started,
        "report": last_report
        or {
            "status": "continue",
            "summary": "reached max_rounds",
            "evidence": [],
            "next_steps": [],
            "blocker": "",
        },
        "workspace_dir": workspace,
    }
