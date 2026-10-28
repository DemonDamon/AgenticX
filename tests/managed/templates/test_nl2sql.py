"""NL2SQL read-only surface tests."""

from __future__ import annotations

import pytest

from agenticx.managed.templates.data_suite import (
    FakeQueryChannel,
    ReadOnlySqlExecutor,
    build_nl2sql_manifest_stub,
    is_read_only_sql,
)


@pytest.mark.parametrize(
    "sql,ok",
    [
        ("SELECT 1", True),
        ("  with t as (select 1) select * from t", True),
        ("INSERT INTO t VALUES (1)", False),
        ("UPDATE t SET a=1", False),
        ("DROP TABLE t", False),
        ("SELECT 1; DELETE FROM t", False),
        ("", False),
    ],
)
def test_is_read_only_sql(sql, ok):
    assert is_read_only_sql(sql) is ok


def test_executor_allows_select_denies_write():
    ch = FakeQueryChannel([{"id": 1}])
    ex = ReadOnlySqlExecutor(ch)
    assert ex.execute("SELECT id FROM t") == [{"id": 1}]
    with pytest.raises(PermissionError):
        ex.execute("INSERT INTO t VALUES (1)")


def test_manifest_stub_passes_write_guards():
    m = build_nl2sql_manifest_stub()
    assert m["tools"][0]["name"] == "data_suite_sql_query"
