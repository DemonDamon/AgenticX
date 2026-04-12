#!/usr/bin/env python3
"""AgentRuntime core loop with structured event stream.

Author: Damon Li
"""

from __future__ import annotations

import json
import asyncio
import hashlib
import inspect
import logging
import os
import re
from pathlib import Path
import threading
import time
import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional, Sequence

from agenticx.cli.agent_tools import STUDIO_TOOLS, dispatch_tool_async
from agenticx.cli.studio_mcp import build_mcp_tools_context
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.runtime.compactor import ContextCompactor
from agenticx.runtime.tool_orchestrator import partition_tool_calls
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.hooks import HookRegistry
from agenticx.runtime.loop_detector import LoopDetector
from agenticx.runtime.llm_retry import LLMRetryPolicy, _classify_error
from agenticx.runtime.token_budget import BudgetLevel, TokenBudgetGuard
from agenticx.runtime.usage_metadata import usage_metadata_from_llm_response

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any


MAX_TOOL_ROUNDS = 10


def _session_disk_dir(session: Any) -> Optional[Path]:
    sid = getattr(session, "_session_id", None) or getattr(session, "_owner_session_id", None)
    text = str(sid or "").strip()
    if not text:
        return None
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    return Path.home() / ".agenticx" / "sessions" / safe


