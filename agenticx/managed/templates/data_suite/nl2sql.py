"""Read-only NL2SQL tool surface with managed LLM closed loop."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, List, Optional, Protocol

from agenticx.managed.llm import LLMCallContext, LLMFactory
from agenticx.managed.templates.data_suite.types import WriteGuardPolicy
from agenticx.managed.templates.data_suite.write_guards import (
    CODE_INVALID_QUERY_MODE,
    CODE_WRITE_GUARD_DENIED,
    QUERY_MODE_EXECUTE,
    QUERY_MODE_EXPLAIN,
    assert_read_only_tools,
    decide_query_mode,
    decide_sql_write_gate,
    normalize_query_mode,
)

_WRITE_HEAD = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)
_SELECT_HEAD = re.compile(r"^\s*(WITH\b|SELECT\b)", re.IGNORECASE)
_FENCED_SQL = re.compile(r"```(?:sql)?\s*([\s\S]*?)```", re.IGNORECASE)
_TOOL_NAME = "data_suite_sql_query"


def is_read_only_sql(sql: str) -> bool:
    text = (sql or "").strip()
    if not text:
        return False
    if ";" in text.rstrip(";"):
        return False  # multi-statement
    if _WRITE_HEAD.search(text):
        return False
    return bool(_SELECT_HEAD.match(text))


class _QueryChannel(Protocol):
    def query(self, sql: str, *, limit: int = 100) -> List[dict]: ...


class ReadOnlySqlExecutor:
    def __init__(self, channel: _QueryChannel, *, write_guard: WriteGuardPolicy | None = None) -> None:
        self._channel = channel
        self._write_guard = write_guard or WriteGuardPolicy()

    def execute(self, sql: str, *, limit: int = 100) -> List[dict]:
        decide_sql_write_gate(is_readonly=is_read_only_sql(sql)).raise_if_denied(
            as_permission_error=True
        )
        return list(self._channel.query(sql, limit=limit))


def build_nl2sql_manifest_stub(*, model: str = "openai/gpt-4o-mini") -> dict[str, Any]:
    manifest = {
        "schema": "agx.agent/v1",
        "model": model,
        "system": "You translate natural language to read-only SQL. Never mutate data.",
        "tools": [
            {
                "type": "custom",
                "name": _TOOL_NAME,
                "description": "Run a read-only SELECT against the bound channel.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string"},
                        "mode": {
                            "type": "string",
                            "enum": ["explain", "execute"],
                            "default": "execute",
                            "description": (
                                "explain returns SQL/plan without channel execution; "
                                "execute runs read-only SQL via the bound channel."
                            ),
                        },
                    },
                    "required": ["sql"],
                },
            }
        ],
        "runtime": {"max_tool_rounds": 6},
    }
    assert_read_only_tools(manifest, WriteGuardPolicy())
    return manifest


class FakeQueryChannel:
    """Minimal channel for unit tests."""

    def __init__(self, rows: List[dict] | None = None) -> None:
        self.rows = list(rows or [{"id": 1}])
        self.calls: List[str] = []

    def query(self, sql: str, *, limit: int = 100) -> List[dict]:
        self.calls.append(sql)
        return self.rows[:limit]


def _tool_sql(tool_calls: Any) -> Optional[str]:
    if not isinstance(tool_calls, list):
        return None
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = str(call.get("name") or fn.get("name") or "")
        if name != _TOOL_NAME:
            continue
        args = call.get("arguments")
        if args is None:
            args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                return args.strip() or None
        if isinstance(args, dict):
            sql = args.get("sql")
            if isinstance(sql, str) and sql.strip():
                return sql.strip()
    return None


def _content_sql(content: Any) -> Optional[str]:
    text = content if isinstance(content, str) else getattr(content, "content", None)
    if not isinstance(text, str):
        return None
    text = text.strip()
    if not text:
        return None
    fenced = _FENCED_SQL.search(text)
    if fenced:
        candidate = fenced.group(1).strip()
        if candidate:
            return candidate
    # plain first line / whole blob if it looks like SQL
    if _SELECT_HEAD.match(text) or _WRITE_HEAD.match(text):
        return text.rstrip("`").strip()
    return None


def extract_sql_from_llm(response: Any) -> str:
    """Prefer ``data_suite_sql_query`` tool args; else fenced/plain SQL from content."""
    tool_calls = getattr(response, "tool_calls", None)
    if tool_calls is None and isinstance(response, dict):
        tool_calls = response.get("tool_calls")
    sql = _tool_sql(tool_calls)
    if sql:
        return sql
    content = response
    if isinstance(response, dict):
        content = response.get("content", response)
    sql = _content_sql(content)
    if sql:
        return sql
    raise ValueError("nl2sql_no_sql: LLM response contained no SQL")


@dataclass
class Nl2SqlResult:
    sql: str
    rows: List[dict]
    refused: bool = False
    reason: Optional[str] = None
    mode: str = QUERY_MODE_EXECUTE
    executed: bool = False
    code: Optional[str] = None


_SYSTEM_PROMPT = (
    "You translate natural language to read-only SQL. "
    "Return only a SELECT (or WITH … SELECT). Never mutate data."
)


class Nl2SqlSession:
    """Thin LLM → read-only SQL → channel executor closed loop."""

    def __init__(
        self,
        *,
        llm_factory: LLMFactory,
        channel: _QueryChannel,
        context: LLMCallContext,
        provider: str = "fake",
        model: str = "fake-nl2sql",
        write_guard: WriteGuardPolicy | None = None,
    ) -> None:
        self._factory = llm_factory
        self._channel = channel
        self._context = context
        self._provider = provider
        self._model = model
        self._executor = ReadOnlySqlExecutor(channel, write_guard=write_guard)

    def ask(
        self,
        question: str,
        *,
        limit: int = 100,
        mode: str | None = None,
    ) -> Nl2SqlResult:
        mode_decision = decide_query_mode(mode)
        resolved_mode = normalize_query_mode(mode)
        if not mode_decision.allowed:
            return Nl2SqlResult(
                sql="",
                rows=[],
                refused=True,
                reason=mode_decision.reason,
                mode=resolved_mode,
                executed=False,
                code=mode_decision.code or CODE_INVALID_QUERY_MODE,
            )

        llm = self._factory.create(
            provider=self._provider,
            model=self._model,
            context=self._context,
        )
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ]
        response = llm.invoke(messages)
        try:
            sql = extract_sql_from_llm(response)
        except ValueError as exc:
            return Nl2SqlResult(
                sql="",
                rows=[],
                refused=True,
                reason=str(exc),
                mode=resolved_mode,
                executed=False,
                code=None,
            )

        if resolved_mode == QUERY_MODE_EXPLAIN:
            # Draft only: never touch the channel (even for non-readonly SQL).
            return Nl2SqlResult(
                sql=sql,
                rows=[],
                refused=False,
                reason=None,
                mode=QUERY_MODE_EXPLAIN,
                executed=False,
                code=None,
            )

        sql_decision = decide_sql_write_gate(is_readonly=is_read_only_sql(sql))
        if not sql_decision.allowed:
            return Nl2SqlResult(
                sql=sql,
                rows=[],
                refused=True,
                reason=sql_decision.reason,
                mode=QUERY_MODE_EXECUTE,
                executed=False,
                code=sql_decision.code or CODE_WRITE_GUARD_DENIED,
            )
        try:
            rows = self._executor.execute(sql, limit=limit)
        except PermissionError as exc:
            return Nl2SqlResult(
                sql=sql,
                rows=[],
                refused=True,
                reason=str(exc),
                mode=QUERY_MODE_EXECUTE,
                executed=False,
                code=CODE_WRITE_GUARD_DENIED,
            )
        return Nl2SqlResult(
            sql=sql,
            rows=list(rows),
            refused=False,
            reason=None,
            mode=QUERY_MODE_EXECUTE,
            executed=True,
            code=None,
        )


def run_nl2sql(
    question: str,
    *,
    llm_factory: LLMFactory,
    channel: _QueryChannel,
    context: LLMCallContext,
    provider: str = "fake",
    model: str = "fake-nl2sql",
    limit: int = 100,
    write_guard: WriteGuardPolicy | None = None,
    mode: str | None = None,
) -> Nl2SqlResult:
    """One-shot NL → SQL; ``mode=explain`` drafts only, ``execute`` (default) runs read-only."""
    session = Nl2SqlSession(
        llm_factory=llm_factory,
        channel=channel,
        context=context,
        provider=provider,
        model=model,
        write_guard=write_guard,
    )
    return session.ask(question, limit=limit, mode=mode)


__all__ = [
    "FakeQueryChannel",
    "Nl2SqlResult",
    "Nl2SqlSession",
    "QUERY_MODE_EXECUTE",
    "QUERY_MODE_EXPLAIN",
    "ReadOnlySqlExecutor",
    "build_nl2sql_manifest_stub",
    "extract_sql_from_llm",
    "is_read_only_sql",
    "run_nl2sql",
]
