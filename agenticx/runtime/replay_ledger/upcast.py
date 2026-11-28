"""Read-time upcasters for persisted replay ledger event rows.

Ledger rows are append-only and are never rewritten on disk. A row written
by an older schema is upgraded in memory on every read, one registered step
at a time, until it reaches the current schema version. A row that cannot be
upgraded (no step registered for its version, or newer than this build) is
returned with its version untouched so callers can still read its base
fields.

Rule: bumping ``SCHEMA_VERSION`` is only allowed together with a step that
upgrades the previous version.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Callable

UpcastStep = Callable[[dict[str, Any]], dict[str, Any]]


def row_schema_version(row: dict[str, Any]) -> int:
    """Return the version a persisted row declares; missing or blank means v0."""
    raw = row.get("schema_version")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return 0
    return max(0, int(raw))


def upcast_event_row(row: dict[str, Any], *, target_version: int) -> dict[str, Any]:
    """Upgrade one persisted row in memory up to ``target_version``."""
    if not isinstance(row, dict):
        raise ValueError("event row must be a JSON object")
    upgraded = dict(row)
    version = row_schema_version(upgraded)
    target = int(target_version)
    while version < target:
        step = UPGCAST_STEPS.get(version)
        if step is None:
            break
        upgraded = dict(step(upgraded))
        version += 1
    upgraded["schema_version"] = version
    return upgraded


def _upcast_v0_to_v1(row: dict[str, Any]) -> dict[str, Any]:
    """v0 rows predate the version stamp; their field set already matches v1."""
    row["schema_version"] = 1
    return row


# Key: the row's version BEFORE the step. Value: the step to version + 1.
UPGCAST_STEPS: dict[int, UpcastStep] = {0: _upcast_v0_to_v1}
