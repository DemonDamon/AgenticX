#!/usr/bin/env python3
"""Enterprise agent-action policy loaded from the local desktop config.

The policy is inert unless the desktop is signed into an enterprise
(``enterprise.enabled`` is true and ``enterprise.token`` is non-empty).
Patterns use case-insensitive fnmatch against subjects:

- the tool name, such as ``bash_exec``
- ``mcp:<tool_name>`` for ``mcp_call``
- ``git:push`` when a ``bash_exec`` command runs ``git push``

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from typing import Any

_MAX_PATTERNS = 100
_PATTERN_RE = re.compile(r"^[A-Za-z0-9_:*./-]{1,128}$")
_GIT_PUSH_RE = re.compile(r"(?:^|[;&|]\s*)git\s+push\b", re.IGNORECASE)


@dataclass(frozen=True)
class EnterpriseAgentPolicy:
    denied: tuple[str, ...] = ()
    always_ask: tuple[str, ...] = ()
    disable_session_allow: bool = False


def _normalize_patterns(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if not _PATTERN_RE.fullmatch(text) or text in seen:
            continue
        seen.add(text)
        out.append(text)
        if len(out) >= _MAX_PATTERNS:
            break
    return tuple(out)


def _flag_true(value: Any) -> bool:
    return value is True


def _mapping(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    return None


def policy_from_mapping(raw: Any) -> EnterpriseAgentPolicy:
    """Validate an untrusted policy document. Invalid entries are dropped."""

    data = _mapping(raw)
    if data is None:
        return EnterpriseAgentPolicy()
    denied = data.get("denied_tools", data.get("deniedTools"))
    always_ask = data.get("always_ask_tools", data.get("alwaysAskTools"))
    if "disable_session_allow" in data:
        flag = data.get("disable_session_allow")
    else:
        flag = data.get("disableSessionAllow")
    return EnterpriseAgentPolicy(
        denied=_normalize_patterns(denied),
        always_ask=_normalize_patterns(always_ask),
        disable_session_allow=_flag_true(flag),
    )


def load_enterprise_agent_policy() -> EnterpriseAgentPolicy:
    """Return the signed-in enterprise policy, or an empty policy."""

    try:
        from agenticx.cli.config_manager import ConfigManager

        if ConfigManager.get_value("enterprise.enabled") is not True:
            return EnterpriseAgentPolicy()
        token = ConfigManager.get_value("enterprise.token")
        if not isinstance(token, str) or not token.strip():
            return EnterpriseAgentPolicy()
        return policy_from_mapping(ConfigManager.get_value("enterprise.agent_action_policy"))
    except Exception:
        return EnterpriseAgentPolicy()


def policy_subjects(tool_name: str, arguments: dict[str, Any] | None) -> list[str]:
    """Subjects a tool call can match. Order is the match priority."""

    name = str(tool_name or "").strip()
    args = arguments if isinstance(arguments, dict) else {}
    subjects: list[str] = []
    if name:
        subjects.append(name)
    if name == "mcp_call":
        mcp_name = str(args.get("tool_name") or "").strip()
        if mcp_name:
            subjects.append(f"mcp:{mcp_name}")
    if name == "bash_exec":
        command = args.get("command")
        if isinstance(command, str) and _GIT_PUSH_RE.search(command):
            subjects.append("git:push")
    return subjects


def _matches(subject: str, pattern: str) -> bool:
    return fnmatch.fnmatchcase(subject.casefold(), pattern.casefold())


def _first_match(subjects: list[str], patterns: tuple[str, ...]) -> str | None:
    for subject in subjects:
        for pattern in patterns:
            if _matches(subject, pattern):
                return subject
    return None


def enterprise_denied_subject(
    tool_name: str,
    arguments: dict[str, Any] | None,
    policy: EnterpriseAgentPolicy | None = None,
) -> str | None:
    """First subject denied by policy, or None."""

    active = policy if policy is not None else load_enterprise_agent_policy()
    return _first_match(policy_subjects(tool_name, arguments), active.denied)


def enterprise_ask_subject(
    tool_name: str,
    arguments: dict[str, Any] | None,
    policy: EnterpriseAgentPolicy | None = None,
) -> str | None:
    """First subject that must be confirmed, or None."""

    active = policy if policy is not None else load_enterprise_agent_policy()
    return _first_match(policy_subjects(tool_name, arguments), active.always_ask)
