#!/usr/bin/env python3
"""Reviewed multi-agent workflow helpers for project group chat.

This module deliberately contains only serialisable state and deterministic
protocol helpers.  The actual agents continue to run through
``GroupChatRouter`` / ``AgentRuntime``.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import json
from pathlib import Path
import re
from typing import Any, Mapping, Sequence

from agenticx.utils.atomic_writer import atomic_write_text
from agenticx.workspace.loader import ensure_group_workspace


MEMBER_RUNTIME_STATE_KEY = "group_workflow_member_state_v1"
MEMBER_HISTORY_MAX_MESSAGES = 18
MEMBER_HISTORY_MAX_CHARS = 24_000
DOSSIER_MAX_CHARS = 48_000


class GroupWorkflowError(RuntimeError):
    """Raised when a reviewed workflow stage cannot reach an accepted state."""


class ReviewStatus(str, Enum):
    PASS = "pass"
    PASS_WITH_RISK = "pass_with_risk"
    REVISE = "revise"
    FAIL = "fail"


@dataclass(frozen=True)
class ReviewIssue:
    severity: str
    problem: str
    fix: str = ""


@dataclass(frozen=True)
class ReviewDecision:
    status: ReviewStatus
    summary: str
    issues: list[ReviewIssue] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    raw_text: str = ""

    @property
    def accepted(self) -> bool:
        return self.status in {ReviewStatus.PASS, ReviewStatus.PASS_WITH_RISK}


@dataclass(frozen=True)
class WorkflowMember:
    avatar_id: str
    name: str
    role: str = ""
    prompt: str = ""


@dataclass
class WorkflowStageRecord:
    task_id: str
    description: str
    executor_id: str
    executor_name: str
    reviewer_id: str = ""
    reviewer_name: str = ""
    dependency_outputs: dict[str, str] = field(default_factory=dict)
    attempts: list[str] = field(default_factory=list)
    reviews: list[ReviewDecision] = field(default_factory=list)
    final_output: str = ""
    status: str = "pending"
    failure_reason: str = ""


_QUALITY_ROLE_KEYWORDS: tuple[str, ...] = (
    "审核",
    "审稿",
    "评审",
    "质量",
    "验收",
    "测试",
    "风控",
    "风险",
    "合规",
    "编辑",
    "review",
    "quality",
    "qa",
    "test",
    "risk",
    "compliance",
    "editor",
)


def select_reviewer(
    members: Sequence[WorkflowMember],
    *,
    executor_id: str,
    task_index: int = 0,
) -> WorkflowMember | None:
    """Choose an independent reviewer, preferring explicit quality roles."""
    executor = str(executor_id or "").strip()
    candidates = [m for m in members if m.avatar_id and m.avatar_id != executor]
    if not candidates:
        return None

    def _quality_score(member: WorkflowMember) -> int:
        haystack = f"{member.role}\n{member.prompt}".casefold()
        return sum(1 for keyword in _QUALITY_ROLE_KEYWORDS if keyword in haystack)

    scored = [(member, _quality_score(member)) for member in candidates]
    best = max(score for _, score in scored)
    top = [member for member, score in scored if score == best]
    return top[max(0, int(task_index)) % len(top)]


def _strip_reasoning(text: str) -> str:
    return re.sub(
        r"<think>.*?</think>",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    ).strip()


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    text = _strip_reasoning(str(raw_text or ""))
    fenced = re.search(
        r"```(?:json)?\s*(\{.*?\})\s*```",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    candidates = [fenced.group(1)] if fenced else []
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            return payload
    return None


def _normalise_status(raw: Any, fallback_text: str = "") -> ReviewStatus | None:
    value = str(raw or "").strip().casefold().replace("-", "_").replace(" ", "_")
    aliases = {
        "pass": ReviewStatus.PASS,
        "passed": ReviewStatus.PASS,
        "通过": ReviewStatus.PASS,
        "pass_with_risk": ReviewStatus.PASS_WITH_RISK,
        "conditional_pass": ReviewStatus.PASS_WITH_RISK,
        "有条件通过": ReviewStatus.PASS_WITH_RISK,
        "带风险通过": ReviewStatus.PASS_WITH_RISK,
        "revise": ReviewStatus.REVISE,
        "revision": ReviewStatus.REVISE,
        "needs_revision": ReviewStatus.REVISE,
        "需修改": ReviewStatus.REVISE,
        "需要修改": ReviewStatus.REVISE,
        "需要返工": ReviewStatus.REVISE,
        "返工": ReviewStatus.REVISE,
        "fail": ReviewStatus.FAIL,
        "failed": ReviewStatus.FAIL,
        "不通过": ReviewStatus.FAIL,
        "失败": ReviewStatus.FAIL,
    }
    if value in aliases:
        return aliases[value]

    text = str(fallback_text or "").casefold()
    # Negative/conditional phrases must be checked before the substring “通过”.
    if any(
        marker in text
        for marker in ("不通过", "审核失败", "status: fail", '"status":"fail"')
    ):
        return ReviewStatus.FAIL
    if any(
        marker in text
        for marker in ("需要返工", "需修改", "需要修改", "status: revise")
    ):
        return ReviewStatus.REVISE
    if any(
        marker in text
        for marker in ("有条件通过", "带风险通过", "pass with risk", "pass_with_risk")
    ):
        return ReviewStatus.PASS_WITH_RISK
    if any(marker in text for marker in ("审核通过", "验收通过", "status: pass")):
        return ReviewStatus.PASS
    return None


def _normalise_issues(raw: Any) -> list[ReviewIssue]:
    if not isinstance(raw, list):
        return []
    issues: list[ReviewIssue] = []
    for item in raw:
        if isinstance(item, Mapping):
            severity = str(item.get("severity") or "P1").strip().upper()
            if severity not in {"P0", "P1", "P2"}:
                severity = "P1"
            problem = str(item.get("problem") or item.get("issue") or "").strip()
            fix = str(item.get("fix") or item.get("suggestion") or "").strip()
        else:
            severity = "P1"
            problem = str(item or "").strip()
            fix = ""
        if problem:
            issues.append(ReviewIssue(severity=severity, problem=problem, fix=fix))
    return issues


def _plain_text_issues(raw_text: str) -> list[ReviewIssue]:
    issues: list[ReviewIssue] = []
    for match in re.finditer(
        r"(?im)(?<![A-Z0-9])(P[012])\s*[:：\-]\s*([^\n]+)",
        str(raw_text or ""),
    ):
        problem = match.group(2).strip(" -；;")
        if problem:
            issues.append(
                ReviewIssue(
                    severity=match.group(1).upper(),
                    problem=problem,
                    fix="按该严重级别问题补齐后重新提交审核。",
                )
            )
    return issues


def parse_review_decision(raw_text: str) -> ReviewDecision:
    """Parse the reviewer contract and fail closed when it is malformed."""
    raw = str(raw_text or "").strip()
    payload = _extract_json_object(raw)
    if payload is not None:
        status = _normalise_status(payload.get("status"), raw)
        summary = str(payload.get("summary") or payload.get("reason") or "").strip()
        issues = _normalise_issues(payload.get("issues"))
        strengths_raw = payload.get("strengths")
        strengths = (
            [str(item).strip() for item in strengths_raw if str(item).strip()]
            if isinstance(strengths_raw, list)
            else []
        )
    else:
        status = _normalise_status(None, raw)
        summary = _strip_reasoning(raw)[:500]
        issues = _plain_text_issues(raw)
        strengths = []

    if status is None:
        return ReviewDecision(
            status=ReviewStatus.REVISE,
            summary="审核输出未遵循结构化协议，需要重新审核或补齐结论。",
            issues=[
                ReviewIssue(
                    severity="P1",
                    problem="审核结果无法解析，不能确认候选产出已通过质量门控。",
                    fix="按指定 JSON schema 返回 status、summary、issues 和 strengths。",
                )
            ],
            raw_text=raw,
        )

    blocking_issues = [issue for issue in issues if issue.severity in {"P0", "P1"}]
    if status in {ReviewStatus.PASS, ReviewStatus.PASS_WITH_RISK} and blocking_issues:
        status = ReviewStatus.REVISE
        if not summary:
            summary = "仍存在阻塞交付的问题，需要返工。"

    if not summary:
        summary = {
            ReviewStatus.PASS: "候选产出满足当前任务要求。",
            ReviewStatus.PASS_WITH_RISK: "候选产出可交付，但仍有非阻塞风险。",
            ReviewStatus.REVISE: "候选产出需要修改后重新审核。",
            ReviewStatus.FAIL: "候选产出未达到可交付标准。",
        }[status]

    return ReviewDecision(
        status=status,
        summary=summary,
        issues=issues,
        strengths=strengths,
        raw_text=raw,
    )


def build_review_prompt(
    *,
    original_request: str,
    task_description: str,
    dependency_outputs: Mapping[str, str],
    candidate_output: str,
    executor_name: str,
) -> str:
    dependencies = "\n\n".join(
        f"### {task_id}\n{output}" for task_id, output in dependency_outputs.items()
    ) or "（无上游依赖，本阶段应保持独立判断。）"
    return f"""你现在是该阶段的独立质量审核者，不是执行者，也不要替执行者重写答案。

