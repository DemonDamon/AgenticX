"""Near-orchestrated Claude Code CLI subagents from a CodeBuddy session.

When the user asks CodeBuddy to use Claude Code / CC as subagents, CodeBuddy's
own ``Agent`` tool can only spawn CodeBuddy teammates. Near intercepts that
intent and runs real ``claude`` CLI headless sessions in parallel via the
existing Claude Code harness adapter, then returns the combined result on the
parent CodeBuddy turn.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.harness.types import TURN_STATUS_ERROR, TURN_STATUS_SUCCESS, TurnRequest, TurnResult
from agenticx.wb_bridge.codebuddy_agent_await import user_asked_for_claude_code_subagents

_log = logging.getLogger(__name__)

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


def _register_cc_run_open(
    *,
    owner_session_id: str,
    run_id: str,
    task: CcSubagentTask,
    model: Optional[str],
    batch_source_id: str,
    cluster_title: str,
) -> None:
    """Register one Claude Code CLI child into the parent WorkPanel Spawns store."""
    if not owner_session_id:
        return
    try:
        from agenticx.runtime.subagent_runs import SubAgentRunStore

        store = SubAgentRunStore(owner_session_id)
        store.open_run(
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
    except Exception as exc:  # noqa: BLE001
        _log.warning("[cc_subagents] open_run failed for %s: %s", run_id, exc)


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
        store.append_activity(
            run_id,
            event_type="subagent_completed" if ok else "subagent_error",
            title="Claude Code CLI subagent completed" if ok else "Claude Code CLI subagent failed",
            detail=(
                f"status={status} wrote_output={wrote} path={out_path}"
                if out_path
                else f"status={status}"
            ),
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
    _register_cc_run_open(
        owner_session_id=parent_session_id,
        run_id=rid,
        task=task,
        model=model,
        batch_source_id=batch_source_id or rid,
        cluster_title=cluster_title or "Claude Code CLI subagents",
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
    }
    try:
        view = adapter.spawn(cwd, options=options)
        sid = str(view.get("session_id") or "")
        outcome["session_id"] = sid
        result = adapter.turn(
            sid,
            TurnRequest(text=task.prompt, wait_seconds=float(wait_seconds)),
        )
        out_path = Path(task.output_path)
        wrote = out_path.is_file() and out_path.stat().st_size > 0
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
        _register_cc_run_close(
            owner_session_id=parent_session_id,
            run_id=rid,
            outcome=outcome,
        )
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
    ``SubAgentRunStore`` under that owner session so WorkPanel Spawns/clusters
    can list Claude Code CLI harness runs (not CodeBuddy Agent teammates).
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
    cluster_title = "Claude Code CLI subagents"
    results: List[Dict[str, Any]] = []
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
    return {
        "ok": any_ok,
        "error": None if any_ok else "all_failed",
        "results": results,
        "task_count": len(tasks),
        "batch_source_id": batch_source_id,
        "parent_session_id": parent_session_id,
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
    if not user_asked_for_claude_code_subagents(user_text):
        return None

    payload = run_claude_code_subagents(
        user_text,
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
    "claude_code_cli_available",
    "format_cc_subagent_result_text",
    "maybe_run_cc_subagents_for_codebuddy_turn",
    "plan_claude_code_subagent_tasks",
    "run_claude_code_subagents",
]
