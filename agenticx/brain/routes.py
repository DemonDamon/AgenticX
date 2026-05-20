"""FastAPI routes for multi-brain knowledge."""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from agenticx.brain.manager import BrainManager
from agenticx.brain.registry import BrainError, BrainRegistry
from agenticx.brain.runtime_docs import DocsBrainRuntime
from agenticx.brain.search import search_code_brains, search_docs_brains
from agenticx.brain.types import BrainScope, BrainType
from agenticx.studio.kb.contracts import ChunkingSpec, EmbeddingSpec, KBConfig, KBError
from agenticx.studio.kb.runtime import (
    _build_embedding_provider,
    _embed_texts,
    _libreoffice_install_hint,
)

logger = logging.getLogger(__name__)


def _require_docs_brain(brain_id: str) -> DocsBrainRuntime:
    brain = BrainRegistry.instance().get(brain_id)
    if brain is None:
        raise HTTPException(status_code=404, detail=f"brain {brain_id} not found")
    if brain.type != BrainType.DOCS:
        raise HTTPException(status_code=400, detail="not a docs brain")
    rt = BrainManager.instance().get_runtime(brain_id)
    if not isinstance(rt, DocsBrainRuntime):
        raise HTTPException(status_code=500, detail="runtime type mismatch")
    return rt


