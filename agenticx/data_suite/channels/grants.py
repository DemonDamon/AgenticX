from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List


@dataclass
class WriteGrantStore:
    grants: Dict[str, Dict[str, str]] = field(default_factory=dict)
    audit: List[Dict[str, Any]] = field(default_factory=list)

    def has_grant(self, grant_id: str, channel: str, table: str) -> bool:
        g = self.grants.get(grant_id)
        if not g:
            return False
        return g.get("channel") == channel and g.get("table") == table

    def record_write(
        self,
        *,
        grant_id: str,
        channel: str,
        table: str,
        row_count: int,
    ) -> None:
        self.audit.append({
            "ts": datetime.now(timezone.utc).isoformat(),
            "grant_id": grant_id,
            "channel": channel,
            "table": table,
            "row_count": row_count,
        })
