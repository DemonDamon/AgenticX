#!/usr/bin/env python3
"""Shared cron fixture and next-fire rules.

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from ma_agent_runtime.cron import CronError, next_fire, parse_cron, render_template

_FIXTURE = json.loads(
    (Path(__file__).resolve().parents[4] / "tests/fixtures/managed_agents/cron_cases.json").read_text(
        encoding="utf-8"
    )
)


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def test_shared_fixture_validity() -> None:
    for expr in _FIXTURE["valid"]:
        parse_cron(expr)
    for item in _FIXTURE["invalid"]:
        with pytest.raises(CronError) as caught:
            parse_cron(item["expr"])
        assert str(caught.value) == item["error"]


def test_next_fire_fixture() -> None:
    for item in _FIXTURE["next_fire"]:
        spec = parse_cron(item["expr"])
        assert next_fire(spec, item["tz"], _utc(item["after"])) == _utc(item["expect"])


def test_next_fire_strictly_after() -> None:
    spec = parse_cron("*/15 * * * *")
    after = _utc("2026-10-25T10:15:00Z")
    assert next_fire(spec, "UTC", after) == _utc("2026-10-25T10:30:00Z")


def test_render_template_variables() -> None:
    rendered = render_template(
        "日报 {{date}} {{datetime}} {{schedule_name}} {{run_id}} {{unknown}}",
        scheduled_for=_utc("2026-10-26T01:00:00Z"),
        tz="Asia/Shanghai",
        schedule_name="销售",
        run_id="run-1",
    )
    assert rendered == "日报 2026-10-26 2026-10-26 09:00 销售 run-1 {{unknown}}"
