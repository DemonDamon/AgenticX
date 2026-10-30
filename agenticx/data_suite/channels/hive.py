"""HiveChannel — DataChannel for HiveServer2 / Spark Thrift SQL (in-memory / injectable)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from agenticx.data_suite.channels.base import (
    ChannelProbeResult,
    ChannelQueryResult,
    WriteDeniedError,
)
from agenticx.data_suite.channels.grants import WriteGrantStore

_SELECT_STAR = re.compile(
    r"^\s*SELECT\s+\*\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*$",
    re.IGNORECASE,
)


@dataclass
class InMemoryHiveTransport:
    """Dict table → list[dict] transport for offline CI / unit tests.

    Duck shape: ``list_tables`` / ``execute_query`` / ``execute_write``
    (also accepts ``query`` / ``write`` aliases via HiveChannel).
    """

    tables: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)

    def list_tables(self) -> List[str]:
        return sorted(self.tables.keys())

    def execute_query(
        self, sql: str, limit: int = 200
    ) -> Tuple[List[str], List[List[Any]]]:
        """Run a minimal ``SELECT * FROM <table>`` against memory tables."""
        m = _SELECT_STAR.match(sql or "")
        if not m:
            raise ValueError("InMemoryHiveTransport only supports `SELECT * FROM <table>`")
        table = m.group(1)
        rows = self.tables.get(table)
        if rows is None:
            raise KeyError(f"unknown table: {table}")
        sliced = list(rows[: int(limit)])
        if not sliced:
            return [], []
        columns = list(sliced[0].keys())
        out = [[r.get(c) for c in columns] for r in sliced]
        return columns, out

    def execute_write(self, table: str, rows: List[Dict[str, Any]]) -> int:
        bucket = self.tables.setdefault(table, [])
        bucket.extend(rows)
        return len(rows)

    # Aliases matching the channel duck typing in the plan
    def query(self, sql: str, limit: int = 200) -> Tuple[List[str], List[List[Any]]]:
        return self.execute_query(sql, limit=limit)

    def write(self, table: str, rows: List[Dict[str, Any]]) -> int:
        return self.execute_write(table, rows)


def _seed_memory_transport(cfg: Dict[str, Any]) -> InMemoryHiveTransport:
    tables = cfg.get("tables")
    seeded: Dict[str, List[Dict[str, Any]]] = {}
    if isinstance(tables, dict):
        for name, rows in tables.items():
            seeded[str(name)] = list(rows) if isinstance(rows, list) else []
    return InMemoryHiveTransport(tables=seeded)


def _has_hive_endpoint(cfg: Dict[str, Any]) -> bool:
    return bool(cfg.get("host") or cfg.get("thrift_uri") or cfg.get("url"))


def _try_live_transport(cfg: Dict[str, Any]) -> Any:
    """Optional live pyhive/thrift client. Raises RuntimeError if libs missing."""
    try:
        import pyhive  # noqa: F401  # type: ignore
    except ImportError:
        try:
            import thrift  # noqa: F401  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "hive thrift client not installed "
                "(install optional pyhive or thrift)"
            ) from exc
    # Live wiring is deferred; presence of a client lib is enough for probe path.
    raise RuntimeError(
        "live Hive transport not configured "
        "(inject transport= for tests; live thrift/pyhive wiring deferred)"
    )


@dataclass
class HiveChannel:
    """Hive / Spark Thrift DataChannel. Unit tests use InMemoryHiveTransport."""

    name: str
    transport: Any = None
    grants: Optional[WriteGrantStore] = None
    dialect: str = "hive"
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)
    _live_error: Optional[str] = field(default=None, repr=False)

    @classmethod
    def from_dict(
        cls,
        name: str,
        cfg: Dict[str, Any],
        *,
        grants: Optional[WriteGrantStore] = None,
        transport: Any = None,
    ) -> "HiveChannel":
        cfg = dict(cfg)
        dialect = str(cfg.get("dialect") or "hive").strip().lower() or "hive"
        ch = cls(name=name, grants=grants, dialect=dialect, _cfg=cfg)
        if transport is not None:
            ch.transport = transport
            return ch
        if _has_hive_endpoint(cfg):
            # Lazy: leave transport None; probe tries live and sets ok=False if deferred.
            return ch
        ch.transport = _seed_memory_transport(cfg)
        return ch

    def _ensure_transport(self) -> Any:
        if self.transport is not None:
            return self.transport
        if _has_hive_endpoint(self._cfg):
            try:
                self.transport = _try_live_transport(self._cfg)
            except RuntimeError as exc:
                self._live_error = str(exc)
                raise
        else:
            self.transport = _seed_memory_transport(self._cfg)
        return self.transport

    def probe(self) -> ChannelProbeResult:
        try:
            transport = self._ensure_transport()
        except RuntimeError as exc:
            return ChannelProbeResult(
                channel=self.name, ok=False, dialect=self.dialect, error=str(exc)
            )
        try:
            tables = [str(t) for t in transport.list_tables()]
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
        m = _SELECT_STAR.match(statement or "")
        if not m:
            raise ValueError(
                "HiveChannel only supports `SELECT * FROM <table>`"
            )
        table = m.group(1)
        transport = self._ensure_transport()
        # Prefer transport.execute_query / query; fall back to table read.
        try:
            if hasattr(transport, "execute_query"):
                columns, rows = transport.execute_query(
                    f"SELECT * FROM {table}", limit=int(limit) + 1
                )
            elif hasattr(transport, "query"):
                columns, rows = transport.query(
                    f"SELECT * FROM {table}", limit=int(limit) + 1
                )
            else:
                raise AttributeError("transport missing execute_query/query")
        except KeyError:
            raise KeyError(f"unknown table: {table}") from None
        if not rows:
            return ChannelQueryResult(columns=[], rows=[], truncated=False)
        truncated = len(rows) > limit
        return ChannelQueryResult(
            columns=list(columns),
            rows=[list(r) for r in rows[:limit]],
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
        transport = self._ensure_transport()
        if hasattr(transport, "execute_write"):
            n = transport.execute_write(table, rows)
        elif hasattr(transport, "write"):
            n = transport.write(table, rows)
        else:
            raise AttributeError("transport missing execute_write/write")
        store.record_write(
            grant_id=grant_id,
            channel=self.name,
            table=table,
            row_count=n,
        )
        return n
