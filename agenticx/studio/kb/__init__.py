"""Machi Knowledge Base (Stage 1 MVP) — backend package.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md
Author: Damon Li

Scope (per plan §0):
- Single global KB (no per-avatar / per-session binding yet).
- Chroma (local PersistentClient) as the only vector store.
- Ollama bge-m3 by default; online embedding providers as fallback.
- recursive_chunker, chunk_size=800, overlap=80.
- VectorRetriever only (K=5).
- Built-in knowledge_search tool (not MCP).
"""

from .contracts import (
    ChunkingSpec,
    EmbeddingSpec,
    FileFilterSpec,
    IngestJob,
    IngestJobStatus,
    IngestReport,
    KBConfig,
    KBDocument,
    KBDocumentStatus,
    KBError,
    KBSearchResponse,
    RetrievalHit,
    RetrievalHitSource,
    RetrievalSpec,
    SUPPORTED_EXTENSIONS,
    VectorStoreSpec,
)
from .jobs import JobRegistry
from .manager import KBManager
from .runtime import KBRuntime

__all__ = [
    "ChunkingSpec",
    "EmbeddingSpec",
    "FileFilterSpec",
    "IngestJob",
    "IngestJobStatus",
    "IngestReport",
    "JobRegistry",
    "KBConfig",
    "KBDocument",
    "KBDocumentStatus",
    "KBError",
    "KBManager",
    "KBRuntime",
    "KBSearchResponse",
    "RetrievalHit",
    "RetrievalHitSource",
    "RetrievalSpec",
    "SUPPORTED_EXTENSIONS",
    "VectorStoreSpec",
]
