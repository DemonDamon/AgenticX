"""KafkaChannel — DataChannel for Kafka topics (in-memory / injectable transport)."""

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
class InMemoryKafkaTransport:
    """Dict topic → list[dict] transport for offline CI / unit tests."""

    topics: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)

    def list_topics(self) -> List[str]:
        return sorted(self.topics.keys())

    def read(self, topic: str, limit: int = 200) -> List[Dict[str, Any]]:
        rows = self.topics.get(topic)
        if rows is None:
            raise KeyError(f"unknown topic: {topic}")
        return list(rows[: int(limit)])

    def write(self, topic: str, rows: List[Dict[str, Any]]) -> int:
        bucket = self.topics.setdefault(topic, [])
        bucket.extend(rows)
        return len(rows)


def _seed_memory_transport(cfg: Dict[str, Any]) -> InMemoryKafkaTransport:
    tables = cfg.get("tables")
    topics_cfg = cfg.get("topics")
    seeded: Dict[str, List[Dict[str, Any]]] = {}
    if isinstance(tables, dict):
        for name, rows in tables.items():
            seeded[str(name)] = list(rows) if isinstance(rows, list) else []
    if isinstance(topics_cfg, (list, tuple)):
        for name in topics_cfg:
            seeded.setdefault(str(name), [])
    return InMemoryKafkaTransport(topics=seeded)


def _has_bootstrap(cfg: Dict[str, Any]) -> bool:
    return bool(
        cfg.get("bootstrap_servers") or cfg.get("bootstrap") or cfg.get("servers")
    )


def _try_live_transport(cfg: Dict[str, Any]) -> Any:
    """Optional live client. Raises RuntimeError with clear message if libs missing."""
    try:
        import confluent_kafka  # noqa: F401  # type: ignore
    except ImportError:
        try:
            import kafka  # noqa: F401  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "kafka client not installed "
                "(install optional confluent-kafka or kafka-python)"
            ) from exc
    # Live wiring is deferred; presence of a client lib is enough for S2 probe path.
    # Without a full admin/consumer wrapper, still surface that bootstrap was requested.
    raise RuntimeError(
        "live Kafka transport not configured "
        "(inject transport= for tests; live client wiring deferred)"
    )


@dataclass
class KafkaChannel:
    """Kafka DataChannel. Unit tests use InMemoryKafkaTransport / injected transport."""

    name: str
    transport: Any = None
    grants: Optional[WriteGrantStore] = None
    dialect: str = "kafka"
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
    ) -> "KafkaChannel":
        cfg = dict(cfg)
        ch = cls(name=name, grants=grants, dialect="kafka", _cfg=cfg)
        if transport is not None:
            ch.transport = transport
            return ch
        if _has_bootstrap(cfg):
            # Lazy: leave transport None; probe tries live import and sets ok=False if missing.
            return ch
        ch.transport = _seed_memory_transport(cfg)
        return ch

    def _ensure_transport(self) -> Any:
        if self.transport is not None:
            return self.transport
        if _has_bootstrap(self._cfg):
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
            tables = [str(t) for t in transport.list_topics()]
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
                "KafkaChannel only supports `SELECT * FROM <topic>`"
            )
        topic = m.group(1)
        transport = self._ensure_transport()
        try:
            # Fetch one extra to detect truncation (FakeChannel-compatible).
            rows_dicts = transport.read(topic, limit=int(limit) + 1)
        except KeyError:
            raise KeyError(f"unknown topic: {topic}") from None
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
        n = transport.write(table, rows)
        store.record_write(
            grant_id=grant_id,
            channel=self.name,
            table=table,
            row_count=n,
        )
        return n
