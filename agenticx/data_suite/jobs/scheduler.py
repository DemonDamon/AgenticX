from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from agenticx.data_suite.jobs.dsl import JobSpec


def _match_field(field: str, value: int) -> bool:
    field = (field or "*").strip()
    if field == "*":
        return True
    # comma lists and single ints; P0 subset (no ranges/steps)
    parts = [p.strip() for p in field.split(",") if p.strip()]
    for p in parts:
        try:
            if int(p) == value:
                return True
        except ValueError:
            return False
    return False


def cron_matches(expr: str, when: datetime) -> bool:
    """Match 5-field cron: minute hour dom month dow (0=Sun..6=Sat, also 7=Sun)."""
    parts = (expr or "").split()
    if len(parts) != 5:
        return False
    minute, hour, dom, month, dow = parts
    if not _match_field(minute, when.minute):
        return False
    if not _match_field(hour, when.hour):
        return False
    if not _match_field(dom, when.day):
        return False
    if not _match_field(month, when.month):
        return False
    # Python weekday: Mon=0..Sun=6 → cron Sunday=0
    cron_dow = (when.weekday() + 1) % 7
    if dow != "*":
        ok = False
        for p in dow.split(","):
            p = p.strip()
            try:
                v = int(p)
            except ValueError:
                return False
            if v == 7:
                v = 0
            if v == cron_dow:
                ok = True
                break
        if not ok:
            return False
    return True


@dataclass
class DataJobScheduler:
    jobs: List[JobSpec] = field(default_factory=list)

    def due(self, now: Optional[datetime] = None) -> List[JobSpec]:
        when = now or datetime.now()
        out: List[JobSpec] = []
        for job in self.jobs:
            if job.schedule and cron_matches(job.schedule, when):
                out.append(job)
        return out
