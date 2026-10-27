#!/usr/bin/env python3
"""SQLAlchemy tables match the drizzle session DDL column for column.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql.sqltypes import JSON, Variant

from ma_agent_runtime.tables import AUTOMATION_TABLES, CHANNEL_TABLES, DREAM_TABLES, EVAL_TABLES, MANAGED_TABLES

_ROOT = Path(__file__).resolve().parents[4]
_CREATE = re.compile(r'CREATE TABLE IF NOT EXISTS "(\w+)" \((.*?)\);', re.S)
_COLUMN = re.compile(r'^"(\w+)"\s+(.*)$')
_ALTER = re.compile(
    r'ALTER TABLE "(\w+)" ADD COLUMN IF NOT EXISTS "(\w+)"\s+([^;]+);',
    re.I,
)
_WANTED = {
    "ma_sessions",
    "ma_session_events",
    "ma_work_items",
    "ma_session_usage",
    "ma_eval_runs",
    "ma_eval_results",
    "ma_eval_candidates",
    "ma_memory_dreams",
}


def _not_null(rest: str) -> bool:
    upper = rest.upper()
    return "NOT NULL" in upper or "PRIMARY KEY" in upper


def _family(rest: str) -> tuple[str, int | None]:
    lowered = rest.lower().strip()
    varchar = re.match(r"varchar\((\d+)\)", lowered)
    if varchar:
        return "varchar", int(varchar.group(1))
    if lowered.startswith("text"):
        return "text", None
    if lowered.startswith("integer"):
        return "integer", None
    if lowered.startswith("bigint"):
        return "bigint", None
    if lowered.startswith("boolean"):
        return "boolean", None
    if lowered.startswith("jsonb"):
        return "jsonb", None
    if lowered.startswith("timestamp with time zone"):
        return "timestamptz", None
    raise AssertionError(rest)


def _ddl_columns() -> dict[str, dict[str, tuple[tuple[str, int | None], bool]]]:
    sql_0061 = (_ROOT / "enterprise/packages/db-schema/drizzle/0061_ma_control_plane.sql").read_text(
        encoding="utf-8"
    )
    sql_0062 = (_ROOT / "enterprise/packages/db-schema/drizzle/0062_ma_work_inbox.sql").read_text(
        encoding="utf-8"
    )
    sql_0068 = (_ROOT / "enterprise/packages/db-schema/drizzle/0068_ma_evals.sql").read_text(
        encoding="utf-8"
    )
    sql_0069 = (_ROOT / "enterprise/packages/db-schema/drizzle/0069_ma_memory_dreams.sql").read_text(
        encoding="utf-8"
    )
    tables: dict[str, dict[str, tuple[tuple[str, int | None], bool]]] = {}
    for name, body in _CREATE.findall(sql_0061 + "\n" + sql_0068 + "\n" + sql_0069):
        if name not in _WANTED:
            continue
        columns: dict[str, tuple[tuple[str, int | None], bool]] = {}
        for line in body.splitlines():
            match = _COLUMN.match(line.strip().rstrip(","))
            if match is None:
                continue
            col_name, rest = match.group(1), match.group(2)
            columns[col_name] = (_family(rest), _not_null(rest))
        tables[name] = columns
    for table, col_name, rest in _ALTER.findall(sql_0062):
        tables[table][col_name] = (_family(rest), _not_null(rest))
    return tables


def _plain(column_type: object) -> object:
    if isinstance(column_type, Variant):
        return column_type.impl
    return column_type


def _matches(column_type: object, family: tuple[str, int | None]) -> bool:
    kind, length = family
    plain = _plain(column_type)
    if kind == "varchar":
        return isinstance(plain, String) and plain.length == length
    if kind == "text":
        return isinstance(plain, Text)
    if kind == "integer":
        return type(plain) is Integer
    if kind == "bigint":
        return isinstance(plain, BigInteger)
    if kind == "boolean":
        return isinstance(plain, Boolean)
    if kind == "jsonb":
        return isinstance(plain, JSON)
    if kind == "timestamptz":
        return isinstance(plain, DateTime) and plain.timezone is True
    return False


def test_columns_match_drizzle_migrations() -> None:
    expected = _ddl_columns()
    actual = {table.name: table for table in (*MANAGED_TABLES, *EVAL_TABLES, *DREAM_TABLES)}
    assert set(actual) == set(expected)
    for name, columns in expected.items():
        table = actual[name]
        assert {column.name for column in table.columns} == set(columns)
        for column in table.columns:
            family, not_null = columns[column.name]
            assert _matches(column.type, family), (name, column.name, column.type, family)
            assert (column.nullable is False) is not_null, (name, column.name)


def test_unique_constraints_present() -> None:
    by_name = {table.name: table for table in MANAGED_TABLES}
    for table_name, constraint_name in (
        ("ma_session_events", "ma_session_events_session_seq_uq"),
        ("ma_session_usage", "ma_session_usage_session_event_uq"),
    ):
        names = {
            constraint.name
            for constraint in by_name[table_name].constraints
            if isinstance(constraint, UniqueConstraint)
        }
        assert constraint_name in names


def test_automation_tables_match_ddl() -> None:
    sql = (_ROOT / "enterprise/packages/db-schema/drizzle/0065_ma_schedules_webhooks.sql").read_text(
        encoding="utf-8"
    )
    wanted = {"ma_schedule_runs", "ma_webhook_deliveries"}
    expected: dict[str, dict[str, tuple[tuple[str, int | None], bool]]] = {}
    for name, body in _CREATE.findall(sql):
        if name not in wanted:
            continue
        columns: dict[str, tuple[tuple[str, int | None], bool]] = {}
        for line in body.splitlines():
            match = _COLUMN.match(line.strip().rstrip(","))
            if match is None:
                continue
            col_name, rest = match.group(1), match.group(2)
            columns[col_name] = (_family(rest), _not_null(rest))
        expected[name] = columns
    actual = {table.name: table for table in AUTOMATION_TABLES}
    assert set(actual) == wanted
    assert set(expected) == wanted
    for name, columns in expected.items():
        table = actual[name]
        assert {column.name for column in table.columns} == set(columns)
        for column in table.columns:
            family, not_null = columns[column.name]
            assert _matches(column.type, family), (name, column.name, column.type, family)
            assert (column.nullable is False) is not_null, (name, column.name)


def test_channel_tables_match_ddl() -> None:
    sql = (_ROOT / "enterprise/packages/db-schema/drizzle/0066_ma_channels.sql").read_text(encoding="utf-8")
    wanted = {"ma_channel_conversations", "ma_channel_inbound", "ma_channel_runtime_state"}
    expected: dict[str, dict[str, tuple[tuple[str, int | None], bool]]] = {}
    for name, body in _CREATE.findall(sql):
        if name not in wanted:
            continue
        columns: dict[str, tuple[tuple[str, int | None], bool]] = {}
        for line in body.splitlines():
            match = _COLUMN.match(line.strip().rstrip(","))
            if match is None:
                continue
            col_name, rest = match.group(1), match.group(2)
            columns[col_name] = (_family(rest), _not_null(rest))
        expected[name] = columns
    actual = {table.name: table for table in CHANNEL_TABLES}
    assert set(actual) == wanted
    assert set(expected) == wanted
    for name, columns in expected.items():
        table = actual[name]
        assert {column.name for column in table.columns} == set(columns)
        for column in table.columns:
            family, not_null = columns[column.name]
            assert _matches(column.type, family), (name, column.name, column.type, family)
            assert (column.nullable is False) is not_null, (name, column.name)
