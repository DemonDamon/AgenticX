import pytest

from agenticx.data_suite.channels.credentials import (
    ChannelConfigError,
    build_channel,
    load_channel_config,
    redact_secrets,
)
from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.clickhouse import ClickHouseChannel
from agenticx.data_suite.channels.jdbc import JdbcChannel
from agenticx.data_suite.channels.kafka import KafkaChannel


def test_load_channel_config_missing(monkeypatch):
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(lambda cls, key: None))
    with pytest.raises(ChannelConfigError):
        load_channel_config("nope")


def test_build_fake_kind_from_cfg():
    ch = build_channel(
        "jdbc_demo",
        cfg={
            "kind": "jdbc",
            "tables": {"users": [{"id": 1}]},
            "grants": {"g1": {"channel": "jdbc_demo", "table": "users"}},
        },
    )
    assert isinstance(ch, FakeChannel)
    assert ch.kind == "jdbc"
    assert ch.probe().ok is True
    assert ch.query("SELECT * FROM users").rows == [[1]]


def test_build_clickhouse_kind_from_cfg():
    ch = build_channel(
        "ch1",
        cfg={"kind": "clickhouse", "host": "127.0.0.1", "database": "default"},
    )
    assert isinstance(ch, ClickHouseChannel)
    assert ch.name == "ch1"


def test_redact_secrets():
    assert redact_secrets({"host": "h", "password": "secret"})["password"] == "***"


def test_build_jdbc_with_url_returns_jdbc_channel():
    ch = build_channel(
        "pg1",
        cfg={
            "kind": "jdbc",
            "url": "sqlite+pysqlite:///:memory:",
            "dialect": "sqlite",
        },
    )
    assert isinstance(ch, JdbcChannel)
    assert ch.name == "pg1"
    probe = ch.probe()
    assert probe.ok is True


def test_build_kafka_with_bootstrap_returns_kafka_channel():
    ch = build_channel(
        "k1",
        cfg={
            "kind": "kafka",
            "bootstrap_servers": "localhost:9092",
        },
    )
    assert isinstance(ch, KafkaChannel)
    assert ch.name == "k1"
    # Live client optional — probe may be ok=False without lib; still KafkaChannel.
    probe = ch.probe()
    assert probe.ok is False
    assert probe.error


def test_build_kafka_tables_only_returns_fake():
    ch = build_channel(
        "k_offline",
        cfg={
            "kind": "kafka",
            "tables": {"events": [{"id": 1}]},
        },
    )
    assert isinstance(ch, FakeChannel)
    assert ch.kind == "kafka"
    assert ch.probe().ok is True
    assert ch.query("SELECT * FROM events").rows == [[1]]


def test_build_kafka_empty_returns_kafka_memory():
    ch = build_channel("k_empty", cfg={"kind": "kafka"})
    assert isinstance(ch, KafkaChannel)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.tables == []



def test_build_file_with_endpoint_returns_file_channel():
    from agenticx.data_suite.channels.file import FileChannel

    ch = build_channel(
        "f1",
        cfg={
            "kind": "file",
            "endpoint": "s3://bucket/prefix",
        },
    )
    assert isinstance(ch, FileChannel)
    assert ch.name == "f1"
    probe = ch.probe()
    assert probe.ok is False
    assert probe.error


def test_build_file_with_root_returns_file_channel():
    from agenticx.data_suite.channels.file import FileChannel

    ch = build_channel(
        "f_root",
        cfg={"kind": "file", "root": "/data/landing"},
    )
    assert isinstance(ch, FileChannel)


def test_build_file_tables_only_returns_fake():
    ch = build_channel(
        "f_offline",
        cfg={
            "kind": "file",
            "tables": {"members": [{"id": 1}]},
        },
    )
    assert isinstance(ch, FakeChannel)
    assert ch.kind == "file"
    assert ch.probe().ok is True
    assert ch.query("SELECT * FROM members").rows == [[1]]


def test_build_file_empty_returns_file_memory():
    from agenticx.data_suite.channels.file import FileChannel

    ch = build_channel("f_empty", cfg={"kind": "file"})
    assert isinstance(ch, FileChannel)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.tables == []
