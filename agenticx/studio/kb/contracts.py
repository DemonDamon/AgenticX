"""Frozen contracts for the Machi KB MVP.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

Any change to shapes here requires a plan bump (v2.x) because the frontend
TypeScript mirrors these field names verbatim.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional


class KBError(Exception):
    """Base exception for KB subsystem errors."""


SUPPORTED_EXTENSIONS: List[str] = [".md", ".txt", ".pdf", ".docx"]
"""Stage-1 MVP file filter (plan §0)."""


@dataclass
class VectorStoreSpec:
    backend: Literal["chroma"] = "chroma"
    path: str = "~/.agenticx/storage/vector_db/default"
    collection: str = "default"


@dataclass
class EmbeddingSpec:
    provider: str = "ollama"
    model: str = "bge-m3"
    dim: int = 1024
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None


@dataclass
class ChunkingSpec:
    strategy: str = "recursive"
    chunk_size: int = 800
    chunk_overlap: int = 80


@dataclass
class FileFilterSpec:
    extensions: List[str] = field(default_factory=lambda: list(SUPPORTED_EXTENSIONS))
    max_file_size_mb: int = 100


@dataclass
class RetrievalSpec:
    top_k: int = 5
    score_floor: float = 0.0


@dataclass
class KBConfig:
    """Full KB node persisted under ``~/.agenticx/config.yaml : knowledge_base``."""

    enabled: bool = False
    vector_store: VectorStoreSpec = field(default_factory=VectorStoreSpec)
    embedding: EmbeddingSpec = field(default_factory=EmbeddingSpec)
    chunking: ChunkingSpec = field(default_factory=ChunkingSpec)
    file_filters: FileFilterSpec = field(default_factory=FileFilterSpec)
    retrieval: RetrievalSpec = field(default_factory=RetrievalSpec)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "KBConfig":
        if not data:
            return cls()
        merged = cls()
        if "enabled" in data:
            merged.enabled = bool(data.get("enabled"))
        if isinstance(data.get("vector_store"), dict):
            merged.vector_store = VectorStoreSpec(
                backend=str(data["vector_store"].get("backend", "chroma")),
                path=str(data["vector_store"].get("path", merged.vector_store.path)),
                collection=str(data["vector_store"].get("collection", merged.vector_store.collection)),
            )
        if isinstance(data.get("embedding"), dict):
            e = data["embedding"]
            merged.embedding = EmbeddingSpec(
                provider=str(e.get("provider", "ollama")),
                model=str(e.get("model", "bge-m3")),
                dim=int(e.get("dim", 1024)),
                base_url=e.get("base_url"),
                api_key_env=e.get("api_key_env"),
            )
        if isinstance(data.get("chunking"), dict):
            c = data["chunking"]
            merged.chunking = ChunkingSpec(
                strategy=str(c.get("strategy", "recursive")),
                chunk_size=int(c.get("chunk_size", 800)),
                chunk_overlap=int(c.get("chunk_overlap", 80)),
            )
        if isinstance(data.get("file_filters"), dict):
            f = data["file_filters"]
            exts = f.get("extensions")
            merged.file_filters = FileFilterSpec(
                extensions=list(exts) if isinstance(exts, list) else list(SUPPORTED_EXTENSIONS),
                max_file_size_mb=int(f.get("max_file_size_mb", 100)),
            )
        if isinstance(data.get("retrieval"), dict):
            r = data["retrieval"]
            merged.retrieval = RetrievalSpec(
                top_k=int(r.get("top_k", 5)),
                score_floor=float(r.get("score_floor", 0.0)),
            )
        return merged

    def embedding_fingerprint(self) -> str:
        """Stable identifier used to detect "rebuild required" after config change."""
        return f"{self.embedding.provider}:{self.embedding.model}:{self.embedding.dim}"


# ----------------------------- documents & jobs -----------------------------


class KBDocumentStatus(str, Enum):
    QUEUED = "queued"
    PARSING = "parsing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    WRITING = "writing"
    DONE = "done"
    FAILED = "failed"


@dataclass
class KBDocument:
    id: str
    source_path: str
    source_name: str
    size_bytes: int
    mtime_iso: str
    status: KBDocumentStatus = KBDocumentStatus.QUEUED
    chunks: int = 0
    error: Optional[str] = None
    added_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    embedding_fingerprint: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        return data


class IngestJobStatus(str, Enum):
    QUEUED = "queued"
    PARSING = "parsing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    WRITING = "writing"
    DONE = "done"
    FAILED = "failed"


@dataclass
class IngestReport:
    success: int = 0
    failed: int = 0
    reasons: List[str] = field(default_factory=list)


@dataclass
class IngestJob:
    id: str = field(default_factory=lambda: f"job_{uuid.uuid4().hex[:12]}")
    document_id: Optional[str] = None
    status: IngestJobStatus = IngestJobStatus.QUEUED
    progress: float = 0.0
    message: str = ""
    report: IngestReport = field(default_factory=IngestReport)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "document_id": self.document_id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "report": asdict(self.report),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


# --------------------------- retrieval --------------------------------------


@dataclass
class RetrievalHitSource:
    kind: Literal["local", "remote"] = "local"
    uri: str = ""
    title: Optional[str] = None
    chunk_index: Optional[int] = None
    page: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "uri": self.uri,
            "title": self.title,
            "chunk_index": self.chunk_index,
            "page": self.page,
        }


@dataclass
class RetrievalHit:
    id: str
    score: float
    text: str
    source: RetrievalHitSource
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "score": self.score,
            "text": self.text,
            "source": self.source.to_dict(),
            "metadata": self.metadata,
        }


@dataclass
class KBSearchResponse:
    hits: List[RetrievalHit] = field(default_factory=list)
    used_top_k: int = 0
    source: Literal["local"] = "local"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hits": [h.to_dict() for h in self.hits],
            "used_top_k": self.used_top_k,
            "source": self.source,
        }
