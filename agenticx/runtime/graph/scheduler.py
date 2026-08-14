#!/usr/bin/env python3
"""DAG scheduler for GraphRun task nodes (AgentRuntime execution layer).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional

from agenticx.runtime.graph.models import GraphNode, GraphRun, NodeStatus
from agenticx.runtime.graph.store import GraphRunStore, get_default_store

_log = logging.getLogger(__name__)

NodeRunner = Callable[[GraphNode], AsyncIterator[Any]]
EventHook = Callable[[str, Dict[str, Any]], None]
ShouldStop = Callable[[], Any]

_SENTINEL = object()


async def _should_stop(should_stop: Optional[ShouldStop]) -> bool:
    if should_stop is None:
        return False
    try:
        result = should_stop()
        if asyncio.iscoroutine(result) or isinstance(result, Awaitable):
            return bool(await result)  # type: ignore[misc]
        return bool(result)
    except Exception:
        return False


def _ready_nodes(run: GraphRun) -> List[GraphNode]:
    ready: List[GraphNode] = []
    for node in run.nodes.values():
        if node.status in (NodeStatus.PENDING, NodeStatus.READY):
            if run.deps_satisfied(node.id):
                node.status = NodeStatus.READY
                ready.append(node)
    return ready


async def execute_group_run(
    run: GraphRun,
    *,
    runner: NodeRunner,
    on_event: Optional[EventHook] = None,
    store: Optional[GraphRunStore] = None,
    max_parallel: int = 4,
    should_stop: Optional[ShouldStop] = None,
    pause_poll_seconds: float = 0.05,
) -> AsyncIterator[Any]:
    """Execute READY task nodes in parallel waves respecting depends edges.

    Yields runner items as they arrive (merged across concurrent nodes).
    """
    store = store or get_default_store()
    max_parallel = max(1, int(max_parallel))
    store.save(run, bump_version=True)
    if on_event:
        on_event(
            "graph.run_created",
            {
                "run_id": run.run_id,
                "session_id": run.session_id,
                "group_id": run.group_id,
                "version": run.version,
                "node_ids": list(run.nodes.keys()),
            },
        )

    async def _run_one(node: GraphNode, out: "asyncio.Queue[Any]") -> None:
        node.status = NodeStatus.RUNNING
        if node.id not in run.run_state.current_nodes:
            run.run_state.current_nodes.append(node.id)
        if on_event:
            on_event(
                "graph.node_updated",
                {"run_id": run.run_id, "node": node.to_dict(), "version": run.version},
            )
        try:
            async for item in runner(node):
                await out.put(item)
            node.status = NodeStatus.DONE
        except asyncio.CancelledError:
            node.status = NodeStatus.CANCELLED
            raise
        except Exception as exc:
            _log.warning("Graph node %s failed: %s", node.id, exc)
            node.status = NodeStatus.FAILED
            node.meta["error"] = str(exc)[:500]
        finally:
            if node.id in run.run_state.current_nodes:
                run.run_state.current_nodes = [
                    x for x in run.run_state.current_nodes if x != node.id
                ]
            store.save(run, bump_version=True)
            if on_event:
                on_event(
                    "graph.node_updated",
                    {"run_id": run.run_id, "node": node.to_dict(), "version": run.version},
                )
            await out.put(_SENTINEL)

    while not run.is_finished():
        if await _should_stop(should_stop):
            run.status = "closed"
            store.save(run, bump_version=True)
            break

        if run.status == "paused":
            await asyncio.sleep(pause_poll_seconds)
            fresh = store.load(run.run_id)
            if fresh is not None:
                run.status = fresh.status
            continue

        ready = _ready_nodes(run)
        batch = ready[:max_parallel]
        if not batch:
            if any(n.status == NodeStatus.RUNNING for n in run.nodes.values()):
                await asyncio.sleep(pause_poll_seconds)
                continue
            break

        queue: asyncio.Queue[Any] = asyncio.Queue()
        workers = [asyncio.create_task(_run_one(n, queue)) for n in batch]
        remaining = len(workers)
        try:
            while remaining > 0:
                if await _should_stop(should_stop):
                    for t in workers:
                        t.cancel()
                    break
                item = await queue.get()
                if item is _SENTINEL:
                    remaining -= 1
                    continue
                yield item
        finally:
            for t in workers:
                if not t.done():
                    t.cancel()
            await asyncio.gather(*workers, return_exceptions=True)

        if await _should_stop(should_stop):
            run.status = "closed"
            store.save(run, bump_version=True)
            break

    if run.status == "open":
        run.status = "closed"
        store.save(run, bump_version=True)
        if on_event:
            on_event(
                "graph.run_status",
                {"run_id": run.run_id, "status": run.status, "version": run.version},
            )