## 原始用户请求
{original_request}

## 当前阶段任务
{task_description}

## 已审核上游交接
{dependencies}

## 执行者
{executor_name}

## 候选产出
{candidate_output}

## 审核要求
请独立检查：
1. 是否覆盖当前阶段和原始请求中的关键要求；
2. 事实、数字、引用和“已经完成”的陈述是否有可见依据；
3. 结论是否内在一致，是否与上游交接冲突；
4. 产出是否可执行、可验证、可直接用于最终交付；
5. 是否存在安全、合规、权限或工具不可用却被掩盖的问题。

严重级别：P0=核心缺失/关键事实无依据/产物不可用/安全硬错误；P1=显著影响质量或执行；P2=非阻塞改进。
只返回一个 JSON 对象，不要 Markdown，不要解释，不要调用其他成员：
{{
  "status": "pass | pass_with_risk | revise | fail",
  "summary": "一句话审核结论",
  "issues": [{{"severity": "P0 | P1 | P2", "problem": "具体问题", "fix": "具体修改要求"}}],
  "strengths": ["已做好的部分"]
}}
只要存在 P0 或 P1，status 必须是 revise 或 fail；只有 P2 风险时才可 pass_with_risk。
""".strip()


def build_rework_prompt(
    *,
    original_request: str,
    task_description: str,
    previous_output: str,
    decision: ReviewDecision,
    attempt_number: int,
    dependency_outputs: Mapping[str, str],
) -> str:
    issue_rows = "\n".join(
        f"- [{issue.severity}] {issue.problem}"
        + (f"；修改要求：{issue.fix}" if issue.fix else "")
        for issue in decision.issues
    ) or f"- {decision.summary}"
    dependencies = "\n\n".join(
        f"### {task_id}\n{output}" for task_id, output in dependency_outputs.items()
    ) or "（无）"
    return f"""这是第 {max(1, int(attempt_number))} 次返工。你仍是本阶段执行者，必须根据独立审核意见修订。

