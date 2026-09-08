#!/usr/bin/env python3
"""Turn-intent helpers for plan mode.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

TURN_INTENT_ALLOWED_TOOLS = {
    "file_read",
    "grep",
    "glob",
    "web_search",
    "web_fetch",
    "liteparse",
    "skill_list",
    "skill_use",
    "session_search",
    "memory_search",
    "mcp_list",
    "todo_list",
    "scratchpad_read",
    "knowledge_search",
    "code_search",
}

_PLAN_MODE_BLOCK = (
    "## Plan mode\n"
    "You are in plan mode. Research with read-only tools only.\n"
    "Do not edit files, run commands, delegate, install, or take any other "
    "side-effecting action.\n"
    "Return a concrete plan: goal, steps, risks, and what you will not do.\n"
    "Wait for the user to confirm before executing.\n"
)


def apply_turn_intent_to_session(
    session: Any,
    *,
    plan_mode: bool,
    is_automation: bool,
    isolate_run: bool = False,
) -> None:
    """Bind this turn's intent onto the session. Automation always stays default."""
    if is_automation:
        setattr(session, "plan_mode", False)
        return
    if isolate_run:
        setattr(session, "plan_mode", False)
        return
    from agenticx.runtime.isolate_run import load_isolate_state

    if load_isolate_state(session) is not None and not plan_mode:
        setattr(session, "plan_mode", False)
        return
    if not plan_mode:
        setattr(session, "plan_mode", False)
        return
    setattr(session, "plan_mode", True)


def session_has_restricted_turn_intent(session: Any) -> bool:
    return bool(getattr(session, "plan_mode", False))


def is_turn_intent_tool_allowed(tool_name: str) -> bool:
    return str(tool_name or "").strip() in TURN_INTENT_ALLOWED_TOOLS


def filter_tools_for_turn_intent(tools: list[Any], session: Any) -> list[Any]:
    """Strip mutating tools when plan mode is active."""
    if not session_has_restricted_turn_intent(session):
        return tools
    out: list[Any] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        name = str((tool.get("function") or {}).get("name") or "").strip()
        if name in TURN_INTENT_ALLOWED_TOOLS:
            out.append(tool)
    return out


def turn_intent_denial_message(tool_name: str, session: Any) -> str | None:
    if not session_has_restricted_turn_intent(session):
        return None
    if is_turn_intent_tool_allowed(tool_name):
        return None
    return (
        f"plan mode cannot run {tool_name}. "
        "Use read-only tools only, then wait for the user to leave this mode."
    )


def build_turn_intent_block(session: Any) -> str:
    if getattr(session, "plan_mode", False):
        return _PLAN_MODE_BLOCK
    return ""
