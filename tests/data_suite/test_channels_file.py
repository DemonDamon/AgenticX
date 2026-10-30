"""Unit tests for FileChannel (in-memory / injected transport; no live SFTP/OSS)."""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from agenticx.data_suite.channels.base import WriteDeniedError
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.file import (
    FileChannel,
    InMemoryFileTransport,
    PathLayoutPolicy,
    TransientFileError,
)


def test_file_probe_lists_seeded_tables():
    transport = InMemoryFileTransport(
        tables={
            "members": {"part-a": [{"id": 1}, {"id": 2}]},
            "events": {},
        }
    )
    ch = FileChannel(name="f1", transport=transport)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.dialect == "file"
    assert probe.tables == ["events", "members"]


def test_file_query_select_star_and_truncated():
    rows = [{"id": i, "v": f"r{i}"} for i in range(5)]
    transport = InMemoryFileTransport(tables={"members": {"obj": rows}})
    ch = FileChannel(name="f1", transport=transport)
    q = ch.query("SELECT * FROM members", limit=2)
    assert q.columns == ["id", "v"]
    assert q.rows == [[0, "r0"], [1, "r1"]]
    assert q.truncated is True
    q_all = ch.query("SELECT * FROM members", limit=10)
    assert len(q_all.rows) == 5
    assert q_all.truncated is False


def test_file_query_rejects_non_select():
    transport = InMemoryFileTransport(tables={"members": {"obj": [{"id": 1}]}})
    ch = FileChannel(name="f1", transport=transport)
    with pytest.raises(ValueError, match="SELECT \\* FROM"):
        ch.query("DELETE FROM members")
    with pytest.raises(ValueError):
        ch.query("SELECT id FROM members")


def test_file_write_requires_grant():
    transport = InMemoryFileTransport(tables={"members": {}})
    grants = WriteGrantStore(grants={"g1": {"channel": "f1", "table": "members"}})
    ch = FileChannel(name="f1", transport=transport, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("members", [{"id": 1}], grant_id="nope")
    assert ch.write_rows("members", [{"id": 1, "name": "x"}], grant_id="g1") == 1
    q = ch.query("SELECT * FROM members")
    assert q.rows == [[1, "x"]]
    assert grants.audit and grants.audit[-1]["row_count"] == 1


def test_file_from_dict_tables_seeds_memory():
    ch = FileChannel.from_dict(
        "mem",
        {"tables": {"members": [{"id": 1}], "events": []}},
    )
    assert isinstance(ch.transport, InMemoryFileTransport)
    probe = ch.probe()
    assert probe.ok is True
    assert probe.tables == ["events", "members"]
    assert ch.query("SELECT * FROM members").rows == [[1]]


def test_file_path_policy_injectable_no_hardcoded_date():
    """Path/partition is policy-driven; channel kernel must not hardcode date=YYYYMMDD."""
    src = Path(
        inspect.getfile(
            __import__("agenticx.data_suite.channels.file", fromlist=["file"])
        )
    ).read_text(encoding="utf-8")
    assert "date=YYYYMMDD" not in src
    assert "date=%Y%m%d" not in src

    class PrefixedPolicy(PathLayoutPolicy):
        def list_keys(self, table: str) -> list[str]:
            return [f"custom_prefix/{table}/part-0"]

        def resolve_read(self, table: str, key: str) -> str:
            return f"custom_prefix/{table}/{key}"

        def resolve_write(self, table: str, key: str) -> str:
            return f"custom_prefix/{table}/{key}"

    policy = PrefixedPolicy()
    transport = InMemoryFileTransport(
        tables={"members": {"part-0": [{"id": 9}]}},
        path_policy=policy,
    )
    ch = FileChannel(name="f1", transport=transport, path_policy=policy)
    keys = transport.list_objects("members")
    assert keys == ["custom_prefix/members/part-0"]
    assert "date=" not in keys[0]
    assert ch.query("SELECT * FROM members").rows == [[9]]


def test_file_retry_after_one_transient_failure():
    class FlakyTransport(InMemoryFileTransport):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._fail_remaining = 1

        def read_rows(self, table: str, *, limit: int = 200):
            if self._fail_remaining > 0:
                self._fail_remaining -= 1
                raise TransientFileError("transient read failure")
            return super().read_rows(table, limit=limit)

        def write_rows(self, table: str, rows: list) -> int:
            if self._fail_remaining > 0:
                self._fail_remaining -= 1
                raise TransientFileError("transient write failure")
            return super().write_rows(table, rows)

    transport = FlakyTransport(tables={"members": {"obj": [{"id": 1}]}})
    ch = FileChannel(name="f1", transport=transport, _cfg={"retries": 2})
    q = ch.query("SELECT * FROM members")
    assert q.rows == [[1]]

    transport2 = FlakyTransport(tables={"members": {}})
    grants = WriteGrantStore(grants={"g1": {"channel": "f1", "table": "members"}})
    ch2 = FileChannel(name="f1", transport=transport2, grants=grants, _cfg={"retries": 2})
    assert ch2.write_rows("members", [{"id": 2}], grant_id="g1") == 1
