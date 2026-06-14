#!/usr/bin/env python3
"""Natural-language memory forget helpers (graph + workspace text).

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from agenticx.memory.graph.group_id import derive_group_id_from_avatar_id
from agenticx.memory.graph.store import MemoryGraphStore
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.workspace.loader import (
    delete_memory_entries_batch,
    read_memory_entries,
    resolve_subject_workspace_dir,
)

logger = logging.getLogger(__name__)


def _match_query(text: str, query: str) -> bool:
    hay = str(text or "").strip().lower()
    needle = str(query or "").strip().lower()
    return bool(needle) and needle in hay


async def forget_memory_for_session(
    query: str,
    *,
    scope: str = "both",
    avatar_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Remove graph episodes and/or workspace bullets matching query."""
    q = str(query or "").strip()
    normalized_scope = str(scope or "both").strip().lower()
    if normalized_scope not in {"graph", "text", "both"}:
        return {"ok": False, "error": "scope must be graph, text, or both"}
    if not q:
        return {"ok": False, "error": "missing query", "message": "未找到匹配记忆"}

    group_id = derive_group_id_from_avatar_id(avatar_id, session_id=session_id)
    deleted_episodes: List[str] = []
    skipped_pinned: List[str] = []
    deleted_text = 0
    entity_labels: Set[str] = set()

    if normalized_scope in {"graph", "both"}:
        store = MemoryGraphStore.singleton()
        episode_ids: Set[str] = set()
        try:
            episodes = await store.list_episodes(group_id, last_n=100)
            for ep in episodes:
                preview = str(ep.get("preview") or ep.get("name") or "")
                if _match_query(preview, q):
                    eid = str(ep.get("id") or "").strip()
                    if eid:
                        episode_ids.add(eid)
        except Exception as exc:
            logger.warning("forget graph episode list failed: %s", exc)

        try:
            subgraph = await store.search_subgraph(group_id, q, limit_nodes=40, limit_edges=60)
            for node in subgraph.get("nodes") or []:
                if not isinstance(node, dict):
                    continue
                label = str(node.get("label") or "").strip()
                if label:
                    entity_labels.add(label)
                if str(node.get("kind") or "") == "episode":
                    eid = str(node.get("id") or "").strip()
                    if eid:
                        episode_ids.add(eid)
        except Exception as exc:
            logger.warning("forget graph search failed: %s", exc)

        if episode_ids:
            try:
                bulk = await store.delete_episodes_bulk(group_id, sorted(episode_ids))
                deleted_episodes = list(bulk.get("deleted") or [])
                skipped_pinned = list(bulk.get("skipped_pinned") or [])
            except Exception as exc:
                logger.warning("forget graph bulk delete failed: %s", exc)

    if normalized_scope in {"text", "both"}:
        try:
            workspace_dir = resolve_subject_workspace_dir(avatar_id=avatar_id)
            entries = read_memory_entries(workspace_dir)
            targets: List[tuple[str, int]] = []
            for entry in entries:
                section = str(entry.get("section") or "").strip()
                text = str(entry.get("text") or "")
                if not section or not _match_query(text, q):
                    continue
                try:
                    index = int(entry.get("index"))
                except (TypeError, ValueError):
                    continue
                targets.append((section, index))
            if targets:
                deleted_text = delete_memory_entries_batch(workspace_dir, targets)
                try:
                    WorkspaceMemoryStore().index_workspace_sync(workspace_dir)
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("forget workspace text failed: %s", exc)

    if not deleted_episodes and deleted_text == 0 and not skipped_pinned:
        return {
            "ok": True,
            "message": "未找到匹配记忆",
            "deleted_episodes": 0,
            "deleted_text": 0,
            "skipped_pinned": 0,
        }

    subject_label = group_id or "current subject"
    entities = ", ".join(sorted(entity_labels)[:8])
    parts = [f"已从 {subject_label} 记忆移除 {len(deleted_episodes)} 条 episode"]
    if deleted_text:
        parts.append(f"{deleted_text} 条文本")
    if entities:
        parts.append(f"涉及实体：{entities}")
    if skipped_pinned:
        parts.append(f"pinned 的 {len(skipped_pinned)} 条已保留")
    message = "；".join(parts)

    return {
        "ok": True,
        "message": message,
        "deleted_episodes": len(deleted_episodes),
        "deleted_text": deleted_text,
        "skipped_pinned": len(skipped_pinned),
        "episode_ids": deleted_episodes,
        "entities": sorted(entity_labels),
    }
