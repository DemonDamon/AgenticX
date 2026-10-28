from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from agenticx.connectors.database import check_read_only_sql
from agenticx.data_suite.channels.base import (
    ChannelProbeResult,
    ChannelQueryResult,
    WriteDeniedError,
)
from agenticx.data_suite.channels.grants import WriteGrantStore


@dataclass
class ClickHouseChannel:
    """ClickHouse DataChannel. Requires optional extra ``clickhouse-connect``."""

    name: str
    client: Any = None
    grants: Optional[WriteGrantStore] = None
    database: str = ""
    _cfg: Dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(
        cls,
        name: str,
        cfg: Dict[str, Any],
        *,
        grants: Optional[WriteGrantStore] = None,
    ) -> "ClickHouseChannel":
        return cls(name=name, grants=grants, database=str(cfg.get("database") or ""), _cfg=dict(cfg))

    @classmethod
    def from_env(
        cls,
        name: str = "clickhouse",
        *,
        grants: Optional[WriteGrantStore] = None,
    ) -> "ClickHouseChannel":
        url = os.getenv("AGX_CH_URL", "").strip()
        cfg: Dict[str, Any] = {}
        if url:
            parsed = urlparse(url)
            cfg = {
                "host": parsed.hostname or "localhost",
                "port": parsed.port or 8123,
                "username": parsed.username or "default",
                "password": parsed.password or "",
                "database": (parsed.path or "/").lstrip("/") or "default",
            }
        else:
            cfg = {
                "host": os.getenv("AGX_CH_HOST", "localhost"),
                "port": int(os.getenv("AGX_CH_PORT", "8123")),
                "username": os.getenv("AGX_CH_USER", "default"),
                "password": os.getenv("AGX_CH_PASSWORD", ""),
                "database": os.getenv("AGX_CH_DATABASE", "default"),
            }
        return cls.from_dict(name, cfg, grants=grants)

    def _ensure_client(self) -> Any:
        if self.client is not None:
            return self.client
        try:
            import clickhouse_connect  # type: ignore
        except ImportError as exc:
            raise RuntimeError("clickhouse-connect not installed") from exc
        kwargs = {
            "host": self._cfg.get("host", "localhost"),
            "port": int(self._cfg.get("port") or 8123),
            "username": self._cfg.get("username") or self._cfg.get("user") or "default",
            "password": self._cfg.get("password") or "",
        }
        database = self._cfg.get("database") or self.database
        if database:
            kwargs["database"] = database
        self.client = clickhouse_connect.get_client(**kwargs)
        return self.client

    def probe(self) -> ChannelProbeResult:
        try:
            client = self._ensure_client()
        except RuntimeError as exc:
            return ChannelProbeResult(
                channel=self.name, ok=False, dialect="clickhouse", error=str(exc)
            )
        try:
            result = client.query("SHOW TABLES")
            tables = [str(r[0]) for r in (result.result_rows or [])]
            return ChannelProbeResult(
                channel=self.name,
                ok=True,
                dialect="clickhouse",
                tables=tables,
            )
        except Exception as exc:  # noqa: BLE001 — surface probe failure
            return ChannelProbeResult(
                channel=self.name, ok=False, dialect="clickhouse", error=str(exc)
            )

    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult:
        err = check_read_only_sql(statement)
        if err:
            raise ValueError(err)
        client = self._ensure_client()
        # Soft limit: wrap when statement has no LIMIT (best-effort for P0)
        sql = statement.rstrip().rstrip(";")
        if " limit " not in sql.lower():
            sql = f"{sql} LIMIT {int(limit)}"
        result = client.query(sql)
        columns = list(result.column_names or [])
        rows = [list(r) for r in (result.result_rows or [])]
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
        client = self._ensure_client()
        columns = list(rows[0].keys())
        payload = [[r.get(c) for c in columns] for r in rows]
        client.insert(table, payload, column_names=columns)
        store.record_write(
            grant_id=grant_id,
            channel=self.name,
            table=table,
            row_count=len(rows),
        )
        return len(rows)
