"""S1-1: golden-path FakeChannel seed + probe."""

from __future__ import annotations

import pytest

from agenticx.data_suite.channels.registry import ChannelRegistry
from examples.data_suite.golden_path.probe import (
    build_golden_registry,
    load_member_seed,
    probe_src,
)


def test_load_member_seed_has_rows():
    rows = load_member_seed()
    assert len(rows) >= 20
    assert "member_id" in rows[0]
    assert "email" in rows[0]


def test_probe_requires_src_channel():
    empty = ChannelRegistry()
    with pytest.raises(KeyError):
        probe_src(empty)


def test_probe_src_lists_members_table():
    registry = build_golden_registry()
    result = probe_src(registry)
    assert result.ok is True
    assert result.channel == "src"
    assert "members" in result.tables
    q = registry.get("src").query("SELECT * FROM members")
    assert len(q.rows) >= 20


def test_dst_registered_with_empty_table():
    registry = build_golden_registry()
    assert "dst" in registry.names()
    probe = registry.get("dst").probe()
    assert probe.ok is True
    assert "members_out" in probe.tables
