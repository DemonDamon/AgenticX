from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class LineageLog:
    """Append-only lineage event log for a job run."""

    events: List[Dict[str, Any]] = field(default_factory=list)

    def record(
        self,
        node_id: str,
        *,
        inputs: Optional[Any] = None,
        outputs: Optional[Any] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.events.append({
            "ts": datetime.now(timezone.utc).isoformat(),
            "node_id": node_id,
            "inputs": inputs,
            "outputs": outputs,
            "meta": dict(meta or {}),
        })
