"""Unit tests for KafkaChannel (in-memory / injected transport; no live Kafka)."""

from __future__ import annotations

import pytest

from agenticx.data_suite.channels.base import WriteDeniedError
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.kafka import InMemoryKafkaTransport, KafkaChannel


def test_kafka_probe_lists_seeded_topics():
    transport = InMemoryKafkaTransport(
        topics={
            "events": [{"id": 1}, {"id": 2}],
            "logs": [],
        }
    )
    ch = KafkaChannel(name="k1", transport=transport)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.dialect == "kafka"
    assert probe.tables == ["events", "logs"]


def test_kafka_query_select_star_and_truncated():
    rows = [{"id": i, "v": f"r{i}"} for i in range(5)]
    transport = InMemoryKafkaTransport(topics={"events": rows})
    ch = KafkaChannel(name="k1", transport=transport)
    q = ch.query("SELECT * FROM events", limit=2)
    assert q.columns == ["id", "v"]
    assert q.rows == [[0, "r0"], [1, "r1"]]
    assert q.truncated is True
    q_all = ch.query("SELECT * FROM events", limit=10)
    assert len(q_all.rows) == 5
    assert q_all.truncated is False


def test_kafka_query_rejects_non_select():
    transport = InMemoryKafkaTransport(topics={"events": [{"id": 1}]})
    ch = KafkaChannel(name="k1", transport=transport)
    with pytest.raises(ValueError, match="SELECT \\* FROM"):
        ch.query("DELETE FROM events")
    with pytest.raises(ValueError):
        ch.query("SELECT id FROM events")


def test_kafka_write_requires_grant():
    transport = InMemoryKafkaTransport(topics={"events": []})
    grants = WriteGrantStore(grants={"g1": {"channel": "k1", "table": "events"}})
    ch = KafkaChannel(name="k1", transport=transport, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("events", [{"id": 1}], grant_id="nope")
    assert ch.write_rows("events", [{"id": 1, "name": "x"}], grant_id="g1") == 1
    q = ch.query("SELECT * FROM events")
    assert q.rows == [[1, "x"]]
    assert grants.audit and grants.audit[-1]["row_count"] == 1


def test_kafka_from_dict_tables_seeds_memory():
    ch = KafkaChannel.from_dict(
        "mem",
        {"tables": {"events": [{"id": 1}], "metrics": []}},
    )
    assert isinstance(ch.transport, InMemoryKafkaTransport)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.tables == ["events", "metrics"]
    assert ch.query("SELECT * FROM events").rows == [[1]]


def test_kafka_from_dict_topics_list_seeds_empty():
    ch = KafkaChannel.from_dict("mem", {"topics": ["a", "b"]})
    probe = ch.probe()
    assert probe.ok is True
    assert probe.tables == ["a", "b"]


def test_kafka_probe_bootstrap_without_client_ok_false():
    ch = KafkaChannel.from_dict(
        "live",
        {"bootstrap_servers": "localhost:9092"},
    )
    assert ch.transport is None
    probe = ch.probe()
    assert probe.ok is False
    assert probe.error
    assert "kafka" in probe.error.lower() or "not" in probe.error.lower()
