"""NL2SQL read-only surface tests."""

from __future__ import annotations

import pytest

from agenticx.managed.templates.data_suite import (
    CODE_WRITE_GUARD_DENIED,
    FakeQueryChannel,
    ReadOnlySqlExecutor,
    WriteGateDecision,
    build_nl2sql_manifest_stub,
    decide_sql_write_gate,
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
    with pytest.raises(PermissionError) as ei:
        ex.execute("INSERT INTO t VALUES (1)")
    assert CODE_WRITE_GUARD_DENIED in str(ei.value)
    assert "non-readonly sql" in str(ei.value)


def test_sql_write_gate_decision_shape():
    allowed = decide_sql_write_gate(is_readonly=True)
    assert isinstance(allowed, WriteGateDecision)
    assert allowed.allowed is True
    assert allowed.code == ""

    denied = decide_sql_write_gate(is_readonly=False)
    assert denied.allowed is False
    assert denied.code == CODE_WRITE_GUARD_DENIED
    assert denied.reason.startswith(f"{CODE_WRITE_GUARD_DENIED}:")


def test_manifest_stub_passes_write_guards():
    m = build_nl2sql_manifest_stub()
    assert m["tools"][0]["name"] == "data_suite_sql_query"
