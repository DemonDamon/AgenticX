#!/usr/bin/env python3
"""User-configured path rules (``permissions.path_rules``).

The settings UI promises: match file paths by glob and allow or deny
access. Until this module was wired onto the execution path, that
promise was only stored and returned by the permissions API.

Two tiers:

``allow: false`` (deny)
    Absolute refusal. Short-circuits before the confirm gate. A written
    ban must not become "approve this once".

``allow: true`` (allow)
    Skip confirmation, not "open the sandbox". It is a standing
    exemption for writes on that path. It cannot let a path leave the
    workspace -- the workspace boundary belongs to the sandbox and
    ``_resolve_workspace_path``. A rule written as ``/**`` must not
    dismantle isolation.

Deny is global: any matching deny wins, regardless of list order.
Allow is first-match among remaining allow rules.

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Any, Optional, Sequence

#: Result of one match. ``None`` means no rule hit.
PathDecision = Optional[bool]


def normalize_path_rules(raw: Any) -> list[tuple[str, bool]]:
    """Return ``[(pattern, allow), …]`` from whatever the config holds.

    Rules are hand-written and may be edited by other tools. Bad values
    are skipped, not raised: exploding the execution path because of one
    malformed rule is worse than ignoring that rule.
    """
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[tuple[str, bool]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        pattern = str(entry.get("pattern", "") or "").strip()
        if not pattern:
            continue
        # Only an explicit false is a deny; missing allow defaults to allow.
        out.append((pattern, entry.get("allow") is not False))
    return out


def match_path_rules(
    path: str | Path,
    rules: Sequence[tuple[str, bool]],
) -> tuple[PathDecision, str]:
    """Deny wins globally; among allows, the first match wins.

    "First match wins" contradicts "deny is absolute": ``allow *`` then
    ``deny */.env`` would let ``.env`` through. Scan every deny first.
    If none hit, take the first allow in order.

    Args:
        path: Already-resolved absolute path.
        rules: Output of :func:`normalize_path_rules`.

    Returns:
        ``(decision, pattern)``. When ``decision`` is ``None``,
        ``pattern`` is empty.
    """
    text = str(path)
    # Globs are written with ``/``. Compare Windows paths both as-is
    # and with forward slashes so a rule does not silently miss.
    candidates = {text, text.replace("\\", "/")}

    def _hits(pattern: str) -> bool:
        shapes = {pattern, pattern.replace("\\", "/")}
        return any(
            fnmatch.fnmatch(candidate, shape)
            for candidate in candidates
            for shape in shapes
        )

    for pattern, allow in rules:
        if not allow and _hits(pattern):
            return False, pattern
    for pattern, allow in rules:
        if allow and _hits(pattern):
            return True, pattern
    return None, ""


def path_rule_decision(
    path: str | Path,
    raw_rules: Any,
) -> tuple[PathDecision, str]:
    """Convenience wrapper: normalize then match."""
    return match_path_rules(path, normalize_path_rules(raw_rules))
