"""Unit tests for JdbcChannel (in-memory SQLite; no live DB)."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from agenticx.data_suite.channels.base import WriteDeniedError
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.jdbc import JdbcChannel


def _memory_engine():
    return create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_jdbc_probe_and_query_sqlite():
    engine = _memory_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE events (id INTEGER, name TEXT)"))
        conn.execute(text("INSERT INTO events (id, name) VALUES (1, 'a'), (2, 'b')"))
    ch = JdbcChannel(name="jdbc1", engine=engine, dialect="sqlite")
    probe = ch.probe()
    assert probe.ok is True
    assert "events" in probe.tables
    q = ch.query("SELECT * FROM events", limit=10)
    assert q.columns == ["id", "name"]
    assert q.rows == [[1, "a"], [2, "b"]]


def test_jdbc_query_rejects_write_sql():
    engine = _memory_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE events (id INTEGER)"))
    ch = JdbcChannel(name="jdbc1", engine=engine)
    with pytest.raises(ValueError):
        ch.query("DELETE FROM events")
    with pytest.raises(ValueError):
        ch.query("INSERT INTO events (id) VALUES (1)")


def test_jdbc_write_requires_grant():
    engine = _memory_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE events (id INTEGER, name TEXT)"))
    grants = WriteGrantStore(grants={"g1": {"channel": "jdbc1", "table": "events"}})
    ch = JdbcChannel(name="jdbc1", engine=engine, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("events", [{"id": 1, "name": "x"}], grant_id="nope")
    assert ch.write_rows("events", [{"id": 1, "name": "x"}], grant_id="g1") == 1
    q = ch.query("SELECT id, name FROM events")
    assert q.rows == [[1, "x"]]
    assert grants.audit and grants.audit[-1]["row_count"] == 1


def test_jdbc_from_dict_sqlite_url():
    ch = JdbcChannel.from_dict(
        "mem",
        {"url": "sqlite+pysqlite:///:memory:", "dialect": "sqlite"},
    )
    assert ch.name == "mem"
    # Shared StaticPool memory DB: create then probe on same channel
    engine = ch._ensure_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE t1 (id INTEGER)"))
    probe = ch.probe()
    assert probe.ok is True
    assert "t1" in probe.tables


def test_jdbc_probe_connect_error(monkeypatch):
    ch = JdbcChannel(name="bad", _cfg={"url": "sqlite+pysqlite:///:memory:"})

    class Boom:
        def connect(self, *a, **k):
            raise RuntimeError("boom connect")

    def fake_ensure():
        return Boom()

    monkeypatch.setattr(ch, "_ensure_engine", fake_ensure)
    # probe uses inspect(engine); force failure via inspect path
    import sqlalchemy

    def boom_inspect(eng):
        raise RuntimeError("inspect failed")

    monkeypatch.setattr(sqlalchemy, "inspect", boom_inspect)
    r = ch.probe()
    assert r.ok is False
    assert r.error
