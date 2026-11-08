"""CodeBuddy Agent-tool honesty + short await after fire-and-forget spawn.

Repro (session d37c29ea): user asked for Claude Code as subagents; CodeBuddy
used its own ``Agent`` tool, returned "Spawned successfully", ended the parent
turn, and Near's WorkPanel stayed empty while teammates stalled before writing
``report_*.md``.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

import ujson

_CC_SUBAGENT_RE = re.compile(
    r"(claude\s*code|claude-code|\bcc\b).{0,40}(sub[\s-]?agent|子代理|队友)"
    r"|(sub[\s-]?agent|子代理).{0,40}(claude\s*code|claude-code|\bcc\b)"
    r"|用\s*(claude\s*code|claude-code|cc)\s*.{0,20}(sub|子)",
    re.IGNORECASE | re.DOTALL,
)

_PATH_RE = re.compile(
    r"(?:/Users/[^\s\"']+\.md|~/?[^\s\"']+\.md|[A-Za-z0-9_./-]*report[^\s\"']*\.md)"
)


@dataclass(frozen=True)
class AgentSpawn:
    name: str
    agent_id: str
    team_name: str
    task_id: str
    expected_paths: tuple[str, ...]


def user_asked_for_claude_code_subagents(text: str) -> bool:
    """True when the user asked to use Claude Code / CC as subagents."""
    return bool(_CC_SUBAGENT_RE.search(text or ""))


def _paths_from_text(text: str) -> List[str]:
    out: List[str] = []
    for m in _PATH_RE.finditer(text or ""):
        raw = m.group(0).strip().rstrip(")，。；;,")
        if raw and raw not in out:
            out.append(raw)
    return out


def parse_agent_spawns_from_objects(objs: Iterable[Dict[str, Any]]) -> List[AgentSpawn]:
    """Collect Agent spawn results from CodeBuddy stream objects."""
    pending_paths: Dict[str, List[str]] = {}
    spawns: List[AgentSpawn] = []
    for obj in objs:
        if not isinstance(obj, dict):
            continue
        kind = obj.get("type")
        name = str(obj.get("name") or "")
        call_id = str(obj.get("callId") or obj.get("id") or "")
        if kind == "function_call" and name == "Agent":
            blob = ""
            args = obj.get("arguments")
            if isinstance(args, str):
                blob = args
            elif isinstance(args, dict):
                blob = ujson.dumps(args, ensure_ascii=False)
            pd = obj.get("providerData") if isinstance(obj.get("providerData"), dict) else {}
            blob += " " + str(pd.get("argumentsDisplayText") or "")
            # Also scan common prompt fields.
            for key in ("prompt", "description", "task"):
                if isinstance(args, dict) and args.get(key):
                    blob += " " + str(args.get(key))
            pending_paths[call_id] = _paths_from_text(blob)
            continue
        if kind == "function_call_result" and name == "Agent":
            out = obj.get("output")
            text = ""
            if isinstance(out, dict):
                text = str(out.get("text") or "")
            elif isinstance(out, str):
                text = out
            pd = obj.get("providerData") if isinstance(obj.get("providerData"), dict) else {}
            tool_result = pd.get("toolResult") if isinstance(pd.get("toolResult"), dict) else {}
            if not text:
                text = str(tool_result.get("content") or "")
            renderer = tool_result.get("renderer") if isinstance(tool_result.get("renderer"), dict) else {}
            renderer_blob = str(renderer.get("value") or "")
            if "Spawned successfully" not in text and "spawned successfully" not in text.lower():
                # Still record paths from call args if any.
                continue
            meta: Dict[str, str] = {}
            for line in text.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    meta[k.strip().lower()] = v.strip()
            expected = tuple(
                pending_paths.get(call_id)
                or _paths_from_text(text + " " + renderer_blob)
            )
            spawns.append(
                AgentSpawn(
                    name=meta.get("name") or "",
                    agent_id=meta.get("agent_id") or "",
                    team_name=meta.get("team_name") or "",
                    task_id=meta.get("task_id") or "",
                    expected_paths=expected,
                )
            )
    return spawns


def parse_agent_spawns_from_lines(lines: Sequence[str]) -> List[AgentSpawn]:
    objs: List[Dict[str, Any]] = []
    for line in lines:
        line = (line or "").strip()
        if not line:
            continue
        try:
            obj = ujson.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            objs.append(obj)
    return parse_agent_spawns_from_objects(objs)


def _expand_path(raw: str, cwd: str) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path(cwd or ".").joinpath(p)
    return p


def artifacts_ready(spawns: Sequence[AgentSpawn], *, cwd: str) -> bool:
    """True when every spawn that named an output path has a non-empty file."""
    expected: List[Path] = []
    for sp in spawns:
        for raw in sp.expected_paths:
            expected.append(_expand_path(raw, cwd))
    if not expected:
        return False
    return all(p.is_file() and p.stat().st_size > 0 for p in expected)


def await_agent_artifacts(
    spawns: Sequence[AgentSpawn],
    *,
    cwd: str,
    timeout_sec: float = 45.0,
    poll_interval: float = 0.5,
) -> Dict[str, Any]:
    """Poll for expected markdown artifacts after CodeBuddy Agent spawn."""
    deadline = time.monotonic() + max(0.0, float(timeout_sec))
    expected = []
    for sp in spawns:
        for raw in sp.expected_paths:
            expected.append(str(_expand_path(raw, cwd)))
    if not expected:
        return {
            "ready": False,
            "expected_paths": [],
            "existing_paths": [],
            "waited_sec": 0.0,
            "no_expected_paths": True,
        }
    while True:
        ready = artifacts_ready(spawns, cwd=cwd)
        if ready:
            return {
                "ready": True,
                "expected_paths": expected,
                "waited_sec": max(0.0, float(timeout_sec) - (deadline - time.monotonic())),
            }
        if time.monotonic() >= deadline:
            existing = [p for p in expected if Path(p).is_file() and Path(p).stat().st_size > 0]
            return {
                "ready": False,
                "expected_paths": expected,
                "existing_paths": existing,
                "waited_sec": float(timeout_sec),
            }
        time.sleep(max(0.05, float(poll_interval)))


def honesty_footer(
    *,
    asked_for_claude_code: bool,
    spawns: Sequence[AgentSpawn],
    await_info: Optional[Dict[str, Any]],
) -> str:
    """User-visible caveat when CB Agent is not Claude Code / artifacts missing."""
    bits: List[str] = []
    if asked_for_claude_code and spawns:
        bits.append(
            "说明：你点名要用 Claude Code 做 subagent，但当前会话引擎是 CodeBuddy；"
            "刚才起的是 CodeBuddy 自带的 Agent 队友，并不是 Claude Code CLI。"
            "若必须用 Claude Code，请先把执行引擎切到 claude-code 再派发。"
        )
    if spawns and await_info is not None and not await_info.get("ready"):
        names = ", ".join(s.name or s.task_id or s.agent_id for s in spawns) or "Agent"
        missing = await_info.get("expected_paths") or []
        bits.append(
            f"说明：CodeBuddy Agent（{names}）已返回 Spawned successfully，"
            f"但在等待后仍未看到约定产物"
            + (f"（{'、'.join(missing[:4])}）" if missing else "")
            + "。队友可能已卡住或随父回合结束停住；Near 任务栏不会把它们显示成 Claude Code 子代理。"
        )
    if not bits:
        return ""
    return "\n\n---\n" + "\n".join(bits)


def codebuddy_cc_subagent_guard_prefix(user_text: str) -> str:
    """Prefix injected into the CB user turn when they ask for Claude Code subagents."""
    if not user_asked_for_claude_code_subagents(user_text):
        return ""
    return (
        "[NEAR HARNESS NOTE — NON-EXECUTABLE]\n"
        "The user asked to use Claude Code (claude-code) as subagents.\n"
        "CodeBuddy's `Agent` tool spawns CodeBuddy teammates, NOT Claude Code CLI.\n"
        "Do NOT claim Claude Code subagents started. Either:\n"
        "1) Tell the user to switch the Near harness to claude-code / agenticx, or\n"
        "2) Clearly label that you are using CodeBuddy Agent teammates instead, "
        "and do not say Claude Code was launched.\n"
        "===== USER MESSAGE =====\n"
    )
