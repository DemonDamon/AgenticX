#!/usr/bin/env python3
"""Five-field cron parsing and next-fire computation for managed schedules.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_FIELD_SPECS = (
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("day_of_month", 1, 31),
    ("month", 1, 12),
    ("day_of_week", 0, 7),
)
_STEP_RE = re.compile(r"^\d{1,2}$")
_RANGE_RE = re.compile(r"^(\d{1,2})(?:-(\d{1,2}))?$")
_TEMPLATE_RE = re.compile(r"\{\{([^{}]+)\}\}")
_TEMPLATE_LIMIT = 16384


class CronError(ValueError):
    """A cron expression or time zone cannot be used."""


@dataclass(frozen=True)
class CronSpec:
    """Expanded five-field cron. ``days_of_week`` uses 0 for Sunday."""

    minutes: tuple[int, ...]
    hours: tuple[int, ...]
    days_of_month: frozenset[int]
    months: frozenset[int]
    days_of_week: frozenset[int]
    dom_restricted: bool
    dow_restricted: bool


def _invalid(name: str) -> CronError:
    return CronError(f"cron: {name} is invalid")


def _parse_step(text: str, name: str) -> int:
    if _STEP_RE.fullmatch(text) is None:
        raise _invalid(name)
    step = int(text)
    if step < 1 or step > 59:
        raise _invalid(name)
    return step


def _range_values(start: int, end: int, step: int, name: str) -> list[int]:
    values = list(range(start, end + 1, step))
    if not values:
        raise _invalid(name)
    return values


def _expand_item(item: str, name: str, low: int, high: int) -> list[int]:
    if item == "*":
        return _range_values(low, high, 1, name)
    if item.startswith("*/"):
        return _range_values(low, high, _parse_step(item[2:], name), name)
    slash = item.find("/")
    range_part = item if slash < 0 else item[:slash]
    step = 1 if slash < 0 else _parse_step(item[slash + 1 :], name)
    match = _RANGE_RE.fullmatch(range_part)
    if match is None:
        raise _invalid(name)
    start = int(match.group(1))
    end_text = match.group(2)
    if end_text is None:
        end = high if slash >= 0 else start
    else:
        end = int(end_text)
        if start > end:
            raise _invalid(name)
    if start < low or start > high or end < low or end > high:
        raise _invalid(name)
    if slash < 0 and end_text is None:
        return [start]
    return _range_values(start, end, step, name)


def _expand_field(field: str, name: str, low: int, high: int) -> list[int]:
    if not field:
        raise _invalid(name)
    values: set[int] = set()
    for item in field.split(","):
        if not item:
            raise _invalid(name)
        values.update(_expand_item(item, name, low, high))
    return sorted(values)


def parse_cron(expr: str) -> CronSpec:
    """Parse a 5-field cron expression. ``7`` in the weekday field becomes ``0``."""
    if not isinstance(expr, str):
        raise CronError("cron: expected 5 fields")
    fields = re.split(r" +", expr.strip()) if expr.strip() else []
    if len(fields) != 5:
        raise CronError("cron: expected 5 fields")
    expanded: list[list[int]] = []
    for field, (name, low, high) in zip(fields, _FIELD_SPECS, strict=True):
        expanded.append(_expand_field(field, name, low, high))
    minutes = expanded[0]
    if len(minutes) > 12:
        raise CronError("cron: minute field fires more than 12 times per hour")
    days_of_week = frozenset(0 if value == 7 else value for value in expanded[4])
    return CronSpec(
        minutes=tuple(minutes),
        hours=tuple(expanded[1]),
        days_of_month=frozenset(expanded[2]),
        months=frozenset(expanded[3]),
        days_of_week=days_of_week,
        dom_restricted=fields[2] != "*",
        dow_restricted=fields[4] != "*",
    )


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise CronError("timezone: unknown time zone") from exc


def _candidate(year: int, month: int, day: int, hour: int, minute: int, zone: ZoneInfo) -> datetime:
    naive = datetime(year, month, day, hour, minute)
    local = naive.replace(tzinfo=zone)
    roundtrip = local.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
    if roundtrip != naive:
        local = (naive + timedelta(hours=1)).replace(tzinfo=zone)
    return local.astimezone(timezone.utc)


def _day_matches(spec: CronSpec, day: datetime) -> bool:
    if day.month not in spec.months:
        return False
    dom_ok = day.day in spec.days_of_month
    dow_ok = (day.weekday() + 1) % 7 in spec.days_of_week
    if spec.dom_restricted and spec.dow_restricted:
        return dom_ok or dow_ok
    if spec.dom_restricted:
        return dom_ok
    if spec.dow_restricted:
        return dow_ok
    return True


def next_fire(spec: CronSpec, tz: str, after: datetime) -> datetime:
    """Return the first UTC instant strictly after ``after`` that matches ``spec``."""
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    else:
        after = after.astimezone(timezone.utc)
    zone = _zone(tz)
    local = after.astimezone(zone)
    day = local.date()
    for _ in range(1500):
        current = datetime(day.year, day.month, day.day)
        if _day_matches(spec, current):
            for hour in spec.hours:
                for minute in spec.minutes:
                    candidate = _candidate(day.year, day.month, day.day, hour, minute, zone)
                    if candidate > after:
                        return candidate
        day = day + timedelta(days=1)
    raise CronError("cron: no future fire time")


def render_template(
    template: str,
    *,
    scheduled_for: datetime,
    tz: str,
    schedule_name: str,
    run_id: str,
) -> str:
    """Replace the four known placeholders. Unknown ``{{x}}`` tokens stay put."""
    if scheduled_for.tzinfo is None:
        scheduled_for = scheduled_for.replace(tzinfo=timezone.utc)
    local = scheduled_for.astimezone(_zone(tz))
    values = {
        "date": local.strftime("%Y-%m-%d"),
        "datetime": local.strftime("%Y-%m-%d %H:%M"),
        "schedule_name": schedule_name,
        "run_id": run_id,
    }

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in values:
            return values[name]
        return match.group(0)

    rendered = _TEMPLATE_RE.sub(replace, template)
    raw = rendered.encode("utf-8")
    if len(raw) <= _TEMPLATE_LIMIT:
        return rendered
    return raw[:_TEMPLATE_LIMIT].decode("utf-8", errors="ignore")


__all__ = [
    "CronError",
    "CronSpec",
    "next_fire",
    "parse_cron",
    "render_template",
]
