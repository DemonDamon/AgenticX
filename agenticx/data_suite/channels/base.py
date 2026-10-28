from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


class WriteDeniedError(RuntimeError):
    """Raised when write_rows is called without a valid grant."""


@dataclass
class ChannelProbeResult:
    channel: str
    ok: bool
    dialect: str = ""
    tables: List[str] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "channel": self.channel,
            "ok": self.ok,
            "dialect": self.dialect,
            "tables": list(self.tables),
            "error": self.error,
        }


@dataclass
class ChannelQueryResult:
    columns: List[str]
    rows: List[List[Any]]
    truncated: bool = False


@runtime_checkable
class DataChannel(Protocol):
    name: str

    def probe(self) -> ChannelProbeResult: ...

    def query(self, statement: str, *, limit: int = 200) -> ChannelQueryResult: ...

    def write_rows(self, table: str, rows: list[dict], *, grant_id: str) -> int: ...
