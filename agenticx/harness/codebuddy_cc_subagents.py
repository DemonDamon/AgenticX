"""Near-orchestrated Claude Code CLI subagents from a CodeBuddy session.

When the user asks CodeBuddy to use Claude Code / CC as subagents, CodeBuddy's
own ``Agent`` tool can only spawn CodeBuddy teammates. Near intercepts that
intent and runs real ``claude`` CLI headless sessions in parallel via the
existing Claude Code harness adapter, then returns the combined result on the
parent CodeBuddy turn.
"""

from __future__ import annotations

import logging
import os
import re
import signal
import threading
import time
import uuid
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

from agenticx.harness.types import TURN_STATUS_ERROR, TURN_STATUS_SUCCESS, TurnRequest, TurnResult
from agenticx.wb_bridge.codebuddy_agent_await import user_asked_for_claude_code_subagents

_log = logging.getLogger(__name__)

# Live Claude Code CLI children for WorkPanel 「中断」. Keyed by run_id.
_ACTIVE_CC_RUNS: Dict[str, Dict[str, Any]] = {}
_ACTIVE_CC_LOCK = threading.RLock()

# Mid-turn progress for parent Near SSE (studio session id → queue).
# The CB→CC intercept blocks adapter.turn(); without this bus the desktop only
# sees harness_progress heartbeats and then one final dump.
_CC_PROGRESS: Dict[str, Deque[Dict[str, Any]]] = defaultdict(deque)
_CC_PROGRESS_LOCK = threading.RLock()
_CC_PROGRESS_MAX = 400


def publish_cc_orchestration_progress(
    owner_session_id: str,
    item: Dict[str, Any],
) -> None:
    """Enqueue one mid-turn SSE-shaped progress item for a studio session."""
    sid = str(owner_session_id or "").strip()
    if not sid or not isinstance(item, dict):
        return
    row = dict(item)
    with _CC_PROGRESS_LOCK:
        q = _CC_PROGRESS[sid]
        q.append(row)
        while len(q) > _CC_PROGRESS_MAX:
            q.popleft()


def drain_cc_orchestration_progress(owner_session_id: str) -> List[Dict[str, Any]]:
    """Pop all queued CB→CC progress items for the Near studio session."""
    sid = str(owner_session_id or "").strip()
    if not sid:
        return []
    with _CC_PROGRESS_LOCK:
        q = _CC_PROGRESS.get(sid)
        if not q:
            return []
        items = list(q)
        q.clear()
        return items


def clear_cc_orchestration_progress(owner_session_id: str) -> None:
    sid = str(owner_session_id or "").strip()
    if not sid:
        return
    with _CC_PROGRESS_LOCK:
        _CC_PROGRESS.pop(sid, None)

_TWO_REPORTS_RE = re.compile(
    r"(?:两份|两个).{0,40}?(?:关于|就)?(?P<body>.+?)(?:的)?(?:推演|预测|分析|报告)",
    re.IGNORECASE | re.DOTALL,
)
_SPLIT_RE = re.compile(r"[和与、,/]+")
_N_SUBAGENTS_RE = re.compile(
    r"(?:起|用|派)?\s*(?P<n>[两二三四五六七八九十2-9]|\d+)\s*(?:个)?\s*"
    r"(?:claude\s*code|claude-code|cc)?\s*(?:sub[\s-]?agents?|子代理|队友)",
    re.IGNORECASE,
)