def _env_int_runtime(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return default


def _maybe_persist_large_tool_result(
    session: Any,
    tool_call_id: str,
    tool_name: str,
    result: str,
) -> str:
    threshold = _env_int_runtime("AGX_TOOL_RESULT_PERSIST_THRESHOLD", 8000)
    text = str(result or "")
    if len(text) <= threshold:
        return text
    base = _session_disk_dir(session)
    if base is None:
        return text
    sub = base / "tool-results"
    try:
        sub.mkdir(parents=True, exist_ok=True)
    except OSError:
        return text
    safe_id = re.sub(r"[^a-zA-Z0-9_.-]+", "_", tool_call_id).strip("_") or uuid.uuid4().hex[:12]
    out_path = sub / f"{safe_id}.txt"
    try:
        out_path.write_text(text, encoding="utf-8")
    except OSError:
        return text
    preview = text[:2000]
    return (
        f"[Tool result persisted to disk: {out_path}]\n"
        f"{preview}\n"
        f"... ({len(text)} chars total, see file for full content)"
    )


def _parallel_tools_enabled() -> bool:
    """Check whether parallel tool dispatch is enabled.

    Reads from ``AGX_PARALLEL_TOOLS`` env var or ``runtime.parallel_tools``
    in ``config.yaml``.
    """
    env = os.environ.get("AGX_PARALLEL_TOOLS", "")
    if env == "1":
        return True
    if env == "0":
        return False
    try:
        from agenticx.cli.config_manager import ConfigManager
        val = ConfigManager.get_value("runtime.parallel_tools")
        return bool(val)
    except Exception:
        return False
MAX_CONTEXT_CHARS = 16_000
STOP_MESSAGE = "已中断当前生成"
DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS = 120.0
PROVIDER_INVOKE_TIMEOUT_SECONDS: Dict[str, float] = {
    # Some providers/models (especially tool-heavy rounds) often need longer first-token latency.
    "volcengine": 180.0,
    "bailian": 180.0,
    "zhipu": 150.0,
}
MODEL_INVOKE_TIMEOUT_SECONDS: Dict[str, float] = {
    # Heavy reasoning + tool planning models usually need longer invoke windows.
    "glm-5": 180.0,
    "doubao-seed-2-0-pro-260215": 180.0,
}
DEFAULT_LLM_FIRST_FEEDBACK_SECONDS = 8.0
PROVIDER_FIRST_FEEDBACK_SECONDS: Dict[str, float] = {
    "volcengine": 12.0,
    "bailian": 12.0,
    "zhipu": 10.0,
}
DEFAULT_STATUS_QUERY_BUDGET_PER_TURN = 2
DEFAULT_STATUS_QUERY_COOLDOWN_SECONDS = 8.0
DEFAULT_LLM_HEARTBEAT_TIMEOUT_SECONDS = 60.0
DEFAULT_LLM_HARD_TIMEOUT_SECONDS = 300.0
logger = logging.getLogger(__name__)


def _truncate(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... (truncated, total {len(text)} chars)"


def _resolve_meta_tool_dispatchers():
    """Resolve meta-only dispatchers lazily to avoid import cycles."""
    from agenticx.runtime.meta_tools import _meta_only_names, dispatch_meta_tool_async

    return _meta_only_names, dispatch_meta_tool_async


def _resolve_llm_invoke_timeout_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_INVOKE_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_invoke_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    model_name = str(getattr(session, "model_name", "") or "").strip().lower()
    if model_name and model_name in MODEL_INVOKE_TIMEOUT_SECONDS:
        return MODEL_INVOKE_TIMEOUT_SECONDS[model_name]
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_INVOKE_TIMEOUT_SECONDS:
        return PROVIDER_INVOKE_TIMEOUT_SECONDS[provider_name]
    return DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS


def _resolve_llm_first_feedback_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_FIRST_FEEDBACK_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    provider_name = str(getattr(session, "provider_name", "") or "").strip().lower()
    if provider_name and provider_name in PROVIDER_FIRST_FEEDBACK_SECONDS:
        return PROVIDER_FIRST_FEEDBACK_SECONDS[provider_name]
    return DEFAULT_LLM_FIRST_FEEDBACK_SECONDS


def _resolve_status_query_budget_per_turn() -> int:
    env_raw = os.getenv("AGX_STATUS_QUERY_BUDGET_PER_TURN", "").strip()
    if env_raw:
        try:
            value = int(env_raw)
            if value >= 1:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.status_query_budget_per_turn")
        if cfg_value is not None:
            value = int(cfg_value)
            if value >= 1:
                return value
    except Exception:
        pass
    return DEFAULT_STATUS_QUERY_BUDGET_PER_TURN


def _resolve_status_query_cooldown_seconds() -> float:
    env_raw = os.getenv("AGX_STATUS_QUERY_COOLDOWN_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value >= 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.status_query_cooldown_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value >= 0:
                return value
    except Exception:
        pass
    return DEFAULT_STATUS_QUERY_COOLDOWN_SECONDS


def _resolve_llm_heartbeat_timeout_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_heartbeat_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    return DEFAULT_LLM_HEARTBEAT_TIMEOUT_SECONDS


def _resolve_llm_hard_timeout_seconds(session: StudioSession) -> float:
    env_raw = os.getenv("AGX_LLM_HARD_TIMEOUT_SECONDS", "").strip()
    if env_raw:
        try:
            value = float(env_raw)
            if value > 0:
                return value
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg_value = ConfigManager.get_value("runtime.llm_hard_timeout_seconds")
        if cfg_value is not None:
            value = float(cfg_value)
            if value > 0:
                return value
    except Exception:
        pass
    return DEFAULT_LLM_HARD_TIMEOUT_SECONDS


def _repair_streamed_tool_arguments(raw: str) -> Dict[str, Any]:
    def _sanitize_parsed_args(parsed: Dict[str, Any]) -> Dict[str, Any]:
        # Drop leaked streamed metadata keys/values such as call_xxx / sa-xxxx
        # before tool dispatch.
        cleaned: Dict[str, Any] = {}
        for key, value in parsed.items():
            key_text = str(key).strip()
            val_text = str(value).strip() if value is not None else ""
            if re.fullmatch(r"call_[A-Za-z0-9]+", key_text):
                continue
            if re.fullmatch(r"(call_[A-Za-z0-9]+|sa-[a-z0-9]+)", val_text):
                continue
            cleaned[key] = value
        return cleaned

    text = (raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return _sanitize_parsed_args(parsed) if isinstance(parsed, dict) else {}
    except Exception:
        pass
    lpos = text.find("{")
    rpos = text.rfind("}")
    if lpos >= 0 and rpos > lpos:
        try:
            parsed = json.loads(text[lpos : rpos + 1])
            return _sanitize_parsed_args(parsed) if isinstance(parsed, dict) else {}
        except Exception:
            pass
    return {}


def _serialize_artifacts(session: StudioSession) -> str:
    if not session.artifacts:
        return "(empty)"
    parts: List[str] = []
    for path, content in session.artifacts.items():
        parts.append(f"--- {path} ---\n{_truncate(content, 4000)}")
    return "\n\n".join(parts)


def _serialize_context_files(session: StudioSession) -> str:
    if not session.context_files:
        return "(empty)"
    parts: List[str] = []
    for fpath, content in session.context_files.items():
        parts.append(f"--- {fpath} ---\n{_truncate(content, 4000)}")
    return "\n\n".join(parts)


def _serialize_skill_summaries(session: StudioSession) -> str:
    try:
        bound = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
        summaries = get_all_skill_summaries(bound_avatar_id=bound)
    except Exception:
        summaries = []
    if not summaries:
        return "(no skills discovered)"
    return "\n".join(f"- {item['name']}: {item['description']}" for item in summaries[:120])


def _serialize_todos(session: StudioSession) -> str:
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is None:
        return "No todos."
    try:
        return str(todo_manager.render())
    except Exception:
        return "No todos."


def _serialize_scratchpad(session: StudioSession) -> str:
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict) or not scratchpad:
        return "(empty)"
    lines: List[str] = []
    for key in sorted(scratchpad.keys()):
        value = str(scratchpad.get(key, ""))
        preview = value if len(value) <= 200 else value[:200] + "..."
        lines.append(f"- {key}: {preview.replace(chr(10), ' ')}")
    return "\n".join(lines)


def _build_agent_system_prompt(session: StudioSession) -> str:
    mcp_context = ""
    if session.mcp_hub is not None:
        mcp_context = build_mcp_tools_context(session.mcp_hub)
    if not mcp_context:
        mcp_context = "(no MCP tools connected)"

    return (
        "你是 AgenticX Studio 的执行型 Agent（implement 角色）。\n"
        "核心目标：根据用户请求完成代码/命令操作，并在不确定或高风险动作前主动确认。\n\n"
        "## 回复语言\n"
        "- 必须使用中文回复。\n"
        "- 简洁、可执行、优先给出当前进度。\n\n"
        "## 可用元 Skills 摘要\n"
        f"{_serialize_skill_summaries(session)}\n\n"
        "## 当前会话 artifacts\n"
        f"{_serialize_artifacts(session)}\n\n"
        "## 当前 Todo 列表\n"
        f"{_serialize_todos(session)}\n\n"
        "## 当前 Scratchpad 摘要\n"
        f"{_serialize_scratchpad(session)}\n\n"
        "## 当前 context_files\n"
        f"{_serialize_context_files(session)}\n\n"
        "## 当前 MCP 工具上下文\n"
        f"{_truncate(mcp_context, 6000)}\n\n"
        "## 浏览器自动化（browser-use 等 MCP）\n"
        "- MCP 工具**不会**自动变成单独的 function；须先用 `mcp_connect` 连接配置好的服务器（如 `browser-use`），再用 `mcp_call` 调用，"
        "`tool_name` / `arguments` 与上方「当前 MCP 工具上下文」中的名称和 schema 一致。\n"
        "- 用户给出「打开某网站、点击、登录、点赞」等**可执行**目标时：优先 `mcp_call` 调用 "
        "`retry_with_browser_use_agent`，在 `arguments.task` 中写清站点、步骤与成功标准；"
        "应用 `allowed_domains` 限制域名以降低风险。需要逐步可见过程时，可改用 `browser_navigate`、"
        "`browser_get_state`、`browser_click` 等低层工具分步执行。\n"
        "- 未连接 MCP 或缺少对应工具时，说明如何配置（如 `~/.agenticx/mcp.json`），不要假装已执行浏览器操作。\n\n"
        "## 安全与确认规则（必须遵守）\n"
        "- bash_exec 仅对白名单命令自动执行；非白名单命令必须先征得用户确认。\n"
        "- file_write 与 file_edit 必须先展示 unified diff，再征得用户确认。\n"
        "- 当信息不足或需求含糊时，直接以文字回复追问用户，不要调用工具。\n"
        "- 多步骤任务优先使用 todo_write 跟踪进度，保持只有一个 in_progress。\n"
        "- 对中间结果优先写入 scratchpad_write，后续步骤先 scratchpad_read 复用。\n"
        "- 优先最小改动，避免无关重构。\n"
    )


def _parse_tool_arguments(raw_args: Any) -> Dict[str, Any]:
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str):
        stripped = raw_args.strip()
        if not stripped:
            return {}
        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def _summarize_tool_calls_for_history(tool_calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only stable fields to avoid leaking runtime metadata ids into model context."""
    summarized: List[Dict[str, Any]] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        function_obj = call.get("function", {}) if isinstance(call.get("function"), dict) else {}
        name = str(function_obj.get("name", "")).strip()
        arguments = function_obj.get("arguments")
        if isinstance(arguments, str):
            parsed_args = _parse_tool_arguments(arguments)
        elif isinstance(arguments, dict):
            parsed_args = arguments
        else:
            parsed_args = {}
        summarized.append({"name": name, "arguments": parsed_args})
    return summarized


def _sanitize_context_messages(messages: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Repair history to satisfy strict tool-call pairing providers.

    Rules:
    - Keep tool messages only when their tool_call_id is declared by some assistant tool_calls.
    - Keep assistant tool_calls only when each call id has a corresponding tool response in history.
      Unmatched calls are removed from that assistant message.
    """
    sanitized: List[Dict[str, Any]] = []
    idx = 0
    total = len(messages)

    while idx < total:
        msg = messages[idx]
        role = str(msg.get("role", ""))

        if role != "assistant":
            # Tool messages are only valid as contiguous responses immediately
            # following an assistant tool_calls message. Standalone tool rows are dropped.
            if role != "tool":
                sanitized.append(msg)
            idx += 1
            continue

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            sanitized.append(msg)
            idx += 1
            continue

        expected_ids: set[str] = set()
        call_map: Dict[str, Dict[str, Any]] = {}
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if not cid:
                continue
            expected_ids.add(cid)
            call_map[cid] = call

        # Collect contiguous tool responses right after this assistant turn.
        j = idx + 1
        contiguous_tool_rows: List[Dict[str, Any]] = []
        responded_ids: set[str] = set()
        while j < total:
            next_msg = messages[j]
            if str(next_msg.get("role", "")) != "tool":
                break
            cid = str(next_msg.get("tool_call_id", "")).strip()
            if cid and cid in expected_ids:
                contiguous_tool_rows.append(next_msg)
                responded_ids.add(cid)
            j += 1

        kept_calls: List[Dict[str, Any]] = []
        for call in tool_calls:
            if not isinstance(call, dict):
                continue
            cid = str(call.get("id", "")).strip()
            if cid and cid in responded_ids and cid in call_map:
                kept_calls.append(call_map[cid])
        if kept_calls:
            msg_copy = dict(msg)
            msg_copy["tool_calls"] = kept_calls
            sanitized.append(msg_copy)
            sanitized.extend(contiguous_tool_rows)
        else:
            # Remove dangling tool_calls but keep assistant content text.
            msg_copy = dict(msg)
            msg_copy.pop("tool_calls", None)
            sanitized.append(msg_copy)

        # Skip contiguous tool block, whether kept or dropped.
        idx = j

    return sanitized


def _iter_text_chunks(text: str, chunk_size: int = 16) -> List[str]:
    if chunk_size <= 0:
        chunk_size = 16
    return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]


def _is_minimax_chat_setting_error(error: Exception) -> bool:
    """Return True when MiniMax rejects request chat settings."""
    text = str(error or "").lower()
    return (
        "invalid chat setting" in text
        or "invalid params" in text and "(2013)" in text
    )


def _merge_consecutive_simple_roles_for_minimax(
    messages: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Merge adjacent system/user rows for MiniMax OpenAI-compatible API.

    MiniMax returns error 2013 (invalid chat setting) when the same role
    appears on consecutive messages (e.g. main system prompt + [compacted]
    system block from ContextCompactor). Tool-call turns are left unchanged.
    """
    merge_roles = frozenset({"system", "user"})
    out: List[Dict[str, Any]] = []
    for msg in messages:
        m = dict(msg)
        role = str(m.get("role", ""))
        if m.get("tool_calls"):
            out.append(m)
            continue
        if role not in merge_roles:
            out.append(m)
            continue
        if (
            out
            and str(out[-1].get("role", "")) == role
            and not out[-1].get("tool_calls")
        ):
            prev = out[-1]
            prev["content"] = (
                str(prev.get("content", "")) + "\n\n" + str(m.get("content", ""))
            ).strip()
        else:
            out.append(m)
    return out


def _extract_inline_tool_call(
    text: str, allowed_tool_names: set[str]
) -> Optional[Dict[str, Any]]:
    """
    Parse tool-like text (e.g. <tool_code>check_resources()</tool_code>)
    and convert it to one synthetic tool call payload.
    """
    if not text:
        return None
    snippet = text
    tag_block = re.search(r"<tool_code>\s*(.*?)\s*</tool_code>", text, re.S)
    if tag_block:
        snippet = tag_block.group(1).strip()

    # Find the first allowed tool call anywhere in the snippet.
    # This supports wrappers such as print(check_resources()).
    tool_name: Optional[str] = None
    raw_args = ""
    for name in sorted(allowed_tool_names, key=len, reverse=True):
        match = re.search(rf"\b{re.escape(name)}\s*\((.*?)\)", snippet, re.S)
        if match:
            tool_name = name
            raw_args = (match.group(1) or "").strip()
            break
    if not tool_name:
        return None

    if not raw_args:
        args_obj: Dict[str, Any] = {}
    else:
        # Allow JSON object in parentheses: foo({"a":1})
        try:
            parsed = json.loads(raw_args)
            args_obj = parsed if isinstance(parsed, dict) else {}
        except Exception:
            args_obj = {}
    return {"name": tool_name, "arguments": args_obj}


def _build_progress_signature(session: StudioSession) -> str:
    artifacts = getattr(session, "artifacts", {}) or {}
    artifact_entries = []
    for key, value in artifacts.items():
        sval = str(value)
        digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
        artifact_entries.append({"path": str(key), "len": len(sval), "hash": digest})
    artifact_entries.sort(key=lambda item: item["path"])
    scratchpad = getattr(session, "scratchpad", {}) or {}
    scratch_entries = []
    if isinstance(scratchpad, dict):
        for key, value in scratchpad.items():
            sval = str(value)
            digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
            scratch_entries.append({"key": str(key), "len": len(sval), "hash": digest})
    scratch_entries.sort(key=lambda item: item["key"])
    todo_payload: List[Dict[str, Any]] = []
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is not None:
        try:
            todo_payload = list(todo_manager.to_payload())
        except Exception:
            todo_payload = []
    context_entries = []
    context_files = getattr(session, "context_files", {}) or {}
    if isinstance(context_files, dict):
        for key, value in context_files.items():
            sval = str(value)
            digest = hashlib.sha1(sval.encode("utf-8")).hexdigest()[:12] if sval else ""
            context_entries.append({"path": str(key), "len": len(sval), "hash": digest})
    context_entries.sort(key=lambda item: item["path"])
    raw = json.dumps(
        {
            "artifacts": artifact_entries,
            "scratchpad": scratch_entries,
            "todos": todo_payload,
            "context_files": context_entries,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


_CONFIRMATION_SPAM_KEYWORDS = frozenset(
    {"TODO", "FINAL", "COMPLETED", "ULTIMATE", "ABSOLUTE", "REPORT", "SUMMARY"}
)


def _confirmation_spam_score_for_path(path: str) -> int:
    """Count keyword hits in basename; 2+ suggests meta/status filename spam."""
    if not path:
        return 0
    basename = os.path.basename(path).upper()
    return sum(1 for kw in _CONFIRMATION_SPAM_KEYWORDS if kw in basename)


def _extract_written_paths_from_result(result: str) -> List[str]:
    if not isinstance(result, str) or not result:
        return []
    paths: List[str] = []
    for raw_line in result.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = re.match(r"^OK:\s*(?:wrote|edited)\s+(.+?)(?:\s+\(\d+\s+chars\))?$", line)
        if not match:
            continue
        path = str(match.group(1) or "").strip()
        if path:
            paths.append(path)
    return paths


def _resolve_mid_turn_persist_interval() -> float:
    """Seconds between mid-turn incremental persists (0 to disable)."""
    raw = os.environ.get("AGX_MID_TURN_PERSIST_INTERVAL_SEC", "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return 30.0


def _resolve_mid_turn_persist_tool_count() -> int:
    """Number of tool calls between mid-turn persists (0 to disable)."""
    raw = os.environ.get("AGX_MID_TURN_PERSIST_TOOL_COUNT", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 3


class AgentRuntime:
    """LLM-driven runtime that emits structured events."""

    def __init__(
        self,
        llm: Any,
        confirm_gate: ConfirmGate,
        *,
        max_tool_rounds: int = MAX_TOOL_ROUNDS,
        loop_warning_threshold: int = 4,
        loop_critical_threshold: int = 8,
        hooks: Optional[HookRegistry] = None,
        team_manager: Optional[Any] = None,
        mid_turn_persist: Optional[Callable[[], None]] = None,
    ) -> None:
        self.llm = llm
        self.confirm_gate = confirm_gate
        self.max_tool_rounds = max_tool_rounds
        self.hooks = hooks or HookRegistry()
        self.compactor = ContextCompactor(llm)
        self.loop_detector = LoopDetector(
            warning_threshold=loop_warning_threshold,
            critical_threshold=loop_critical_threshold,
        )
        self.team_manager = team_manager
        self.token_budget = TokenBudgetGuard()
        self._mid_turn_persist = mid_turn_persist
        self._persist_interval_sec = _resolve_mid_turn_persist_interval()
        self._persist_tool_count = _resolve_mid_turn_persist_tool_count()
        self._last_persist_time: float = 0.0
        self._tools_since_persist: int = 0
        try:
            from agenticx.runtime.hooks.legacy_event_bridge_hook import LegacyEventBridgeHook

            # Bridge AgentRuntime events to global HookEvent handlers (bundled/imported hooks).
            self.hooks.register(LegacyEventBridgeHook(), priority=100)
        except Exception:
            pass
        try:
            from agenticx.runtime.hooks.memory_hook import MemoryHook
            self.hooks.register(MemoryHook(), priority=-10)
        except Exception:
            pass
        try:
            from agenticx.runtime.hooks.session_summary_hook import SessionSummaryHook
            self.hooks.register(SessionSummaryHook(), priority=-20)
        except Exception:
            pass
        try:
            from agenticx.learning.observer import ObservationHook
            self.hooks.register(ObservationHook(), priority=-30)
        except Exception:
            pass

    def _maybe_mid_turn_persist(self) -> None:
        """Fire incremental persist if interval or tool-count thresholds are met."""
        if self._mid_turn_persist is None:
            return
        now = time.time()
        interval_ok = (
            self._persist_interval_sec > 0
            and (now - self._last_persist_time) >= self._persist_interval_sec
        )
        count_ok = (
            self._persist_tool_count > 0
            and self._tools_since_persist >= self._persist_tool_count
        )
        if interval_ok or count_ok:
            try:
                self._mid_turn_persist()
            except Exception:
                pass
            self._last_persist_time = now
            self._tools_since_persist = 0

    async def run_turn(
        self,
        user_input: str,
        session: StudioSession,
        should_stop: Optional[Callable[[], bool | Awaitable[bool]]] = None,
        *,
        agent_id: str = "meta",
        tools: Optional[Sequence[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
        user_message_content: Optional[Any] = None,
        history_user_attachments: Optional[list[dict[str, Any]]] = None,
        persist_user_message: bool = True,
    ) -> AsyncGenerator[RuntimeEvent, None]:
        async def _check_should_stop() -> bool:
            if should_stop is None:
                return False
            try:
                result = should_stop()
                if inspect.isawaitable(result):
                    return bool(await result)
                return bool(result)
            except Exception:
                return False

        self.token_budget.reset_turn()
        self._last_persist_time = time.time()
        self._tools_since_persist = 0

        current_system_prompt = system_prompt or _build_agent_system_prompt(session)
        active_tools: Sequence[Dict[str, Any]] = STUDIO_TOOLS if tools is None else tools
        allowed_tool_names = {
            str(tool.get("function", {}).get("name", "")).strip()
            for tool in active_tools
            if isinstance(tool, dict)
        }
        history = _sanitize_context_messages(session.agent_messages)
        compact_model = str(getattr(session, "model_name", "") or "")
        compacted_history, did_compact, compact_summary, compacted_count = await self.compactor.maybe_compact(
            history,
            model=compact_model,
        )
        messages: List[Dict[str, Any]] = [{"role": "system", "content": current_system_prompt}]
        messages.extend(compacted_history)
        if did_compact:
            yield RuntimeEvent(
                type=EventType.COMPACTION.value,
                data={
                    "compacted_count": compacted_count,
                    "summary": compact_summary,
                },
                agent_id=agent_id,
            )
            await self.hooks.run_on_compaction(compacted_count, compact_summary, session)
        _is_system_trigger = user_input.startswith("[系统通知]")
        user_content: Any = user_message_content if user_message_content is not None else user_input
        messages.append({"role": "user", "content": user_content})
        if persist_user_message:
            session.agent_messages.append({"role": "user", "content": user_input})
        await self.hooks.run_on_agent_start(session, agent_id, user_input)
        synced_session_message_count = len(session.agent_messages)
        if persist_user_message and not _is_system_trigger:
            hist_user: dict[str, Any] = {"role": "user", "content": user_input}
            if history_user_attachments:
                hist_user["attachments"] = list(history_user_attachments)
            session.chat_history.append(hist_user)
        status_query_total = 0
        status_query_attempts_total = 0
        max_status_queries_per_turn = _resolve_status_query_budget_per_turn()
        min_status_query_interval_sec = _resolve_status_query_cooldown_seconds()
        last_status_query_at = 0.0
        last_status_query_signature: Optional[str] = None
        repeated_status_query_count = 0
        last_status_query_had_rows = False
        executed_tool_names: List[str] = []
        disk_write_paths: set[str] = set()
        write_path_counts: Dict[str, int] = {}
        confirmation_spam_count = 0
        rounds_without_todo = 0
        invoke_timeout_seconds = _resolve_llm_invoke_timeout_seconds(session)
        heartbeat_timeout_seconds = _resolve_llm_heartbeat_timeout_seconds(session)
        hard_timeout_seconds = _resolve_llm_hard_timeout_seconds(session)
        request_timeout_seconds = max(
            invoke_timeout_seconds,
            heartbeat_timeout_seconds,
            hard_timeout_seconds,
        ) + 15.0
        first_feedback_seconds = _resolve_llm_first_feedback_seconds(session)
        provider_name = str(getattr(session, "provider_name", "") or "").strip()
        model_name = str(getattr(session, "model_name", "") or "").strip()

        for round_idx in range(1, self.max_tool_rounds + 1):
            if await _check_should_stop():
                yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                return
            yield RuntimeEvent(
                type=EventType.ROUND_START.value,
                data={"round": round_idx, "max_rounds": self.max_tool_rounds},
                agent_id=agent_id,
            )
            if agent_id != "meta" and round_idx > 1 and (round_idx - 1) % 8 == 0:
                checkpoint = {
                    "agent_id": agent_id,
                    "round": round_idx - 1,
                    "max_rounds": self.max_tool_rounds,
                    "executed_tools": list(dict.fromkeys(executed_tool_names))[-10:],
                    "artifact_count": len(session.artifacts),
                    "text": f"已执行至第 {round_idx - 1} 轮，准备继续。",
                }
                yield RuntimeEvent(
                    type=EventType.SUBAGENT_CHECKPOINT.value,
                    data=checkpoint,
                    agent_id=agent_id,
                )
                recent_tools = (
                    executed_tool_names[-32:]
                    if len(executed_tool_names) > 32
                    else list(executed_tool_names)
                )
                file_write_heavy = sum(1 for n in recent_tools if n in ("file_write", "file_edit"))
                unique_recent = set(recent_tools)
                is_stalling = file_write_heavy > 5 and len(unique_recent) <= 2
                if is_stalling and recent_tools:
                    task_hint = str(user_input or "")[:800]
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"<checkpoint round={round_idx - 1}>"
                                f"WARNING: {file_write_heavy} of your last {len(recent_tools)} tool calls "
                                "were file writes/edits. You appear to be creating status/confirmation files "
                                "instead of performing the actual task. STOP creating files and focus on "
                                f"your delegated_task: {task_hint}. "
                                "If the task is done, output your final answer as text."
                                "</checkpoint>"
                            ),
                        },
                    )
            if len(session.agent_messages) > synced_session_message_count:
                messages.extend(
                    _sanitize_context_messages(session.agent_messages[synced_session_message_count:])
                )
                synced_session_message_count = len(session.agent_messages)
            if rounds_without_todo > 10:
                messages.append(
                    {
                        "role": "user",
                        "content": "<reminder>10+ rounds without todo_write. Please update todo list.</reminder>",
                    }
                )
            try:
                messages = await self.hooks.run_before_model(messages, session)
                messages = _sanitize_context_messages(messages)
                if provider_name.strip().lower() == "minimax":
                    messages = _merge_consecutive_simple_roles_for_minimax(messages)
                response_text = ""
                tool_calls: List[Dict[str, Any]] = []
                response: Any
                stream_with_tools = getattr(self.llm, "stream_with_tools", None)
                used_stream_path = False
                if callable(stream_with_tools):
                    try:
                        token_queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()
                        loop = asyncio.get_running_loop()
                        stop_stream = threading.Event()

                        def _queue_put(payload: Dict[str, Any] | None) -> None:
                            loop.call_soon_threadsafe(token_queue.put_nowait, payload)

                        def _run_sync_stream_with_tools() -> None:
                            try:
                                stream_kwargs: Dict[str, Any] = {
                                    "tools": list(active_tools),
                                    "tool_choice": "auto",
                                    "temperature": 0.2,
                                    "max_tokens": 8192,
                                    "timeout": request_timeout_seconds,
                                }
                                # MiniMax occasionally rejects advanced chat settings (error 2013).
                                # Start streaming with conservative parameters to reduce hard failures.
                                if provider_name.strip().lower() == "minimax":
                                    stream_kwargs.pop("tool_choice", None)
                                    stream_kwargs.pop("temperature", None)
                                    stream_kwargs["max_tokens"] = 4096
                                for chunk in stream_with_tools(
                                    messages,
                                    **stream_kwargs,
                                ):
                                    if stop_stream.is_set():
                                        break
                                    if isinstance(chunk, dict):
                                        _queue_put(dict(chunk))
                            except Exception as exc:
                                _queue_put(
                                    {"type": "stream_error", "error": str(exc)}
                                )
                            finally:
                                _queue_put(None)

                        stream_task = loop.run_in_executor(
                            None, _run_sync_stream_with_tools
                        )
                        stream_started_at = loop.time()
                        first_chunk_at = 0.0
                        last_chunk_at = 0.0
                        waiting_hint_emitted = False
                        last_pulse_at = stream_started_at
                        tool_calls_acc: Dict[int, Dict[str, str]] = {}
                        stream_usage: Dict[str, int] = {}
                        def _safe_int(value: Any) -> int:
                            if isinstance(value, bool):
                                return int(value)
                            if isinstance(value, (int, float)):
                                return int(value)
                            if isinstance(value, str):
                                raw = value.strip()
                                if not raw:
                                    return 0
                                try:
                                    return int(raw)
                                except ValueError:
                                    try:
                                        return int(float(raw))
                                    except ValueError:
                                        return 0
                            return 0
                        while True:
                            if await _check_should_stop():
                                stop_stream.set()
                                yield RuntimeEvent(
                                    type=EventType.ERROR.value,
                                    data={"text": STOP_MESSAGE},
                                    agent_id=agent_id,
                                )
                                return
                            now = loop.time()
                            elapsed = now - stream_started_at
                            if (not waiting_hint_emitted) and elapsed >= first_feedback_seconds:
                                waiting_hint_emitted = True
                                last_pulse_at = now
                                yield RuntimeEvent(
                                    type=EventType.TOKEN.value,
                                    data={"text": "⏳"},
                                    agent_id=agent_id,
                                )
                            if elapsed >= hard_timeout_seconds:
                                stop_stream.set()
                                raise asyncio.TimeoutError()
                            idle_limit = (
                                invoke_timeout_seconds
                                if first_chunk_at <= 0
                                else heartbeat_timeout_seconds
                            )
                            idle_anchor = stream_started_at if first_chunk_at <= 0 else last_chunk_at
                            if (now - idle_anchor) >= idle_limit:
                                stop_stream.set()
                                raise asyncio.TimeoutError()
                            try:
                                stream_chunk = await asyncio.wait_for(
                                    token_queue.get(), timeout=0.1
                                )
                            except asyncio.TimeoutError:
                                if stream_task.done():
                                    break
                                continue
                            if stream_chunk is None:
                                break
                            chunk_type = str(stream_chunk.get("type", "")).strip()
                            if chunk_type == "stream_error":
                                raise RuntimeError(
                                    str(stream_chunk.get("error", "stream error"))
                                )
                            if first_chunk_at <= 0:
                                first_chunk_at = now
                            last_chunk_at = now
                            if chunk_type == "content":
                                tok = str(stream_chunk.get("text", ""))
                                if tok:
                                    response_text += tok
                                    yield RuntimeEvent(
                                        type=EventType.TOKEN.value,
                                        data={"text": tok},
                                        agent_id=agent_id,
                                    )
                            elif chunk_type == "usage":
                                usage_raw = stream_chunk.get("usage", {})
                                if isinstance(usage_raw, dict):
                                    pt = _safe_int(
                                        usage_raw.get("prompt_tokens") or usage_raw.get("input_tokens") or 0
                                    )
                                    ct = _safe_int(
                                        usage_raw.get("completion_tokens")
                                        or usage_raw.get("output_tokens")
                                        or 0
                                    )
                                    tt = _safe_int(usage_raw.get("total_tokens") or 0)
                                    if tt == 0 and (pt > 0 or ct > 0):
                                        tt = pt + ct
                                    if pt > 0 or ct > 0 or tt > 0:
                                        stream_usage = {
                                            "prompt_tokens": pt,
                                            "completion_tokens": ct,
                                            "total_tokens": tt,
                                        }
                            elif chunk_type == "tool_call_delta":
                                raw_idx = stream_chunk.get("tool_index", 0)
                                idx = raw_idx if isinstance(raw_idx, int) else 0
                                acc = tool_calls_acc.setdefault(
                                    idx, {"id": "", "name": "", "arguments": ""}
                                )
                                raw_tc_id = stream_chunk.get("tool_call_id", "")
                                tool_call_id = str(raw_tc_id).strip() if isinstance(raw_tc_id, str) else ""
                                raw_tn = stream_chunk.get("tool_name", "")
                                tool_name = str(raw_tn).strip() if isinstance(raw_tn, str) and raw_tn is not None else ""
                                if tool_name.lower() == "none":
                                    tool_name = ""
                                args_delta = str(stream_chunk.get("arguments_delta", ""))
                                if tool_call_id:
                                    acc["id"] = tool_call_id
                                if tool_name:
                                    acc["name"] = tool_name
                                if args_delta:
                                    acc["arguments"] += args_delta
                        await stream_task
                        for idx in sorted(tool_calls_acc.keys()):
                            item = tool_calls_acc[idx]
                            accumulated_name = (item.get("name") or "").strip()
                            if not accumulated_name or accumulated_name.lower() == "none":
                                logger.warning(
                                    "Dropping streamed tool_call at index %d with empty/invalid name",
                                    idx,
                                )
                                continue
                            args_obj = _repair_streamed_tool_arguments(item.get("arguments", ""))
                            tool_calls.append(
                                {
                                    "id": item.get("id") or f"stream-{uuid.uuid4().hex[:8]}",
                                    "type": "function",
                                    "function": {
                                        "name": accumulated_name,
                                        "arguments": json.dumps(args_obj, ensure_ascii=False),
                                    },
                                }
                            )
                        response = type(
                            "StreamResponse",
                            (),
                            {"content": response_text, "tool_calls": tool_calls, "usage": stream_usage},
                        )()
                        used_stream_path = True
                    except Exception:
                        logger.warning(
                            "stream_with_tools failed, fallback to invoke path",
                            exc_info=True,
                        )
                        used_stream_path = False
                    finally:
                        stop_stream.set()
                        if "stream_task" in locals() and stream_task is not None:
                            try:
                                await asyncio.wait_for(asyncio.shield(stream_task), timeout=1.0)
                            except Exception:
                                pass
                if not used_stream_path:
                    def _invoke_once_with_fallback() -> Any:
                        try:
                            return self.llm.invoke(
                                messages,
                                tools=active_tools,
                                tool_choice="auto",
                                temperature=0.2,
                                max_tokens=8192,
                                timeout=request_timeout_seconds,
                            )
                        except Exception as invoke_exc:
                            provider_lower = provider_name.strip().lower()
                            if provider_lower == "minimax" and _is_minimax_chat_setting_error(invoke_exc):
                                logger.warning(
                                    "MiniMax rejected chat settings; retrying invoke with conservative params",
                                    exc_info=True,
                                )
                                minimax_retries = [
                                    # Keep tools, but remove advanced settings and lower token budget.
                                    {
                                        "tools": active_tools,
                                        "max_tokens": 4096,
                                        "timeout": request_timeout_seconds,
                                    },
                                    # Some accounts reject max_tokens + tool_choice combos in edge cases.
                                    {
                                        "tools": active_tools,
                                        "timeout": request_timeout_seconds,
                                    },
                                ]
                                last_exc: Exception = invoke_exc
                                for retry_kwargs in minimax_retries:
                                    try:
                                        return self.llm.invoke(messages, **retry_kwargs)
                                    except Exception as retry_exc:
                                        last_exc = retry_exc
                                        if not _is_minimax_chat_setting_error(retry_exc):
                                            raise
                                raise last_exc
                            raise

                    _retry_policy = LLMRetryPolicy()

                    def _invoke_with_retry() -> Any:
                        return _retry_policy.call_sync_with_retry(_invoke_once_with_fallback)

                    invoke_task = asyncio.create_task(
                        asyncio.to_thread(
                            _invoke_with_retry,
                        )
                    )
                    wait_started_at = asyncio.get_running_loop().time()
                    waiting_hint_emitted = False
                    last_pulse_at = wait_started_at
                    while True:
                        if await _check_should_stop():
                            invoke_task.cancel()
                            try:
                                await invoke_task
                            except (asyncio.CancelledError, Exception):
                                pass
                            yield RuntimeEvent(
                                type=EventType.ERROR.value,
                                data={"text": STOP_MESSAGE},
                                agent_id=agent_id,
                            )
                            return
                        if invoke_task.done():
                            response = await invoke_task
                            break
                        now = asyncio.get_running_loop().time()
                        elapsed = now - wait_started_at
                        if (not waiting_hint_emitted) and elapsed >= first_feedback_seconds:
                            waiting_hint_emitted = True
                            last_pulse_at = now
                            yield RuntimeEvent(
                                type=EventType.TOKEN.value,
                                data={"text": "⏳"},
                                agent_id=agent_id,
                            )
                        if elapsed >= invoke_timeout_seconds:
                            invoke_task.cancel()
                            raise asyncio.TimeoutError()
                        await asyncio.sleep(0.1)
                await self.hooks.run_after_model(response, session)

                _round_usage = usage_metadata_from_llm_response(response)
                self.token_budget.record(_round_usage)
                budget_level, budget_source, budget_current, budget_max = self.token_budget.check_with_source()
                if budget_level == BudgetLevel.EXCEEDED:
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={
                            "text": (
                                "Token budget exceeded "
                                f"({budget_current}/{budget_max}, source={budget_source}). "
                                "Stopping to preserve results."
                            ),
                            "detector": "token_budget",
                        },
                        agent_id=agent_id,
                    )
                    return
                if budget_level == BudgetLevel.COMPRESS:
                    hist_compact = _sanitize_context_messages(session.agent_messages)
                    react_hist, did_react, react_summary, react_count = await self.compactor.maybe_compact(
                        hist_compact,
                        force=True,
                        model=model_name,
                    )
                    if did_react:
                        session.agent_messages = react_hist
                        messages[:] = [{"role": "system", "content": current_system_prompt}, *list(react_hist)]
                        yield RuntimeEvent(
                            type=EventType.COMPACTION.value,
                            data={
                                "compacted_count": react_count,
                                "summary": react_summary,
                                "reactive": True,
                            },
                            agent_id=agent_id,
                        )
                        try:
                            await self.hooks.run_on_compaction(react_count, react_summary, session)
                        except Exception:
                            pass
                    budget_level, budget_source, budget_current, budget_max = self.token_budget.check_with_source()
                    if budget_level == BudgetLevel.COMPRESS:
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "<budget_compress>Please compress context aggressively and focus on "
                                    "final deliverable only. Avoid exploratory loops.</budget_compress>"
                                ),
                            },
                        )
                if budget_level == BudgetLevel.WARNING:
                    messages.append({"role": "user", "content": self.token_budget.convergence_hint()})
            except asyncio.TimeoutError:
                provider_hint = provider_name or "(unknown)"
                model_hint = model_name or "(unknown)"
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={
                        "text": (
                            f"模型响应超时（>{int(invoke_timeout_seconds)}s，provider={provider_hint}, model={model_hint}）。"
                            "当前轮为工具可调用模式，模型可能在内部思考/函数规划后才返回。"
                            "可切换更快模型，或提高 AGX_LLM_INVOKE_TIMEOUT_SECONDS。"
                        )
                    },
                    agent_id=agent_id,
                )
                return
            except Exception as exc:
                yield RuntimeEvent(
                    type=EventType.ERROR.value,
                    data={"text": f"模型调用失败: {exc}"},
                    agent_id=agent_id,
                )
                return
            response_text = (response.content or "").strip()
            raw_tc = response.tool_calls or []
            tool_calls = [
                tc for tc in raw_tc
                if isinstance(tc, dict)
                and (tc.get("function", {}) if isinstance(tc.get("function"), dict) else {}).get("name")
                and str((tc.get("function", {}) if isinstance(tc.get("function"), dict) else {}).get("name", "")).strip().lower() != "none"
            ]
            if not tool_calls:
                inline_tool = _extract_inline_tool_call(response_text, allowed_tool_names)
                if inline_tool is not None:
                    tool_calls = [
                        {
                            "id": f"inline-{uuid.uuid4().hex[:8]}",
                            "type": "function",
                            "function": {
                                "name": inline_tool["name"],
                                "arguments": json.dumps(inline_tool["arguments"], ensure_ascii=False),
                            },
                        }
                    ]
            assistant_message: Dict[str, Any] = {"role": "assistant", "content": response_text}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            session.agent_messages.append(assistant_message)
            synced_session_message_count = len(session.agent_messages)

            if not tool_calls:
                if response_text.strip():
                    # Tokens were already streamed to the client during the
                    # invoke/stream phase above; do NOT re-send them here.
                    final_text = response_text.strip()
                else:
                    streamed_text = ""
                    try:
                        token_queue: asyncio.Queue[str | None] = asyncio.Queue()
                        stream_loop = asyncio.get_running_loop()

                        def _run_sync_stream() -> None:
                            try:
                                for chunk in self.llm.stream(
                                    messages,
                                    temperature=0.2,
                                    max_tokens=8192,
                                    timeout=request_timeout_seconds,
                                ):
                                    tok = chunk if isinstance(chunk, str) else str(chunk.get("content", ""))
                                    if tok:
                                        stream_loop.call_soon_threadsafe(token_queue.put_nowait, tok)
                            finally:
                                stream_loop.call_soon_threadsafe(token_queue.put_nowait, None)

                        stream_task = asyncio.get_running_loop().run_in_executor(None, _run_sync_stream)

                        while True:
                            if await _check_should_stop():
                                stream_task.cancel()
                                yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                                return
                            try:
                                tok = await asyncio.wait_for(token_queue.get(), timeout=0.05)
                            except asyncio.TimeoutError:
                                continue
                            if tok is None:
                                break
                            streamed_text += tok
                            yield RuntimeEvent(type=EventType.TOKEN.value, data={"text": tok}, agent_id=agent_id)

                        await stream_task
                    except Exception:
                        streamed_text = response_text
                    final_text = streamed_text.strip() if streamed_text.strip() else response_text
                if not str(final_text).strip() and executed_tool_names:
                    unique_tools = ", ".join(dict.fromkeys(executed_tool_names))
                    final_text = (
                        "已完成工具调用（"
                        f"{unique_tools}）。\n"
                        "当前模型未返回进一步正文，请继续给我下一步指令。"
                    )
                if not _is_system_trigger:
                    session.chat_history.append({"role": "assistant", "content": final_text})
                await self.hooks.run_on_agent_end(final_text, session)
                _um = usage_metadata_from_llm_response(response)
                _final_data: dict[str, Any] = {"text": final_text}
                if _um:
                    _final_data["usage_metadata"] = _um
                yield RuntimeEvent(type=EventType.FINAL.value, data=_final_data, agent_id=agent_id)
                return

            assistant_tool_message = {
                "role": "assistant",
                "content": response_text,
                "tool_calls": tool_calls,
            }
            messages.append(assistant_tool_message)
            tool_calls_summary = _summarize_tool_calls_for_history(tool_calls)
            tool_call_text = f"工具调用:\n{json.dumps(tool_calls_summary, ensure_ascii=False)}"
            if not _is_system_trigger:
                session.chat_history.append({"role": "tool", "content": tool_call_text})

            _parallel_mode = _parallel_tools_enabled() and len(tool_calls) > 1
            if _parallel_mode:
                logger.debug(
                    "tool parallel partition batch sizes: %s",
                    [len(b) for b in partition_tool_calls(tool_calls)],
                )

            for call in tool_calls:
                if await _check_should_stop():
                    yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                    return
                function_obj = call.get("function", {}) if isinstance(call, dict) else {}
                raw_tool_name = function_obj.get("name", "")
                tool_name = str(raw_tool_name).strip() if isinstance(raw_tool_name, str) else ""
                if tool_name.lower() == "none":
                    tool_name = ""
                tool_call_id = str(call.get("id", "")) if isinstance(call, dict) else ""
                arguments = _parse_tool_arguments(function_obj.get("arguments"))
                dispatch_arguments = dict(arguments)
                dispatch_arguments["__tool_call_id"] = tool_call_id
                dispatch_arguments["__agent_id"] = agent_id
                if not tool_name:
                    invalid_message = "模型返回了无效工具调用（缺少 tool name），已忽略本次调用。"
                    tool_name = "unknown_tool"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": invalid_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": invalid_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(
                            {"role": "tool", "content": f"工具结果({tool_name}):\n{invalid_message}"}
                        )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": invalid_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": invalid_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                hook_outcome = await self.hooks.run_before_tool_call(tool_name, arguments, session)
                if hook_outcome.blocked:
                    blocked_message = hook_outcome.reason or f"工具 {tool_name} 被策略阻止。"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": blocked_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": blocked_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": blocked_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                if tool_name not in allowed_tool_names:
                    denied_message = f"工具 '{tool_name}' 不在当前允许列表中，已拒绝执行。"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    session.agent_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "name": tool_name,
                            "content": denied_message,
                        }
                    )
                    synced_session_message_count = len(session.agent_messages)
                    if not _is_system_trigger:
                        session.chat_history.append(
                            {"role": "assistant", "content": f"工具结果({tool_name}):\n{denied_message}"}
                        )
                    yield RuntimeEvent(
                        type=EventType.ERROR.value,
                        data={"text": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    yield RuntimeEvent(
                        type=EventType.TOOL_RESULT.value,
                        data={"name": tool_name, "result": denied_message, "tool_call_id": tool_call_id},
                        agent_id=agent_id,
                    )
                    continue
                if tool_name == "query_subagent_status":
                    status_query_attempts_total += 1
                    if agent_id == "meta" and status_query_attempts_total > max_status_queries_per_turn:
                        budget_msg = (
                            f"【已阻止】本轮状态查询已超过预算上限（{max_status_queries_per_turn} 次），为避免无效轮询已停止继续查询。\n"
                            "请基于已有状态结果直接回复用户，或等待后台完成事件。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": budget_msg,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": budget_msg,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": budget_msg, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "本轮状态查询达到预算上限（2 次），已停止轮询。"
                                "我会在子智能体完成/失败后主动汇报。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue
                    now_ts = time.time()
                    if (
                        agent_id == "meta"
                        and last_status_query_at > 0
                        and (now_ts - last_status_query_at) < min_status_query_interval_sec
                    ):
                        wait_left = max(1, int(min_status_query_interval_sec - (now_ts - last_status_query_at)))
                        cooldown_msg = (
                            "【已阻止】query_subagent_status 冷却中，避免无效轮询。\n"
                            f"请至少等待 {wait_left}s 再次查询，或直接基于当前信息回答用户。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": cooldown_msg,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": cooldown_msg,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": cooldown_msg, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "状态查询处于冷却窗口，我先停止本轮轮询。"
                                "若子智能体仍在运行，我会在完成事件到达后主动汇报。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue
                    # Allow exactly one status query per turn for meta agent;
                    # block only from the second attempt in the same turn.
                    if agent_id == "meta" and status_query_attempts_total > 1:
                        throttled_once = (
                            "【已阻止】本轮已调用过一次 query_subagent_status，禁止同一轮重复轮询。\n"
                            "请基于该次结果直接回答用户，或结束本轮等待后台完成事件。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled_once,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled_once,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": throttled_once, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "本轮状态已查询过一次，已停止重复轮询。"
                                "若子智能体仍运行，我会在完成事件到达后主动汇报。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue
                    status_query_total += 1
                    last_status_query_at = now_ts
                    try:
                        signature = json.dumps(arguments, ensure_ascii=False, sort_keys=True)
                    except Exception:
                        signature = str(arguments)
                    if signature == last_status_query_signature:
                        repeated_status_query_count += 1
                    else:
                        last_status_query_signature = signature
                        repeated_status_query_count = 1
                    if (
                        status_query_attempts_total > 20
                        or (
                            status_query_total > 12
                            and repeated_status_query_count > 6
                            and last_status_query_had_rows
                        )
                    ):
                        throttled = (
                            "【已阻止】query_subagent_status 调用过于频繁，本次调用被拦截。\n"
                            "⚠️ 你必须立即停止查询并执行以下操作之一：\n"
                            "1) 如果子智能体仍在运行 → 直接告知用户任务正在后台执行，结束本轮对话，等待完成事件。\n"
                            "2) 如果子智能体已完成 → 根据已知信息汇报结果，不再查询。\n"
                            "3) 如果不确定 → 告知用户「任务已提交，完成后会自动通知」，结束本轮。\n"
                            "禁止再次调用 query_subagent_status，否则将继续被拦截并消耗轮次配额。"
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled,
                            }
                        )
                        session.agent_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "name": tool_name,
                                "content": throttled,
                            }
                        )
                        synced_session_message_count = len(session.agent_messages)
                        yield RuntimeEvent(
                            type=EventType.TOOL_RESULT.value,
                            data={"name": tool_name, "result": throttled, "tool_call_id": tool_call_id},
                            agent_id=agent_id,
                        )
                        if agent_id == "meta":
                            final_text = (
                                "检测到状态轮询过于频繁，已停止本轮自动执行。"
                                "我会等待后台完成事件并主动给你汇报结果。"
                            )
                            await self.hooks.run_on_agent_end(final_text, session)
                            yield RuntimeEvent(type=EventType.FINAL.value, data={"text": final_text}, agent_id=agent_id)
                            return
                        continue

                yield RuntimeEvent(
                    type=EventType.TOOL_CALL.value,
                    data={"name": tool_name, "arguments": arguments, "tool_call_id": tool_call_id},
                    agent_id=agent_id,
                )
                pending_events: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()

                async def _on_tool_event(event_payload: Dict[str, Any]) -> None:
                    pending_events.put_nowait(event_payload)

                before_progress = _build_progress_signature(session)
                before_disk_write_count = len(disk_write_paths)
                effective_tm = self.team_manager or getattr(session, "_team_manager", None)
                meta_only_names, meta_dispatch = _resolve_meta_tool_dispatchers()
                if tool_name in meta_only_names:
                    if effective_tm is None:
                        dispatch_task = asyncio.create_task(
                            asyncio.sleep(0, result=f"ERROR: meta tool '{tool_name}' requires team manager")
                        )
                    else:
                        dispatch_task = asyncio.create_task(
                            meta_dispatch(
                                tool_name,
                                dispatch_arguments,
                                team_manager=effective_tm,
                                session=session,
                            )
                        )
                else:
                    dispatch_task = asyncio.create_task(
                        dispatch_tool_async(
                            tool_name,
                            dispatch_arguments,
                            session,
                            confirm_gate=self.confirm_gate,
                            event_callback=_on_tool_event,
                            team_manager=effective_tm,
                        )
                    )

                # Long-running tools (e.g. mcp_call → browser_navigate) block here with no LLM chunks;
                # emit periodic TOOL_PROGRESS so Desktop SSE stays alive and users see liveness.
                _tool_wait_loop = asyncio.get_running_loop()
                _tool_exec_wait_started = _tool_wait_loop.time()
                _next_tool_progress_at = _tool_exec_wait_started + 0.8

                while True:
                    if await _check_should_stop():
                        dispatch_task.cancel()
                        try:
                            await dispatch_task
                        except asyncio.CancelledError:
                            pass
                        yield RuntimeEvent(type=EventType.ERROR.value, data={"text": STOP_MESSAGE}, agent_id=agent_id)
                        return
                    if dispatch_task.done() and pending_events.empty():
                        break
                    try:
                        emitted = await asyncio.wait_for(pending_events.get(), timeout=0.05)
                        yield RuntimeEvent(
                            type=str(emitted.get("type", "")),
                            data=dict(emitted.get("data", {})),
                            agent_id=agent_id,
                        )
                    except asyncio.TimeoutError:
                        _now = _tool_wait_loop.time()
                        if not dispatch_task.done() and _now >= _next_tool_progress_at:
                            yield RuntimeEvent(
                                type=EventType.TOOL_PROGRESS.value,
                                data={
                                    "name": tool_name,
                                    "tool_call_id": tool_call_id,
                                    "elapsed_seconds": round(_now - _tool_exec_wait_started, 1),
                                },
                                agent_id=agent_id,
                            )
                            _next_tool_progress_at = _now + 2.0
                        continue

                try:
                    result = await dispatch_task
                except Exception as exc:
                    result = f"ERROR: tool execution failed: {exc}"
                if tool_name == "query_subagent_status":
                    has_rows = False
                    try:
                        parsed = json.loads(result)
                        if isinstance(parsed, dict):
                            rows = parsed.get("subagents")
                            if isinstance(rows, list) and len(rows) > 0:
                                has_rows = True
                            if isinstance(parsed.get("subagent"), dict):
                                has_rows = True
                    except Exception:
                        has_rows = False
                    last_status_query_had_rows = has_rows
                    if not has_rows:
                        status_query_total = max(0, status_query_total - 1)
                        repeated_status_query_count = 0
                result = await self.hooks.run_after_tool_call(tool_name, result, session)
                result = _maybe_persist_large_tool_result(session, tool_call_id, tool_name, str(result))
                result = self.compactor.micro_compact_tool_result(tool_name, str(result))
                if tool_name == "todo_write":
                    rounds_without_todo = 0
                else:
                    rounds_without_todo += 1
                executed_tool_names.append(tool_name)
                after_progress = _build_progress_signature(session)
                written_paths_for_progress: List[str] = []
                if tool_name in {"file_write", "file_edit"} and isinstance(result, str):
                    written_paths_for_progress = _extract_written_paths_from_result(result)
                    for path in written_paths_for_progress:
                        write_path_counts[path] = write_path_counts.get(path, 0) + 1
                        disk_write_paths.add(path)
                if agent_id != "meta" and tool_name in {"file_write", "file_edit"} and isinstance(
                    result, str
                ):
                    for path in written_paths_for_progress:
                        if _confirmation_spam_score_for_path(path) >= 2:
                            confirmation_spam_count += 1
                    if confirmation_spam_count >= 3:
                        spam_msg = "Detected confirmation file spam. Terminating subagent."
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={"text": spam_msg, "detector": "confirmation_spam"},
                            agent_id=agent_id,
                        )
                        return
                file_write_progress = (
                    tool_name in {"file_write", "file_edit"}
                    and isinstance(result, str)
                    and (
                        "OK: wrote " in result
                        or "OK: edited " in result
                    )
                )
                if file_write_progress and written_paths_for_progress:
                    for p in written_paths_for_progress:
                        if write_path_counts.get(p, 0) > 2:
                            file_write_progress = False
                            break
                disk_write_progress = len(disk_write_paths) > before_disk_write_count
                PROGRESS_TOOLS = {
                    "todo_write", "scratchpad_write", "bash_exec",
                    "file_read", "list_files", "file_search", "grep_search",
                }
                logical_progress = (
                    tool_name in PROGRESS_TOOLS
                    and isinstance(result, str)
                    and not result.lstrip().startswith("ERROR:")
                    and len(result.strip()) > 10
                )
                self.loop_detector.record_call(
                    tool_name,
                    LoopDetector.args_signature(arguments),
                    has_progress=(
                        (before_progress != after_progress)
                        or file_write_progress
                        or disk_write_progress
                        or logical_progress
                    ),
                )
                loop_issue = self.loop_detector.check()
                if loop_issue is not None:
                    reminder = (
                        f"[loop-{loop_issue.level}] {loop_issue.message} "
                        "请调整策略：改用不同工具、读取更多上下文，或先总结当前结论。"
                    )
                    messages.append({"role": "user", "content": reminder})
                    if loop_issue.level == "critical":
                        yield RuntimeEvent(
                            type=EventType.ERROR.value,
                            data={"text": reminder, "detector": loop_issue.detector},
                            agent_id=agent_id,
                        )
                        return
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": result,
                    }
                )
                session.agent_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": tool_name,
                        "content": result,
                    }
                )
                synced_session_message_count = len(session.agent_messages)
                if not _is_system_trigger:
                    session.chat_history.append(
                        {"role": "tool", "content": f"工具结果({tool_name}):\n{result}"}
                    )

                self._tools_since_persist += 1
                self._maybe_mid_turn_persist()

                yield RuntimeEvent(
                    type=EventType.TOOL_RESULT.value,
                    data={"name": tool_name, "result": result, "tool_call_id": tool_call_id},
                    agent_id=agent_id,
                )

        message = (
            "已达到最大工具调用轮数，已暂停自动执行。"
            "请基于当前结果继续指示，或缩小任务范围。"
        )
        if agent_id == "meta":
            await self.hooks.run_on_agent_end(message, session)
            yield RuntimeEvent(type=EventType.ERROR.value, data={"text": message}, agent_id=agent_id)
            return
        await self.hooks.run_on_agent_end(message, session)
        yield RuntimeEvent(
            type=EventType.SUBAGENT_PAUSED.value,
            data={
                "agent_id": agent_id,
                "round": self.max_tool_rounds,
                "max_rounds": self.max_tool_rounds,
                "text": message,
                "executed_tools": list(dict.fromkeys(executed_tool_names))[-10:],
            },
            agent_id=agent_id,
        )
