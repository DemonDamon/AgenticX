"""Admin nl2sql_cli JSON bridge (W4)."""

from __future__ import annotations

from agenticx.managed.templates.data_suite.nl2sql_cli import handle
from agenticx.managed.templates.data_suite.write_guards import CODE_WRITE_GUARD_DENIED


def test_cli_explain_never_executes():
    out = handle({"question": "上月华东大区 GMV 和退货率分别是多少？", "mode": "explain"})
    assert out["ok"] is True
    data = out["data"]
    assert data["mode"] == "explain"
    assert data["executed"] is False
    assert data["rows"] == []
    assert data["channel_calls"] == []
    assert "SELECT" in data["sql"].upper()


def test_cli_execute_returns_rows():
    out = handle({"question": "上月华东大区 GMV", "mode": "execute"})
    assert out["ok"] is True
    data = out["data"]
    assert data["executed"] is True
    assert data["rows"][0]["region"] == "华东"


def test_cli_write_gate_denied():
    out = handle({"question": "写入", "mode": "execute", "sql": "DELETE FROM t"})
    assert out["ok"] is True
    data = out["data"]
    assert data["refused"] is True
    assert data["code"] == CODE_WRITE_GUARD_DENIED
    assert data["channel_calls"] == []
