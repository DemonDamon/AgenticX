"""FileChannel — DataChannel for SFTP / object storage (in-memory / injectable transport)."""

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


class TransientFileError(RuntimeError):
    """Transient transport failure eligible for channel-level retry."""


@dataclass
class PathLayoutPolicy:
    """Injectable path/partition strategy. Engine default: flat ``{table}/{name}``."""

    def list_keys(self, table: str) -> List[str]:
        raise NotImplementedError

    def resolve_read(self, table: str, key: str) -> str:
        return f"{table}/{key}"

    def resolve_write(self, table: str, key: str) -> str:
        return f"{table}/{key}"


@dataclass
class FlatPathPolicy(PathLayoutPolicy):
    """Default flat layout: keys are object names under the logical table."""

    def list_keys(self, table: str) -> List[str]:
        # Caller (transport) supplies actual keys; this is a no-op default.
        return []


@dataclass
class InMemoryFileTransport:
    """Dict table → key → list[dict] rows for offline CI / unit tests.

    Optional ``path_policy`` remaps listed object keys (partition layout is
    configurable policy — not hardcoded in the channel kernel).
    """

    tables: Dict[str, Dict[str, List[Dict[str, Any]]]] = field(default_factory=dict)
    path_policy: Optional[PathLayoutPolicy] = None
    fail_times: int = 0

    def list_tables(self) -> List[str]:
        return sorted(self.tables.keys())

    def list_objects(self, table: str) -> List[str]:
        keys = sorted((self.tables.get(table) or {}).keys())
        policy = self.path_policy
        if policy is not None and hasattr(policy, "list_keys"):
            custom = policy.list_keys(table)
            if custom:
                return list(custom)
        return keys

    def _maybe_fail(self) -> None:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise TransientFileError("simulated transient failure")

    def read_rows(self, table: str, *, limit: int = 200) -> List[Dict[str, Any]]:
        self._maybe_fail()
        bucket = self.tables.get(table)
        if bucket is None:
            raise KeyError(f"unknown table: {table}")
        rows: List[Dict[str, Any]] = []
        for _key in sorted(bucket.keys()):
            rows.extend(bucket[_key])
            if len(rows) >= int(limit):
                break
        return list(rows[: int(limit)])

    def write_rows(self, table: str, rows: List[Dict[str, Any]]) -> int:
        self._maybe_fail()
        objects = self.tables.setdefault(table, {})
        key = "part-0"
        policy = self.path_policy
        if policy is not None:
            key = policy.resolve_write(table, key)
            # Prefer bare object name under table when policy returns a path.
            if "/" in key:
                key = key.rsplit("/", 1)[-1]
        bucket = objects.setdefault(key, [])
        bucket.extend(rows)
        return len(rows)


def _seed_memory_transport(cfg: Dict[str, Any]) -> InMemoryFileTransport:
    tables_cfg = cfg.get("tables")
    seeded: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    if isinstance(tables_cfg, dict):
        for name, value in tables_cfg.items():
            tname = str(name)
            if isinstance(value, list):
                # Flat seed: table -> rows → single object "obj"
                seeded[tname] = {"obj": list(value)}
            elif isinstance(value, dict):
                # Nested: table -> key -> rows
                nested: Dict[str, List[Dict[str, Any]]] = {}
                for k, rows in value.items():
                    nested[str(k)] = list(rows) if isinstance(rows, list) else []
                seeded[tname] = nested
            else:
                seeded[tname] = {}
    return InMemoryFileTransport(tables=seeded)


def _has_file_endpoint(cfg: Dict[str, Any]) -> bool:
    return bool(
        cfg.get("root")
        or cfg.get("base_path")
        or cfg.get("sftp_host")
        or cfg.get("endpoint")
        or cfg.get("bucket")
    )


def _try_live_transport(cfg: Dict[str, Any]) -> Any:
    """Optional live client. Deferred — inject transport= for tests."""
    raise RuntimeError(
        "live file transport not configured "
        "(inject transport= for tests; live SFTP/OSS wiring deferred)"
    )


def _with_retry(fn, *, retries: int):
    """Run ``fn``; retry on TransientFileError (``retries`` retries → retries+1 attempts)."""
    last_exc: Optional[BaseException] = None
    for _ in range(max(1, int(retries) + 1)):
        try:
            return fn()
        except TransientFileError as exc:
            last_exc = exc
            continue
    assert last_exc is not None
    raise last_exc


@dataclass
class FileChannel:
    """File / object-storage DataChannel. Unit tests use InMemoryFileTransport."""

    name: str
    transport: Any = None
    grants: Optional[WriteGrantStore] = None
    dialect: str = "file"
    path_policy: Any = None
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
    ) -> "FileChannel":
        cfg = dict(cfg)
        ch = cls(name=name, grants=grants, dialect="file", _cfg=cfg)
        if transport is not None:
            ch.transport = transport
            return ch
        if _has_file_endpoint(cfg):
            # Lazy: leave transport None; probe tries live and sets ok=False if deferred.
            return ch
        ch.transport = _seed_memory_transport(cfg)
        return ch

    def _retries(self) -> int:
        raw = self._cfg.get("retries", 2)
        try:
            return int(raw)
        except (TypeError, ValueError):
            return 2

    def _ensure_transport(self) -> Any:
        if self.transport is not None:
            return self.transport
        if _has_file_endpoint(self._cfg):
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
                "FileChannel only supports `SELECT * FROM <table>`"
            )
        table = m.group(1)
        transport = self._ensure_transport()

        def _read():
            return transport.read_rows(table, limit=int(limit) + 1)

        try:
            rows_dicts = _with_retry(_read, retries=self._retries())
        except KeyError:
            raise KeyError(f"unknown table: {table}") from None
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
        if not rows:
            return 0
        transport = self._ensure_transport()

        def _write():
            return transport.write_rows(table, rows)

        n = _with_retry(_write, retries=self._retries())
        store.record_write(
            grant_id=grant_id,
            channel=self.name,
            table=table,
            row_count=n,
        )
        return n
