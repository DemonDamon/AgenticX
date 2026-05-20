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
    CODE = "code"


class BrainScope(str, Enum):
    GLOBAL = "global"
    PRIVATE = "private"


@dataclass
class CodeBrainConfig:
    """Per-brain code index settings (1 brain ↔ 1 codebase)."""

    codebase_path: str = ""
    enabled: bool = True
    backend: str = "semble"
    preload_model: bool = False
    max_index_memory_mb: int = 1024
    search_mode: str = "hybrid"
    default_top_k: int = 10
    include_text_files: bool = False
    model: str = "minishlab/potion-code-16M"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "CodeBrainConfig":
        if not isinstance(data, dict):
            return cls()
        top_k = data.get("default_top_k", 10)
        try:
            top_k_int = int(top_k)
        except (TypeError, ValueError):
            top_k_int = 10
        mem = data.get("max_index_memory_mb", 1024)
        try:
            mem_int = int(mem)
        except (TypeError, ValueError):
            mem_int = 1024
        return cls(
            codebase_path=str(data.get("codebase_path") or ""),
            enabled=bool(data.get("enabled", True)),
            backend=str(data.get("backend") or "semble"),
            preload_model=bool(data.get("preload_model", False)),
            max_index_memory_mb=max(128, min(8192, mem_int)),
            search_mode=str(data.get("search_mode") or "hybrid"),
            default_top_k=max(1, min(50, top_k_int)),
            include_text_files=bool(data.get("include_text_files", False)),
            model=str(data.get("model") or "minishlab/potion-code-16M"),
        )


BrainConfigPayload = Union[KBConfig, CodeBrainConfig]


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

    def code_config(self) -> CodeBrainConfig:
        if self.type != BrainType.CODE:
            raise ValueError("not a code brain")
        return CodeBrainConfig.from_dict(self.config)


BrainsEnabledSpec = Optional[Union[Literal["*"], List[str]]]


def new_brain_id() -> str:
    return uuid.uuid4().hex[:12]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
