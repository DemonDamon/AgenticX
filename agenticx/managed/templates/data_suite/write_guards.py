"""Shared agent write-gate decisions for Data Suite and MCPHub."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from agenticx.managed.templates.data_suite.types import WriteGuardPolicy

# Stable error codes (master plan W0/W1 contract).
CODE_WRITE_GUARD_DENIED = "write_guard_denied"
CODE_WRITE_TOOLS_DISABLED = "write_tools_disabled"

_WRITE_TOOL_TOKEN_RE = re.compile(r"[^a-z0-9]+")
_WRITE_TOOL_TOKENS = frozenset(
    {
        "write",
        "writes",
        "create",
        "insert",
        "update",
        "upsert",
        "delete",
        "drop",
        "truncate",
        "alter",
        "mutate",
        "exec",
        "execute",
        "bash",
        "shell",
        "rm",
        "remove",
        "put",
        "patch",
        "grant",
        "revoke",
        "publish",
        "upload",
        "send",
        "post",
    }
)


@dataclass(frozen=True)
class WriteGateDecision:
    """Unified write-gate outcome shared by NL2SQL and MCPHub."""

    allowed: bool
    code: str = ""
    reason: str = ""

    def raise_if_denied(self, *, as_permission_error: bool = False) -> None:
        if self.allowed:
            return
        msg = self.reason or self.code or CODE_WRITE_GUARD_DENIED
        if as_permission_error:
            raise PermissionError(msg)
        raise ValueError(msg)


def allow_write() -> WriteGateDecision:
    return WriteGateDecision(allowed=True, code="", reason="")


def deny_write(*, code: str, reason: str) -> WriteGateDecision:
    return WriteGateDecision(allowed=False, code=code, reason=reason)


def decide_non_readonly_sql() -> WriteGateDecision:
    """Denial used when SQL is not a safe read-only statement."""
    return deny_write(
        code=CODE_WRITE_GUARD_DENIED,
        reason=f"{CODE_WRITE_GUARD_DENIED}: non-readonly sql",
    )


def decide_sql_write_gate(*, is_readonly: bool) -> WriteGateDecision:
    if is_readonly:
        return allow_write()
    return decide_non_readonly_sql()


def decide_manifest_tools_gate(
    denied_tool_names: list[str] | tuple[str, ...] | set[str],
) -> WriteGateDecision:
    names = sorted({str(n) for n in denied_tool_names if str(n)})
    if not names:
        return allow_write()
    return deny_write(
        code=CODE_WRITE_GUARD_DENIED,
        reason=f"{CODE_WRITE_GUARD_DENIED}: {names}",
    )


def tool_requires_write_enable(name: str, *, description: str = "") -> bool:
    """Heuristic: treat mutating-looking MCP tool names as write-gated."""
    blob = f"{name or ''} {description or ''}".lower()
    tokens = {t for t in _WRITE_TOOL_TOKEN_RE.split(blob) if t}
    return bool(tokens & _WRITE_TOOL_TOKENS)


def decide_mcp_write_gate(
    *,
    requires_write_enable: bool,
    write_tools_enabled: bool,
    tool_name: str = "",
) -> WriteGateDecision:
    if not requires_write_enable or write_tools_enabled:
        return allow_write()
    label = tool_name or "tool"
    return deny_write(
        code=CODE_WRITE_TOOLS_DISABLED,
        reason=(
            f"{CODE_WRITE_TOOLS_DISABLED}: write tool {label!r} "
            "requires explicit enable"
        ),
    )


def _tool_names(manifest: Mapping[str, Any]) -> list[str]:
    names: list[str] = []
    for item in manifest.get("tools") or []:
        if not isinstance(item, Mapping):
            continue
        t = str(item.get("type") or "")
        if t == "custom":
            name = str(item.get("name") or "")
            if name:
                names.append(name)
        elif t == "agx_builtin":
            for cfg in item.get("configs") or []:
                if not isinstance(cfg, Mapping):
                    continue
                if cfg.get("enabled") is False:
                    continue
                name = str(cfg.get("name") or "")
                if name:
                    names.append(name)
    return names


def evaluate_read_only_tools(
    manifest: Mapping[str, Any],
    policy: WriteGuardPolicy | None = None,
) -> WriteGateDecision:
    """Return a write-gate decision for enabled tools in an agent manifest."""
    policy = policy or WriteGuardPolicy()
    denied: list[str] = []
    for name in _tool_names(manifest):
        if name in policy.deny_tool_names:
            denied.append(name)
            continue
        if name.startswith("data_suite_"):
            continue
        if any(name.startswith(p) for p in policy.allow_prefixes):
            continue
        # Custom tools outside allowlist are denied for NL2SQL stubs.
        if "." not in name and name not in policy.deny_tool_names:
            denied.append(name)
    return decide_manifest_tools_gate(denied)


def assert_read_only_tools(
    manifest: Mapping[str, Any],
    policy: WriteGuardPolicy | None = None,
) -> None:
    """Raise ValueError if any enabled tool violates the write-guard policy."""
    evaluate_read_only_tools(manifest, policy).raise_if_denied(as_permission_error=False)


__all__ = [
    "CODE_WRITE_GUARD_DENIED",
    "CODE_WRITE_TOOLS_DISABLED",
    "WriteGateDecision",
    "allow_write",
    "assert_read_only_tools",
    "decide_manifest_tools_gate",
    "decide_mcp_write_gate",
    "decide_non_readonly_sql",
    "decide_sql_write_gate",
    "deny_write",
    "evaluate_read_only_tools",
    "tool_requires_write_enable",
]
