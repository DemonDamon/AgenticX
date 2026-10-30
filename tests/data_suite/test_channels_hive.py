"""Unit tests for HiveChannel (in-memory / injected transport; no live Hive)."""

from __future__ import annotations

import pytest

from agenticx.data_suite.channels.base import WriteDeniedError
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.hive import HiveChannel, InMemoryHiveTransport


def test_hive_probe_lists_seeded_tables():
    transport = InMemoryHiveTransport(
        tables={
            "events": [{"id": 1}, {"id": 2}],
            "logs": [],
        }
    )
    ch = HiveChannel(name="h1", transport=transport)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.dialect == "hive"
    assert probe.tables == ["events", "logs"]


def test_hive_query_select_star_and_truncate():
    rows = [{"id": i, "v": f"r{i}"} for i in range(5)]
    transport = InMemoryHiveTransport(tables={"events": rows})
    ch = HiveChannel(name="h1", transport=transport)
    q = ch.query("SELECT * FROM events", limit=2)
    assert q.columns == ["id", "v"]
    assert q.rows == [[0, "r0"], [1, "r1"]]
    assert q.truncated is True
    q_all = ch.query("SELECT * FROM events", limit=10)
    assert len(q_all.rows) == 5
    assert q_all.truncated is False


def test_hive_query_rejects_non_select():
    transport = InMemoryHiveTransport(tables={"events": [{"id": 1}]})
    ch = HiveChannel(name="h1", transport=transport)
    with pytest.raises(ValueError, match="SELECT \\* FROM"):
        ch.query("DELETE FROM events")
    with pytest.raises(ValueError):
        ch.query("SELECT id FROM events")


def test_hive_write_requires_grant():
    transport = InMemoryHiveTransport(tables={"events": []})
    grants = WriteGrantStore(grants={"g1": {"channel": "h1", "table": "events"}})
    ch = HiveChannel(name="h1", transport=transport, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("events", [{"id": 1}], grant_id="nope")
    assert ch.write_rows("events", [{"id": 1, "name": "x"}], grant_id="g1") == 1
    q = ch.query("SELECT * FROM events")
    assert q.rows == [[1, "x"]]
    assert grants.audit and grants.audit[-1]["row_count"] == 1


def test_hive_from_dict_tables_seeds_memory():
    ch = HiveChannel.from_dict(
        "mem",
        {"tables": {"events": [{"id": 1}], "metrics": []}},
    )
    assert isinstance(ch.transport, InMemoryHiveTransport)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.tables == ["events", "metrics"]
    assert ch.query("SELECT * FROM events").rows == [[1]]


def test_hive_probe_endpoint_without_lib_ok_false():
    ch = HiveChannel.from_dict(
        "live",
        {"host": "localhost", "port": 10000, "database": "default"},
    )
    assert ch.transport is None
    probe = ch.probe()
    assert probe.ok is False
    assert probe.error
    assert "hive" in probe.error.lower() or "thrift" in probe.error.lower() or "not" in probe.error.lower()


def test_hive_probe_thrift_uri_without_lib_ok_false():
    ch = HiveChannel.from_dict(
        "live",
        {"thrift_uri": "hive://localhost:10000/default"},
    )
    assert ch.transport is None
    probe = ch.probe()
    assert probe.ok is False
    assert probe.error
