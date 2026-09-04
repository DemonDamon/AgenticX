#!/usr/bin/env python3
"""Estimate per-category context/token usage for a Studio session.

Author: Damon Li
"""

import json
import re
import threading
import time
from typing import Any

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.model_context_window import resolve_context_window
from agenticx.runtime.prompts.current_time import build_current_time_block
from agenticx.runtime.prompts.meta_agent import (
    _build_active_subagents_context,
    _build_avatars_context,
    _build_computer_use_capabilities_block,
    _build_context_files_block,
    _build_kb_retrieval_policy_block,
    _build_mcps_context,
    _build_native_connectors_context,
    _build_session_summary_context,
    _build_skills_context,
    _build_taskspaces_context,
    _build_todo_context,
    _build_workspace_context_block,
)

# A flat chars/token ratio undercounts Chinese by ~40%: one CJK character is
# roughly one token, while Latin text and JSON run ~3+ chars per token. Both
# constants were fitted against tiktoken o200k over 800 real session messages
# (aggregate within 5% of ground truth, median per-message error 7.4%), and
# cross-checked against a live GLM turn billed at 28,294 input tokens.
_CJK_CHARS_PER_TOKEN = 1.2
_OTHER_CHARS_PER_TOKEN = 3.2
_CJK_PATTERN = re.compile(
    "[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]"
)
_SKILL_SUMMARY_TTL_SECONDS = 45.0
_OCCUPANCY_CACHE_MAX = 48
_OMITTED_INLINE_DATA = "[omitted-inline-data]"
_INLINE_DATA_PREFIXES = ("data:", "data:image/")
# Instruction body from meta_agent.py (duties / scheduling / MCP loop): ~18,000
# chars at its measured ~17% CJK mix. Measured independently of session I/O so
# occupancy stays in the same band without concatenating the live system prompt
# on every session switch.
_STATIC_DUTY_TOKENS = 7_300

_SKILL_LOCK = threading.Lock()
_SKILL_CACHE: dict[str, tuple[float, list]] = {}
_OCCUPANCY_LOCK = threading.Lock()
_OCCUPANCY_CACHE: dict[str, tuple[tuple[Any, ...], dict[str, int]]] = {}


def _text_tokens(text: str) -> int:
    """Estimate tokens for one block, counting CJK and non-CJK separately."""
    if not text:
        return 0
    cjk = len(_CJK_PATTERN.findall(text))
    other = len(text) - cjk
    estimate = cjk / _CJK_CHARS_PER_TOKEN + other / _OTHER_CHARS_PER_TOKEN
    return max(1, int(estimate))


def _is_inline_data_payload(value: str) -> bool:
    text = str(value or "")
    return text.startswith(_INLINE_DATA_PREFIXES) and len(text) > 256


def _redact_inline_data_for_occupancy(value: Any) -> Any:
    """Drop persisted data URLs so occupancy tracks model-facing text."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if (
                key in {"data_url", "data", "url"}
                and isinstance(item, str)
                and _is_inline_data_payload(item)
            ):
                out[key] = _OMITTED_INLINE_DATA
            else:
                out[key] = _redact_inline_data_for_occupancy(item)
        return out
    if isinstance(value, list):
        return [_redact_inline_data_for_occupancy(item) for item in value]
    if isinstance(value, str) and _is_inline_data_payload(value):
        return _OMITTED_INLINE_DATA
    return value


def _message_tokens_for_occupancy(item: Any) -> int:
    try:
        return _text_tokens(
            json.dumps(
                _redact_inline_data_for_occupancy(item),
                ensure_ascii=False,
                default=str,
            )
        )
    except Exception:
        return _text_tokens(str(item))


def _safe_block(fn: Any, *args: Any, **kwargs: Any) -> str:
    try:
        return fn(*args, **kwargs)
    except Exception:
        return ""


def _reset_usage_caches() -> None:
    """Test helper: drop in-process occupancy / skill caches."""
    with _SKILL_LOCK:
        _SKILL_CACHE.clear()
    with _OCCUPANCY_LOCK:
        _OCCUPANCY_CACHE.clear()


def invalidate_occupancy_cache(session_id: str) -> None:
    """Drop a session's occupancy row after retry/edit truncate."""
    sid = str(session_id or "").strip()
    if not sid:
        return
    with _OCCUPANCY_LOCK:
        _OCCUPANCY_CACHE.pop(sid, None)


