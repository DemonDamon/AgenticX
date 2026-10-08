"""Database connector core (SQLite / MySQL / PostgreSQL), read-only by default.

Safety layers for the default read-only mode:

1. SQL gate: one statement only; must start with SELECT / WITH / SHOW /
   DESCRIBE / DESC / EXPLAIN; data-changing keywords anywhere are rejected.
2. Connection-level read-only: SQLite ``mode=ro`` URI, PostgreSQL read-only
   session, MySQL ``SET SESSION TRANSACTION READ ONLY`` + read-only transaction.
3. Row limit (fetchmany) with an explicit ``truncated`` flag.

Writes are only possible with ``AGX_DB_ALLOW_WRITES=1`` (explicit opt-in at
creation time), via a separate ``execute_write`` tool.

Configuration comes from env (``AGX_DB_*``), so the password lives in the
mcp.json ``env`` block like other MCP secrets and never enters tool results.

Author: Damon Li
"""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DB_TYPES = ("sqlite", "mysql", "postgresql")
DEFAULT_PORTS = {"mysql": 3306, "postgresql": 5432}
DEFAULT_ROW_LIMIT = 200
MAX_ROW_LIMIT = 5000
MAX_CELL_CHARS = 2000

_READ_PREFIX = re.compile(r"^\s*(select|with|show|describe|desc|explain)\b", re.I)
_WRITE_WORDS = re.compile(
    r"\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|"
    r"attach|detach|vacuum|reindex|copy|call|lock|pragma)\b",
    re.I,
)
_INTO = re.compile(r"\binto\s+(outfile|dumpfile)\b|\bselect\b[^;]*\binto\b", re.I)


class DbError(RuntimeError):
    pass


@dataclass
class DbConfig:
    db_type: str
    path: str = ""  # sqlite
    host: str = ""
    port: int = 0
    database: str = ""
    user: str = ""
    password: str = field(default="", repr=False)
    allow_writes: bool = False
    row_limit: int = DEFAULT_ROW_LIMIT
    ssl: bool = False

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None) -> "DbConfig":
        e = env if env is not None else os.environ
        db_type = normalize_db_type(e.get("AGX_DB_TYPE", ""))
        try:
            port = int(e.get("AGX_DB_PORT") or 0)
        except ValueError:
            port = 0
        try:
            limit = int(e.get("AGX_DB_ROW_LIMIT") or DEFAULT_ROW_LIMIT)
        except ValueError:
            limit = DEFAULT_ROW_LIMIT
        return cls(
            db_type=db_type,
            path=e.get("AGX_DB_PATH", ""),
            host=e.get("AGX_DB_HOST", ""),
            port=port or DEFAULT_PORTS.get(db_type, 0),
            database=e.get("AGX_DB_NAME", ""),
            user=e.get("AGX_DB_USER", ""),
            password=e.get("AGX_DB_PASSWORD", ""),
            allow_writes=str(e.get("AGX_DB_ALLOW_WRITES", "")).strip() in ("1", "true", "yes"),
            row_limit=max(1, min(limit, MAX_ROW_LIMIT)),
            ssl=str(e.get("AGX_DB_SSL", "")).strip() in ("1", "true", "yes"),
        )

    def to_env(self) -> Dict[str, str]:
        env = {"AGX_DB_TYPE": self.db_type, "AGX_DB_ROW_LIMIT": str(self.row_limit)}
        if self.db_type == "sqlite":
            env["AGX_DB_PATH"] = self.path
        else:
            env.update({
                "AGX_DB_HOST": self.host,
                "AGX_DB_PORT": str(self.port or DEFAULT_PORTS[self.db_type]),
                "AGX_DB_NAME": self.database,
                "AGX_DB_USER": self.user,
            })
            if self.password:
                env["AGX_DB_PASSWORD"] = self.password
            if self.ssl:
                env["AGX_DB_SSL"] = "1"
        if self.allow_writes:
            env["AGX_DB_ALLOW_WRITES"] = "1"
        return env

    def identity(self) -> str:
        """Dedupe key: same database + same account = same connector."""
        if self.db_type == "sqlite":
            return f"sqlite:{Path(self.path).expanduser().resolve()}"
        return f"{self.db_type}://{self.user}@{self.host.lower()}:{self.port or DEFAULT_PORTS[self.db_type]}/{self.database}"

    def validate(self) -> Optional[str]:
        if self.db_type not in DB_TYPES:
            return "db_type must be sqlite / mysql / postgresql"
        if self.db_type == "sqlite":
            if not self.path:
                return "sqlite needs a file path"
            if not Path(self.path).expanduser().is_file():
                return f"sqlite file not found: {self.path}"
            return None
        if not self.host or not self.database or not self.user:
            return "host / database / user are required"
        if not (0 < int(self.port or DEFAULT_PORTS[self.db_type]) < 65536):
            return "invalid port"
        return None


