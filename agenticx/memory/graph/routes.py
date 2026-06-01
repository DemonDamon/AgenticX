#!/usr/bin/env python3
"""FastAPI routes for memory graph read/write APIs.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query

from agenticx.memory.graph.config import load_memory_graph_config, memory_graph_config_to_dict
from agenticx.memory.graph.group_id import derive_group_id, resolve_scope_group_id, validate_group_access
from agenticx.memory.graph.store import (
    MemoryGraphDisabledError,
    MemoryGraphStore,
    MemoryGraphUnavailableError,
    extract_last_turn_messages,
    load_session_messages,
)
from agenticx.memory.graph.writer import MemoryGraphWriter


def register_memory_graph_routes(app, *, check_token) -> None:
    """Register /api/memory/graph/* on the given FastAPI app."""

    router = APIRouter(prefix="/api/memory/graph", tags=["memory-graph"])

    def _auth(token: Optional[str]) -> None:
        check_token(token)

    def _map_error(exc: Exception) -> HTTPException:
        if isinstance(exc, MemoryGraphDisabledError):
            return HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        if isinstance(exc, MemoryGraphUnavailableError):
            return HTTPException(status_code=503, detail={"error": "memory_graph_unavailable", "message": str(exc)})
        return HTTPException(status_code=500, detail={"error": "memory_graph_error", "message": str(exc)})

    @router.get("/overview")
    async def memory_graph_overview(
        scope: Optional[str] = Query(default=None),
        avatar_id: Optional[str] = Query(default=None),
        session_id: Optional[str] = Query(default=None),
        group_id: Optional[str] = Query(default=None),
        limit_nodes: int = Query(default=80, ge=1, le=200),
        limit_edges: int = Query(default=120, ge=1, le=300),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        cfg = load_memory_graph_config()
        if not cfg.enabled:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        gid = group_id or resolve_scope_group_id(
            scope=scope,
            avatar_id=avatar_id,
            session_id=session_id,
            default_scope=cfg.default_scope,
        )
        if group_id and not validate_group_access(gid, avatar_id=avatar_id, session_id=session_id):
            raise HTTPException(status_code=403, detail={"error": "group_access_denied"})
        try:
            store = MemoryGraphStore.singleton()
            view = await store.get_overview(gid, limit_nodes=limit_nodes, limit_edges=limit_edges)
            return {"ok": True, **view}
        except (MemoryGraphDisabledError, MemoryGraphUnavailableError) as exc:
            raise _map_error(exc) from exc

    @router.get("/episode/{episode_uuid}")
    async def memory_graph_episode(
        episode_uuid: str,
        group_id: str = Query(...),
        avatar_id: Optional[str] = Query(default=None),
        session_id: Optional[str] = Query(default=None),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        cfg = load_memory_graph_config()
        if not cfg.enabled:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        if not validate_group_access(group_id, avatar_id=avatar_id, session_id=session_id):
            raise HTTPException(status_code=403, detail={"error": "group_access_denied"})
        try:
            store = MemoryGraphStore.singleton()
            view = await store.get_episode_subgraph(group_id, episode_uuid)
            return {"ok": True, **view}
        except (MemoryGraphDisabledError, MemoryGraphUnavailableError) as exc:
            raise _map_error(exc) from exc

    @router.get("/episodes")
    async def memory_graph_episodes(
        group_id: str = Query(...),
        last_n: int = Query(default=20, ge=1, le=100),
        avatar_id: Optional[str] = Query(default=None),
        session_id: Optional[str] = Query(default=None),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        cfg = load_memory_graph_config()
        if not cfg.enabled:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        if not validate_group_access(group_id, avatar_id=avatar_id, session_id=session_id):
            raise HTTPException(status_code=403, detail={"error": "group_access_denied"})
        try:
            store = MemoryGraphStore.singleton()
            items = await store.list_episodes(group_id, last_n=last_n)
            return {"ok": True, "episodes": items, "groupId": group_id}
        except (MemoryGraphDisabledError, MemoryGraphUnavailableError) as exc:
            raise _map_error(exc) from exc

    @router.post("/search")
    async def memory_graph_search(
        payload: dict[str, Any],
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        cfg = load_memory_graph_config()
        if not cfg.enabled:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        group_id = str(payload.get("group_id", "") or "").strip()
        query = str(payload.get("query", "") or "").strip()
        center = payload.get("center_node_uuid")
        avatar_id = payload.get("avatar_id")
        session_id = payload.get("session_id")
        if not group_id or not query:
            raise HTTPException(status_code=400, detail="group_id and query are required")
        if not validate_group_access(group_id, avatar_id=avatar_id, session_id=session_id):
            raise HTTPException(status_code=403, detail={"error": "group_access_denied"})
        try:
            store = MemoryGraphStore.singleton()
            view = await store.search_subgraph(
                group_id,
                query,
                center_node_uuid=str(center) if center else None,
            )
            return {"ok": True, **view}
        except (MemoryGraphDisabledError, MemoryGraphUnavailableError) as exc:
            raise _map_error(exc) from exc

    @router.post("/ingest")
    async def memory_graph_ingest(
        payload: dict[str, Any],
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        """Enqueue ingest for the latest user+assistant turn in a session."""
        _auth(x_agx_desktop_token)
        cfg = load_memory_graph_config()
        if not cfg.enabled:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        session_id = str(payload.get("session_id", "") or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        avatar_id = payload.get("avatar_id")
        scope = payload.get("scope")
        group_id = payload.get("group_id")
        gid = group_id or resolve_scope_group_id(
            scope=scope,
            avatar_id=avatar_id,
            session_id=session_id,
            default_scope=cfg.default_scope,
        )
        if not validate_group_access(gid, avatar_id=avatar_id, session_id=session_id):
            raise HTTPException(status_code=403, detail={"error": "group_access_denied"})
        messages = extract_last_turn_messages(load_session_messages(session_id))
        if not messages:
            raise HTTPException(status_code=400, detail="no_user_assistant_pair")
        writer = MemoryGraphWriter.singleton()
        ok = await writer.enqueue_turn(
            group_id=gid,
            session_id=session_id,
            messages=messages,
            priority=5,
            source_description="near-manual-ingest",
        )
        if not ok:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_ingest_unavailable"})
        return {"ok": True, "queued": True, "group_id": gid, "session_id": session_id}

    @router.get("/status")
    async def memory_graph_status(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        from agenticx.memory.graph.deps import graphiti_runtime_info

        store = MemoryGraphStore.singleton()
        status = store.get_status()
        cfg = load_memory_graph_config()
        status["config"] = memory_graph_config_to_dict(cfg)
        try:
            from agenticx.memory.graph.clients import resolve_effective_models

            status["models"] = resolve_effective_models(cfg)
        except Exception:  # 模型解析失败不应影响 status
            status["models"] = None
        status.update(graphiti_runtime_info())
        return {"ok": True, **status}

    @router.delete("/episode/{episode_uuid}")
    async def memory_graph_delete_episode(
        episode_uuid: str,
        group_id: str = Query(...),
        avatar_id: Optional[str] = Query(default=None),
        session_id: Optional[str] = Query(default=None),
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        cfg = load_memory_graph_config()
        if not cfg.enabled:
            raise HTTPException(status_code=503, detail={"error": "memory_graph_disabled"})
        if not validate_group_access(group_id, avatar_id=avatar_id, session_id=session_id):
            raise HTTPException(status_code=403, detail={"error": "group_access_denied"})
        try:
            store = MemoryGraphStore.singleton()
            await store.delete_episode(episode_uuid)
            return {"ok": True, "deleted": episode_uuid}
        except (MemoryGraphDisabledError, MemoryGraphUnavailableError) as exc:
            raise _map_error(exc) from exc

    @router.get("/config")
    async def memory_graph_config_get(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        return {"ok": True, "config": memory_graph_config_to_dict(load_memory_graph_config())}

    @router.put("/config")
    async def memory_graph_config_put(
        payload: dict[str, Any],
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict[str, Any]:
        _auth(x_agx_desktop_token)
        from agenticx.cli.config_manager import ConfigManager

        block = payload.get("config") if isinstance(payload.get("config"), dict) else payload
        if not isinstance(block, dict):
            raise HTTPException(status_code=400, detail="config object required")
        path = ConfigManager.GLOBAL_CONFIG_PATH
        raw = ConfigManager._load_yaml(path)
        raw["memory_graph"] = block
        ConfigManager._dump_yaml(path, raw)
        MemoryGraphStore.singleton().refresh_config()
        return {"ok": True, "config": memory_graph_config_to_dict(load_memory_graph_config())}

    app.include_router(router)
