"""Pre-tool guard hook: block dangerous shell commands.

Author: Damon Li
"""

from __future__ import annotations

import re

from agenticx.hooks.types import HookEvent

# Note: the old pattern ``(-\w*f|-\w*r){2,}`` required *adjacent* flag tokens, so it
# missed the common form ``rm -rf`` (single ``-rf`` cluster) and ``rm -r -f`` (space).
# Anchor ``rm`` to line / statement starts so we do not false-positive on e.g.
# ``git commit -m "rm -rf docs"``.
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
]


def _resolve_shell_command(event: HookEvent) -> str:
    raw = event.context.get("command", "")
    if isinstance(raw, str) and raw.strip():
        return raw
    if str(event.context.get("tool_name", "")).strip() == "bash_exec":
        ti = event.context.get("tool_input")
        if isinstance(ti, dict):
            c = ti.get("command", "")
            if isinstance(c, str) and c.strip():
                return c
    return ""


async def handle(event: HookEvent) -> bool | None:
    if event.type != "tool" or event.action != "before_call":
        return True

    command = _resolve_shell_command(event)
    if not command.strip():
        return True

    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(command):
            return False

    return True
