#!/usr/bin/env python3
"""Pure retention selection logic for memory graph episodes.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Set, Tuple


def parse_episode_reference_time(item: Dict[str, Any]) -> datetime | None:
    """Parse referenceTime from a timeline DTO."""
    raw = item.get("referenceTime") or item.get("reference_time")
    if raw is None:
        return None
    if isinstance(raw, datetime):
        dt = raw
    else:
        text = str(raw).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def select_episodes_for_prune(
    episodes: List[Dict[str, Any]],
    *,
    max_episodes: int,
    max_age_days: int,
    pinned: Set[str],
    now: datetime | None = None,
) -> Tuple[List[str], int]:
    """Return episode UUIDs to delete and the count that would be kept.

    Pinned episodes are never selected for deletion. When max_episodes is set,
    the newest episodes are kept plus any pinned episodes outside that window.
    """
    if not episodes:
        return [], 0
    if max_episodes <= 0 and max_age_days <= 0:
        return [], len(episodes)

    ref_now = now or datetime.now(timezone.utc)
    pinned_ids = {str(x).strip() for x in pinned if str(x).strip()}

    by_id: Dict[str, Dict[str, Any]] = {}
    for item in episodes:
        eid = str(item.get("id") or "").strip()
        if eid:
            by_id[eid] = item

    to_delete: Set[str] = set()

    if max_age_days > 0:
        cutoff = ref_now - timedelta(days=max_age_days)
        for eid, item in by_id.items():
            if eid in pinned_ids:
                continue
            ref = parse_episode_reference_time(item)
            if ref is not None and ref < cutoff:
                to_delete.add(eid)

    if max_episodes > 0 and len(by_id) > max_episodes:
        sorted_eps = sorted(
            by_id.items(),
            key=lambda pair: parse_episode_reference_time(pair[1]) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        keep_ids: Set[str] = set(pinned_ids)
        for eid, _item in sorted_eps:
            if len(keep_ids) >= max_episodes:
                break
            keep_ids.add(eid)
        for eid in by_id:
            if eid not in keep_ids and eid not in pinned_ids:
                to_delete.add(eid)

    kept = len(by_id) - len(to_delete)
    return sorted(to_delete), max(kept, 0)
