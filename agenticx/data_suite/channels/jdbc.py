"""JdbcChannel — SQLAlchemy-backed DataChannel for JDBC/SQL dialects."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
from urllib.parse import quote_plus

from agenticx.connectors.database import check_read_only_sql
from agenticx.data_suite.channels.base import (
    ChannelProbeResult,
    ChannelQueryResult,
    WriteDeniedError,
)
from agenticx.data_suite.channels.grants import WriteGrantStore

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")

_DIALECT_DRIVERS = {
    "postgresql": "postgresql+psycopg2",
    "postgres": "postgresql+psycopg2",
    "mysql": "mysql+pymysql",
    "sqlite": "sqlite+pysqlite",
    "jdbc": "postgresql+psycopg2",
    "sql": "postgresql+psycopg2",
}


def _quote_ident(name: str) -> str:
    n = str(name or "").strip()
    if not _IDENT.match(n):
        raise ValueError(f"invalid SQL identifier: {name!r}")
    return n


@dataclass
class JdbcChannel:
    """SQLAlchemy DataChannel. Unit tests use sqlite+pysqlite:///:memory:."""

    name: str
    engine: Any = None
    grants: Optional[WriteGrantStore] = None
    dialect: str = "jdbc"
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(
        cls,
        name: str,
        cfg: Dict[str, Any],
        *,
        grants: Optional[WriteGrantStore] = None,
    ) -> "JdbcChannel":
        dialect = str(cfg.get("dialect") or cfg.get("kind") or "jdbc").strip().lower()
        return cls(name=name, grants=grants, dialect=dialect, _cfg=dict(cfg))

    def _build_url(self) -> str:
        cfg = self._cfg
        url = cfg.get("url")
        if url:
            return str(url)
        path = cfg.get("path")
        if path is not None and str(path) != "":
            return f"sqlite+pysqlite:///{path}"
        kind = str(cfg.get("dialect") or cfg.get("kind") or self.dialect or "postgresql").strip().lower()
        driver = _DIALECT_DRIVERS.get(kind, kind)
        host = str(cfg.get("host") or "localhost")
        port = cfg.get("port")
        database = str(cfg.get("database") or "")
        user = str(cfg.get("username") or cfg.get("user") or "")
        password = str(cfg.get("password") or "")
        auth = ""
        if user:
            auth = quote_plus(user)
            if password:
                auth = f"{auth}:{quote_plus(password)}"
            auth = f"{auth}@"
        host_part = host
        if port:
            host_part = f"{host}:{int(port)}"
        db_part = f"/{database}" if database else ""
        return f"{driver}://{auth}{host_part}{db_part}"

    def _ensure_engine(self) -> Any:
        if self.engine is not None:
            return self.engine
        try:
            from sqlalchemy import create_engine
            from sqlalchemy.pool import StaticPool
        except ImportError as exc:
            raise RuntimeError("sqlalchemy not installed") from exc
        url = self._build_url()
        if not url:
            raise RuntimeError("jdbc channel missing url/host/path")
        kwargs: Dict[str, Any] = {}
        # In-memory SQLite: share one DB across connections for probe/query/write.
        if url.startswith("sqlite") and ":memory:" in url:
            kwargs["connect_args"] = {"check_same_thread": False}
            kwargs["poolclass"] = StaticPool
        self.engine = create_engine(url, **kwargs)
        return self.engine

    def probe(self) -> ChannelProbeResult:
        try:
            engine = self._ensure_engine()
        except RuntimeError as exc:
            return ChannelProbeResult(
                channel=self.name, ok=False, dialect=self.dialect, error=str(exc)
            )
        try:
            from sqlalchemy import inspect as sa_inspect

            insp = sa_inspect(engine)
            tables = [str(t) for t in insp.get_table_names()]
            return ChannelProbeResult(
                channel=self.name,
                ok=True,
                dialect=self.dialect,
                tables=tables,
            )
        except Exception as exc:  # noqa: BLE001 — surface probe failure
            return ChannelProbeResult(
                channel=self.name, ok=False, dialect=self.dialect, error=str(exc)
            )

    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult:
        err = check_read_only_sql(statement)
        if err:
            raise ValueError(err)
        engine = self._ensure_engine()
        from sqlalchemy import text

        sql = statement.rstrip().rstrip(";")
        if " limit " not in sql.lower():
            sql = f"{sql} LIMIT {int(limit)}"
        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(r) for r in result.fetchall()]
        truncated = len(rows) > limit
        return ChannelQueryResult(
            columns=columns,
            rows=rows[:limit],
            truncated=truncated,
        )

    def write_rows(self, table: str, rows: list[dict], *, grant_id: str) -> int:
        store = self.grants or WriteGrantStore()
        if not store.has_grant(grant_id, self.name, table):
            raise WriteDeniedError(
                f"missing grant {grant_id!r} for {self.name}.{table}"
            )
        if not rows:
            return 0
        engine = self._ensure_engine()
        from sqlalchemy import text

        table_q = _quote_ident(table)
        columns = list(rows[0].keys())
        col_sql = ", ".join(_quote_ident(c) for c in columns)
        placeholders = ", ".join(f":{c}" for c in columns)
        stmt = text(f"INSERT INTO {table_q} ({col_sql}) VALUES ({placeholders})")
        with engine.begin() as conn:
            for row in rows:
                conn.execute(stmt, {c: row.get(c) for c in columns})
        store.record_write(
            grant_id=grant_id,
            channel=self.name,
            table=table,
            row_count=len(rows),
        )
        return len(rows)
