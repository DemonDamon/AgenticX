#!/usr/bin/env python3
"""Episode pin sidecar for memory graph retention protection.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Set

logger = logging.getLogger(__name__)

DEFAULT_PINS_PATH = Path.home() / ".agenticx" / "memory" / "graph_pins.json"


def _pins_path() -> Path:
    return DEFAULT_PINS_PATH


def _read_all() -> dict[str, list[str]]:
    path = _pins_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("graph_pins.json unreadable, treating as empty: %s", exc)
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, value in raw.items():
        gid = str(key or "").strip()
        if not gid:
            continue
        if isinstance(value, list):
            out[gid] = [str(v).strip() for v in value if str(v).strip()]
    return out


def _write_all(data: dict[str, list[str]]) -> None:
    path = _pins_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_pins(group_id: str) -> Set[str]:
    """Return pinned episode UUIDs for a graph partition."""
    gid = str(group_id or "").strip()
    if not gid:
        return set()
    rows = _read_all().get(gid) or []
    return {row for row in rows if row}


def set_pin(group_id: str, episode_uuid: str, *, pinned: bool) -> None:
    """Pin or unpin one episode within a partition."""
    gid = str(group_id or "").strip()
    eid = str(episode_uuid or "").strip()
    if not gid or not eid:
        return
    try:
        data = _read_all()
        current = set(data.get(gid) or [])
        if pinned:
            current.add(eid)
        else:
            current.discard(eid)
        if current:
            data[gid] = sorted(current)
        elif gid in data:
            del data[gid]
        _write_all(data)
    except Exception as exc:
        logger.warning("failed to update graph pin (%s/%s): %s", gid, eid, exc)


def is_pinned(group_id: str, episode_uuid: str) -> bool:
    """Return True when the episode is pinned in the given partition."""
    return str(episode_uuid or "").strip() in load_pins(group_id)
