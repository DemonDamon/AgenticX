#!/usr/bin/env python3
"""Cron-oriented bridge over ``automation_tasks.json``.

Author: Damon Li
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from agenticx.runtime._automation_tasks_io import load_automation_tasks, save_automation_tasks

_log = logging.getLogger(__name__)


def _parse_iso_ts(ts: Any) -> Optional[float]:
    if ts is None:
        return None
    raw = str(ts).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


class CronSource:
    """Poll persisted automation tasks with ``longrun_server_dispatch: true``."""

    def __init__(self, *, min_gap_sec: float = 3600.0) -> None:
        self._min_gap_sec = float(min_gap_sec)

    def _is_due(self, row: Dict[str, Any], now: float) -> bool:
        freq = row.get("frequency") if isinstance(row.get("frequency"), dict) else {}
        ftype = str(freq.get("type", "daily")).strip().lower()
        last_ts = _parse_iso_ts(row.get("lastRunAt"))
        if ftype == "interval":
            hours = float(freq.get("hours") or 24)
            gap = max(hours * 3600.0, self._min_gap_sec)
            if last_ts is None:
                return True
            return (now - float(last_ts)) >= gap
        if last_ts is None:
            return True
        return (now - float(last_ts)) >= self._min_gap_sec

    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        now = time.time()
        for row in load_automation_tasks():
            if not isinstance(row, dict):
                continue
            if not bool(row.get("enabled", False)):
                continue
            if not bool(row.get("longrun_server_dispatch", False)):
                continue
            tid = str(row.get("id", "") or "").strip()
            prompt = str(row.get("prompt", "") or "").strip()
            if not tid or not prompt:
                continue
            if not self._is_due(row, now):
                continue
            payload: Dict[str, Any] = {
                "id": f"auto-{tid}",
                "task": prompt,
                "name": str(row.get("name", "") or tid),
                "role": "automation",
                "wants_continuation": False,
            }
            prov = str(row.get("provider", "") or "").strip()
            mod = str(row.get("model", "") or "").strip()
            if prov:
                payload["provider"] = prov
            if mod:
                payload["model"] = mod
            items.append(payload)
        return items

    async def mark_task_done(self, task_id: str) -> None:
        tid = str(task_id or "").strip()
        if not tid.startswith("auto-"):
            return
        real = tid[5:].strip()
        if not real:
            return
        rows = load_automation_tasks()
        changed = False
        stamp = datetime.now(timezone.utc).isoformat()
        for row in rows:
            if isinstance(row, dict) and str(row.get("id", "")).strip() == real:
                row["lastRunAt"] = stamp
                row["lastRunStatus"] = "ok"
                changed = True
                break
        if changed:
            try:
                save_automation_tasks(rows)
            except Exception:
                _log.warning("CronSource failed to persist lastRunAt for %s", real, exc_info=True)
