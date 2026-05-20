"""HTTP routes for code_index settings and status (Desktop / remote)."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class CodeIndexConfigBody(BaseModel):
    enabled: Optional[bool] = None
    backend: Optional[str] = None
    preload_model: Optional[bool] = None
    max_index_memory_mb: Optional[int] = Field(None, ge=128, le=8192)
    semble: Optional[Dict[str, Any]] = None


def register_code_index_routes(app: FastAPI) -> None:
    if getattr(app.state, "_code_index_routes_registered", False):
        return
    app.state._code_index_routes_registered = True

    @app.get("/api/code-index/config")
    async def get_code_index_config() -> Dict[str, Any]:
        from agenticx.code_index.config import load_code_index_config

        cfg = load_code_index_config()
        return {
            "ok": True,
            "config": {
                "enabled": cfg.enabled,
                "backend": cfg.backend,
                "preload_model": cfg.preload_model,
                "max_index_memory_mb": cfg.max_index_memory_mb,
                "semble": {
                    "search_mode": cfg.semble_search_mode,
                    "default_top_k": cfg.semble_default_top_k,
                    "include_text_files": cfg.semble_include_text_files,
                    "model": cfg.semble_model,
                },
            },
        }

    @app.put("/api/code-index/config")
    async def put_code_index_config(body: CodeIndexConfigBody) -> Dict[str, Any]:
        from agenticx.cli.config_manager import ConfigManager

        patch: Dict[str, Any] = {}
        if body.enabled is not None:
            patch["enabled"] = body.enabled
        if body.backend is not None:
            patch["backend"] = body.backend
        if body.preload_model is not None:
            patch["preload_model"] = body.preload_model
        if body.max_index_memory_mb is not None:
            patch["max_index_memory_mb"] = body.max_index_memory_mb
        if body.semble is not None:
            patch["semble"] = body.semble
        try:
            current = ConfigManager.get_value("code_index") or {}
            if not isinstance(current, dict):
                current = {}
            merged = {**current, **patch}
            if body.semble is not None:
                sem = current.get("semble") if isinstance(current.get("semble"), dict) else {}
                merged["semble"] = {**sem, **body.semble}
            ConfigManager.set_value("code_index", merged, scope="global")
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return await get_code_index_config()

    @app.get("/api/code-index/status")
    async def code_index_status(codebase_path: str = "") -> Dict[str, Any]:
        from agenticx.code_index.manager import CodeIndexManager

        mgr = CodeIndexManager.instance()
        if not codebase_path.strip():
            with mgr._lock:
                tasks = [t.to_status_dict() for t in mgr._tasks.values()]
            return {"ok": True, "tasks": tasks}
        path = Path(codebase_path).expanduser().resolve()
        status = await asyncio.to_thread(mgr.get_status, path)
        return {"ok": True, **status}

    @app.post("/api/code-index/preload")
    async def code_index_preload() -> Dict[str, Any]:
        from agenticx.code_index.manager import CodeIndexManager

        try:
            await asyncio.to_thread(CodeIndexManager.instance().preload_model)
            return {"ok": True, "message": "嵌入模型预热已启动"}
        except ImportError as exc:
            return {"ok": False, "error": f"未安装 code_index 依赖: {exc}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @app.post("/api/code-index/clear")
    async def code_index_clear(body: Dict[str, str]) -> Dict[str, Any]:
        from agenticx.code_index.manager import CodeIndexManager

        raw = str(body.get("codebase_path", "") or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="codebase_path required")
        path = Path(raw).expanduser().resolve()
        await asyncio.to_thread(CodeIndexManager.instance().clear, path)
        return {"ok": True, "codebase_path": str(path)}