def normalize_db_type(raw: Any) -> str:
    t = str(raw or "").strip().lower()
    return {"postgres": "postgresql", "pg": "postgresql", "pgsql": "postgresql", "sqlite3": "sqlite", "mariadb": "mysql"}.get(t, t)


def driver_status(db_type: str) -> Tuple[bool, str]:
    db_type = normalize_db_type(db_type)
    if db_type == "sqlite":
        return True, "sqlite3 (stdlib)"
    if db_type == "mysql":
        try:
            import pymysql  # noqa: F401

            return True, "pymysql"
        except ImportError:
            return False, "pip install pymysql"
    if db_type == "postgresql":
        for mod in ("psycopg2", "psycopg"):
            try:
                __import__(mod)
                return True, mod
            except ImportError:
                continue
        return False, "pip install psycopg2-binary"
    return False, "unsupported db_type"


def _strip_sql(sql: str) -> str:
    s = re.sub(r"--[^\n]*", " ", sql)
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    # blank out string literals so keywords inside them don't trip the gate
    s = re.sub(r"'(?:''|[^'])*'", "''", s)
    s = re.sub(r'"(?:""|[^"])*"', '""', s)
    s = re.sub(r"`[^`]*`", "``", s)
    return s.strip()


def check_read_only_sql(sql: str) -> Optional[str]:
    """Return an error message when *sql* is not a single read-only statement."""
    cleaned = _strip_sql(sql or "")
    if not cleaned:
        return "empty SQL"
    body = cleaned.rstrip().rstrip(";").strip()
    if ";" in body:
        return "only one statement is allowed"
    if not _READ_PREFIX.match(body):
        return "read-only mode: only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN are allowed"
    m = _WRITE_WORDS.search(body)
    if m:
        return f"read-only mode: keyword '{m.group(1).upper()}' is not allowed"
    if _INTO.search(body):
        return "read-only mode: SELECT ... INTO is not allowed"
    return None


_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)?$")


def _check_ident(name: str) -> str:
    n = str(name or "").strip()
    if not _IDENT.match(n):
        raise DbError("invalid table name (letters, digits, _ and optional schema. prefix)")
    return n


