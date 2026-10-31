"""NL2SQL LLM closed-loop tests (hermetic Fake / Scripted LLM)."""

from __future__ import annotations

import pytest

from agenticx.managed.llm import LLMCallContext
from agenticx.managed.templates.data_suite import (
    CODE_INVALID_QUERY_MODE,
    CODE_WRITE_GUARD_DENIED,
    FakeQueryChannel,
    extract_sql_from_llm,
    run_nl2sql,
)
from agenticx.managed.testing import ScriptStep, ScriptedLLM, StaticLLMFactory, tool_call


def _ctx() -> LLMCallContext:
    return LLMCallContext(
        tenant_id="t1",
        session_id="s1",
        agent_id="nl2sql",
        agent_version=1,
        user_id="u1",
    )


def test_extract_sql_from_tool_call():
    step = ScriptStep(
        content="",
        tool_calls=[tool_call("data_suite_sql_query", {"sql": "SELECT id FROM t"}, "c1")],
    )
    llm = ScriptedLLM([step])
    resp = llm.invoke([{"role": "user", "content": "q"}])
    assert extract_sql_from_llm(resp) == "SELECT id FROM t"


def test_extract_sql_from_fenced_content():
    class _R:
        content = "```sql\nSELECT 1\n```"
        tool_calls = []

    assert extract_sql_from_llm(_R()) == "SELECT 1"


def test_run_nl2sql_select_ok():
    llm = ScriptedLLM(
        [ScriptStep(content="```sql\nSELECT id FROM members\n```")],
    )
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"id": 42}])
    result = run_nl2sql("列出成员 id", llm_factory=factory, channel=ch, context=_ctx())
    assert result.refused is False
    assert result.sql.upper().startswith("SELECT")
    assert result.rows == [{"id": 42}]
    assert ch.calls == [result.sql]


def test_run_nl2sql_via_tool_call():
    llm = ScriptedLLM(
        [
            ScriptStep(
                content="",
                tool_calls=[
                    tool_call("data_suite_sql_query", {"sql": "SELECT count(*) AS c FROM t"}, "c1")
                ],
            )
        ]
    )
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"c": 3}])
    result = run_nl2sql("how many?", llm_factory=factory, channel=ch, context=_ctx())
    assert not result.refused
    assert result.rows == [{"c": 3}]


def test_run_nl2sql_refuses_write_sql():
    llm = ScriptedLLM([ScriptStep(content="INSERT INTO t VALUES (1)")])
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"id": 1}])
    result = run_nl2sql("插入一行", llm_factory=factory, channel=ch, context=_ctx())
    assert result.refused is True
    assert "write_guard_denied" in (result.reason or "")
    assert ch.calls == []  # channel never touched


def test_run_nl2sql_refuses_drop_via_tool():
    llm = ScriptedLLM(
        [
            ScriptStep(
                content="",
                tool_calls=[tool_call("data_suite_sql_query", {"sql": "DROP TABLE t"}, "c1")],
            )
        ]
    )
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel()
    result = run_nl2sql("删表", llm_factory=factory, channel=ch, context=_ctx())
    assert result.refused is True
    assert ch.calls == []


def test_run_nl2sql_no_sql_refused():
    llm = ScriptedLLM([ScriptStep(content="I cannot help with that.")])
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel()
    result = run_nl2sql("??", llm_factory=factory, channel=ch, context=_ctx())
    assert result.refused is True
    assert "nl2sql_no_sql" in (result.reason or "")



def test_run_nl2sql_explain_never_hits_channel():
    llm = ScriptedLLM(
        [ScriptStep(content="```sql\nSELECT id FROM members\n```")],
    )
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"id": 42}])
    result = run_nl2sql(
        "列出成员 id",
        llm_factory=factory,
        channel=ch,
        context=_ctx(),
        mode="explain",
    )
    assert result.refused is False
    assert result.mode == "explain"
    assert result.executed is False
    assert result.sql.upper().startswith("SELECT")
    assert result.rows == []
    assert ch.calls == []


def test_run_nl2sql_default_mode_is_execute():
    llm = ScriptedLLM(
        [ScriptStep(content="```sql\nSELECT id FROM members\n```")],
    )
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"id": 7}])
    result = run_nl2sql("列出", llm_factory=factory, channel=ch, context=_ctx())
    assert result.mode == "execute"
    assert result.executed is True
    assert result.refused is False
    assert result.rows == [{"id": 7}]
    assert ch.calls == [result.sql]


def test_run_nl2sql_execute_still_refuses_write():
    llm = ScriptedLLM([ScriptStep(content="DELETE FROM t")])
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"id": 1}])
    result = run_nl2sql(
        "删数据",
        llm_factory=factory,
        channel=ch,
        context=_ctx(),
        mode="execute",
    )
    assert result.refused is True
    assert result.executed is False
    assert result.mode == "execute"
    assert CODE_WRITE_GUARD_DENIED in (result.reason or "")
    assert (result.code or "") == CODE_WRITE_GUARD_DENIED or CODE_WRITE_GUARD_DENIED in (
        result.reason or ""
    )
    assert ch.calls == []


def test_run_nl2sql_explain_allows_draft_write_sql_without_channel():
    """Explain returns SQL draft even when non-readonly; never executes."""
    llm = ScriptedLLM([ScriptStep(content="INSERT INTO t VALUES (1)")])
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"id": 1}])
    result = run_nl2sql(
        "插入一行",
        llm_factory=factory,
        channel=ch,
        context=_ctx(),
        mode="explain",
    )
    assert result.refused is False
    assert result.executed is False
    assert "INSERT" in result.sql.upper()
    assert result.rows == []
    assert ch.calls == []


def test_run_nl2sql_invalid_mode():
    llm = ScriptedLLM([ScriptStep(content="```sql\nSELECT 1\n```")])
    factory = StaticLLMFactory(llm)
    ch = FakeQueryChannel([{"n": 1}])
    result = run_nl2sql(
        "q",
        llm_factory=factory,
        channel=ch,
        context=_ctx(),
        mode="mutate",
    )
    assert result.refused is True
    assert result.executed is False
    assert result.code == CODE_INVALID_QUERY_MODE
    assert CODE_INVALID_QUERY_MODE in (result.reason or "")
    assert ch.calls == []
