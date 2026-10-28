"""Read-only NL2SQL tool surface."""

from __future__ import annotations

import re
from typing import Any, List, Protocol

from agenticx.managed.templates.data_suite.types import WriteGuardPolicy
from agenticx.managed.templates.data_suite.write_guards import assert_read_only_tools

_WRITE_HEAD = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|MERGE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)
_SELECT_HEAD = re.compile(r"^\s*(WITH\b|SELECT\b)", re.IGNORECASE)


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
        if not is_read_only_sql(sql):
            raise PermissionError("write_guard_denied: non-readonly sql")
        return list(self._channel.query(sql, limit=limit))


def build_nl2sql_manifest_stub(*, model: str = "openai/gpt-4o-mini") -> dict[str, Any]:
    manifest = {
        "schema": "agx.agent/v1",
        "model": model,
        "system": "You translate natural language to read-only SQL. Never mutate data.",
        "tools": [
            {
                "type": "custom",
                "name": "data_suite_sql_query",
                "description": "Run a read-only SELECT against the bound channel.",
                "input_schema": {
                    "type": "object",
                    "properties": {"sql": {"type": "string"}},
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
