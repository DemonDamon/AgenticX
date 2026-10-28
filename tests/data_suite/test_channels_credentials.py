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
