"""Near-orchestrated Claude Code CLI subagents from a CodeBuddy session.

When the user asks CodeBuddy to use Claude Code / CC as subagents, CodeBuddy's
own ``Agent`` tool can only spawn CodeBuddy teammates. Near intercepts that
intent and runs real ``claude`` CLI headless sessions in parallel via the
existing Claude Code harness adapter, then returns the combined result on the
parent CodeBuddy turn.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.harness.types import TURN_STATUS_ERROR, TURN_STATUS_SUCCESS, TurnRequest, TurnResult
from agenticx.wb_bridge.codebuddy_agent_await import user_asked_for_claude_code_subagents

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


def _run_one(
    *,
    task: CcSubagentTask,
    cwd: str,
    wait_seconds: float,
    model: Optional[str],
) -> Dict[str, Any]:
    from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter

    adapter = ClaudeCodeAdapter()
    options: Dict[str, Any] = {
        "mode": "headless",
        "auto_allow_permissions": True,
        "permission_policy": "auto",
    }
    if model:
        options["model"] = model
    view = adapter.spawn(cwd, options=options)
    sid = str(view.get("session_id") or "")
    try:
        result = adapter.turn(
            sid,
            TurnRequest(text=task.prompt, wait_seconds=float(wait_seconds)),
        )
        out_path = Path(task.output_path)
        wrote = out_path.is_file() and out_path.stat().st_size > 0
        return {
            "name": task.name,
            "session_id": sid,
            "status": result.status,
            "result_text": result.result_text or "",
            "output_path": task.output_path,
            "wrote_output": wrote,
            "ok": bool(result.ok),
            "detail": dict(result.detail or {}),
        }
    finally:
        try:
            adapter.stop(sid)
        except Exception:
            pass


def run_claude_code_subagents(
    user_text: str,
    *,
    cwd: str,
    wait_seconds: float = 180.0,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Spawn real Claude Code CLI subagents and collect per-task outcomes."""
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

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futs = {
            pool.submit(
                _run_one,
                task=t,
                cwd=cwd,
                wait_seconds=wait_seconds,
                model=model,
            ): t
            for t in tasks
        }
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                t = futs[fut]
                results.append(
                    {
                        "name": t.name,
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