def _skill_summaries(bound_avatar_id: str | None) -> list:
    key = str(bound_avatar_id or "")
    now = time.monotonic()
    with _SKILL_LOCK:
        hit = _SKILL_CACHE.get(key)
        if hit is not None and now - hit[0] < _SKILL_SUMMARY_TTL_SECONDS:
            return hit[1]
    try:
        rows = get_all_skill_summaries(bound_avatar_id=bound_avatar_id)
    except Exception:
        rows = []
    with _SKILL_LOCK:
        _SKILL_CACHE[key] = (now, rows)
    return rows


def _occupancy_fingerprint(
    managed: Any,
    *,
    avatar_context: dict[str, str] | None,
    group_chat: dict[str, Any] | None,
) -> tuple[Any, ...]:
    session = managed.studio_session
    msgs = getattr(session, "agent_messages", None) or []
    last = ""
    if msgs:
        try:
            last = json.dumps(msgs[-1], ensure_ascii=False, default=str)[:160]
        except Exception:
            last = str(msgs[-1])[:160]
    hub = getattr(session, "mcp_hub", None)
    n_mcp = len(getattr(hub, "tools", None) or []) if hub is not None else 0
    group_ids = ""
    if isinstance(group_chat, dict):
        raw_ids = group_chat.get("avatar_ids")
        if isinstance(raw_ids, list):
            group_ids = ",".join(sorted(str(x).strip() for x in raw_ids if str(x).strip()))
    avatar_key = ""
    if isinstance(avatar_context, dict):
        avatar_key = str(avatar_context.get("name", "") or "")
    return (
        len(msgs),
        last,
        str(getattr(session, "bound_avatar_id", "") or ""),
        len(getattr(managed, "taskspaces", None) or []),
        n_mcp,
        avatar_key,
        group_ids,
        str(getattr(session, "kb_retrieval_mode", "") or ""),
    )


def _payload_from_categories(
    categories: dict[str, int],
    *,
    session_model: str,
    override_model: str,
) -> dict:
    used_tokens = sum(categories.values())
    max_tokens = resolve_usage_window(
        session_model=session_model,
        override_model=override_model,
    )
    return {
        "used_tokens": used_tokens,
        "max_tokens": max_tokens,
        "percent": round(min(100.0, (used_tokens / max_tokens) * 100), 1) if max_tokens > 0 else 0.0,
        "categories": categories,
    }


def apply_last_request_occupancy_floor(
    usage: dict[str, Any],
    last_input_tokens: int,
) -> dict[str, Any]:
    """Lift reconstructed occupancy to the last billed prompt when it is larger.

    The category rebuild skips the live system prompt (static duty tokens) so it
    can under-count by tens of thousands versus the provider's input_tokens.
    """
    used = int(usage.get("used_tokens") or 0)
    try:
        last = int(last_input_tokens or 0)
    except (TypeError, ValueError):
        last = 0
    if last <= used:
        return usage
    categories = dict(usage.get("categories") or {})
    residual = last - used
    categories["system_prompt"] = int(categories.get("system_prompt") or 0) + residual
    max_tokens = int(usage.get("max_tokens") or 0)
    return {
        **usage,
        "categories": categories,
        "used_tokens": last,
        "percent": (
            round(min(100.0, (last / max_tokens) * 100), 1) if max_tokens > 0 else 0.0
        ),
    }


def resolve_usage_window(*, session_model: str = "", override_model: str = "") -> int:
    """Pane-selected model wins over a blank/stale session.model_name.

    Occupancy percent is window / used. If the Desktop pane has already
    switched models but the session row still has an empty model_name, the
    lookup must not pin the default 128K window.
    """
    name = str(override_model or "").strip() or str(session_model or "").strip()
    return resolve_context_window(name)