_CN_NUM = {
    "两": 2,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


@dataclass(frozen=True)
class CcSubagentTask:
    name: str
    prompt: str
    output_path: str


def _parse_n(text: str) -> int:
    m = _N_SUBAGENTS_RE.search(text or "")
    if not m:
        if re.search(r"两份|两个", text or ""):
            return 2
        return 1
    raw = m.group("n")
    if raw.isdigit():
        return max(1, min(4, int(raw)))
    return max(1, min(4, _CN_NUM.get(raw, 1)))


def _topics_from_two_reports(text: str) -> List[str]:
    m = _TWO_REPORTS_RE.search(text or "")
    if not m:
        return []
    body = (m.group("body") or "").strip()
    parts = [p.strip() for p in _SPLIT_RE.split(body) if p.strip()]
    cleaned: List[str] = []
    for p in parts:
        p = re.sub(r"^(后续的|关于|就)", "", p).strip()
        if p and p not in cleaned:
            cleaned.append(p)
    return cleaned[:4]


def plan_claude_code_subagent_tasks(user_text: str, *, cwd: str) -> List[CcSubagentTask]:
    """Build 1–4 Claude Code CLI subagent tasks from the user ask."""
    text = (user_text or "").strip()
    n = _parse_n(text)
    topics = _topics_from_two_reports(text)
    if len(topics) >= 2:
        n = max(n, len(topics))
    elif n < 2 and user_asked_for_claude_code_subagents(text):
        if re.search(r"sub[\s-]?agents?|子代理|两份|两个", text, re.I):
            n = max(n, 2)

    base = Path(cwd or ".").expanduser().resolve()
    tasks: List[CcSubagentTask] = []
    if topics:
        for i, topic in enumerate(topics[:n], start=1):
            out = base / f"report_cc_subagent_{i}.md"
            tasks.append(
                CcSubagentTask(
                    name=f"claude-code-{i}-{topic[:24]}",
                    output_path=str(out),
                    prompt=(
                        "你是由 Near 跨引擎派发的 Claude Code CLI subagent（真实 claude CLI，"
                        "不是 CodeBuddy Agent 队友）。\n"
                        f"工作目录：{base}\n"
                        f"任务主题：{topic}\n"
                        f"请围绕用户原话完成该主题的推演/分析报告，保存为：{out}\n"
                        "用户原话：\n"
                        f"{text}\n\n"
                        "要求：写出完整 markdown 报告到上述路径；回复里只给 ≤400 字摘要 + 文件路径。"
                        "使用中文。"
                    ),
                )
            )
        return tasks

    for i in range(1, n + 1):
        out = base / f"report_cc_subagent_{i}.md"
        focus = (
            f"你是第 {i}/{n} 个并行 subagent；请与其它 subagent 分工，避免重复整份拷贝。"
            if n > 1
            else "你是唯一的 Claude Code CLI subagent。"
        )
        tasks.append(
            CcSubagentTask(
                name=f"claude-code-{i}",
                output_path=str(out),
                prompt=(
                    "你是由 Near 跨引擎派发的 Claude Code CLI subagent（真实 claude CLI，"
                    "不是 CodeBuddy Agent 队友）。\n"
                    f"工作目录：{base}\n"
                    f"{focus}\n"
                    f"请完成用户任务，完整产物写入：{out}\n"
                    "用户原话：\n"
                    f"{text}\n\n"
                    "要求：写出完整 markdown 到上述路径；回复里只给 ≤400 字摘要 + 文件路径。"
                    "使用中文。"
                ),
            )
        )
    return tasks


def claude_code_cli_available() -> bool:
    from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter

    return bool(ClaudeCodeAdapter().available())



def _track_cc_run(
    run_id: str,
    *,
    owner_session_id: str,
    claude_session_id: str = "",
    pid: Optional[int] = None,
) -> None:
    rid = str(run_id or "").strip()
    if not rid:
        return
    with _ACTIVE_CC_LOCK:
        row = dict(_ACTIVE_CC_RUNS.get(rid) or {})
        row.update(
            {
                "owner_session_id": str(owner_session_id or "").strip(),
                "claude_session_id": str(claude_session_id or "").strip(),
                "pid": int(pid) if pid else row.get("pid"),
                "cancel_requested": bool(row.get("cancel_requested")),
            }
        )
        _ACTIVE_CC_RUNS[rid] = row


def _untrack_cc_run(run_id: str) -> None:
    rid = str(run_id or "").strip()
    if not rid:
        return
    with _ACTIVE_CC_LOCK:
        _ACTIVE_CC_RUNS.pop(rid, None)


def _mark_cc_run_cancel_requested(run_id: str) -> Optional[Dict[str, Any]]:
    rid = str(run_id or "").strip()
    if not rid:
        return None
    with _ACTIVE_CC_LOCK:
        row = _ACTIVE_CC_RUNS.get(rid)
        if row is None:
            return None
        row = dict(row)
        row["cancel_requested"] = True
        _ACTIVE_CC_RUNS[rid] = row
        return row


def _cc_run_cancel_requested(run_id: str) -> bool:
    rid = str(run_id or "").strip()
    if not rid:
        return False
    with _ACTIVE_CC_LOCK:
        row = _ACTIVE_CC_RUNS.get(rid) or {}
        return bool(row.get("cancel_requested"))


def _patch_run_process_refs(
    *,
    owner_session_id: str,
    run_id: str,
    claude_session_id: str = "",
    pid: Optional[int] = None,
) -> None:
    """Persist claude session/pid onto the WorkPanel run record for interrupt."""
    if not owner_session_id or not run_id:
        return
    refs: Dict[str, Any] = {}
    if claude_session_id:
        refs["claude_session_id"] = claude_session_id
    if pid:
        refs["pid"] = int(pid)
        refs["process_id"] = int(pid)
    if not refs:
        return
    try:
        from agenticx.runtime.subagent_runs import SubAgentRunStore

        SubAgentRunStore(owner_session_id).merge_detail_refs(run_id, refs)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[cc_subagents] patch process refs failed for %s: %s", run_id, exc)


def _stop_claude_session(claude_session_id: str) -> bool:
    sid = str(claude_session_id or "").strip()
    if not sid:
        return False
    try:
        from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter

        return bool(ClaudeCodeAdapter().stop(sid))
    except Exception as exc:  # noqa: BLE001
        _log.warning("[cc_subagents] stop claude session %s failed: %s", sid, exc)
        return False


def _kill_pid(pid: Optional[int]) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        return False
    try:
        os.kill(int(pid), 0)
    except (ProcessLookupError, PermissionError, OSError):
        return True
    try:
        os.kill(int(pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass
    return True


def cancel_claude_code_subagent_run(
    *,
    owner_session_id: str,
    run_id: str,
) -> Dict[str, Any]:
    """WorkPanel 「中断」 for Near-orchestrated Claude Code CLI children.

    Native ``AgentTeamManager.cancel_subagent`` only knows ``sa-*`` teammates.
    CC CLI runs live in ``SubAgentRunStore`` + an in-process registry; without
    this path the red 中断 button is a no-op.
    """
    sid = str(owner_session_id or "").strip()
    rid = str(run_id or "").strip()
    if not sid or not rid:
        return {
            "ok": False,
            "error": "missing_ids",
            "message": "session_id and agent_id are required",
        }

    tracked = _mark_cc_run_cancel_requested(rid)
    claude_sid = str((tracked or {}).get("claude_session_id") or "").strip()
    pid = (tracked or {}).get("pid")

    store_record = None
    try:
        from agenticx.runtime.subagent_runs import SubAgentRunStore

        store = SubAgentRunStore(sid)
        store_record = store.get_run(rid)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[cc_subagents] cancel store lookup failed for %s: %s", rid, exc)
        store = None  # type: ignore[assignment]

    if store_record is None and tracked is None:
        # Allow cancel by run id even when owner mismatch: scan is too heavy;
        # require owner_session_id match for store rows.
        return {
            "ok": False,
            "error": "not_found",
            "message": f"未找到 Claude Code CLI subagent: {rid}",
        }

    if store_record is not None:
        refs = dict(store_record.detail_refs or {})
        if not claude_sid:
            claude_sid = str(refs.get("claude_session_id") or "").strip()
        if not pid:
            raw_pid = refs.get("pid") or refs.get("process_id")
            try:
                pid = int(raw_pid) if raw_pid is not None else None
            except (TypeError, ValueError):
                pid = None
        kind = str(store_record.kind or "").strip()
        if kind and kind not in {"claude-code", "cc", "claude_code"} and not rid.startswith(
            "cc-subagent-"
        ):
            return {
                "ok": False,
                "error": "not_cc_run",
                "message": f"run {rid} is not a Claude Code CLI subagent",
            }

    stopped = False
    if claude_sid:
        stopped = _stop_claude_session(claude_sid) or stopped
    if pid:
        stopped = _kill_pid(pid) or stopped

    status = "cancelled"
    if store is not None and store_record is not None:
        try:
            store.update_status(
                rid,
                status=status,
                error_text="用户中断",
                completed_at=time.time(),
            )
            store.append_activity(
                rid,
                event_type="subagent_cancelled",
                title="Claude Code CLI subagent cancelled",
                detail=f"stopped={stopped} claude_session_id={claude_sid or '-'} pid={pid or '-'}",
            )
        except Exception as exc:  # noqa: BLE001
            _log.warning("[cc_subagents] cancel store update failed for %s: %s", rid, exc)

    return {
        "ok": True,
        "agent_id": rid,
        "run_id": rid,
        "status": status,
        "stopped": bool(stopped),
        "kind": "claude-code",
    }


def _register_cc_run_open(
    *,
    owner_session_id: str,
    run_id: str,
    task: CcSubagentTask,
    model: Optional[str],
    batch_source_id: str,
    cluster_title: str,
) -> Dict[str, Any]:
    """Register one Claude Code CLI child into the parent WorkPanel Spawns store.

    Returns ``{cluster_id, created_at}`` when registration succeeds (empty dict
    otherwise). Owner must be the Near studio session id, not the CodeBuddy
    harness surface session id.
    """
    if not owner_session_id:
        return {}
    try:
        from agenticx.runtime.subagent_runs import SubAgentRunStore

        store = SubAgentRunStore(owner_session_id)
        record = store.open_run(
            run_id=run_id,
            kind="claude-code",
            name=task.name,
            role="Claude Code CLI subagent",
            task=task.prompt[:2000],
            status="running",
            provider="claude-code",
            model=str(model or "").strip(),
            source_tool_call_id=batch_source_id,
            title=cluster_title,
            started_at=time.time(),
            detail_refs={
                "child_harness": "claude-code",
                "orchestrated_by": "near",
                "output_path": task.output_path,
            },
        )
        store.append_activity(
            run_id,
            event_type="subagent_started",
            title="Claude Code CLI subagent started",
            detail=f"harness=claude-code output={task.output_path}",
        )
        if record is None:
            return {}
        cluster_id = str(getattr(record, "cluster_id", "") or "").strip()
        created_at = float(getattr(record, "created_at", 0.0) or 0.0)
        publish_cc_orchestration_progress(
            owner_session_id,
            {
                "kind": "subagent_started",
                "agent_id": run_id,
                "name": task.name,
                "role": "Claude Code CLI subagent",
                "task": task.prompt[:500],
                "status": "running",
                "provider": "claude-code",
                "model": str(model or "").strip(),
                "cluster_id": cluster_id,
                "cluster_title": cluster_title,
            },
        )
        publish_cc_orchestration_progress(
            owner_session_id,
            {
                "kind": "text",
                "agent_id": "meta",
                "text": f"- **{task.name}**：已启动（Claude Code CLI）\n",
            },
        )
        return {
            "cluster_id": cluster_id,
            "created_at": created_at,
        }
    except Exception as exc:  # noqa: BLE001
        _log.warning("[cc_subagents] open_run failed for %s: %s", run_id, exc)
        return {}


def _register_cc_run_close(
    *,
    owner_session_id: str,
    run_id: str,
    outcome: Dict[str, Any],
) -> None:
    """Finalize one Claude Code CLI child run for WorkPanel Spawns/clusters."""
    if not owner_session_id or not run_id:
        return
    try:
        from agenticx.runtime.subagent_runs import SubAgentRunStore

        store = SubAgentRunStore(owner_session_id)
        raw_status = str(outcome.get("status") or "").strip().lower()
        if raw_status == "cancelled" or bool((outcome.get("detail") or {}).get("cancelled")):
            ok = False
            status = "cancelled"
        else:
            ok = bool(outcome.get("ok"))
            status = "completed" if ok else "failed"
        out_path = str(outcome.get("output_path") or "").strip()
        wrote = bool(outcome.get("wrote_output"))
        output_files = [out_path] if wrote and out_path else []
        artifacts = [{"path": out_path, "kind": "file"}] if output_files else []
        summary = str(outcome.get("result_text") or "").strip()[:2000]
        error_text = "" if ok else (summary or str(outcome.get("status") or "error"))
        store.close_run(
            run_id,
            status=status,
            result_summary=summary,
            error_text=error_text,
            result_file=out_path if wrote else "",
            output_files=output_files,
            artifacts=artifacts,
            detail_refs={
                "child_harness": "claude-code",
                "orchestrated_by": "near",
                "claude_session_id": str(outcome.get("session_id") or ""),
                "result_md_path": out_path if wrote else None,
            },
            completed_at=time.time(),
        )
        if status == "cancelled":
            event_type = "subagent_cancelled"
            title = "Claude Code CLI subagent cancelled"
        elif ok:
            event_type = "subagent_completed"
            title = "Claude Code CLI subagent completed"
        else:
            event_type = "subagent_error"
            title = "Claude Code CLI subagent failed"
        store.append_activity(
            run_id,
            event_type=event_type,
            title=title,
            detail=(
                f"status={status} wrote_output={wrote} path={out_path}"
                if out_path
                else f"status={status}"
            ),
        )
        name = str(outcome.get("name") or run_id)
        summary = str(outcome.get("result_text") or "").strip()
        if status == "cancelled":
            publish_cc_orchestration_progress(
                owner_session_id,
                {
                    "kind": "subagent_error",
                    "agent_id": run_id,
                    "text": "用户中断",
                    "status": "cancelled",
                },
            )
            publish_cc_orchestration_progress(
                owner_session_id,
                {
                    "kind": "text",
                    "agent_id": "meta",
                    "text": f"- **{name}**：已中断\n",
                },
            )
        elif ok:
            publish_cc_orchestration_progress(
                owner_session_id,
                {
                    "kind": "subagent_completed",
                    "agent_id": run_id,
                    "summary": summary[:2000],
                    "result_file": out_path if wrote else "",
                },
            )
            line = f"- **{name}**：成功"
            if wrote and out_path:
                line += f"；已写文件 `{out_path}`"
            line += "\n"
            if summary:
                line += f"  摘要：{summary[:400]}\n"
            publish_cc_orchestration_progress(
                owner_session_id,
                {"kind": "text", "agent_id": "meta", "text": line},
            )
        else:
            publish_cc_orchestration_progress(
                owner_session_id,
                {
                    "kind": "subagent_error",
                    "agent_id": run_id,
                    "text": (summary or status or "执行异常")[:500],
                    "status": "failed",
                },
            )
            publish_cc_orchestration_progress(
                owner_session_id,
                {
                    "kind": "text",
                    "agent_id": "meta",
                    "text": f"- **{name}**：未完成（{status or 'error'}）\n",
                },
            )
    except Exception as exc:  # noqa: BLE001
        _log.warning("[cc_subagents] close_run failed for %s: %s", run_id, exc)


def _run_one(
    *,
    task: CcSubagentTask,
    cwd: str,
    wait_seconds: float,
    model: Optional[str],
    parent_session_id: str = "",
    run_id: str = "",
    batch_source_id: str = "",
    cluster_title: str = "",
) -> Dict[str, Any]:
    from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter

    rid = str(run_id or "").strip() or f"cc-subagent-{uuid.uuid4().hex[:10]}"
    open_meta = _register_cc_run_open(
        owner_session_id=parent_session_id,
        run_id=rid,
        task=task,
        model=model,
        batch_source_id=batch_source_id or rid,
        cluster_title=cluster_title or "Agent 蜂群",
    )

    adapter = ClaudeCodeAdapter()
    options: Dict[str, Any] = {
        "mode": "headless",
        "auto_allow_permissions": True,
        "permission_policy": "auto",
    }
    if model:
        options["model"] = model
    sid = ""
    outcome: Dict[str, Any] = {
        "name": task.name,
        "run_id": rid,
        "session_id": "",
        "status": TURN_STATUS_ERROR,
        "result_text": "",
        "output_path": task.output_path,
        "wrote_output": False,
        "ok": False,
        "detail": {},
        "cluster_id": str(open_meta.get("cluster_id") or ""),
        "cluster_created_at": float(open_meta.get("created_at") or 0.0) or None,
        "role": "Claude Code CLI subagent",
        "provider": "claude-code",
        "model": str(model or "").strip(),
    }
    _track_cc_run(rid, owner_session_id=parent_session_id)
    try:
        view = adapter.spawn(cwd, options=options)
        sid = str(view.get("session_id") or "")
        outcome["session_id"] = sid
        raw_pid = view.get("pid")
        try:
            pid_val = int(raw_pid) if raw_pid is not None else None
        except (TypeError, ValueError):
            pid_val = None
        _track_cc_run(
            rid,
            owner_session_id=parent_session_id,
            claude_session_id=sid,
            pid=pid_val,
        )
        _patch_run_process_refs(
            owner_session_id=parent_session_id,
            run_id=rid,
            claude_session_id=sid,
            pid=pid_val,
        )
        if _cc_run_cancel_requested(rid):
            outcome.update(
                {
                    "status": "cancelled",
                    "result_text": "用户中断",
                    "wrote_output": False,
                    "ok": False,
                    "detail": {"cancelled": True},
                }
            )
        else:
            # Run the blocking Claude Code turn on a nested thread so this
            # worker can drain mid-turn stream-json into the parent SSE bus.
            turn_box: Dict[str, Any] = {}
            err_box: Dict[str, Any] = {}

            def _blocking_turn() -> None:
                try:
                    turn_box["result"] = adapter.turn(
                        sid,
                        TurnRequest(
                            text=task.prompt,
                            wait_seconds=float(wait_seconds),
                        ),
                    )
                except Exception as turn_exc:  # noqa: BLE001
                    err_box["exc"] = turn_exc

            turn_thread = threading.Thread(
                target=_blocking_turn,
                name=f"cc-turn-{rid}",
                daemon=True,
            )
            turn_thread.start()
            drain = getattr(adapter, "drain_midturn_stream_items", None)
            last_heartbeat = time.monotonic()
            while turn_thread.is_alive():
                if _cc_run_cancel_requested(rid):
                    try:
                        adapter.stop(sid)
                    except Exception:
                        pass
                    break
                if callable(drain) and parent_session_id:
                    try:
                        items = drain(sid) or []
                    except Exception:
                        items = []
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        kind = str(item.get("kind") or "")
                        if kind == "text":
                            piece = str(item.get("text") or "")
                            if piece:
                                publish_cc_orchestration_progress(
                                    parent_session_id,
                                    {
                                        "kind": "text",
                                        "agent_id": rid,
                                        "text": piece,
                                    },
                                )
                        elif kind in {"tool_start", "tool_end"}:
                            # Surface tool activity into the WorkPanel live pane.
                            name = str(item.get("name") or "tool").strip() or "tool"
                            marker = (
                                f"\n# {name} …\n"
                                if kind == "tool_start"
                                else f"\n# {name} done\n"
                            )
                            publish_cc_orchestration_progress(
                                parent_session_id,
                                {
                                    "kind": "text",
                                    "agent_id": rid,
                                    "text": marker,
                                },
                            )
                now = time.monotonic()
                if parent_session_id and now - last_heartbeat >= 12.0:
                    publish_cc_orchestration_progress(
                        parent_session_id,
                        {
                            "kind": "text",
                            "agent_id": "meta",
                            "text": f"（{task.name} 仍在运行…）\n",
                        },
                    )
                    last_heartbeat = now
                turn_thread.join(0.25)

            if err_box.get("exc") is not None and not _cc_run_cancel_requested(rid):
                raise err_box["exc"]  # noqa: B904 — re-raise for outer handler

            result = turn_box.get("result")
            out_path = Path(task.output_path)
            wrote = out_path.is_file() and out_path.stat().st_size > 0
            if _cc_run_cancel_requested(rid):
                detail = dict(getattr(result, "detail", None) or {}) if result else {}
                outcome.update(
                    {
                        "status": "cancelled",
                        "result_text": "用户中断",
                        "wrote_output": wrote,
                        "ok": False,
                        "detail": {"cancelled": True, **detail},
                    }
                )
            elif result is None:
                outcome.update(
                    {
                        "status": TURN_STATUS_ERROR,
                        "result_text": "Claude Code CLI turn returned no result",
                        "wrote_output": wrote,
                        "ok": False,
                        "detail": {},
                    }
                )
            else:
                outcome.update(
                    {
                        "status": result.status,
                        "result_text": result.result_text or "",
                        "wrote_output": wrote,
                        "ok": bool(result.ok),
                        "detail": dict(result.detail or {}),
                    }
                )
    except Exception as exc:  # noqa: BLE001
        if _cc_run_cancel_requested(rid):
            outcome.update(
                {
                    "status": "cancelled",
                    "result_text": "用户中断",
                    "wrote_output": False,
                    "ok": False,
                    "detail": {"cancelled": True, "exception": type(exc).__name__},
                }
            )
        else:
            outcome.update(
                {
                    "status": TURN_STATUS_ERROR,
                    "result_text": str(exc),
                    "wrote_output": False,
                    "ok": False,
                    "detail": {"exception": type(exc).__name__},
                }
            )
    finally:
        if sid:
            try:
                adapter.stop(sid)
            except Exception:
                pass
        if _cc_run_cancel_requested(rid):
            outcome["status"] = "cancelled"
            outcome["ok"] = False
            if not str(outcome.get("result_text") or "").strip():
                outcome["result_text"] = "用户中断"
        _register_cc_run_close(
            owner_session_id=parent_session_id,
            run_id=rid,
            outcome=outcome,
        )
        _untrack_cc_run(rid)
    return outcome


def run_claude_code_subagents(
    user_text: str,
    *,
    cwd: str,
    wait_seconds: float = 180.0,
    model: Optional[str] = None,
    parent_session_id: str = "",
) -> Dict[str, Any]:
    """Spawn real Claude Code CLI subagents and collect per-task outcomes.

    When ``parent_session_id`` is set, each child is registered into
    ``SubAgentRunStore`` under that owner (Near **studio** session id, not the
    CodeBuddy harness surface id) so WorkPanel 「子智能体」 and the in-chat
    Agent 蜂群 card can list Claude Code CLI harness runs.
    """
    tasks = plan_claude_code_subagent_tasks(user_text, cwd=cwd)
    if not tasks:
        return {"ok": False, "error": "no_tasks", "results": []}
    if not claude_code_cli_available():
        return {
            "ok": False,
            "error": "claude_code_unavailable",
            "results": [],
            "tasks": [{"name": t.name, "output_path": t.output_path} for t in tasks],
        }

    batch_id = uuid.uuid4().hex[:10]
    batch_source_id = f"near-cc-{batch_id}"
    cluster_title = f"Agent 蜂群 · {len(tasks)} 个并行任务"
    results: List[Dict[str, Any]] = []
    if parent_session_id:
        clear_cc_orchestration_progress(parent_session_id)
        publish_cc_orchestration_progress(
            parent_session_id,
            {
                "kind": "text",
                "agent_id": "meta",
                "text": (
                    f"正在跨引擎拉起 {len(tasks)} 个真实 Claude Code CLI subagent"
                    + "（不是 CodeBuddy Agent 队友）…\n\n"
                                ),
            },
        )
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futs = {
            pool.submit(
                _run_one,
                task=t,
                cwd=cwd,
                wait_seconds=wait_seconds,
                model=model,
                parent_session_id=parent_session_id,
                run_id=f"cc-subagent-{batch_id}-{idx}",
                batch_source_id=batch_source_id,
                cluster_title=cluster_title,
            ): t
            for idx, t in enumerate(tasks, start=1)
        }
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                t = futs[fut]
                results.append(
                    {
                        "name": t.name,
                        "run_id": "",
                        "session_id": "",
                        "status": TURN_STATUS_ERROR,
                        "result_text": str(exc),
                        "output_path": t.output_path,
                        "wrote_output": False,
                        "ok": False,
                        "detail": {"exception": type(exc).__name__},
                    }
                )

    results.sort(key=lambda r: str(r.get("name") or ""))
    any_ok = any(bool(r.get("ok")) for r in results)
    run_ids = [
        str(r.get("run_id") or "").strip()
        for r in results
        if str(r.get("run_id") or "").strip()
    ]
    cluster_id = ""
    cluster_created_at = None
    for r in results:
        cid = str(r.get("cluster_id") or "").strip()
        if cid:
            cluster_id = cid
            created = r.get("cluster_created_at")
            try:
                cluster_created_at = float(created) if created is not None else None
            except (TypeError, ValueError):
                cluster_created_at = None
            break
    return {
        "ok": any_ok,
        "error": None if any_ok else "all_failed",
        "results": results,
        "task_count": len(tasks),
        "batch_source_id": batch_source_id,
        "parent_session_id": parent_session_id,
        "cluster_id": cluster_id,
        "cluster_title": cluster_title,
        "cluster_created_at": cluster_created_at,
        "run_ids": run_ids,
    }


def format_cc_subagent_result_text(payload: Dict[str, Any]) -> str:
    """User-visible summary for the parent CodeBuddy bubble."""
    results = list(payload.get("results") or [])
    if payload.get("error") == "claude_code_unavailable":
        return (
            "你点名要用 Claude Code 做 subagent，但本机未找到 `claude` CLI，"
            "Near 无法跨引擎拉起。请先安装/登录 Claude Code，或把会话切到 claude-code。"
        )
    if not results:
        return "Near 未能解析出可派发的 Claude Code subagent 任务。"

    lines = [
        f"已由 Near 跨引擎拉起 {len(results)} 个真实 Claude Code CLI subagent"
        "（不是 CodeBuddy Agent 队友）：",
        "",
    ]
    for r in results:
        status = "成功" if r.get("ok") else f"未完成（{r.get('status') or 'error'}）"
        path = r.get("output_path") or ""
        wrote = "已写文件" if r.get("wrote_output") else "未检测到产物文件"
        lines.append(f"- **{r.get('name')}**：{status}；{wrote} `{path}`")
        excerpt = (r.get("result_text") or "").strip()
        if excerpt:
            lines.append(f"  摘要：{excerpt[:500]}")
    lines.append("")
    lines.append("说明：父会话仍是 CodeBuddy；子任务进程是本机 `claude` CLI。")
    return "\n".join(lines)


def maybe_run_cc_subagents_for_codebuddy_turn(
    *,
    parent_session_id: str,
    user_text: str,
    cwd: str,
    wait_seconds: float,
    model: Optional[str] = None,
) -> Optional[TurnResult]:
    """If the user asked for CC subagents, run them and return a parent TurnResult.

    Returns None when the ask should fall through to normal CodeBuddy handling.
    """
    text = (user_text or "").strip()
    # Defense in depth: never treat Near's completion/system notices as a fresh
    # "use Claude Code as subagents" ask (that caused endless swarm respawns).
    if text.startswith("[系统通知]") or text.startswith("[auto-nudge]"):
        return None
    if "以下子智能体已全部结束" in text or "子智能体已全部结束或暂停" in text:
        return None
    if not user_asked_for_claude_code_subagents(text):
        return None

    payload = run_claude_code_subagents(
        text,
        cwd=cwd or ".",
        wait_seconds=wait_seconds,
        model=model,
        parent_session_id=parent_session_id,
    )
    text = format_cc_subagent_result_text(payload)
    status = TURN_STATUS_SUCCESS if payload.get("ok") else TURN_STATUS_ERROR
    if payload.get("error") == "claude_code_unavailable":
        status = TURN_STATUS_SUCCESS
    return TurnResult(
        harness="codebuddy",
        session_id=parent_session_id,
        status=status,
        result_text=text[:8000],
        tail="",
        deduplicated=False,
        detail={
            "near_cc_subagents": payload,
            "orchestrated_by": "near",
            "child_harness": "claude-code",
        },
    )


__all__ = [
    "CcSubagentTask",
    "cancel_claude_code_subagent_run",
    "clear_cc_orchestration_progress",
    "claude_code_cli_available",
    "drain_cc_orchestration_progress",
    "format_cc_subagent_result_text",
    "maybe_run_cc_subagents_for_codebuddy_turn",
    "plan_claude_code_subagent_tasks",
    "publish_cc_orchestration_progress",
    "run_claude_code_subagents",
]