def register_brain_routes(app: FastAPI) -> None:
    if getattr(app.state, "_brain_routes_registered", False):
        return
    app.state._brain_routes_registered = True

    BrainRegistry.instance().bootstrap()

    @app.get("/api/brains")
    async def list_brains() -> Dict[str, Any]:
        brains = BrainRegistry.instance().list_brains()
        out = []
        for b in brains:
            d = b.to_dict()
            if b.type == BrainType.DOCS:
                try:
                    rt = BrainManager.instance().get_runtime(b.id)
                    if isinstance(rt, DocsBrainRuntime):
                        d["stats"] = rt.stats()
                except Exception:
                    pass
            out.append(d)
        return {"ok": True, "brains": out}

    @app.post("/api/brains")
    async def create_brain(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        name = str(payload.get("name") or "新知识脑").strip()
        btype = BrainType(str(payload.get("type") or "docs"))
        scope_raw = str(payload.get("scope") or "global")
        scope = BrainScope(scope_raw)
        owner = payload.get("owner_avatar_id")
        try:
            brain = BrainRegistry.instance().create(
                name=name,
                brain_type=btype,
                scope=scope,
                owner_avatar_id=str(owner) if owner else None,
                description=str(payload.get("description") or ""),
                enabled=bool(payload.get("enabled", True)),
                config=payload.get("config") if isinstance(payload.get("config"), dict) else None,
            )
        except BrainError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "brain": brain.to_dict()}

    @app.get("/api/brains/{brain_id}")
    async def get_brain(brain_id: str) -> Dict[str, Any]:
        brain = BrainRegistry.instance().get(brain_id)
        if brain is None:
            raise HTTPException(status_code=404, detail="not found")
        d = brain.to_dict()
        if brain.type == BrainType.DOCS:
            rt = _require_docs_brain(brain_id)
            d["stats"] = rt.stats()
        return {"ok": True, "brain": d}

    @app.patch("/api/brains/{brain_id}")
    async def patch_brain(brain_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        try:
            brain = BrainRegistry.instance().update(brain_id, payload)
        except BrainError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        BrainManager.instance().evict(brain_id)
        return {"ok": True, "brain": brain.to_dict()}

    @app.delete("/api/brains/{brain_id}")
    async def delete_brain(brain_id: str) -> Dict[str, Any]:
        try:
            ok = BrainRegistry.instance().delete(brain_id)
        except BrainError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        BrainManager.instance().evict(brain_id)
        return {"ok": ok}

    # ------------------------ docs brain (KB-shaped) --------------------- #

    @app.get("/api/brains/{brain_id}/config")
    async def read_brain_kb_config(brain_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        cfg = rt.read_config()
        return {"ok": True, "config": cfg.to_dict(), "stats": rt.stats()}

    @app.put("/api/brains/{brain_id}/config")
    async def write_brain_kb_config(brain_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        rt = _require_docs_brain(brain_id)
        new_cfg = KBConfig.from_dict(payload)
        result = rt.write_config(new_cfg)
        BrainManager.instance().evict(brain_id)
        return {
            "ok": True,
            "config": rt.read_config().to_dict(),
            "rebuild_required": bool(result.get("rebuild_required")),
        }

    @app.get("/api/brains/{brain_id}/materials")
    async def list_brain_materials(brain_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        docs = rt.runtime.list_documents()
        return {"ok": True, "count": len(docs), "documents": [d.to_dict() for d in docs]}

    @app.post("/api/brains/{brain_id}/materials")
    async def add_brain_material(
        brain_id: str,
        path: Optional[str] = Form(default=None),
        file: Optional[UploadFile] = File(default=None),
    ) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        cfg = rt.read_config()
        if not cfg.enabled:
            raise HTTPException(status_code=400, detail="brain is not enabled")

        abs_path: Optional[Path] = None
        if file is not None and file.filename:
            upload_dir = Path(cfg.vector_store.path).expanduser().parent / "uploads"
            upload_dir.mkdir(parents=True, exist_ok=True)
            safe_name = Path(file.filename).name
            abs_path = upload_dir / safe_name
            if abs_path.exists():
                stem, suffix = abs_path.stem, abs_path.suffix
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
            raise HTTPException(status_code=400, detail="either file or path required")

        try:
            doc = rt.runtime.register_document(str(abs_path))
        except KBError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        job = rt.jobs.submit_ingest(rt.runtime, doc.id)
        return {"ok": True, "document": doc.to_dict(), "job_id": job.id}

    @app.delete("/api/brains/{brain_id}/materials/{doc_id}")
    async def delete_brain_material(brain_id: str, doc_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        ok = rt.runtime.delete_document(doc_id)
        if not ok:
            raise HTTPException(status_code=404, detail=f"document {doc_id} not found")
        return {"ok": True, "document_id": doc_id}

    @app.post("/api/brains/{brain_id}/materials/{doc_id}/rebuild")
    async def rebuild_brain_material(brain_id: str, doc_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        doc = rt.runtime.get_document(doc_id)
        if doc is None:
            raise HTTPException(status_code=404, detail=f"document {doc_id} not found")
        job = rt.jobs.submit_ingest(rt.runtime, doc.id)
        return {"ok": True, "job_id": job.id}

    @app.get("/api/brains/{brain_id}/jobs")
    async def list_brain_jobs(brain_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        jobs = rt.jobs.list()
        return {"ok": True, "count": len(jobs), "jobs": [j.to_dict() for j in jobs]}

    @app.get("/api/brains/{brain_id}/jobs/{job_id}")
    async def get_brain_job(brain_id: str, job_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        job = rt.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"job {job_id} not found")
        return {"ok": True, "job": job.to_dict()}

    @app.get("/api/brains/{brain_id}/stats")
    async def brain_stats(brain_id: str) -> Dict[str, Any]:
        rt = _require_docs_brain(brain_id)
        return {"ok": True, "stats": rt.stats()}

    @app.post("/api/brains/{brain_id}/test_embedding")
    async def brain_test_embedding(brain_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        rt = _require_docs_brain(brain_id)
        embedding_raw = payload.get("embedding")
        if isinstance(embedding_raw, dict):
            wrapper = KBConfig.from_dict({"embedding": embedding_raw})
            spec: EmbeddingSpec = wrapper.embedding
        else:
            spec = rt.read_config().embedding

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

        result = await asyncio.to_thread(_do_test)
        result["provider"] = spec.provider
        result["model"] = spec.model
        result["latency_ms"] = int((time.time() - started) * 1000)
        return result

    @app.get("/api/brains/{brain_id}/parser_status")
    async def brain_parser_status(brain_id: str) -> Dict[str, Any]:
        _require_docs_brain(brain_id)
        from agenticx.tools.adapters.liteparse import LiteParseAdapter

        available = LiteParseAdapter.is_available()
        version: Optional[str] = None
        path: Optional[str] = None
        if available:
            try:
                cli_path = shutil.which("liteparse")
                if cli_path:
                    path = cli_path
                proc = await asyncio.create_subprocess_exec(
                    *(
                        ["liteparse", "--version"]
                        if cli_path
                        else ["npx", "--no-install", "liteparse", "--version"]
                    ),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
                if proc.returncode == 0:
                    text = stdout.decode("utf-8", errors="ignore").strip().splitlines()
                    if text:
                        version = text[-1].strip()
            except Exception:
                version = None

        soffice_path = shutil.which("soffice") or shutil.which("libreoffice")
        return {
            "ok": True,
            "liteparse": {"available": available, "version": version, "path": path},
            "libreoffice": {
                "available": bool(soffice_path),
                "path": soffice_path,
                "required_for": [".doc", ".ppt", ".xls", ".xlsx"],
                "install_hint": _libreoffice_install_hint(),
            },
            "native_ready": True,
            "install_hint": "npm i -g @llamaindex/liteparse",
        }

    @app.post("/api/brains/{brain_id}/debug/preview")
    async def brain_debug_preview(brain_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        source_path = str(payload.get("path", "")).strip()
        if not source_path:
            raise HTTPException(status_code=400, detail="path is required")
        chunking_payload = payload.get("chunking") or {}
        chunking = ChunkingSpec(
            strategy=str(chunking_payload.get("strategy", "recursive")),
            chunk_size=int(chunking_payload.get("chunk_size", 800)),
            chunk_overlap=int(chunking_payload.get("chunk_overlap", 80)),
        )
        rt = _require_docs_brain(brain_id)
        try:
            chunks = await asyncio.to_thread(
                rt.runtime.preview_chunks, source_path, chunking=chunking
            )
        except KBError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("brain preview failed")
            raise HTTPException(status_code=500, detail=f"preview failed: {exc}") from exc
        return {"ok": True, "count": len(chunks), "chunks": chunks}

    @app.post("/api/brains/{brain_id}/search")
    async def search_brain(brain_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        query = str(payload.get("query") or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="query required")
        top_k = int(payload.get("top_k") or 5)
        top_k = max(1, min(20, top_k))
        brain = BrainRegistry.instance().get(brain_id)
        if brain is None:
            raise HTTPException(status_code=404, detail="not found")
        if brain.type == BrainType.DOCS:
            rt = _require_docs_brain(brain_id)
            hits = rt.search(query, top_k=top_k)
            return {"ok": True, "hits": [h.to_dict() for h in hits], "used_top_k": len(hits)}
        from agenticx.brain.runtime_code import CodeBrainRuntime

        rt_code = BrainManager.instance().get_runtime(brain_id)
        if not isinstance(rt_code, CodeBrainRuntime):
            raise HTTPException(status_code=500, detail="runtime mismatch")
        hits = rt_code.search(query, top_k=top_k)
        from agenticx.code_index.format import format_hits_for_tool

        formatted = format_hits_for_tool(hits)
        return {"ok": True, "hits": formatted, "used_top_k": len(formatted)}

    @app.post("/api/brains/{brain_id}/index")
    async def index_code_brain(brain_id: str) -> Dict[str, Any]:
        brain = BrainRegistry.instance().get(brain_id)
        if brain is None or brain.type != BrainType.CODE:
            raise HTTPException(status_code=400, detail="not a code brain")
        from agenticx.brain.runtime_code import CodeBrainRuntime

        rt = BrainManager.instance().get_runtime(brain_id)
        if not isinstance(rt, CodeBrainRuntime):
            raise HTTPException(status_code=500, detail="runtime mismatch")
        try:
            return {"ok": True, **rt.create_index()}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/brains/{brain_id}/index")
    async def code_brain_index_status(brain_id: str) -> Dict[str, Any]:
        brain = BrainRegistry.instance().get(brain_id)
        if brain is None or brain.type != BrainType.CODE:
            raise HTTPException(status_code=400, detail="not a code brain")
        from agenticx.brain.runtime_code import CodeBrainRuntime

        rt = BrainManager.instance().get_runtime(brain_id)
        if not isinstance(rt, CodeBrainRuntime):
            raise HTTPException(status_code=500, detail="runtime mismatch")
        return {"ok": True, "status": rt.status()}

    @app.post("/api/search/knowledge")
    async def aggregate_knowledge_search(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        query = str(payload.get("query") or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="query required")
        top_k = max(1, min(20, int(payload.get("top_k") or 5)))
        return await asyncio.to_thread(
            search_docs_brains,
            query=query,
            top_k=top_k,
            avatar_id=payload.get("avatar_id"),
            brain_id=payload.get("brain_id"),
        )

    @app.post("/api/search/code")
    async def aggregate_code_search(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        query = str(payload.get("query") or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="query required")
        top_k = max(1, min(50, int(payload.get("top_k") or 10)))
        return await asyncio.to_thread(
            search_code_brains,
            query=query,
            top_k=top_k,
            avatar_id=payload.get("avatar_id"),
            brain_id=payload.get("brain_id"),
            strategy=payload.get("strategy"),
        )