def estimate_session_context_usage(
    managed: Any,
    *,
    avatar_context: dict[str, str] | None = None,
    group_chat: dict[str, Any] | None = None,
    user_nickname: str = "",
    user_preference: str = "",
    model_name: str = "",
    session_id: str = "",
) -> dict:
    """Read-only estimate of context usage broken down into 5 categories.

    Session switches must stay cheap: do not rebuild the live system prompt
    (that path scans skills and runs hybrid memory recall). Categories come
    from the same block helpers, with skill summaries and occupancy rows
    cached in-process.
    """
    session = managed.studio_session
    bound_avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    if not isinstance(avatar_context, dict):
        avatar_context = None
    if not isinstance(group_chat, dict):
        group_chat = None
    sid = str(session_id or getattr(session, "session_id", "") or "").strip()
    session_model = str(getattr(session, "model_name", "") or "")
    fingerprint = _occupancy_fingerprint(
        managed,
        avatar_context=avatar_context,
        group_chat=group_chat,
    )
    if sid:
        with _OCCUPANCY_LOCK:
            cached = _OCCUPANCY_CACHE.get(sid)
        if cached is not None and cached[0] == fingerprint:
            return _payload_from_categories(
                cached[1],
                session_model=session_model,
                override_model=model_name,
            )

    skill_summaries = _skill_summaries(bound_avatar_id)
    skills_tokens = _text_tokens(_safe_block(_build_skills_context, skill_summaries))
    mcp_tokens = _text_tokens(_safe_block(_build_mcps_context, session))
    subagents_tokens = _text_tokens(_safe_block(_build_active_subagents_context, session))
    context_files_tokens = _text_tokens(_safe_block(_build_context_files_block, session))
    todo_tokens = _text_tokens(_safe_block(_build_todo_context, session))
    summary_tokens = _text_tokens(_safe_block(_build_session_summary_context, session))
    taskspaces = getattr(managed, "taskspaces", None) or []
    taskspace_tokens = _text_tokens(_safe_block(_build_taskspaces_context, taskspaces))
    connector_tokens = _text_tokens(_safe_block(_build_native_connectors_context))
    group_allowed: set[str] | None = None
    group_name = ""
    if group_chat:
        raw_ids = group_chat.get("avatar_ids")
        if isinstance(raw_ids, list):
            group_allowed = {str(x).strip() for x in raw_ids if str(x).strip()}
        group_name = str(group_chat.get("name", "") or "").strip()
    avatars_tokens = _text_tokens(
        _safe_block(_build_avatars_context, allowed_avatar_ids=group_allowed)
    )
    subject_label = (
        (group_name if group_allowed is not None else "")
        or str((avatar_context or {}).get("name", "") or "").strip()
        or "元智能体"
    )
    workspace_tokens = _text_tokens(
        _safe_block(
            _build_workspace_context_block,
            bound_avatar_id,
            session=session,
            subject_label=subject_label,
        )
    )
    kb_mode = str(getattr(session, "kb_retrieval_mode", "") or "").strip() or None
    identity = (
        f"你是 AgenticX Desktop 的分身智能体「{str((avatar_context or {}).get('name', '')).strip()}」。\n"
        if avatar_context and str(avatar_context.get("name", "") or "").strip()
        else "你是 AgenticX Desktop 的首席 Meta-Agent（CEO）。\n"
    )
    system_tokens = (
        _STATIC_DUTY_TOKENS
        + workspace_tokens
        + todo_tokens
        + summary_tokens
        + taskspace_tokens
        + connector_tokens
        + avatars_tokens
        + _text_tokens(identity)
        + _text_tokens(_safe_block(build_current_time_block))
        + _text_tokens(_safe_block(_build_computer_use_capabilities_block))
        + _text_tokens(_safe_block(_build_kb_retrieval_policy_block, kb_mode))
        + _text_tokens(str(user_nickname or ""))
        + _text_tokens(str(user_preference or ""))
    )

    is_avatar = bound_avatar_id is not None
    tool_defs = list(STUDIO_TOOLS) if is_avatar else list(META_AGENT_TOOLS)
    # 按 ToolSearch 的投影结果计价，而不是整池工具。开了 auto 之后请求里实际只带
    # 常驻工具加已加载的那几个（实测 65 个里带 19 个），照全池算会把这一格虚报一万
    # 多 token，用户看着的上下文占用条就永远是错的。投影失败就退回全池（保守高估）。
    try:
        from agenticx.runtime.tool_search import project_tools_for_round
        from agenticx.runtime.tool_search_runtime import build_runtime_context

        tool_defs = list(
            project_tools_for_round(
                build_runtime_context(session=session, full_openai_tools=tool_defs),
                full_openai_tools=tool_defs,
            )
        )
    except Exception:
        pass
    try:
        tools_tokens = _text_tokens(json.dumps(tool_defs, ensure_ascii=False, default=str))
    except Exception:
        tools_tokens = 0

    # Estimate from the model-facing history (post-compaction agent_messages),
    # not the full UI transcript (chat_history), so the chip tracks what the
    # next request would actually send and drops after compaction.
    agent_messages = getattr(session, "agent_messages", None) or []
    messages_tokens = 0
    for item in agent_messages:
        messages_tokens += _message_tokens_for_occupancy(item)

    hub = getattr(session, "mcp_hub", None)
    mcp_tool_tokens = 0
    if hub is not None:
        try:
            hub_tools = getattr(hub, "tools", None) or []
            mcp_tool_tokens = _text_tokens(
                json.dumps(hub_tools, ensure_ascii=False, default=str)
            )
        except Exception:
            mcp_tool_tokens = 0

    categories = {
        "system_prompt": system_tokens,
        "tools_and_subagents": tools_tokens + subagents_tokens,
        "messages": messages_tokens + context_files_tokens,
        "connectors_and_mcp": mcp_tokens + mcp_tool_tokens,
        "skills": skills_tokens,
    }
    if sid:
        with _OCCUPANCY_LOCK:
            _OCCUPANCY_CACHE[sid] = (fingerprint, categories)
            while len(_OCCUPANCY_CACHE) > _OCCUPANCY_CACHE_MAX:
                _OCCUPANCY_CACHE.pop(next(iter(_OCCUPANCY_CACHE)))
    return _payload_from_categories(
        categories,
        session_model=session_model,
        override_model=model_name,
    )


