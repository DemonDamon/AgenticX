#!/usr/bin/env python3
"""Tool side-effect classification for replay safety.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Any

from agenticx.runtime.command_safety import assess_command

_READ_TOOLS = frozenset(
    {
        "file_read",
        "list_files",
        "file_search",
        "grep_search",
        "web_search",
        "web_fetch",
        "knowledge_search",
        "session_search",
    }
)
_LOCAL_WRITE_TOOLS = frozenset(
    {"file_write", "file_edit", "todo_write", "scratchpad_write"}
)
_EXTERNAL_WRITE_TOOLS = frozenset(
    {
        "send_message",
        "reply_message",
        "im_send_message",
        "lark_send_message",
        "lark_im_send_message",
        "feishu_send_message",
        "send_email",
        "slack_post_message",
        "create_calendar_event",
        "update_calendar_event",
        "delete_calendar_event",
        "create_approval",
        "approve_request",
        "reject_approval",
        "git_push",
        "github_create_issue",
        "github_add_comment",
        "github_create_pull_request",
        "github_merge_pull_request",
    }
)
_EXTERNAL_COMMAND_CODES = frozenset(
    {"external_publish", "host_full_access", "system_disruption"}
)
_LOCAL_COMMAND_CODES = frozenset({"dependency_change", "version_control_change"})
_LOCAL_REDIRECT = re.compile(r"(?<![<>&])>{1,2}\s*(?!&)([^\s;&|]+)")
_NETWORK_DEVICE_REDIRECT = re.compile(r"\d*>{1,2}\s*/dev/(?:tcp|udp)/")
_DYNAMIC_REDIRECT = re.compile(r"\d*>{1,2}&?\s*[\"']?(?:\$|`)")
_LOCAL_WRITE_COMMAND = re.compile(
    r"(?:^|[;&|]\s*)(?:touch|mkdir|rmdir|mv|cp|install|truncate|tee)\b"
)
_IN_PLACE_EDIT = re.compile(r"(?:^|[;&|]\s*)(?:sed|perl)\b[^\n;&|]*\s-i(?:\b|[.])")


def classify_tool_effect(tool_name: str, arguments: dict[str, Any]) -> str:
    """Classify a tool without claiming safety for unknown integrations."""
    name = str(tool_name or "").strip().lower()
    if name in _READ_TOOLS:
        return "read"
    if name in _LOCAL_WRITE_TOOLS:
        return "local_write"
    if name == "request_action_confirmation":
        return "none"
    if name in _EXTERNAL_WRITE_TOOLS:
        return "external_write"
    if name in {"bash_exec", "bash_bg_start"}:
        command = str(arguments.get("command", "") or "")
        verdict = assess_command(command)
        codes = {finding.code for finding in verdict.findings}
        if _NETWORK_DEVICE_REDIRECT.search(command):
            return "external_write"
        if codes & _EXTERNAL_COMMAND_CODES:
            return "external_write"
        if "version_control_change" in codes and re.search(
            r"(?:^|[;&|]\s*)git\s+(?:push|fetch|pull)\b", command
        ):
            return "external_write"
        if _DYNAMIC_REDIRECT.search(command):
            return "unknown"
        if codes and codes <= _LOCAL_COMMAND_CODES:
            return "local_write"
        redirect_targets = {
            match.group(1).strip("'\"") for match in _LOCAL_REDIRECT.finditer(command)
        }
        redirect_targets -= {"/dev/null", "/dev/stdout", "/dev/stderr", "NUL", "nul"}
        if (
            redirect_targets
            or _LOCAL_WRITE_COMMAND.search(command)
            or _IN_PLACE_EDIT.search(command)
        ):
            return "local_write" if not codes else "unknown"
        if verdict.contained and not verdict.undecidable:
            return "read"
        return "unknown"
    if name == "mcp_call" or name.startswith(
        ("computer_", "browser_click", "browser_type")
    ):
        return "unknown"
    return "unknown"
