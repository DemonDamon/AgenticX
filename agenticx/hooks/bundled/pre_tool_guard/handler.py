"""Pre-tool guard hook: block dangerous shell commands.

Inspects tool calls that may execute shell commands and blocks known
dangerous patterns (rm -rf, DROP TABLE/DATABASE, etc.).

Covers multiple shell-executing tool names beyond just ``bash_exec``.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Optional

from agenticx.hooks.types import HookEvent

_SHELL_TOOL_NAMES = frozenset(
    {
        "bash_exec",
        "run_terminal_cmd",
        "shell_exec",
        "terminal",
        "execute_command",
        "run_command",
        "shell",
        "bash",
        "command",
    }
)

_COMMAND_FIELDS = ("command", "cmd", "script", "code", "shell_command")

_RM_PREFIX = r"(?m)(?:^|[;&]|\|\||&&)\s*"
_DANGEROUS_PATTERNS = [
    re.compile(
        _RM_PREFIX + r"rm\s+-(?:[\w-]*r[\w-]*f|[\w-]*f[\w-]*r)\b",
        re.IGNORECASE,
    ),
    re.compile(_RM_PREFIX + r"rm\s+-\w*r\b\s+-\w*f\b", re.IGNORECASE),
    re.compile(_RM_PREFIX + r"rm\s+-\w*f\b\s+-\w*r\b", re.IGNORECASE),
    re.compile(r"\bDROP\s+(TABLE|DATABASE)\b", re.IGNORECASE),
    re.compile(r"\bformat\s+[a-zA-Z]:", re.IGNORECASE),
    re.compile(r">\s*/dev/sd[a-z]", re.IGNORECASE),
    re.compile(r"\bmkfs\b", re.IGNORECASE),
    re.compile(r"\bdd\s+.*\bof=/dev/", re.IGNORECASE),
    # Download-and-execute via shell pipe (classic remote script execution).
    re.compile(r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:bash|sh|zsh)\b", re.IGNORECASE),
    # Reverse shell-ish patterns.
    re.compile(r"/dev/tcp/\d{1,3}(?:\.\d{1,3}){3}/\d{1,5}", re.IGNORECASE),
    re.compile(r"\b(?:nc|ncat|netcat)\b[^\n]*\s(?:-e|--exec)\b", re.IGNORECASE),
]


def _resolve_shell_command(event: HookEvent) -> str:
    """Extract shell command text from the event context.

    Strategy (in priority order):
    1. Explicit ``context["command"]`` set by the event bridge.
    2. For any known shell tool name, scan ``tool_input`` for
       command-like fields.
    """
    raw = event.context.get("command", "")
    if isinstance(raw, str) and raw.strip():
        return raw

    tool_name = str(event.context.get("tool_name", "")).strip().lower()
    ti = event.context.get("tool_input")

    if tool_name in _SHELL_TOOL_NAMES and isinstance(ti, dict):
        return _extract_command_from_input(ti)

    if isinstance(ti, dict):
        candidate = _extract_command_from_input(ti)
        if candidate:
            return candidate

    return ""


def _extract_command_from_input(ti: dict) -> str:
    """Search tool_input dict for command-like field values."""
    for field in _COMMAND_FIELDS:
        val = ti.get(field, "")
        if isinstance(val, str) and val.strip():
            return val
    return ""


async def handle(event: HookEvent) -> Optional[bool]:
    if event.type != "tool" or event.action != "before_call":
        return True

    command = _resolve_shell_command(event)
    if not command.strip():
        return True

    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(command):
            return False

    return True
