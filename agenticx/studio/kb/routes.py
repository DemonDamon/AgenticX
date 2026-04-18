"""FastAPI routes for the Machi Stage-1 KB.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

Everything is mounted onto the studio FastAPI app via
``register_kb_routes(app)`` to keep ``server.py`` changes minimal.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .contracts import (
    ChunkingSpec,
    EmbeddingSpec,
    KBConfig,
    KBError,
    RetrievalHit,
)
from .manager import KBManager
from .runtime import _build_embedding_provider, _embed_texts

logger = logging.getLogger(__name__)


def register_kb_routes(app: FastAPI) -> None:
    """Attach ``/api/kb/*`` routes to the given FastAPI app.

    Idempotent: safe to call multiple times in tests.
    """

    if getattr(app.state, "_kb_routes_registered", False):
        return
    app.state._kb_routes_registered = True

    # ------------------------------ config ------------------------------- #

    @app.get("/api/kb/config")
    async def read_kb_config() -> Dict[str, Any]:
        manager = KBManager.instance()
        cfg = manager.read_config()
        return {
            "ok": True,
            "config": cfg.to_dict(),
            "stats": manager.runtime.stats(),
        }

    @app.put("/api/kb/config")
    async def write_kb_config(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        new_cfg = KBConfig.from_dict(payload)
        manager = KBManager.instance()
        result = manager.write_config(new_cfg)
        return {
            "ok": True,
            "config": manager.read_config().to_dict(),
            "rebuild_required": bool(result.get("rebuild_required")),
            "previous_fingerprint": result.get("previous_fingerprint"),
            "current_fingerprint": result.get("current_fingerprint"),
        }

    # ------------------------------ embedding connectivity test --------- #

    @app.post("/api/kb/test_embedding")
    async def test_embedding(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Ping the configured embedding provider to verify API key / model / dim.

        Accepts an ``embedding`` sub-object (same shape as ``KBConfig.embedding``)
        so the user can test credentials *before* committing the config.
        Falls back to the currently persisted embedding config when omitted.
        """

        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        manager = KBManager.instance()
        embedding_raw = payload.get("embedding")
        if isinstance(embedding_raw, dict):
            wrapper = KBConfig.from_dict({"embedding": embedding_raw})
            spec: EmbeddingSpec = wrapper.embedding
        else:
            spec = manager.read_config().embedding

        import time

        started = time.time()

        def _do_test() -> Dict[str, Any]:
            try:
                provider_obj = _build_embedding_provider(spec)
            except Exception as exc:
                return {"ok": False, "stage": "build", "error": str(exc)}
            try:
                vectors = _embed_texts(provider_obj, ["ping"])
            except Exception as exc:
                return {"ok": False, "stage": "embed", "error": str(exc)}
            if not vectors or not vectors[0]:
                return {"ok": False, "stage": "embed", "error": "provider returned empty vectors"}
            actual_dim = len(vectors[0])
            dim_match = actual_dim == int(spec.dim)
            return {
                "ok": dim_match,
                "stage": "done" if dim_match else "dim_mismatch",
                "actual_dim": actual_dim,
                "expected_dim": int(spec.dim),
                "error": None
                if dim_match
                else (
                    f"模型实际返回 {actual_dim} 维，与「维度 (dim)={spec.dim}」不一致；"
                    f"请把 dim 改成 {actual_dim} 或让模型按 {spec.dim} 维输出。"
                ),
            }

        # Run in a worker thread so aiohttp-based providers don't block the event loop.
        result = await asyncio.to_thread(_do_test)
        result["provider"] = spec.provider
        result["model"] = spec.model
        result["latency_ms"] = int((time.time() - started) * 1000)
        return result

    # ------------------------------ stats -------------------------------- #

    @app.get("/api/kb/stats")
    async def read_kb_stats() -> Dict[str, Any]:
        manager = KBManager.instance()
        return {"ok": True, "stats": manager.runtime.stats()}

    # ---------------------------- documents ------------------------------ #

    @app.get("/api/kb/documents")
    async def list_kb_documents() -> Dict[str, Any]:
        manager = KBManager.instance()
        docs = manager.runtime.list_documents()
        return {"ok": True, "count": len(docs), "documents": [d.to_dict() for d in docs]}

    @app.post("/api/kb/documents")
    async def add_kb_document(
        path: Optional[str] = Form(default=None),
        file: Optional[UploadFile] = File(default=None),
    ) -> Dict[str, Any]:
        """Register one document for ingestion.

        Two modes:
          * ``multipart/form-data`` with a ``file`` field → we stream it into
            the managed KB upload directory then register from there.
          * ``application/x-www-form-urlencoded`` or ``multipart`` with
            ``path=...`` → register an already-existing local file.
        """

        manager = KBManager.instance()
        cfg = manager.read_config()
        if not cfg.enabled:
            raise HTTPException(status_code=400, detail="knowledge base is not enabled")

        abs_path: Optional[Path] = None
        if file is not None and file.filename:
            upload_dir = Path(cfg.vector_store.path).expanduser().parent / "uploads"
            upload_dir.mkdir(parents=True, exist_ok=True)
            safe_name = Path(file.filename).name
            abs_path = upload_dir / safe_name
            # avoid truncating existing uploads when a name collision happens
            if abs_path.exists():
                stem = abs_path.stem
                suffix = abs_path.suffix
                counter = 1
                while abs_path.exists():
                    abs_path = upload_dir / f"{stem}_{counter}{suffix}"
                    counter += 1
            try:
                with abs_path.open("wb") as fh:
                    shutil.copyfileobj(file.file, fh)
            finally:
                await file.close()
        elif path:
            abs_path = Path(path).expanduser().resolve()
        else:
            raise HTTPException(status_code=400, detail="either `file` (multipart) or `path` is required")

        try:
            doc = manager.runtime.register_document(str(abs_path))
        except KBError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        job = manager.jobs.submit_ingest(manager.runtime, doc.id)
        return {"ok": True, "document": doc.to_dict(), "job_id": job.id}

    @app.delete("/api/kb/documents/{doc_id}")
    async def delete_kb_document(doc_id: str) -> Dict[str, Any]:
        manager = KBManager.instance()
        ok = manager.runtime.delete_document(doc_id)
        if not ok:
            raise HTTPException(status_code=404, detail=f"document {doc_id} not found")
        return {"ok": True, "document_id": doc_id}

    @app.post("/api/kb/documents/{doc_id}/rebuild")
    async def rebuild_kb_document(doc_id: str) -> Dict[str, Any]:
        manager = KBManager.instance()
        doc = manager.runtime.get_document(doc_id)
        if doc is None:
            raise HTTPException(status_code=404, detail=f"document {doc_id} not found")
        job = manager.jobs.submit_ingest(manager.runtime, doc.id)
        return {"ok": True, "job_id": job.id}

    # ------------------------------ jobs --------------------------------- #

    @app.get("/api/kb/jobs/{job_id}")
    async def get_kb_job(job_id: str) -> Dict[str, Any]:
        manager = KBManager.instance()
        job = manager.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"job {job_id} not found")
        return {"ok": True, "job": job.to_dict()}

    # ------------------------------ search ------------------------------- #

    @app.post("/api/kb/search")
    async def kb_search(payload: Dict[str, Any]) -> Dict[str, Any]:
        query = str(payload.get("query", "")).strip()
        if not query:
            raise HTTPException(status_code=400, detail="query is required")
        top_k = int(payload.get("top_k") or 0) or None
        manager = KBManager.instance()
        cfg = manager.read_config()
        if not cfg.enabled:
            return {"ok": True, "hits": [], "used_top_k": 0, "source": "local", "disabled": True}
        try:
            hits: List[RetrievalHit] = await asyncio.to_thread(
                manager.runtime.search, query, top_k=top_k
            )
        except KBError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("kb search failed")
            raise HTTPException(status_code=500, detail=f"search failed: {exc}") from exc
        return {
            "ok": True,
            "hits": [h.to_dict() for h in hits],
            "used_top_k": len(hits),
            "source": "local",
        }

    @app.post("/api/kb/debug/preview")
    async def kb_debug_preview(payload: Dict[str, Any]) -> Dict[str, Any]:
        source_path = str(payload.get("path", "")).strip()
        if not source_path:
            raise HTTPException(status_code=400, detail="path is required")
        chunking_payload = payload.get("chunking") or {}
        chunking = ChunkingSpec(
            strategy=str(chunking_payload.get("strategy", "recursive")),
            chunk_size=int(chunking_payload.get("chunk_size", 800)),
            chunk_overlap=int(chunking_payload.get("chunk_overlap", 80)),
        )
        manager = KBManager.instance()
        try:
            chunks = await asyncio.to_thread(
                manager.runtime.preview_chunks, source_path, chunking=chunking
            )
        except KBError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("kb preview failed")
            raise HTTPException(status_code=500, detail=f"preview failed: {exc}") from exc
        return {"ok": True, "count": len(chunks), "chunks": chunks}
