#!/usr/bin/env python3
"""Graphiti-backed memory graph store (Kuzu default).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from agenticx.memory.graph.clients import build_graphiti_clients
from agenticx.memory.graph.config import MemoryGraphConfig, load_memory_graph_config
from agenticx.memory.graph.dto import build_graph_view, map_episode_timeline_item
from agenticx.memory.graph.status import MemoryGraphStatusStore

logger = logging.getLogger(__name__)

_INIT_TIMEOUT_SECONDS = 120.0


def _kuzu_lock_help() -> str:
    return (
        "Kuzu 图谱库被占用：通常是有多个 agx serve 同时在跑（例如重启 Near 后旧进程未退出）。"
        "请完全退出 Near（⌘Q），在终端执行 pkill -f 'agx serve' 后再打开；"
        "勿在 Near 运行时单独执行 agx memory-graph ingest。"
    )


_store_singleton: Optional["MemoryGraphStore"] = None
_init_lock = asyncio.Lock()


def graphiti_available() -> bool:
    try:
        import graphiti_core  # noqa: F401

        return True
    except ImportError:
        return False


def _prepare_kuzu_driver(driver: Any) -> None:
    """Patch graphiti-core KuzuDriver gaps (getzep/graphiti#1258, #1360).

    Graphiti.add_episode compares ``group_id`` to ``driver._database``, but KuzuDriver
    never sets that field. Kuzu also skips FTS index creation in build_indices.
    """
    if not hasattr(driver, "_database"):
        driver._database = getattr(driver, "default_group_id", "") or ""

    # Kuzu stores all groups in one file; clone should only update _database metadata.
    def _clone_with_database(database: str) -> Any:
        return driver.with_database(database)

    driver.clone = _clone_with_database  # type: ignore[method-assign]

    db_obj = getattr(driver, "db", None)
    if db_obj is None:
        return
    try:
        import kuzu
        from graphiti_core.driver.driver import GraphProvider
        from graphiti_core.graph_queries import get_fulltext_indices

        conn = kuzu.Connection(db_obj)
        for stmt in get_fulltext_indices(GraphProvider.KUZU):
            try:
                conn.execute(stmt)
            except Exception as exc:
                logger.debug("kuzu fts index skipped (%s): %s", stmt[:72], exc)
        conn.close()
    except Exception as exc:
        logger.warning("kuzu fts bootstrap failed: %s", exc)


def _dispose_kuzu_driver(driver: Any) -> None:
    """Release the Kuzu DB lock and file descriptors held by a driver.

    ``KuzuDriver.close()`` is a no-op (it relies on GC), so on failure paths we
    must drop the underlying ``kuzu.Database`` / connection references and force a
    collection, otherwise a half-initialized driver keeps the write lock until the
    interpreter happens to GC the exception traceback that pins it.
    """
    if driver is None:
        return
    try:
        client = getattr(driver, "client", None)
        if client is not None:
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass
        for attr in ("client", "db"):
            try:
                setattr(driver, attr, None)
            except Exception:
                pass
    finally:
        import gc

        gc.collect()


class MemoryGraphDisabledError(RuntimeError):
    """Raised when memory_graph.enabled is false."""


class MemoryGraphUnavailableError(RuntimeError):
    """Raised when graphiti-core or backend is missing."""


class MemoryGraphStore:
    """Lazy Graphiti client wrapper."""

    def __init__(self, cfg: Optional[MemoryGraphConfig] = None) -> None:
        self.cfg = cfg or load_memory_graph_config()
        self._graphiti: Any = None
        self._driver: Any = None
        self._ready = False
        self._status = MemoryGraphStatusStore(self.cfg.status_path)

    @classmethod
    def singleton(cls) -> "MemoryGraphStore":
        global _store_singleton
        if _store_singleton is None:
            _store_singleton = cls()
        return _store_singleton

    def refresh_config(self) -> MemoryGraphConfig:
        """Reload memory_graph settings from disk (UI toggles must not require restart)."""
        self.cfg = load_memory_graph_config()
        return self.cfg

    def reset_runtime(self) -> None:
        """Drop cached Graphiti/Kuzu handles so provider/model changes take effect."""
        self._ready = False
        self._graphiti = None
        if self._driver is not None:
            _dispose_kuzu_driver(self._driver)
        self._driver = None
        self._status.write({"last_error": None, "last_error_at": None})

    def require_enabled(self) -> None:
        self.refresh_config()
        if not self.cfg.enabled:
            raise MemoryGraphDisabledError("memory_graph_disabled")

    def require_graphiti(self) -> None:
        self.require_enabled()
        if not graphiti_available():
            raise MemoryGraphUnavailableError(
                "graphiti-core is not installed; pip install 'agenticx[graphiti]'"
            )
        if self.cfg.backend != "kuzu":
            raise MemoryGraphUnavailableError(
                f"backend '{self.cfg.backend}' is not supported in this MVP (use kuzu)"
            )

    def _bootstrap_graphiti_sync(self) -> tuple[Any, Any, Any, Any]:
        """Run blocking Kuzu driver + client setup off the asyncio event loop."""
        os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")
        if not self.cfg.telemetry:
            os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
        os.environ.setdefault(
            "SEMAPHORE_LIMIT",
            str(self.cfg.ingest.semaphore_limit),
        )

        from graphiti_core.driver.kuzu_driver import KuzuDriver

        db_path = str(self.cfg.db_path.expanduser())
        self.cfg.db_path.parent.mkdir(parents=True, exist_ok=True)
        driver = KuzuDriver(db=db_path)
        _prepare_kuzu_driver(driver)
        try:
            llm_client, embedder, cross_encoder = build_graphiti_clients(self.cfg)
        except BaseException:
            # 客户端构建失败时 driver 已持有 Kuzu 锁，必须显式释放，否则锁/FD 泄漏
            _dispose_kuzu_driver(driver)
            raise
        return driver, llm_client, embedder, cross_encoder

    async def ensure_ready(self) -> None:
        self.require_graphiti()
        if self._ready and self._graphiti is not None:
            return
        async with _init_lock:
            if self._ready and self._graphiti is not None:
                return
            from graphiti_core import Graphiti

            loop = asyncio.get_running_loop()
            try:
                driver, llm_client, embedder, cross_encoder = await asyncio.wait_for(
                    loop.run_in_executor(None, self._bootstrap_graphiti_sync),
                    timeout=_INIT_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError as exc:
                raise MemoryGraphUnavailableError(
                    f"Graphiti/Kuzu init timed out after {_INIT_TIMEOUT_SECONDS:.0f}s"
                ) from exc
            except RuntimeError as exc:
                msg = str(exc)
                if "Could not set lock on file" in msg or "lock on file" in msg.lower():
                    # 加锁失败：触发一次 GC 让失败的 kuzu.Database 尽快析构释放句柄
                    import gc

                    gc.collect()
                    raise MemoryGraphUnavailableError(_kuzu_lock_help()) from exc
                raise
            graphiti = None
            try:
                graphiti = Graphiti(
                    graph_driver=driver,
                    llm_client=llm_client,
                    embedder=embedder,
                    cross_encoder=cross_encoder,
                    max_coroutines=self.cfg.ingest.semaphore_limit,
                )
                await asyncio.wait_for(
                    graphiti.build_indices_and_constraints(),
                    timeout=_INIT_TIMEOUT_SECONDS,
                )
            except BaseException as exc:
                # 构建 Graphiti 或建索引失败时，driver 仍持有 Kuzu 锁，必须释放
                _dispose_kuzu_driver(driver)
                self._graphiti = None
                self._driver = None
                if isinstance(exc, asyncio.TimeoutError):
                    raise MemoryGraphUnavailableError(
                        f"Graphiti index build timed out after {_INIT_TIMEOUT_SECONDS:.0f}s"
                    ) from exc
                raise
            self._graphiti = graphiti
            self._driver = driver
            self._ready = True

    async def ingest_turn(
        self,
        *,
        group_id: str,
        session_id: str,
        messages: List[Dict[str, Any]],
        reference_time: Optional[datetime] = None,
        source_description: str = "near-chat-turn",
    ) -> str:
        """Ingest one conversational turn as a Graphiti episode."""
        await self.ensure_ready()
        from graphiti_core.nodes import EpisodeType

        body = _format_episode_body(messages, max_chars=self.cfg.ingest.max_chars_per_episode)
        if not body.strip():
            return ""

        ref = reference_time or datetime.now(timezone.utc)
        name = f"session:{session_id}:{int(ref.timestamp())}"
        result = await self._graphiti.add_episode(
            name=name,
            episode_body=body,
            source_description=source_description,
            reference_time=ref,
            source=EpisodeType.message,
            group_id=group_id,
        )
        episode_uuid = str(getattr(result.episode, "uuid", "") or "")
        overview = await self.get_overview(group_id, limit_nodes=200, limit_edges=400)
        meta = overview.get("meta") or {}
        self._status.set_counts(
            node_count=int(meta.get("nodeCount") or 0),
            edge_count=int(meta.get("edgeCount") or 0),
        )
        return episode_uuid

    async def get_overview(
        self,
        group_id: str,
        *,
        limit_nodes: int = 80,
        limit_edges: int = 120,
    ) -> Dict[str, Any]:
        await self.ensure_ready()
        episodes = await self._graphiti.retrieve_episodes(
            reference_time=datetime.now(timezone.utc),
            last_n=20,
            group_ids=[group_id],
        )
        if not episodes:
            return build_graph_view(group_id=group_id, nodes=[], edges=[], truncated=False)

        episode_uuids = [str(ep.uuid) for ep in episodes if getattr(ep, "uuid", None)]
        results = await self._graphiti.get_nodes_and_edges_by_episode(episode_uuids)
        nodes = list(getattr(results, "nodes", []) or [])
        edges = list(getattr(results, "edges", []) or [])

        truncated = len(nodes) > limit_nodes or len(edges) > limit_edges
        nodes = nodes[:limit_nodes]
        edges = edges[:limit_edges]
        view = build_graph_view(group_id=group_id, nodes=nodes, edges=edges, truncated=truncated)
        self._status.set_counts(
            node_count=len(view.get("nodes") or []),
            edge_count=len(view.get("edges") or []),
        )
        return view

    async def get_episode_subgraph(self, group_id: str, episode_uuid: str) -> Dict[str, Any]:
        await self.ensure_ready()
        results = await self._graphiti.get_nodes_and_edges_by_episode([episode_uuid])
        nodes = list(getattr(results, "nodes", []) or [])
        edges = list(getattr(results, "edges", []) or [])
        return build_graph_view(group_id=group_id, nodes=nodes, edges=edges, truncated=False)

    async def search_subgraph(
        self,
        group_id: str,
        query: str,
        *,
        center_node_uuid: Optional[str] = None,
        limit_nodes: int = 60,
        limit_edges: int = 80,
    ) -> Dict[str, Any]:
        await self.ensure_ready()
        from graphiti_core.search.search_config_recipes import COMBINED_HYBRID_SEARCH_CROSS_ENCODER

        config = COMBINED_HYBRID_SEARCH_CROSS_ENCODER
        config.limit = max(limit_nodes, limit_edges)
        results = await self._graphiti.search_(
            query=query,
            config=config,
            group_ids=[group_id],
            center_node_uuid=center_node_uuid,
        )
        nodes = list(getattr(results, "nodes", []) or [])[:limit_nodes]
        edges = list(getattr(results, "edges", []) or [])[:limit_edges]
        return build_graph_view(group_id=group_id, nodes=nodes, edges=edges, truncated=True)

    async def list_episodes(self, group_id: str, *, last_n: int = 20) -> List[Dict[str, Any]]:
        await self.ensure_ready()
        episodes = await self._graphiti.retrieve_episodes(
            reference_time=datetime.now(timezone.utc),
            last_n=max(1, min(last_n, 100)),
            group_ids=[group_id],
        )
        return [map_episode_timeline_item(ep) for ep in episodes]

    async def delete_episode(self, episode_uuid: str) -> None:
        await self.ensure_ready()
        await self._graphiti.remove_episode(episode_uuid)

    def get_status(self) -> Dict[str, Any]:
        self.refresh_config()
        state = self._status.read()
        state["enabled"] = self.cfg.enabled
        state["graphiti_installed"] = graphiti_available()
        state["backend"] = self.cfg.backend
        state["db_path"] = str(self.cfg.db_path)
        return state


def _format_episode_body(messages: List[Dict[str, Any]], *, max_chars: int) -> str:
    lines: List[str] = []
    for msg in messages:
        role = str(msg.get("role", "") or "").strip().lower()
        content = str(msg.get("content", "") or "").strip()
        if not content:
            continue
        if role == "user":
            nick = str(msg.get("nickname") or msg.get("user_nickname") or "user")
            lines.append(f"user({nick}): {content}")
        elif role == "assistant":
            name = str(msg.get("avatar_name") or msg.get("assistant_name") or "Machi")
            lines.append(f"assistant({name}): {content}")
        else:
            lines.append(f"{role}: {content}")
    body = "\n".join(lines).strip()
    if len(body) > max_chars:
        body = body[: max_chars - 3] + "..."
    return body


def load_session_messages(session_id: str) -> List[Dict[str, Any]]:
    """Load chat history from persisted messages.json."""
    import json
    from pathlib import Path

    sid = str(session_id or "").strip()
    if not sid:
        return []
    path = Path.home() / ".agenticx" / "sessions" / sid / "messages.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(data, dict):
        rows = data.get("messages") or data.get("chat_history") or []
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    return [row for row in rows if isinstance(row, dict)]


def extract_last_turn_messages(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return the latest user+assistant pair from history."""
    user_msg: Optional[Dict[str, Any]] = None
    assistant_msg: Optional[Dict[str, Any]] = None
    for msg in reversed(history):
        role = str(msg.get("role", "") or "").lower()
        content = str(msg.get("content", "") or "").strip()
        if not content or content.startswith("[系统通知]"):
            continue
        if role == "assistant" and assistant_msg is None:
            assistant_msg = msg
            continue
        if role == "user" and user_msg is None:
            user_msg = msg
            if assistant_msg is not None:
                break
    out: List[Dict[str, Any]] = []
    if user_msg is not None:
        out.append(user_msg)
    if assistant_msg is not None:
        out.append(assistant_msg)
    return out