class Database:
    def __init__(self, cfg: DbConfig) -> None:
        self.cfg = cfg
        err = cfg.validate()
        if err:
            raise DbError(err)

    # -- connections -------------------------------------------------------
    def _connect(self, *, write: bool = False):
        c = self.cfg
        if c.db_type == "sqlite":
            p = Path(c.path).expanduser().resolve()
            if write and c.allow_writes:
                return sqlite3.connect(str(p), timeout=10)
            return sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=10)
        if c.db_type == "mysql":
            import pymysql

            conn = pymysql.connect(
                host=c.host, port=int(c.port or 3306), user=c.user, password=c.password,
                database=c.database, connect_timeout=10, read_timeout=60, charset="utf8mb4",
                ssl={"ssl": {}} if c.ssl else None,
            )
            if not write:
                with conn.cursor() as cur:
                    cur.execute("SET SESSION TRANSACTION READ ONLY")
            return conn
        if c.db_type == "postgresql":
            try:
                import psycopg2

                conn = psycopg2.connect(
                    host=c.host, port=int(c.port or 5432), user=c.user, password=c.password,
                    dbname=c.database, connect_timeout=10, sslmode="require" if c.ssl else "prefer",
                )
                if not write:
                    conn.set_session(readonly=True, autocommit=False)
                return conn
            except ImportError:
                import psycopg  # type: ignore

                conn = psycopg.connect(
                    host=c.host, port=int(c.port or 5432), user=c.user, password=c.password,
                    dbname=c.database, connect_timeout=10,
                )
                if not write:
                    conn.read_only = True
                return conn
        raise DbError("unsupported db_type")

    def _scrub(self, exc: BaseException) -> str:
        msg = f"{type(exc).__name__}: {exc}"
        if self.cfg.password:
            msg = msg.replace(self.cfg.password, "***")
        return msg[:500]

    def _run(self, sql: str, params: Tuple = (), *, limit: Optional[int] = None, write: bool = False) -> Dict[str, Any]:
        lim = max(1, min(int(limit or self.cfg.row_limit), MAX_ROW_LIMIT))
        try:
            conn = self._connect(write=write)
        except DbError:
            raise
        except Exception as exc:
            raise DbError(f"connect failed: {self._scrub(exc)}") from None
        try:
            cur = conn.cursor()
            cur.execute(sql, params) if params else cur.execute(sql)
            if cur.description is None:
                affected = cur.rowcount
                if write:
                    conn.commit()
                return {"columns": [], "rows": [], "row_count": 0, "affected_rows": affected, "truncated": False}
            cols = [d[0] for d in cur.description]
            rows = cur.fetchmany(lim + 1)
            truncated = len(rows) > lim
            rows = rows[:lim]
            out_rows = [[_cell(v) for v in r] for r in rows]
            return {"columns": cols, "rows": out_rows, "row_count": len(out_rows), "truncated": truncated, "row_limit": lim}
        except DbError:
            raise
        except Exception as exc:
            raise DbError(self._scrub(exc)) from None
        finally:
            try:
                if not write:
                    conn.rollback()
            except Exception:
                pass
            conn.close()

    # -- tools ---------------------------------------------------------------
    def list_tables(self) -> List[str]:
        t = self.cfg.db_type
        if t == "sqlite":
            sql = "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        elif t == "mysql":
            sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
        else:
            sql = (
                "SELECT CASE WHEN table_schema = 'public' THEN table_name ELSE table_schema || '.' || table_name END "
                "FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') "
                "ORDER BY table_schema, table_name"
            )
        res = self._run(sql, limit=MAX_ROW_LIMIT)
        return [str(r[0]) for r in res["rows"]]

    def describe_table(self, table: str) -> Dict[str, Any]:
        name = _check_ident(table)
        t = self.cfg.db_type
        if t == "sqlite":
            res = self._run(f'PRAGMA table_info("{name}")', limit=MAX_ROW_LIMIT)
            cols = [{"name": r[1], "type": r[2], "nullable": not r[3], "default": r[4], "primary_key": bool(r[5])} for r in res["rows"]]
        elif t == "mysql":
            res = self._run(
                "SELECT column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = %s ORDER BY ordinal_position",
                (name,), limit=MAX_ROW_LIMIT,
            )
            cols = [{"name": r[0], "type": r[1], "nullable": r[2] == "YES", "default": r[3], "primary_key": r[4] == "PRI"} for r in res["rows"]]
        else:
            schema, _, tbl = name.rpartition(".")
            res = self._run(
                "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
                (schema or "public", tbl), limit=MAX_ROW_LIMIT,
            )
            cols = [{"name": r[0], "type": r[1], "nullable": r[2] == "YES", "default": r[3]} for r in res["rows"]]
        if not cols:
            raise DbError(f"table not found: {name}")
        return {"table": name, "columns": cols}

    def query(self, sql: str, limit: Optional[int] = None) -> Dict[str, Any]:
        err = check_read_only_sql(sql)
        if err:
            raise DbError(err)
        return self._run(sql, limit=limit)

    def execute_write(self, sql: str) -> Dict[str, Any]:
        if not self.cfg.allow_writes:
            raise DbError("writes are disabled for this connector (read-only)")
        cleaned = _strip_sql(sql).rstrip(";").strip()
        if ";" in cleaned:
            raise DbError("only one statement is allowed")
        return self._run(sql, write=True)

    def health(self) -> Dict[str, Any]:
        tables = self.list_tables()
        return {"ok": True, "table_count": len(tables), "tables_preview": tables[:20]}


def _cell(v: Any) -> Any:
    if v is None or isinstance(v, (int, float, bool)):
        return v
    if isinstance(v, (bytes, bytearray, memoryview)):
        b = bytes(v)
        return f"<{len(b)} bytes>"
    s = str(v)
    return s if len(s) <= MAX_CELL_CHARS else s[:MAX_CELL_CHARS] + "…"
