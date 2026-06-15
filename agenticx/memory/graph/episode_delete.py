#!/usr/bin/env python3
"""Safe episode removal for Kuzu/Graphiti (avoids in-process SIGSEGV).

Graphiti's ``remove_episode`` ends with ``EpisodicNode.delete`` → Kuzu ``DETACH DELETE``,
which can segfault on inconsistent episodic rows and kill ``agx serve``. Deletion runs in a
subprocess; this module implements the graph cleanup plus a Kuzu-safe episodic node drop.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graphiti_core.graphiti import Graphiti

logger = logging.getLogger(__name__)

_SUBPROCESS_TIMEOUT_SECONDS = 180.0


async def remove_episode_safe(graphiti: Graphiti, episode_uuid: str) -> None:
    """Remove one episode and orphan-only entities without ``EpisodicNode.delete``."""
    from graphiti_core.edges import Edge, EntityEdge
    from graphiti_core.nodes import EpisodicNode, Node
    from graphiti_core.search.search_utils import get_mentioned_nodes

    eid = str(episode_uuid or "").strip()
    if not eid:
        raise ValueError("episode_uuid is required")

    driver = graphiti.driver
    episode = await EpisodicNode.get_by_uuid(driver, eid)
    edges = await EntityEdge.get_by_uuids(driver, episode.entity_edges)

    edges_to_delete: list = []
    for edge in edges:
        if edge.episodes and edge.episodes[0] == episode.uuid:
            edges_to_delete.append(edge)

    nodes = await get_mentioned_nodes(driver, [episode])
    nodes_to_delete: list = []
    for node in nodes:
        records, _, _ = await driver.execute_query(
            "MATCH (e:Episodic)-[:MENTIONS]->(n:Entity {uuid: $uuid}) "
            "RETURN count(*) AS episode_count",
            uuid=node.uuid,
            routing_="r",
        )
        for record in records:
            if record["episode_count"] == 1:
                nodes_to_delete.append(node)

    if edges_to_delete:
        await Edge.delete_by_uuids(driver, [edge.uuid for edge in edges_to_delete])
    if nodes_to_delete:
        await Node.delete_by_uuids(driver, [node.uuid for node in nodes_to_delete])

    await driver.execute_query(
        "MATCH (n:Episodic {uuid: $uuid})-[r:MENTIONS]->() DELETE r",
        uuid=eid,
    )
    await driver.execute_query(
        "MATCH (n:Episodic {uuid: $uuid}) DELETE n",
        uuid=eid,
    )


async def remove_episode_in_fresh_store(episode_uuid: str) -> None:
    """Initialize Graphiti in this process and delete one episode."""
    from agenticx.memory.graph.store import MemoryGraphStore

    store = MemoryGraphStore.singleton()
    await store.ensure_ready()
    if store._graphiti is None:
        raise RuntimeError("memory graph engine is not ready")
    await remove_episode_safe(store._graphiti, episode_uuid)


def remove_episode_in_subprocess(episode_uuid: str) -> None:
    """Run episode delete in a child process so Kuzu SIGSEGV cannot kill agx serve."""
    from agenticx.memory.graph.store import MemoryGraphUnavailableError

    eid = str(episode_uuid or "").strip()
    if not eid:
        raise ValueError("episode_uuid is required")

    proc = subprocess.run(
        [sys.executable, "-m", "agenticx.memory.graph.episode_delete_worker", eid],
        capture_output=True,
        text=True,
        timeout=_SUBPROCESS_TIMEOUT_SECONDS,
        env=os.environ.copy(),
        check=False,
    )
    if proc.returncode == 0:
        return

    detail = (proc.stderr or proc.stdout or "").strip()
    if proc.returncode < 0:
        sig_num = -proc.returncode
        try:
            sig_name = signal.Signals(sig_num).name
        except ValueError:
            sig_name = str(sig_num)
        raise MemoryGraphUnavailableError(
            "删除 episode 时图谱引擎异常（"
            f"{sig_name}），该条数据可能已损坏，请跳过或重建图谱：{eid[:8]}…"
        )
    raise MemoryGraphUnavailableError(detail or f"delete episode failed (exit {proc.returncode})")


def remove_episodes_in_subprocess(episode_uuids: list[str]) -> dict[str, Any]:
    """Delete episodes sequentially in isolated child processes."""
    from agenticx.memory.graph.store import MemoryGraphUnavailableError

    ids = [str(x or "").strip() for x in episode_uuids if str(x or "").strip()]
    deleted: list[str] = []
    failed: list[dict[str, str]] = []
    for eid in ids:
        try:
            remove_episode_in_subprocess(eid)
            deleted.append(eid)
        except MemoryGraphUnavailableError as exc:
            failed.append({"episode_uuid": eid, "error": str(exc)})
    return {"deleted": deleted, "failed": failed}


async def assert_episode_deletable(driver, episode_uuid: str) -> None:
    """Reject episodes whose metadata/edges are inconsistent (Kuzu delete may SIGSEGV)."""
    from agenticx.memory.graph.store import MemoryGraphUnavailableError

    eid = str(episode_uuid or "").strip()
    records, _, _ = await driver.execute_query(
        "MATCH (n:Episodic {uuid: $uuid}) "
        "OPTIONAL MATCH (n)-[r:MENTIONS]->() "
        "RETURN size(n.entity_edges) AS ee, count(r) AS mentions",
        uuid=eid,
    )
    if not records:
        raise MemoryGraphUnavailableError(f"episode not found: {eid[:8]}…")
    ee = int(records[0].get("ee") or 0)
    mentions = int(records[0].get("mentions") or 0)
    if ee == 0 and mentions > 0:
        raise MemoryGraphUnavailableError(
            "该 episode 图谱元数据与关系不一致，无法安全删除。"
            "请跳过此条，或重建图谱后再试。"
        )


async def remove_episode_isolated(episode_uuid: str) -> None:
    """Delete one episode without keeping a second Kuzu writer in-process."""
    result = await remove_episodes_isolated([episode_uuid])
    if result["failed"]:
        raise MemoryGraphUnavailableError(result["failed"][0]["error"])


async def remove_episodes_isolated(episode_uuids: list[str]) -> dict[str, Any]:
    """Delete episodes in one subprocess after releasing the parent Kuzu lock."""
    from agenticx.memory.graph.store import MemoryGraphStore

    ids = [str(x or "").strip() for x in episode_uuids if str(x or "").strip()]
    if not ids:
        return {"deleted": [], "failed": []}

    store = MemoryGraphStore.singleton()
    if store._graphiti is not None and store._driver is not None:
        for eid in ids:
            await assert_episode_deletable(store._driver, eid)
    store.reset_runtime()
    loop = asyncio.get_running_loop()
    raw = await loop.run_in_executor(None, remove_episodes_in_subprocess, ids)
    deleted = [str(x) for x in raw.get("deleted") or []]
    failed: list[dict[str, str]] = []
    for item in raw.get("failed") or []:
        if isinstance(item, dict):
            failed.append(
                {
                    "episode_uuid": str(item.get("episode_uuid") or ""),
                    "error": str(item.get("error") or "delete failed"),
                }
            )
    return {"deleted": deleted, "failed": failed}