## 原始用户请求
{original_request}

## 当前阶段任务
{task_description}

## 已审核上游交接
{dependencies}

## 上一版产出
{previous_output}

## 独立审核结论
{decision.summary}
{issue_rows}

请逐项解决所有 P0/P1，保留已经正确的内容，并输出一份完整、可直接交付的修订版。
不要只列修改计划，不要向审核者致谢，不要解释你准备怎么改。
""".strip()


def render_review_for_group(decision: ReviewDecision) -> str:
    labels = {
        ReviewStatus.PASS: "审核通过",
        ReviewStatus.PASS_WITH_RISK: "有条件通过",
        ReviewStatus.REVISE: "需要返工",
        ReviewStatus.FAIL: "审核未通过",
    }
    rows = [f"{labels[decision.status]}：{decision.summary}"]
    for issue in decision.issues[:5]:
        row = f"- [{issue.severity}] {issue.problem}"
        if issue.fix:
            row += f"；修改：{issue.fix}"
        rows.append(row)
    return "\n".join(rows)


def _text_content(raw: Any) -> str:
    if isinstance(raw, str):
        return raw.strip()
    if not isinstance(raw, list):
        return ""
    parts: list[str] = []
    for block in raw:
        if isinstance(block, Mapping) and str(block.get("type") or "") == "text":
            parts.append(str(block.get("text") or ""))
    return "".join(parts).strip()


def _bounded_text_messages(
    messages: Sequence[Any],
    *,
    max_messages: int = MEMBER_HISTORY_MAX_MESSAGES,
    max_chars: int = MEMBER_HISTORY_MAX_CHARS,
) -> list[dict[str, str]]:
    normalised: list[dict[str, str]] = []
    for item in messages:
        if not isinstance(item, Mapping):
            continue
        role = str(item.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        content = _text_content(item.get("content"))
        if content:
            normalised.append({"role": role, "content": content})

    selected: list[dict[str, str]] = []
    used = 0
    for item in reversed(normalised[-max(1, int(max_messages)) :]):
        content = item["content"]
        remaining = max(0, int(max_chars) - used)
        if remaining <= 0:
            break
        if len(content) > remaining:
            if selected:
                break
            content = content[-remaining:]
        selected.append({"role": item["role"], "content": content})
        used += len(content)
    selected.reverse()
    return selected


def _member_state_root(owner_session: Any) -> dict[str, Any]:
    scratchpad = getattr(owner_session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        scratchpad = {}
        setattr(owner_session, "scratchpad", scratchpad)
    root = scratchpad.get(MEMBER_RUNTIME_STATE_KEY)
    if not isinstance(root, dict):
        root = {"version": 1, "groups": {}}
        scratchpad[MEMBER_RUNTIME_STATE_KEY] = root
    groups = root.get("groups")
    if not isinstance(groups, dict):
        groups = {}
        root["groups"] = groups
    return root


def restore_member_runtime_state(
    owner_session: Any,
    local_session: Any,
    *,
    group_id: str,
    avatar_id: str,
) -> list[dict[str, str]]:
    root = _member_state_root(owner_session)
    groups = root["groups"]
    group = groups.get(str(group_id or ""))
    members = group.get("members") if isinstance(group, dict) else None
    member = members.get(str(avatar_id or "")) if isinstance(members, dict) else None
    rows = _bounded_text_messages(member.get("messages") if isinstance(member, dict) else [])
    local_session.agent_messages = [dict(row) for row in rows]
    local_session.chat_history = [dict(row) for row in rows]
    return rows


def persist_member_runtime_state(
    owner_session: Any,
    local_session: Any,
    *,
    group_id: str,
    avatar_id: str,
) -> list[dict[str, str]]:
    source = getattr(local_session, "agent_messages", None)
    if not isinstance(source, list) or not source:
        source = getattr(local_session, "chat_history", None)
    rows = _bounded_text_messages(source if isinstance(source, list) else [])

    root = _member_state_root(owner_session)
    groups = root["groups"]
    gid = str(group_id or "")
    aid = str(avatar_id or "")
    group = groups.get(gid)
    if not isinstance(group, dict):
        group = {"members": {}}
        groups[gid] = group
    members = group.get("members")
    if not isinstance(members, dict):
        members = {}
        group["members"] = members
    members[aid] = {
        "messages": rows,
        "updated_at": datetime.now().astimezone().isoformat(),
    }
    return rows


def _truncate(text: str, limit: int) -> str:
    raw = str(text or "")
    if len(raw) <= limit:
        return raw
    return raw[: max(0, limit - 24)].rstrip() + "\n…（内容已截断）"


def render_execution_dossier(
    records: Sequence[WorkflowStageRecord],
    *,
    max_chars: int = DOSSIER_MAX_CHARS,
) -> str:
    sections: list[str] = []
    for index, record in enumerate(records, start=1):
        lines = [
            f"## 阶段 {index}: {record.description}",
            f"- task_id: {record.task_id}",
            f"- 执行者: {record.executor_name} ({record.executor_id})",
            f"- 审核者: {record.reviewer_name or '未分配'} ({record.reviewer_id or '-'})",
            f"- 状态: {record.status}",
        ]
        if record.dependency_outputs:
            lines.append(f"- 已接收上游: {', '.join(record.dependency_outputs.keys())}")
        if record.failure_reason:
            lines.append(f"- 未闭环原因: {record.failure_reason}")
        for attempt_index, output in enumerate(record.attempts, start=1):
            lines.append(f"\n### 第 {attempt_index} 版产出\n{_truncate(output, 7_000)}")
            if attempt_index <= len(record.reviews):
                decision = record.reviews[attempt_index - 1]
                lines.append(
                    f"\n### 第 {attempt_index} 次审核\n"
                    f"- 结论: {decision.status.value}\n"
                    f"- 摘要: {decision.summary}"
                )
                for issue in decision.issues:
                    issue_row = f"- [{issue.severity}] {issue.problem}"
                    if issue.fix:
                        issue_row += f"；修改：{issue.fix}"
                    lines.append(issue_row)
        if record.final_output and (
            not record.attempts or record.final_output != record.attempts[-1]
        ):
            lines.append(f"\n### 最终通过版本\n{_truncate(record.final_output, 7_000)}")
        sections.append("\n".join(lines))
    dossier = "\n\n".join(sections) or "（没有生成可执行阶段。）"
    return _truncate(dossier, max(1, int(max_chars)))


def _safe_filename_part(value: str, *, fallback: str, limit: int) -> str:
    cleaned = re.sub(r"[^\w\-\u3400-\u9fff]+", "-", str(value or "").strip(), flags=re.UNICODE)
    cleaned = re.sub(r"-+", "-", cleaned).strip("-_.")
    return (cleaned[:limit].strip("-_.") or fallback)


def write_group_deliverable(
    *,
    group_id: str,
    group_name: str,
    original_request: str,
    run_id: str,
    records: Sequence[WorkflowStageRecord],
    final_answer: str,
    workspace_root: str | Path | None = None,
) -> Path:
    workspace = (
        Path(workspace_root).expanduser().resolve(strict=False)
        if workspace_root is not None
        else ensure_group_workspace(group_id, group_name=group_name)
    )
    now = datetime.now().astimezone()
    topic = _safe_filename_part(original_request, fallback="team-deliverable", limit=36)
    safe_run_id = _safe_filename_part(run_id, fallback="run", limit=28)
    path = workspace / "deliverables" / f"{now.strftime('%Y-%m-%d-%H%M')}-{topic}-{safe_run_id}.md"
    dossier = render_execution_dossier(records)
    content = f"""# {group_name or '项目群'}协作交付

- 生成时间：{now.isoformat()}
- Group ID：{group_id}
- Run ID：{run_id}

## 用户请求

{original_request}

## 团队执行与审核记录

{dossier}

## 负责人最终答复

{final_answer}
"""
    atomic_write_text(path, content)
    return path


__all__ = [
    "DOSSIER_MAX_CHARS",
    "GroupWorkflowError",
    "MEMBER_HISTORY_MAX_CHARS",
    "MEMBER_HISTORY_MAX_MESSAGES",
    "MEMBER_RUNTIME_STATE_KEY",
    "ReviewDecision",
    "ReviewIssue",
    "ReviewStatus",
    "WorkflowMember",
    "WorkflowStageRecord",
    "build_review_prompt",
    "build_rework_prompt",
    "parse_review_decision",
    "persist_member_runtime_state",
    "render_execution_dossier",
    "render_review_for_group",
    "restore_member_runtime_state",
    "select_reviewer",
    "write_group_deliverable",
]