def _empty_session_cache_payload() -> dict[str, int | float]:
    return {
        "session_input_tokens": 0,
        "session_output_tokens": 0,
        "session_total_tokens": 0,
        "session_cached_tokens": 0,
        "session_cache_ratio": 0.0,
        "last_input_tokens": 0,
        "last_cached_tokens": 0,
        "last_cache_ratio": 0.0,
        "requests": 0,
        "zero_cache_requests": 0,
    }


def load_session_cache_payload(session_id: str) -> dict[str, int | float]:
    """Read-only per-session cache-hit payload for the context-usage API.

    Ledger failures return zeros so occupancy estimates can still succeed.
    """
    sid = str(session_id or "").strip()
    if not sid:
        return _empty_session_cache_payload()
    try:
        from agenticx.runtime.usage_store import get_usage_store

        raw = get_usage_store().cache_stats(session_id=sid)
    except Exception:
        return _empty_session_cache_payload()
    return {
        "session_input_tokens": int(raw.get("input_tokens") or 0),
        "session_output_tokens": int(raw.get("output_tokens") or 0),
        "session_total_tokens": int(raw.get("total_tokens") or 0),
        "session_cached_tokens": int(raw.get("cached_tokens") or 0),
        "session_cache_ratio": float(raw.get("cache_ratio") or 0.0),
        "last_input_tokens": int(raw.get("last_input_tokens") or 0),
        "last_cached_tokens": int(raw.get("last_cached_tokens") or 0),
        "last_cache_ratio": float(raw.get("last_cache_ratio") or 0.0),
        "requests": int(raw.get("requests") or 0),
        "zero_cache_requests": int(raw.get("zero_cache_requests") or 0),
    }
