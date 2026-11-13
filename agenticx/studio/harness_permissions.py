#!/usr/bin/env python3
"""Near ↔ external-harness permission prompt helpers.

Maps Claude Code pending ``can_use_tool`` rows onto the desktop
``confirm_required`` SSE shape, and folds Near run_mode into spawn options.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict

from agenticx.cc_bridge.pending_permissions import PendingPermission


def pending_permission_to_confirm_sse_data(
    pending: PendingPermission | Dict[str, Any],
) -> Dict[str, Any]:
    """Desktop-compatible ``confirm_required`` ``data`` payload."""
    if isinstance(pending, PendingPermission):
        request_id = pending.request_id
        tool_name = pending.tool_name
        display_name = pending.display_name or tool_name
        tool_use_id = pending.tool_use_id
        input_summary = dict(pending.input_summary)
        risk = pending.risk
        tool_input = dict(pending.tool_input)
    else:
        request_id = str(pending.get("request_id") or "").strip()
        tool_name = str(pending.get("tool_name") or "tool").strip() or "tool"
        display_name = (
            str(pending.get("display_name") or "").strip() or tool_name
        )
        tool_use_id = str(pending.get("tool_use_id") or "").strip()
        raw_summary = pending.get("input_summary")
        input_summary = dict(raw_summary) if isinstance(raw_summary, dict) else {}
        risk = str(pending.get("risk") or "protected").strip() or "protected"
        raw_input = pending.get("tool_input")
        tool_input = dict(raw_input) if isinstance(raw_input, dict) else {}

    question = f"允许 Claude Code 使用「{display_name}」？"
    _ = tool_input  # full input stays in bridge queue for respond_permission
    return {
        "id": request_id,
        "question": question,
        "context": {
            "source": "claude_code_permission",
            "tool": tool_name,
            "display_name": display_name,
            "tool_use_id": tool_use_id,
            "input_summary": input_summary,
            "risk": risk,
            "harness": "claude-code",
        },
    }


def harness_spawn_options_for_run_mode(
    harness_id: str,
    run_mode: str,
) -> Dict[str, Any]:
    """Fold Near confirm strategy into adapter spawn options.

    - Claude Code ``auto`` → ``auto_allow_permissions=True`` (CLI never blocks).
    - Claude Code ``ask`` / ``allowlist`` → queue prompts (allowlist auto-allows
      low-risk Read/Glob/Grep inside the bridge).
    - CodeBuddy ``auto`` → ``permission_mode=acceptEdits`` (CB has no interactive
      ``can_use_tool`` channel; ask/allowlist keep CB default and may still
      stall on gated tools — documented, not broken).
    - Codex ``auto`` / 「全部允许」→ ``workspace-write`` with network access.
      Near promises not to ask, but workspace isolation still applies, so this
      is not ``danger-full-access``.
    - Codex ``allowlist`` / 「按需确认」→ ``workspace-write`` without network
      (Codex has no interactive approval channel; risky outbound stays blocked).
    - Codex ``ask`` / empty / unknown → ``read-only`` without network.
    """
    hid = str(harness_id or "").strip()
    mode = str(run_mode or "").strip().lower()
    if mode in {"manual", "semi-auto"}:
        mode = "ask" if mode == "manual" else "allowlist"
    if hid == "claude-code":
        if mode == "auto":
            return {"auto_allow_permissions": True}
        policy = "allowlist" if mode == "allowlist" else "ask"
        return {
            "auto_allow_permissions": False,
            "permission_policy": policy,
        }
    if hid == "codebuddy":
        if mode == "auto":
            return {"permission_mode": "acceptEdits"}
        return {}
    if hid == "codex":
        # full_auto is always cleared so a leftover flag cannot silently
        # open danger-full-access after the user switches to a tighter mode.
        if mode == "auto":
            return {
                "sandbox": "workspace-write",
                "network_access": True,
                "full_auto": False,
            }
        if mode == "allowlist":
            return {
                "sandbox": "workspace-write",
                "network_access": False,
                "full_auto": False,
            }
        return {
            "sandbox": "read-only",
            "network_access": False,
            "full_auto": False,
        }
    return {}


__all__ = [
    "harness_spawn_options_for_run_mode",
    "pending_permission_to_confirm_sse_data",
]
