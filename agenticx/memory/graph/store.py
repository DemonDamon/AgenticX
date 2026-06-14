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
from agenticx.memory.graph.pins import load_pins
from agenticx.memory.graph.retention import select_episodes_for_prune
from agenticx.memory.graph.status import MemoryGraphStatusStore

logger = logging.getLogger(__name__)

_EPISODE_LIST_MAX = 500
_INIT_TIMEOUT_SECONDS = 120.0
_EPISODE_IMPACT_NOTE = (
    "Entities may be shared across other episodes; removing this episode does not "
    "guarantee all related entities or edges are removed from the graph."
)


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

    def _touch_job_progress(self, percent: int, stage: str) -> None:
        state = self._status.read()
        if state.get("job_active") or int(state.get("pending_jobs", 0)) > 0:
            self._status.set_job_progress(percent, stage)

    async def _pulse_extracting_progress(self) -> None:
        """Keep progress moving while Graphiti add_episode runs (LLM + embed can take minutes)."""
        steps = (
            (52, "extracting_entities"),
            (60, "extracting_edges"),
            (68, "embedding"),
            (76, "linking"),
        )
        idx = 0
        while True:
            await asyncio.sleep(6)
            if idx < len(steps):
                pct, stage = steps[idx]
                self._touch_job_progress(pct, stage)
                idx += 1
                continue
            state = self._status.read()
            cur = int(state.get("job_progress", 48) or 48)
            if cur < 78:
                self._touch_job_progress(cur + 1, "linking")

    async def ensure_ready(self) -> None:
        """Initialize Graphiti/Kuzu on the dedicated graphiti event-loop thread."""
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        await run_on_graphiti_loop(self._ensure_ready_impl())

    async def _ensure_ready_impl(self) -> None:
        self.require_graphiti()
        if self._ready and self._graphiti is not None:
            return
        async with _init_lock:
            if self._ready and self._graphiti is not None:
                return
            from graphiti_core import Graphiti

            self._touch_job_progress(12, "preparing")
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
                self._touch_job_progress(22, "preparing")
                graphiti = Graphiti(
                    graph_driver=driver,
                    llm_client=llm_client,
                    embedder=embedder,
                    cross_encoder=cross_encoder,
                    max_coroutines=self.cfg.ingest.semaphore_limit,
                )
                self._touch_job_progress(32, "preparing")
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
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._ingest_turn_impl(
                group_id=group_id,
                session_id=session_id,
                messages=messages,
                reference_time=reference_time,
                source_description=source_description,
            )
        )

    async def _ingest_turn_impl(
        self,
        *,
        group_id: str,
        session_id: str,
        messages: List[Dict[str, Any]],
        reference_time: Optional[datetime] = None,
        source_description: str = "near-chat-turn",
    ) -> str:
        """Run ingest on the graphiti loop (internal)."""
        await self._ensure_ready_impl()
        from graphiti_core.nodes import EpisodeType

        self._touch_job_progress(38, "formatting")
        body = _format_episode_body(messages, max_chars=self.cfg.ingest.max_chars_per_episode)
        if not body.strip():
            return ""

        ref = reference_time or datetime.now(timezone.utc)
        name = f"session:{session_id}:{int(ref.timestamp())}"
        self._touch_job_progress(48, "extracting_entities")
        pulse = asyncio.create_task(self._pulse_extracting_progress())
        try:
            result = await self._graphiti.add_episode(
                name=name,
                episode_body=body,
                source_description=source_description,
                reference_time=ref,
                source=EpisodeType.message,
                group_id=group_id,
            )
        finally:
            pulse.cancel()
        episode_uuid = str(getattr(result.episode, "uuid", "") or "")
        self._touch_job_progress(82, "updating")
        overview = await self._get_overview_impl(group_id, limit_nodes=200, limit_edges=400)
        self._touch_job_progress(95, "finalizing")
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
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._get_overview_impl(group_id, limit_nodes=limit_nodes, limit_edges=limit_edges)
        )

    async def _get_overview_impl(
        self,
        group_id: str,
        *,
        limit_nodes: int = 80,
        limit_edges: int = 120,
    ) -> Dict[str, Any]:
        await self._ensure_ready_impl()
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
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._get_episode_subgraph_impl(group_id, episode_uuid)
        )

    async def _get_episode_subgraph_impl(self, group_id: str, episode_uuid: str) -> Dict[str, Any]:
        await self._ensure_ready_impl()
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
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._search_subgraph_impl(
                group_id,
                query,
                center_node_uuid=center_node_uuid,
                limit_nodes=limit_nodes,
                limit_edges=limit_edges,
            )
        )

    async def _search_subgraph_impl(
        self,
        group_id: str,
        query: str,
        *,
        center_node_uuid: Optional[str] = None,
        limit_nodes: int = 60,
        limit_edges: int = 80,
    ) -> Dict[str, Any]:
        await self._ensure_ready_impl()
        # RRF hybrid search avoids cross_encoder reranking (logprobs + N LLM calls), which is
        # slow/unsupported on bailian/qwen and caused UI search timeouts.
        from graphiti_core.search.search_config_recipes import COMBINED_HYBRID_SEARCH_RRF

        config = COMBINED_HYBRID_SEARCH_RRF.model_copy(deep=True)
        config.limit = max(limit_nodes, limit_edges)
        try:
            results = await asyncio.wait_for(
                self._graphiti.search_(
                    query=query,
                    config=config,
                    group_ids=[group_id],
                    center_node_uuid=center_node_uuid,
                ),
                timeout=_SEARCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise MemoryGraphUnavailableError(
                f"图谱搜索超时（>{_SEARCH_TIMEOUT_SECONDS:.0f}s），请稍后重试"
            ) from exc
        nodes = list(getattr(results, "nodes", []) or [])[:limit_nodes]
        edges = list(getattr(results, "edges", []) or [])[:limit_edges]
        return build_graph_view(group_id=group_id, nodes=nodes, edges=edges, truncated=True)

    async def list_episodes(self, group_id: str, *, last_n: int = 20) -> List[Dict[str, Any]]:
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(self._list_episodes_impl(group_id, last_n=last_n))

    async def _list_episodes_impl(self, group_id: str, *, last_n: int = 20) -> List[Dict[str, Any]]:
        await self._ensure_ready_impl()
        episodes = await self._graphiti.retrieve_episodes(
            reference_time=datetime.now(timezone.utc),
            last_n=max(1, min(last_n, _EPISODE_LIST_MAX)),
            group_ids=[group_id],
        )
        pinned = load_pins(group_id)
        items = []
        for ep in episodes:
            row = map_episode_timeline_item(ep)
            row["pinned"] = row.get("id") in pinned
            items.append(row)
        return items

    async def delete_episode(self, episode_uuid: str) -> None:
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        await run_on_graphiti_loop(self._delete_episode_impl(episode_uuid))

    async def _delete_episode_impl(self, episode_uuid: str) -> None:
        await self._ensure_ready_impl()
        await self._graphiti.remove_episode(episode_uuid)

    async def delete_episodes_bulk(self, group_id: str, episode_uuids: List[str]) -> Dict[str, Any]:
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._delete_episodes_bulk_impl(group_id, episode_uuids)
        )

    async def _delete_episodes_bulk_impl(
        self,
        group_id: str,
        episode_uuids: List[str],
    ) -> Dict[str, Any]:
        # Ensure graphiti is ready once up-front; subsequent removes skip re-check
        # to avoid deadlocking the graphiti loop with nested asyncio.wait_for calls.
        await self._ensure_ready_impl()
        pinned = load_pins(group_id)
        deleted: List[str] = []
        skipped_pinned: List[str] = []
        for raw in episode_uuids:
            eid = str(raw or "").strip()
            if not eid:
                continue
            if eid in pinned:
                skipped_pinned.append(eid)
                continue
            await self._graphiti.remove_episode(eid)
            deleted.append(eid)
        return {
            "deleted": deleted,
            "skipped_pinned": skipped_pinned,
            "count": len(deleted),
        }

    async def prune_episodes(
        self,
        group_id: str,
        *,
        max_episodes: int = 0,
        max_age_days: int = 0,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._prune_episodes_impl(
                group_id,
                max_episodes=max_episodes,
                max_age_days=max_age_days,
                dry_run=dry_run,
            )
        )

    async def _prune_episodes_impl(
        self,
        group_id: str,
        *,
        max_episodes: int = 0,
        max_age_days: int = 0,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        await self._ensure_ready_impl()
        episodes = await self._list_episodes_impl(group_id, last_n=_EPISODE_LIST_MAX)
        pinned = load_pins(group_id)
        to_delete, kept = select_episodes_for_prune(
            episodes,
            max_episodes=max_episodes,
            max_age_days=max_age_days,
            pinned=pinned,
        )
        if dry_run:
            return {"would_delete": to_delete, "count": len(to_delete), "kept": kept}
        # _ensure_ready_impl already called above; use _graphiti.remove_episode directly
        # to avoid nested asyncio.wait_for deadlocking the graphiti loop.
        deleted: List[str] = []
        for eid in to_delete:
            await self._graphiti.remove_episode(eid)
            deleted.append(eid)
        return {"deleted": deleted, "count": len(deleted), "kept": kept}

    async def preview_episode_impact(self, group_id: str, episode_uuid: str) -> Dict[str, Any]:
        from agenticx.memory.graph.executor import run_on_graphiti_loop

        return await run_on_graphiti_loop(
            self._preview_episode_impact_impl(group_id, episode_uuid)
        )

    async def _preview_episode_impact_impl(
        self,
        group_id: str,
        episode_uuid: str,
    ) -> Dict[str, Any]:
        view = await self._get_episode_subgraph_impl(group_id, episode_uuid)
        nodes = view.get("nodes") or []
        edges = view.get("edges") or []
        return {
            "episodeId": episode_uuid,
            "groupId": group_id,
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "note": _EPISODE_IMPACT_NOTE,
        }

    def get_status(self) -> Dict[str, Any]:
        self.refresh_config()
        state = self._status.read()
        state["enabled"] = self.cfg.enabled
        state["graphiti_installed"] = graphiti_available()
        state["backend"] = self.cfg.backend
        state["db_path"] = str(self.cfg.db_path)
        return state

    @staticmethod
    def build_status_payload_sync() -> Dict[str, Any]:
        """Lightweight status snapshot for /api/memory/graph/status (worker-thread safe)."""
        from agenticx.memory.graph.config import load_memory_graph_config, memory_graph_config_to_dict
        from agenticx.memory.graph.deps import graphiti_runtime_info

        store = MemoryGraphStore.singleton()
        try:
            from agenticx.memory.graph import writer as writer_mod

            writer = writer_mod._writer_singleton
            queue_size = writer._queue.qsize() if writer is not None else 0
        except Exception:
            queue_size = 0
        MemoryGraphStatusStore(store.cfg.status_path).reconcile_after_restart(queue_size=queue_size)
        status = store.get_status()
        cfg = load_memory_graph_config()
        status["config"] = memory_graph_config_to_dict(cfg)
        try:
            from agenticx.memory.graph.clients import resolve_effective_models

            status["models"] = resolve_effective_models(cfg)
        except Exception:
            status["models"] = None
        status.update(graphiti_runtime_info())
        return status


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
