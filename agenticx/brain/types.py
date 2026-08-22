"""Brain domain types — Plan-Id: 2026-05-20-multi-brain-knowledge-architecture."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from agenticx.studio.kb.contracts import KBConfig


class BrainType(str, Enum):
    DOCS = "docs"


class BrainScope(str, Enum):
    GLOBAL = "global"
    PRIVATE = "private"


BrainConfigPayload = KBConfig


@dataclass
class BrainStats:
    doc_count: int = 0
    indexed_doc_count: int = 0
    failed_doc_count: int = 0
    chunk_count: int = 0
    last_indexed: Optional[str] = None
    rebuild_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "BrainStats":
        if not isinstance(data, dict):
            return cls()
        return cls(
            doc_count=int(data.get("doc_count") or 0),
            indexed_doc_count=int(data.get("indexed_doc_count") or 0),
            failed_doc_count=int(data.get("failed_doc_count") or 0),
            chunk_count=int(data.get("chunk_count") or 0),
            last_indexed=data.get("last_indexed"),
            rebuild_required=bool(data.get("rebuild_required")),
        )


@dataclass
class Brain:
    id: str
    name: str
    type: BrainType
    scope: BrainScope
    storage_root: str
    enabled: bool = True
    description: str = ""
    owner_avatar_id: Optional[str] = None
    config: Dict[str, Any] = field(default_factory=dict)
    stats: BrainStats = field(default_factory=BrainStats)
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type.value,
            "scope": self.scope.value,
            "storage_root": self.storage_root,
            "enabled": self.enabled,
            "description": self.description,
            "owner_avatar_id": self.owner_avatar_id,
            "config": self.config,
            "stats": self.stats.to_dict(),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Brain":
        btype = BrainType(str(data.get("type") or "docs"))
        scope = BrainScope(str(data.get("scope") or "global"))
        return cls(
            id=str(data["id"]),
            name=str(data.get("name") or data["id"]),
            type=btype,
            scope=scope,
            storage_root=str(data.get("storage_root") or ""),
            enabled=bool(data.get("enabled", True)),
            description=str(data.get("description") or ""),
            owner_avatar_id=data.get("owner_avatar_id"),
            config=dict(data.get("config") or {}),
            stats=BrainStats.from_dict(data.get("stats")),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )

    def docs_config(self) -> KBConfig:
        if self.type != BrainType.DOCS:
            raise ValueError("not a docs brain")
        return KBConfig.from_dict(self.config)

BrainsEnabledSpec = Optional[Union[Literal["*"], List[str]]]


def new_brain_id() -> str:
    return uuid.uuid4().hex[:12]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
