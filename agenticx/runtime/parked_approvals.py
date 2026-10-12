#!/usr/bin/env python3
"""In-process registry of unattended confirmations waiting for a human.

Author: Damon Li
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, List

DEFAULT_APPROVAL_TIMEOUT_SECONDS = 1200
MIN_APPROVAL_TIMEOUT_SECONDS = 60
MAX_APPROVAL_TIMEOUT_SECONDS = 7200

_FALSE_TOKENS = frozenset({"0", "false", "no", "off"})
_TRUE_TOKENS = frozenset({"1", "true", "yes", "on"})


@dataclass
class ParkedApproval:
    """One unattended confirmation waiting for a human decision.

    ``label`` is a display hint such as ``automation:atask_xxx`` or an avatar
    id. It may be empty.
    """

    request_id: str
    session_id: str
    agent_id: str
    question: str
    tool: str
    risk: str
    protected_reason: str
    label: str
    created_at: float
    expires_at: float


_lock = threading.Lock()
_items: Dict[str, ParkedApproval] = {}


def register(item: ParkedApproval) -> None:
    """Record a parked approval, replacing any row with the same request id."""

    with _lock:
        _items[item.request_id] = item


def remove(request_id: str) -> None:
    """Drop a parked approval. Missing ids are ignored."""

    with _lock:
        _items.pop(request_id, None)


def list_pending(now: float | None = None) -> List[Dict[str, Any]]:
    """Return live parked approvals, dropping rows that have already expired.

    Rows are ordered by ``created_at`` ascending. Each dict is the dataclass
    fields plus ``remaining_seconds``.
    """

    current = time.time() if now is None else now
    with _lock:
        expired = [
            request_id
            for request_id, item in _items.items()
            if item.expires_at <= current
        ]
        for request_id in expired:
            del _items[request_id]
        ordered = sorted(_items.values(), key=lambda item: item.created_at)
        rows: List[Dict[str, Any]] = []
        for item in ordered:
            row = asdict(item)
            row["remaining_seconds"] = max(0, int(item.expires_at - current))
            rows.append(row)
        return rows


def _parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value == 0:
            return False
        if value == 1:
            return True
        return None
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _FALSE_TOKENS:
            return False
        if token in _TRUE_TOKENS:
            return True
    return None


def _parse_timeout_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _clamp_timeout(value: float) -> float:
    if value < MIN_APPROVAL_TIMEOUT_SECONDS:
        return float(MIN_APPROVAL_TIMEOUT_SECONDS)
    if value > MAX_APPROVAL_TIMEOUT_SECONDS:
        return float(MAX_APPROVAL_TIMEOUT_SECONDS)
    return float(value)


def _config_value(key: str) -> Any:
    """Read one config key. Failures and a missing manager count as unset."""

    try:
        from agenticx.cli.config_manager import ConfigManager

        return ConfigManager.get_value(key)
    except Exception:
        return None


def approval_parking_enabled() -> bool:
    """Whether unattended protected confirms wait for a human.

    ``AGX_UNATTENDED_APPROVAL_PARKING`` wins when it is an explicit flag
    (``0/false/no/off`` or ``1/true/yes/on``). Otherwise
    ``unattended.approval_parking`` is used. Missing config defaults to True.
    """

    raw_env = os.environ.get("AGX_UNATTENDED_APPROVAL_PARKING")
    if raw_env is not None and raw_env.strip():
        parsed_env = _parse_bool(raw_env)
        if parsed_env is not None:
            return parsed_env
    parsed = _parse_bool(_config_value("unattended.approval_parking"))
    if parsed is None:
        return True
    return parsed


def approval_timeout_seconds() -> float:
    """Bounded wait for a parked unattended approval, in seconds.

    Env ``AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC`` wins. An unparseable env value
    uses the default and does not consult config. When env is unset, config
    ``unattended.approval_timeout_seconds`` is next. The result is clamped to
    ``[60, 7200]``.
    """

    raw_env = os.environ.get("AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC")
    if raw_env is not None and raw_env.strip():
        parsed_env = _parse_timeout_number(raw_env)
        if parsed_env is None:
            return float(DEFAULT_APPROVAL_TIMEOUT_SECONDS)
        return _clamp_timeout(parsed_env)

    parsed_config = _parse_timeout_number(
        _config_value("unattended.approval_timeout_seconds")
    )
    if parsed_config is None:
        return float(DEFAULT_APPROVAL_TIMEOUT_SECONDS)
    return _clamp_timeout(parsed_config)
