#!/usr/bin/env python3
"""ULID and UTC timestamp tests.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone

from agenticx.managed.ids import is_ulid, new_ulid, parse_iso, utc_now_iso


def test_new_ulid_shape_and_order() -> None:
    generated = [new_ulid() for _ in range(1000)]
    assert all(is_ulid(value) for value in generated)
    assert len(set(generated)) == 1000
    assert new_ulid(now_ms=1) < new_ulid(now_ms=2)
    assert new_ulid(now_ms=0)[:10] == "0000000000"


def test_utc_now_iso_fixed_width() -> None:
    moment = datetime(2026, 10, 25, 6, 0, 0, 123456, tzinfo=timezone.utc)
    text = utc_now_iso(moment)
    assert text == "2026-10-25T06:00:00.123Z"
    parsed = parse_iso(text)
    assert abs((parsed - moment).total_seconds()) < 0.001
