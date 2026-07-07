#!/usr/bin/env python3
"""Estimate per-category context/token usage for a Studio session.

Author: Damon Li
"""

import json
from typing import Any

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.prompts.meta_agent import (
    _build_active_subagents_context,
    _build_context_files_block,
    _build_mcps_context,
    _build_memory_recall_context,
    _build_skills_context,
    build_meta_agent_system_prompt,
)

_MODEL_CONTEXT_WINDOWS: list[tuple[str, int]] = [
    ("claude-opus-4", 200_000),
    ("claude-sonnet-5", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude", 200_000),
    ("gpt-5", 256_000),
    ("gpt-4o", 128_000),
    ("gpt-4", 128_000),
    ("o1", 200_000),
    ("o3", 200_000),
    ("deepseek", 128_000),
    ("qwen", 128_000),
    ("glm", 128_000),
    ("kimi", 256_000),
    ("minimax", 192_000),
    ("gemini-2.5", 1_048_576),
    ("gemini", 1_000_000),
]
_DEFAULT_CONTEXT_WINDOW = 128_000

_CHARS_PER_TOKEN = 4


def resolve_context_window(model_name: str | None) -> int:
    """Best-effort lookup of a model's context window size, by substring match."""
    name = str(model_name or "").lower()
    for key, window in _MODEL_CONTEXT_WINDOWS:
        if key in name:
            return window
    return _DEFAULT_CONTEXT_WINDOW


def _chars_to_tokens(chars: int) -> int:
    if chars <= 0:
        return 0
    return max(1, chars // _CHARS_PER_TOKEN)


def _safe_block(fn: Any, *args: Any) -> str:
    try:
        return fn(*args)
    except Exception:
        return ""


def estimate_session_context_usage(
    managed: Any,
    *,
    avatar_context: dict[str, str] | None = None,
    group_chat: dict[str, Any] | None = None,
    user_nickname: str = "",
    user_preference: str = "",
) -> dict:
    """Read-only estimate of context usage broken down into 5 categories.

    This never mutates session state and never affects the hot chat-send
    path; it independently re-invokes the same read-only prompt-building
    helper functions used when constructing the real system prompt, purely
    for estimation when the Desktop context-usage popup is opened.
    """
    session = managed.studio_session
    bound_avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    if not isinstance(avatar_context, dict):
        avatar_context = None
    if not isinstance(group_chat, dict):
        group_chat = None
    user_nickname = str(user_nickname or "").strip()
    user_preference = str(user_preference or "").strip()
    kb_mode_override = str(getattr(session, "kb_retrieval_mode", "") or "").strip() or None

    try:
        skill_summaries = get_all_skill_summaries(bound_avatar_id=bound_avatar_id)
    except Exception:
        skill_summaries = []

    try:
        full_system_prompt = build_meta_agent_system_prompt(
            session,
            mode="interactive",
            taskspaces=getattr(managed, "taskspaces", None) or [],
            avatar_context=avatar_context,
            group_chat=group_chat,
            user_nickname=user_nickname,
            user_preference=user_preference,
            kb_retrieval_mode_override=kb_mode_override,
        )
    except Exception:
        full_system_prompt = ""

    skills_chars = len(_safe_block(_build_skills_context, skill_summaries))
    mcp_chars = len(_safe_block(_build_mcps_context, session))
    subagents_chars = len(_safe_block(_build_active_subagents_context, session))
    memory_chars = len(_safe_block(_build_memory_recall_context, session))
    context_files_chars = len(_safe_block(_build_context_files_block, session))

    base_system_chars = max(
        0,
        len(full_system_prompt)
        - skills_chars
        - mcp_chars
        - subagents_chars
        - memory_chars
        - context_files_chars,
    )

    is_avatar = bound_avatar_id is not None
    tool_defs = list(STUDIO_TOOLS) if is_avatar else list(META_AGENT_TOOLS)
    try:
        tools_chars = len(json.dumps(tool_defs, ensure_ascii=False, default=str))
    except Exception:
        tools_chars = 0

    chat_history = getattr(session, "chat_history", None) or []
    messages_chars = 0
    for item in chat_history:
        try:
            messages_chars += len(json.dumps(item, ensure_ascii=False, default=str))
        except Exception:
            messages_chars += len(str(item))

    hub = getattr(session, "mcp_hub", None)
    mcp_tool_chars = 0
    if hub is not None:
        try:
            hub_tools = getattr(hub, "tools", None) or []
            mcp_tool_chars = len(json.dumps(hub_tools, ensure_ascii=False, default=str))
        except Exception:
            mcp_tool_chars = 0

    categories = {
        "system_prompt": _chars_to_tokens(base_system_chars),
        "tools_and_subagents": _chars_to_tokens(tools_chars + subagents_chars),
        "messages": _chars_to_tokens(messages_chars + memory_chars + context_files_chars),
        "connectors_and_mcp": _chars_to_tokens(mcp_chars + mcp_tool_chars),
        "skills": _chars_to_tokens(skills_chars),
    }
    used_tokens = sum(categories.values())
    model_name = str(getattr(session, "model_name", "") or "")
    max_tokens = resolve_context_window(model_name)

    return {
        "used_tokens": used_tokens,
        "max_tokens": max_tokens,
        "percent": round(min(100.0, (used_tokens / max_tokens) * 100), 1) if max_tokens > 0 else 0.0,
        "categories": categories,
    }
