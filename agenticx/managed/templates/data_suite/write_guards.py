"""Read-only write guards for Data Suite agent manifests."""

from __future__ import annotations

from typing import Any, Mapping

from agenticx.managed.templates.data_suite.types import WriteGuardPolicy


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


def assert_read_only_tools(
    manifest: Mapping[str, Any],
    policy: WriteGuardPolicy | None = None,
) -> None:
    """Raise ValueError if any enabled tool violates the write-guard policy."""
    policy = policy or WriteGuardPolicy()
    denied: list[str] = []
    for name in _tool_names(manifest):
        if name in policy.deny_tool_names:
            denied.append(name)
            continue
        if name.startswith("data_suite."):
            continue
        if any(name.startswith(p) for p in policy.allow_prefixes):
            continue
        # Custom tools outside allowlist are denied for NL2SQL stubs.
        if "." not in name and name not in policy.deny_tool_names:
            # allow explicit data_suite custom tools only when prefixed
            denied.append(name)
    if denied:
        raise ValueError(f"write_guard_denied: {sorted(set(denied))}")
