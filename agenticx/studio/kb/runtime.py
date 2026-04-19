"""KBRuntime — single-instance knowledge base backing Machi Stage-1 MVP.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

Design rationale (per plan §2.1):
- Reuses ``agenticx.knowledge.readers`` and ``agenticx.knowledge.chunkers``.
- Uses ``chromadb.PersistentClient`` **directly**. Rationale: the existing
  ``agenticx.storage.vectordb_storages.chroma.ChromaStorage`` is a stub
  (pure print statements, plan v2.1 §7 already flags this layer as optional),
  and fixing the full BaseVectorStorage surface is out of scope for Stage 1.
- Embedding is resolved through a provider factory here instead of
  ``agenticx.embeddings.router`` because MVP only needs a single primary
  provider, not a multi-provider fail-over chain.

Everything exposed here is synchronous and thread-friendly so the FastAPI
route handlers can ``await asyncio.to_thread(...)`` and so the background
ingest queue (``kb_jobs.py``) can call these methods from worker threads.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .contracts import (
    ChunkingSpec,
    EmbeddingSpec,
    IngestReport,
    KBConfig,
    KBDocument,
    KBDocumentStatus,
    KBError,
    RetrievalHit,
    RetrievalHitSource,
    SUPPORTED_EXTENSIONS,
    VectorStoreSpec,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Embedding provider factory                                                  #
# --------------------------------------------------------------------------- #


def _build_embedding_provider(spec: EmbeddingSpec):
    """Resolve an ``agenticx.embeddings`` provider from an ``EmbeddingSpec``.

    The default path is ``ollama`` routed through LiteLLM (``ollama/<model>``).
    Online providers (OpenAI / SiliconFlow / Bailian) go through their native
    classes so that ``api_base`` and dimension hints land in the right kwargs.
    """

    # Prefer the literal api_key in config; fall back to env-var name; finally
    # the well-known vendor default env vars (OPENAI_API_KEY / DASHSCOPE_API_KEY /…).
    literal_key = (spec.api_key or "").strip() or None
    env_key = os.environ.get(spec.api_key_env) if spec.api_key_env else None
    api_key = literal_key or env_key
    provider = (spec.provider or "").lower().strip()

    if provider in {"ollama", "litellm"}:
        from agenticx.embeddings.litellm import LiteLLMEmbeddingProvider

        model = spec.model if spec.model.startswith("ollama/") or provider == "litellm" else f"ollama/{spec.model}"
        base_url = spec.base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        return LiteLLMEmbeddingProvider(model=model, api_key=api_key, api_base=base_url)

    if provider == "openai":
        from agenticx.embeddings.openai import OpenAIEmbeddingProvider

        return OpenAIEmbeddingProvider(
            api_key=api_key or os.environ.get("OPENAI_API_KEY", ""),
            model=spec.model,
            api_base=spec.base_url,
            dimensions=spec.dim if spec.dim else None,
        )

    if provider == "siliconflow":
        from agenticx.embeddings.siliconflow import SiliconFlowEmbeddingProvider

        return SiliconFlowEmbeddingProvider(
            api_key=api_key or os.environ.get("SILICONFLOW_API_KEY", ""),
            model=spec.model,
            dimensions=spec.dim if spec.dim else None,
            **({"api_url": spec.base_url} if spec.base_url else {}),
        )

    if provider == "bailian":
        from agenticx.embeddings.bailian import BailianEmbeddingProvider

        return BailianEmbeddingProvider(
            api_key=api_key or os.environ.get("DASHSCOPE_API_KEY", ""),
            model=spec.model,
            # Bailian v4 supports 2048/1536/1024(默认)/768/512/256/128/64 —
            # forward the user-chosen dim so the HTTP request carries
            # `dimensions=<dim>` and the returned vectors match KBConfig.dim.
            dimensions=spec.dim if spec.dim else None,
            # Bailian's text-embedding API caps each request at 10 inputs
            # ("batch size is invalid, it should not be larger than 10").
            # The provider default (100) silently fails on the first call
            # with any KB above ~10 chunks.
            batch_size=10,
            **({"api_url": spec.base_url} if spec.base_url else {}),
        )

    raise KBError(f"Unsupported embedding provider: {spec.provider!r}")


# --------------------------------------------------------------------------- #
# Chroma adapter                                                              #
# --------------------------------------------------------------------------- #


class _ChromaBackend:
    """Minimal PersistentClient wrapper sized to MVP needs.

    A full ``agenticx.storage.vectordb_storages`` integration is deferred: the
    existing ChromaStorage is a stub (plan §7) and Stage-1 only needs add/
    delete/query over a single collection.
    """

    def __init__(self, spec: VectorStoreSpec, *, expected_dim: int) -> None:
        self._spec = spec
        self._expected_dim = int(expected_dim)
        self._lock = threading.RLock()
        self._client = None
        self._collection = None
        self._path = Path(os.path.expanduser(spec.path))
        self._path.mkdir(parents=True, exist_ok=True)

    def _ensure(self) -> None:
        if self._collection is not None:
            return
        try:
            import chromadb
        except ImportError as exc:  # pragma: no cover - exercised via install docs
            raise KBError(
                "chromadb is required for the knowledge base. Install with `pip install chromadb`."
            ) from exc

        with self._lock:
            if self._collection is not None:
                return
            self._client = chromadb.PersistentClient(path=str(self._path))
            self._collection = self._client.get_or_create_collection(
                name=self._spec.collection,
                metadata={"expected_dim": self._expected_dim},
            )

    # ------------------------------- writes -------------------------------- #

    def upsert(
        self,
        *,
        ids: List[str],
        texts: List[str],
        embeddings: List[List[float]],
        metadatas: List[Dict[str, Any]],
    ) -> None:
        if not ids:
            return
        self._ensure()
        with self._lock:
            self._collection.upsert(
                ids=ids,
                documents=texts,
                embeddings=embeddings,
                metadatas=metadatas,
            )

    def delete_by_document(self, document_id: str) -> int:
        self._ensure()
        with self._lock:
            try:
                result = self._collection.get(where={"document_id": document_id})
                ids = result.get("ids") or []
                if not ids:
                    return 0
                self._collection.delete(ids=ids)
                return len(ids)
            except Exception as exc:  # pragma: no cover - chromadb-specific errors
                logger.warning("Chroma delete_by_document failed for %s: %s", document_id, exc)
                return 0

    def clear(self) -> None:
        self._ensure()
        with self._lock:
            try:
                self._client.delete_collection(self._spec.collection)
            except Exception:
                pass
            self._collection = self._client.get_or_create_collection(
                name=self._spec.collection,
                metadata={"expected_dim": self._expected_dim},
            )

    # ------------------------------- reads --------------------------------- #

    def query(
        self,
        *,
        query_embedding: List[float],
        top_k: int,
    ) -> List[Tuple[str, float, str, Dict[str, Any]]]:
        self._ensure()
        with self._lock:
            result = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=max(1, int(top_k)),
            )
        ids = (result.get("ids") or [[]])[0]
        docs = (result.get("documents") or [[]])[0]
        metas = (result.get("metadatas") or [[]])[0]
        dists = (result.get("distances") or [[]])[0]
        hits: List[Tuple[str, float, str, Dict[str, Any]]] = []
        for idx, cid in enumerate(ids):
            distance = float(dists[idx]) if idx < len(dists) else 0.0
            # chroma returns squared-L2 by default; convert to a similarity-ish score
            score = 1.0 / (1.0 + distance) if distance >= 0 else 0.0
            hits.append((
                str(cid),
                score,
                str(docs[idx]) if idx < len(docs) else "",
                dict(metas[idx]) if idx < len(metas) else {},
            ))
        return hits

    def count(self) -> int:
        self._ensure()
        with self._lock:
            try:
                return int(self._collection.count())
            except Exception:
                return 0


# --------------------------------------------------------------------------- #
# Document registry (persisted metadata outside chromadb)                     #
# --------------------------------------------------------------------------- #


class _DocumentRegistry:
    """Tiny JSON-backed map: document_id -> KBDocument metadata."""

    def __init__(self, store_path: Path) -> None:
        self._path = store_path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, KBDocument] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("KB registry %s unreadable, starting fresh: %s", self._path, exc)
            return
        if not isinstance(raw, dict):
            return
        for doc_id, data in raw.items():
            if not isinstance(data, dict):
                continue
            try:
                self._cache[str(doc_id)] = KBDocument(
                    id=str(data.get("id") or doc_id),
                    source_path=str(data.get("source_path", "")),
                    source_name=str(data.get("source_name", "")),
                    size_bytes=int(data.get("size_bytes", 0)),
                    mtime_iso=str(data.get("mtime_iso", "")),
                    status=KBDocumentStatus(str(data.get("status", "queued"))),
                    chunks=int(data.get("chunks", 0)),
                    error=data.get("error"),
                    added_at=str(data.get("added_at", "")),
                    embedding_fingerprint=data.get("embedding_fingerprint"),
                )
            except Exception as exc:
                logger.warning("KB registry row %s invalid: %s", doc_id, exc)

    def _flush_locked(self) -> None:
        payload = {doc_id: doc.to_dict() for doc_id, doc in self._cache.items()}
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    # API --------------------------------------------------------------------

    def upsert(self, doc: KBDocument) -> None:
        with self._lock:
            self._cache[doc.id] = doc
            self._flush_locked()

    def get(self, doc_id: str) -> Optional[KBDocument]:
        with self._lock:
            return self._cache.get(doc_id)

    def remove(self, doc_id: str) -> Optional[KBDocument]:
        with self._lock:
            doc = self._cache.pop(doc_id, None)
            if doc is not None:
                self._flush_locked()
            return doc

    def list(self) -> List[KBDocument]:
        with self._lock:
            return sorted(self._cache.values(), key=lambda d: d.added_at, reverse=True)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._flush_locked()


# --------------------------------------------------------------------------- #
# KBRuntime                                                                   #
# --------------------------------------------------------------------------- #


class KBRuntime:
    """Singleton-friendly runtime wiring config → embedding → vector store → registry.

    Usage::

        runtime = KBRuntime(config=KBConfig.from_dict(yaml_node))
        doc = runtime.register_document("/abs/path/to/file.md")
        runtime.ingest_document(doc.id)             # sync, called from worker thread
        hits = runtime.search("how do I build?", top_k=5)
    """

    def __init__(self, config: KBConfig, *, registry_dir: Optional[Path] = None) -> None:
        self._config = config
        base = registry_dir or Path(os.path.expanduser("~/.agenticx/storage/kb"))
        base.mkdir(parents=True, exist_ok=True)
        self._registry = _DocumentRegistry(base / "documents.json")
        self._state_path = base / "state.json"
        self._lock = threading.RLock()
        self._embedding_provider = None
        self._backend: Optional[_ChromaBackend] = None
        self._indexed_fingerprint: Optional[str] = None
        self._load_state()

    # ---------------------------- config -------------------------------- #

    @property
    def config(self) -> KBConfig:
        return self._config

    def update_config(self, new_config: KBConfig) -> Dict[str, Any]:
        """Persist in-memory config. Returns ``{rebuild_required, previous_fingerprint}``."""

        with self._lock:
            previous = self._config.embedding_fingerprint()
            self._config = new_config
            # Reset lazy-initialised components; they will be recreated on next use.
            self._embedding_provider = None
            self._backend = None
            current = new_config.embedding_fingerprint()
            rebuild_required = bool(self._indexed_fingerprint and self._indexed_fingerprint != current)
            return {
                "rebuild_required": rebuild_required,
                "previous_fingerprint": previous,
                "current_fingerprint": current,
                "indexed_fingerprint": self._indexed_fingerprint,
            }

    def rebuild_required(self) -> bool:
        if not self._indexed_fingerprint:
            return False
        return self._indexed_fingerprint != self._config.embedding_fingerprint()

    # --------------------- lazy component accessors --------------------- #

    def _embedding(self):
        with self._lock:
            if self._embedding_provider is None:
                self._embedding_provider = _build_embedding_provider(self._config.embedding)
            return self._embedding_provider

    def _store(self) -> _ChromaBackend:
        with self._lock:
            if self._backend is None:
                self._backend = _ChromaBackend(
                    self._config.vector_store,
                    expected_dim=self._config.embedding.dim,
                )
            return self._backend

    # ------------------------------ state ------------------------------- #

    def _load_state(self) -> None:
        if not self._state_path.exists():
            return
        try:
            raw = json.loads(self._state_path.read_text(encoding="utf-8"))
            fp = raw.get("indexed_fingerprint")
            if isinstance(fp, str) and fp:
                self._indexed_fingerprint = fp
        except Exception as exc:
            logger.warning("KB state %s unreadable: %s", self._state_path, exc)

    def _save_state(self) -> None:
        payload = {"indexed_fingerprint": self._indexed_fingerprint}
        self._state_path.write_text(json.dumps(payload), encoding="utf-8")

    # --------------------------- documents ------------------------------ #

    def list_documents(self) -> List[KBDocument]:
        return self._registry.list()

    def get_document(self, doc_id: str) -> Optional[KBDocument]:
        return self._registry.get(doc_id)

    def register_document(self, source_path: str) -> KBDocument:
        """Create a fresh ``KBDocument`` entry in the registry (status=QUEUED)."""

        path = Path(source_path).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise KBError(f"Not a file: {path}")
        ext = path.suffix.lower()
        allowed = {e.lower() for e in (self._config.file_filters.extensions or SUPPORTED_EXTENSIONS)}
        if ext not in allowed:
            raise KBError(f"Unsupported file extension {ext!r}. Allowed: {sorted(allowed)}")
        size = path.stat().st_size
        max_bytes = max(1, self._config.file_filters.max_file_size_mb) * 1024 * 1024
        if size > max_bytes:
            raise KBError(
                f"File too large: {size} bytes (limit {self._config.file_filters.max_file_size_mb}MB)"
            )
        mtime_iso = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
        doc = KBDocument(
            id=f"doc_{abs(hash((str(path), size, mtime_iso))) :x}",
            source_path=str(path),
            source_name=path.name,
            size_bytes=size,
            mtime_iso=mtime_iso,
            status=KBDocumentStatus.QUEUED,
            chunks=0,
            embedding_fingerprint=self._config.embedding_fingerprint(),
        )
        self._registry.upsert(doc)
        return doc

    def delete_document(self, doc_id: str) -> bool:
        doc = self._registry.remove(doc_id)
        if doc is None:
            return False
        try:
            self._store().delete_by_document(doc_id)
        except KBError as exc:
            logger.warning("Failed to purge vectors for %s: %s", doc_id, exc)
        return True

    def clear_all(self) -> None:
        self._registry.clear()
        with self._lock:
            try:
                self._store().clear()
            except KBError as exc:
                logger.warning("Failed to clear vector store: %s", exc)
            self._indexed_fingerprint = None
            self._save_state()

    # ---------------------------- ingest -------------------------------- #

    def ingest_document(
        self,
        doc_id: str,
        *,
        progress_cb=None,
    ) -> IngestReport:
        """Full synchronous ingest pipeline for one registered document.

        ``progress_cb`` receives stage updates so worker threads can relay
        progress to the job registry without reaching back into runtime
        internals.

        Preferred callback signature is::

            progress_cb(status: KBDocumentStatus, message: str, stage_progress: float | None)

        ``stage_progress`` is a 0~1 value within the current stage (currently
        used by EMBEDDING). For backward compatibility, two-arg callbacks are
        also supported.
        """

        doc = self._registry.get(doc_id)
        if doc is None:
            raise KBError(f"Unknown document: {doc_id}")

        report = IngestReport()

        def _report(
            status: KBDocumentStatus,
            message: str = "",
            *,
            stage_progress: Optional[float] = None,
        ) -> None:
            if progress_cb:
                try:
                    progress_cb(status, message, stage_progress)
                except TypeError:
                    # Backward compatibility for legacy two-arg callbacks.
                    progress_cb(status, message)
                except Exception as exc:  # pragma: no cover - purely informational
                    logger.debug("progress callback failed: %s", exc)

        try:
            _report(KBDocumentStatus.PARSING, "reading document")
            text = _read_document_text(doc.source_path)
            if not text.strip():
                raise KBError("Document produced empty text after parsing")

            _report(KBDocumentStatus.CHUNKING, "splitting into chunks")
            chunks = _chunk_text(
                text=text,
                spec=self._config.chunking,
                source_path=doc.source_path,
                document_id=doc.id,
            )
            if not chunks:
                raise KBError("No chunks produced")

            chunk_texts = [c["text"] for c in chunks]
            _report(
                KBDocumentStatus.EMBEDDING,
                f"embedding 0/{len(chunk_texts)} chunks",
                stage_progress=0.0,
            )
            embeddings = _embed_texts_with_progress(
                self._embedding(),
                chunk_texts,
                progress_cb=lambda done, total: _report(
                    KBDocumentStatus.EMBEDDING,
                    f"embedding {done}/{total} chunks",
                    stage_progress=(done / total) if total > 0 else 1.0,
                ),
            )
            if any(len(v) != self._config.embedding.dim for v in embeddings):
                actual = {len(v) for v in embeddings}
                raise KBError(
                    f"Embedding dim mismatch: expected {self._config.embedding.dim}, got {sorted(actual)}"
                )

            _report(KBDocumentStatus.WRITING, "writing to vector store")
            self._store().delete_by_document(doc.id)  # rebuild-safe replace
            ids = [f"{doc.id}::{c['chunk_index']:06d}" for c in chunks]
            # Chroma rejects `None` metadata values with
            # "Expected metadata value to be a str, int, float or bool, got None".
            # PDF / DOCX / PPTX chunks frequently lack `start_index` / `end_index`
            # (non-text sources don't produce char offsets), so drop any None-valued
            # keys rather than letting ingestion blow up at the final write step.
            metadatas = [
                {
                    key: value
                    for key, value in {
                        "document_id": doc.id,
                        "source_path": doc.source_path,
                        "source_name": doc.source_name,
                        "chunk_index": c["chunk_index"],
                        "start_index": c.get("start_index"),
                        "end_index": c.get("end_index"),
                    }.items()
                    if value is not None
                }
                for c in chunks
            ]
            self._store().upsert(
                ids=ids,
                texts=[c["text"] for c in chunks],
                embeddings=embeddings,
                metadatas=metadatas,
            )

            updated = replace(
                doc,
                status=KBDocumentStatus.DONE,
                chunks=len(chunks),
                error=None,
                embedding_fingerprint=self._config.embedding_fingerprint(),
            )
            self._registry.upsert(updated)
            with self._lock:
                self._indexed_fingerprint = self._config.embedding_fingerprint()
                self._save_state()
            report.success = 1
            _report(KBDocumentStatus.DONE, f"indexed {len(chunks)} chunks")
            return report

        except Exception as exc:
            logger.exception("ingest failed for %s", doc_id)
            failed = replace(
                doc,
                status=KBDocumentStatus.FAILED,
                error=str(exc),
            )
            self._registry.upsert(failed)
            report.failed = 1
            report.reasons.append(str(exc))
            _report(KBDocumentStatus.FAILED, str(exc))
            return report

    # ---------------------------- search -------------------------------- #

    def search(self, query: str, *, top_k: Optional[int] = None) -> List[RetrievalHit]:
        q = (query or "").strip()
        if not q:
            return []
        k = max(1, min(20, int(top_k or self._config.retrieval.top_k)))
        query_vec = _embed_texts(self._embedding(), [q])[0]
        raw = self._store().query(query_embedding=query_vec, top_k=k)
        hits: List[RetrievalHit] = []
        for cid, score, text, meta in raw:
            if score < float(self._config.retrieval.score_floor or 0.0):
                continue
            src = RetrievalHitSource(
                kind="local",
                uri=str(meta.get("source_path", "")),
                title=meta.get("source_name"),
                chunk_index=int(meta["chunk_index"]) if meta.get("chunk_index") is not None else None,
            )
            hits.append(
                RetrievalHit(
                    id=cid,
                    score=float(score),
                    text=text,
                    source=src,
                    metadata=meta,
                )
            )
        return hits

    # ------------------------- chunking preview ------------------------- #

    def preview_chunks(
        self,
        source_path: str,
        *,
        chunking: Optional[ChunkingSpec] = None,
    ) -> List[Dict[str, Any]]:
        """Reader + chunker, without embedding/writing — powers the debug panel."""

        text = _read_document_text(source_path)
        spec = chunking or self._config.chunking
        chunks = _chunk_text(
            text=text,
            spec=spec,
            source_path=source_path,
            document_id="__preview__",
        )
        return chunks

    # ------------------------------ stats ------------------------------- #

    def stats(self) -> Dict[str, Any]:
        docs = self._registry.list()
        return {
            "enabled": self._config.enabled,
            "doc_count": len(docs),
            "indexed_doc_count": sum(1 for d in docs if d.status == KBDocumentStatus.DONE),
            "failed_doc_count": sum(1 for d in docs if d.status == KBDocumentStatus.FAILED),
            "embedding_fingerprint": self._config.embedding_fingerprint(),
            "indexed_fingerprint": self._indexed_fingerprint,
            "rebuild_required": self.rebuild_required(),
        }


# --------------------------------------------------------------------------- #
# helpers (reader / chunker / embed)                                          #
# --------------------------------------------------------------------------- #


# Formats that agenticx's native readers can't handle (old-format Office,
# Excel, images) but LiteParse can. When the user registers one of these, we
# route directly to LiteParse; if it's not installed we raise a clear KBError
# with the install hint so the UI can surface a copy-pastable command.
_LITEPARSE_ONLY_EXTS: set[str] = {
    ".doc",
    ".ppt",
    ".xls",
    ".xlsx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
}


_LIBREOFFICE_REQUIRED_EXTS: set[str] = {".doc", ".ppt", ".xls", ".xlsx"}


def _libreoffice_available() -> bool:
    """LibreOffice (``soffice``) is what LiteParse shells out to for legacy
    Office and Excel formats. We probe before invoking so the error is
    immediate and actionable, not a 100-line JS stack trace from the CLI."""

    import shutil

    return bool(shutil.which("soffice") or shutil.which("libreoffice"))


def _read_with_liteparse(path: Path) -> str:
    """Run LiteParse CLI adapter synchronously and return merged text."""

    try:
        from agenticx.tools.adapters.liteparse import LiteParseAdapter
    except Exception as exc:  # pragma: no cover - packaging issue
        raise KBError(
            f"LiteParse adapter unavailable: {exc}. "
            "Install with `npm i -g @llamaindex/liteparse`."
        ) from exc

    if not LiteParseAdapter.is_available():
        raise KBError(
            f"LiteParse CLI not found; required to ingest {path.suffix!r}. "
            "Install with `npm i -g @llamaindex/liteparse` (or `npx liteparse`)."
        )

    ext = path.suffix.lower()
    if ext in _LIBREOFFICE_REQUIRED_EXTS and not _libreoffice_available():
        raise KBError(
            f"解析 {ext} 需要 LibreOffice（LiteParse 内部用 soffice 做格式转换）。"
            f" 未检测到本机已安装。\n"
            f"macOS：brew install --cask libreoffice\n"
            f"Ubuntu：apt-get install libreoffice\n"
            f"Windows：choco install libreoffice-fresh\n"
            f"安装完成后在资料列表重建该条索引即可，无需重启 Machi。"
        )

    adapter = LiteParseAdapter(config={"debug": False})
    try:
        text = asyncio.run(adapter.parse_to_text(path))
    except Exception as exc:
        msg = str(exc)
        # LiteParse bubbles up underlying tool errors verbatim; detect the
        # two most common ones and surface a clean, copy-pastable remedy.
        if "LibreOffice is not installed" in msg or "soffice" in msg.lower():
            raise KBError(
                f"解析 {ext} 需要 LibreOffice 做格式转换。\n"
                f"macOS：brew install --cask libreoffice\n"
                f"Ubuntu：apt-get install libreoffice\n"
                f"Windows：choco install libreoffice-fresh\n"
                f"安装完成后在资料列表重建该条索引即可。"
            ) from exc
        raise KBError(f"LiteParse failed for {path}: {exc}") from exc
    if not isinstance(text, str) or not text.strip():
        raise KBError(f"LiteParse returned empty text for {path}")
    return text


def _read_document_text(source_path: str) -> str:
    """Read a file into plain text.

    Routing order:
      1. Plain text / markdown → ``Path.read_text`` (no parser overhead).
      2. Legacy Office / Excel / images → LiteParse CLI (covers OCR & old
         binary formats; needs ``@llamaindex/liteparse`` installed).
      3. Everything else → ``agenticx/knowledge/readers`` (PDF, DOCX, PPTX,
         HTML, CSV, JSON, YAML, …).
    """

    path = Path(source_path).expanduser()
    ext = path.suffix.lower()

    if ext in {".md", ".txt", ".markdown", ".rst", ".log"}:
        return path.read_text(encoding="utf-8", errors="replace")

    if ext in _LITEPARSE_ONLY_EXTS:
        return _read_with_liteparse(path)

    try:
        from agenticx.knowledge.readers import get_reader
    except Exception as exc:  # pragma: no cover
        raise KBError(f"agenticx.knowledge.readers unavailable: {exc}") from exc

    try:
        reader = get_reader(path)
        raw = reader.read(path)
        # agenticx readers for PDF / Word / PPT expose async `read()`; ingest
        # runs in a sync worker thread, so resolve the coroutine here instead
        # of iterating over it (prior behavior raised "'coroutine' object is
        # not iterable" for every PDF upload).
        if asyncio.iscoroutine(raw):
            docs = asyncio.run(raw)
        else:
            docs = raw
    except Exception as exc:
        raise KBError(f"Reader failed for {path}: {exc}") from exc

    texts: List[str] = []
    for d in docs:
        content = getattr(d, "content", None) or (d.get("content") if isinstance(d, dict) else None)
        if isinstance(content, str) and content.strip():
            texts.append(content)
    if not texts:
        raise KBError(f"No textual content extracted from {path}")
    return "\n\n".join(texts)


def _chunk_text(
    *,
    text: str,
    spec: ChunkingSpec,
    source_path: str,
    document_id: str,
) -> List[Dict[str, Any]]:
    """Run an agenticx chunker, falling back to a naive splitter.

    The fallback exists because some chunker implementations in the repo need
    an LLM handle to operate (e.g. ``SemanticChunker``), but Stage-1 promises
    ``recursive`` which is LLM-free.
    """

    try:
        from agenticx.knowledge.base import ChunkingConfig
        from agenticx.knowledge.chunkers import get_chunker

        config = ChunkingConfig(
            chunk_size=int(spec.chunk_size),
            chunk_overlap=int(spec.chunk_overlap),
        )
        chunker = get_chunker(spec.strategy or "recursive", config=config)
        raw_chunks = chunker.chunk_text(text, metadata={"source_path": source_path})
    except Exception as exc:
        logger.warning("agenticx chunker failed (%s) — falling back to naive splitter", exc)
        raw_chunks = _naive_split(text, spec)

    out: List[Dict[str, Any]] = []
    for idx, ch in enumerate(raw_chunks):
        content = ""
        if isinstance(ch, dict):
            content = str(ch.get("content") or ch.get("text") or "")
            start = ch.get("start_index") or ch.get("start")
            end = ch.get("end_index") or ch.get("end")
        elif hasattr(ch, "content"):
            content = str(getattr(ch, "content"))
            start = getattr(ch, "start_index", None)
            end = getattr(ch, "end_index", None)
        else:
            content = str(ch)
            start = None
            end = None
        content = content.strip()
        if not content:
            continue
        out.append(
            {
                "text": content,
                "chunk_index": idx,
                "start_index": int(start) if isinstance(start, int) else None,
                "end_index": int(end) if isinstance(end, int) else None,
            }
        )
    return out


def _naive_split(text: str, spec: ChunkingSpec) -> List[Dict[str, Any]]:
    size = max(64, int(spec.chunk_size))
    overlap = max(0, min(size - 1, int(spec.chunk_overlap)))
    step = max(1, size - overlap)
    chunks: List[Dict[str, Any]] = []
    i = 0
    while i < len(text):
        piece = text[i : i + size]
        chunks.append({"content": piece, "start_index": i, "end_index": min(len(text), i + size)})
        if i + size >= len(text):
            break
        i += step
    return chunks


def _embed_texts(provider, texts: List[str]) -> List[List[float]]:
    """Call an embedding provider safely and guarantee a list-of-lists shape."""

    if not texts:
        return []

    # aiohttp-based online providers (Bailian / SiliconFlow) cache a
    # ``ClientSession`` on ``self._session`` bound to the asyncio loop that
    # created it. Their sync ``embed()`` does ``asyncio.run(...)``, which
    # destroys that loop after each call. A second ingest reuses the same
    # provider instance, finds ``_session`` still set (not yet garbage
    # collected), and hits "Event loop is closed" inside aiohttp. Reset the
    # attribute so ``_get_session()`` rebuilds a fresh session bound to the
    # new loop. No-op for providers without this attribute (e.g. LiteLLM /
    # OpenAIEmbeddingProvider).
    if getattr(provider, "_session", None) is not None:
        try:
            provider._session = None  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover - defensive
            pass

    if hasattr(provider, "embed_documents"):
        result = provider.embed_documents(texts)
    elif hasattr(provider, "embed"):
        result = provider.embed(texts)
    else:
        raise KBError(f"Embedding provider {type(provider).__name__} lacks an embed method")
    return [list(map(float, v)) for v in result]


def _embed_texts_with_progress(
    provider,
    texts: List[str],
    *,
    progress_cb=None,
) -> List[List[float]]:
    """Embed texts in batches and report incremental progress.

    Large documents may spend a long time in EMBEDDING. Batching allows the UI
    to display concrete progress (e.g. 37%) instead of a static stage label.
    """

    if not texts:
        if progress_cb:
            try:
                progress_cb(0, 0)
            except Exception:  # pragma: no cover - progress only
                pass
        return []

    configured = int(getattr(provider, "batch_size", 0) or 0)
    batch_size = max(1, min(32, configured if configured > 0 else 16))
    total = len(texts)
    done = 0
    vectors: List[List[float]] = []
    for i in range(0, total, batch_size):
        batch = texts[i : i + batch_size]
        vectors.extend(_embed_texts(provider, batch))
        done += len(batch)
        if progress_cb:
            try:
                progress_cb(done, total)
            except Exception:  # pragma: no cover - progress only
                pass
    return vectors
