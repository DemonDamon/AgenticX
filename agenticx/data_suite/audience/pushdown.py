"""Audience DSL → channel-native SQL pushdown (ClickHouse / JDBC).

Compiles the same AST consumed by ``select_audience`` into read-only
``SELECT ... WHERE ...`` for sqlite/jdbc and ClickHouse dialects, executes
via ``DataChannel.query``, and optionally forces ``MaskingEngine`` on rows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Union

from agenticx.data_suite.masking.engine import MaskingEngine
from agenticx.data_suite.masking.policy import MaskingPolicy

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

_BOOL_TRUE = {"clickhouse": "true", "sqlite": "1", "jdbc": "1"}
_BOOL_FALSE = {"clickhouse": "false", "sqlite": "0", "jdbc": "0"}


def _norm_dialect(dialect: str) -> str:
    d = str(dialect or "sqlite").strip().lower()
    if d == "clickhouse":
        return "clickhouse"
    if d in {"sqlite", "fake"}:
        return "sqlite"
    # jdbc / postgresql / mysql / sql → jdbc bool literals (0/1), same as sqlite
    return "jdbc"


def _quote_ident(name: str) -> str:
    n = str(name or "").strip()
    if not _IDENT.match(n):
        raise ValueError(f"invalid SQL identifier: {name!r}")
    return n


def _sql_literal(value: Any, *, dialect: str) -> str:
    d = _norm_dialect(dialect)
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        key = d if d in _BOOL_TRUE else "jdbc"
        return _BOOL_TRUE[key] if value else _BOOL_FALSE[key]
    if isinstance(value, int) and not isinstance(value, bool):
        return str(int(value))
    if isinstance(value, float):
        return repr(float(value))
    # strings (and anything else) → single-quoted, escape '
    s = str(value).replace("'", "''")
    return f"'{s}'"


def _compile_predicate(node: Dict[str, Any], *, dialect: str) -> str:
    if "op" in node and node["op"] in {"and", "or", "not"}:
        op = node["op"]
        args = list(node.get("args") or [])
        if op == "and":
            if not args:
                return "1=1"
            return "(" + " AND ".join(_compile_predicate(a, dialect=dialect) for a in args) + ")"
        if op == "or":
            if not args:
                return "1=0"
            return "(" + " OR ".join(_compile_predicate(a, dialect=dialect) for a in args) + ")"
        if op == "not":
            if len(args) != 1:
                raise ValueError("not expects exactly one arg")
            return f"(NOT {_compile_predicate(args[0], dialect=dialect)})"

    tag = _quote_ident(str(node.get("tag") or ""))
    op = str(node.get("op") or "eq")
    value = node.get("value")
    if op == "eq":
        return f"{tag} = {_sql_literal(value, dialect=dialect)}"
    if op == "in":
        items = list(value or [])
        if not items:
            return "1=0"
        lit = ", ".join(_sql_literal(v, dialect=dialect) for v in items)
        return f"{tag} IN ({lit})"
    if op == "exists":
        # Match in-memory: not None and not ""
        return f"({tag} IS NOT NULL AND {tag} != '')"
    raise ValueError(f"unknown predicate op {op}")


def compile_audience_sql(
    query: Dict[str, Any],
    *,
    table: str,
    id_field: str = "member_id",
    dialect: str = "sqlite",
    columns: Optional[Sequence[str]] = None,
) -> str:
    """Compile audience AST into a read-only SELECT for the given dialect."""
    d = _norm_dialect(dialect)
    table_q = _quote_ident(table)
    cols = list(columns) if columns else [id_field]
    col_sql = ", ".join(_quote_ident(c) for c in cols)
    where = _compile_predicate(query, dialect=d)
    return f"SELECT {col_sql} FROM {table_q} WHERE {where}"


@dataclass
class AudiencePushdownResult:
    ids: List[str]
    rows: List[Dict[str, Any]] = field(default_factory=list)
    sql: str = ""
    dialect: str = ""


def _infer_dialect(channel: Any, explicit: Optional[str]) -> str:
    if explicit:
        return _norm_dialect(explicit)
    d = getattr(channel, "dialect", None) or getattr(channel, "kind", None)
    if d:
        return _norm_dialect(str(d))
    name = type(channel).__name__.lower()
    if "clickhouse" in name:
        return "clickhouse"
    if "jdbc" in name:
        return "jdbc"
    return "sqlite"


def _as_masking_engine(
    masking: Union[MaskingEngine, MaskingPolicy, None],
) -> Optional[MaskingEngine]:
    if masking is None:
        return None
    if isinstance(masking, MaskingEngine):
        return masking
    return MaskingEngine(masking)


def pushdown_select(
    channel: Any,
    query: Dict[str, Any],
    *,
    table: str,
    id_field: str = "member_id",
    dialect: Optional[str] = None,
    columns: Optional[Sequence[str]] = None,
    limit: int = 100_000,
    masking: Union[MaskingEngine, MaskingPolicy, None] = None,
    role: Optional[str] = None,
) -> AudiencePushdownResult:
    """Compile audience query, execute via channel, optionally mask rows.

    When ``masking`` is provided, ``role`` is required and masking is forced
    (same closed-loop spirit as ``secure_query_rows``).
    """
    d = _infer_dialect(channel, dialect)
    cols = list(columns) if columns else [id_field]
    if id_field not in cols:
        cols = [id_field, *cols]
    sql = compile_audience_sql(
        query, table=table, id_field=id_field, dialect=d, columns=cols
    )
    engine = _as_masking_engine(masking)
    if engine is not None and not role:
        raise ValueError("role is required when masking policy/engine is bound")

    result = channel.query(sql, limit=int(limit))
    rows: List[Dict[str, Any]] = [
        {col: val for col, val in zip(result.columns, row)} for row in result.rows
    ]
    if engine is not None:
        rows = engine.apply(rows, role=str(role))

    ids = [str(r[id_field]) for r in rows if id_field in r and r[id_field] is not None]
    return AudiencePushdownResult(ids=ids, rows=rows, sql=sql, dialect=d)
