from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

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
class FakeChannel:
    """In-memory channel for jdbc/hive/kafka/file shapes in offline CI."""

    name: str
    tables: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    grants: Optional[WriteGrantStore] = None
    kind: str = "fake"
    dialect: str = "fake"

    def probe(self) -> ChannelProbeResult:
        return ChannelProbeResult(
            channel=self.name,
            ok=True,
            dialect=self.dialect or self.kind,
            tables=sorted(self.tables.keys()),
        )

    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult:
        m = _SELECT_STAR.match(statement or "")
        if not m:
            raise ValueError(
                "FakeChannel P0 only supports `SELECT * FROM <table>`"
            )
        table = m.group(1)
        if table not in self.tables:
            raise KeyError(f"unknown table: {table}")
        rows_dicts = self.tables[table]
        if not rows_dicts:
            return ChannelQueryResult(columns=[], rows=[], truncated=False)
        columns = list(rows_dicts[0].keys())
        truncated = len(rows_dicts) > limit
        sliced = rows_dicts[:limit]
        rows = [[r.get(c) for c in columns] for r in sliced]
        return ChannelQueryResult(columns=columns, rows=rows, truncated=truncated)

    def write_rows(self, table: str, rows: list[dict], *, grant_id: str) -> int:
        store = self.grants or WriteGrantStore()
        if not store.has_grant(grant_id, self.name, table):
            raise WriteDeniedError(
                f"missing grant {grant_id!r} for {self.name}.{table}"
            )
        bucket = self.tables.setdefault(table, [])
        bucket.extend(rows)
        store.record_write(
            grant_id=grant_id,
            channel=self.name,
            table=table,
            row_count=len(rows),
        )
        return len(rows)
