#!/usr/bin/env python3
"""Partition tool calls into parallel-safe batches for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Awaitable, Callable, Dict, List, Sequence, TypeVar

from agenticx.cli.agent_tools import studio_tool_is_concurrency_safe

T = TypeVar("T")


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return default


def _tool_call_arguments(function_obj: Dict[str, Any]) -> Dict[str, Any]:
    raw = function_obj.get("arguments")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def partition_tool_calls(
    tool_calls: Sequence[Dict[str, Any]],
) -> List[List[Dict[str, Any]]]:
    """Group consecutive concurrency-safe invocations; unsafe calls are singleton batches."""
    calls = [c for c in tool_calls if isinstance(c, dict)]
    batches: List[List[Dict[str, Any]]] = []
    i = 0
    while i < len(calls):
        call = calls[i]
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = str(fn.get("name", "") or "").strip()
        args = _tool_call_arguments(fn)
        if not studio_tool_is_concurrency_safe(name, args):
            batches.append([call])
            i += 1
            continue
        chunk: List[Dict[str, Any]] = []
        j = i
        while j < len(calls):
            cj = calls[j]
            fj = cj.get("function") if isinstance(cj.get("function"), dict) else {}
            nj = str(fj.get("name", "") or "").strip()
            aj = _tool_call_arguments(fj)
            if not studio_tool_is_concurrency_safe(nj, aj):
                break
            chunk.append(cj)
            j += 1
        batches.append(chunk)
        i = j
    return batches


async def execute_batches(
    batches: Sequence[Sequence[Dict[str, Any]]],
    dispatch_fn: Callable[[Dict[str, Any]], Awaitable[T]],
    *,
    parallel: bool,
    max_concurrency: int | None = None,
) -> List[T]:
    """Run each batch: parallel gather inside batch when ``parallel`` and len>1."""
    limit = max_concurrency if max_concurrency is not None else _env_int("AGX_MAX_TOOL_CONCURRENCY", 8)
    sem = asyncio.Semaphore(limit)
    out: List[T] = []

    async def _guarded(c: Dict[str, Any]) -> T:
        async with sem:
            return await dispatch_fn(c)

    for batch in batches:
        calls = [c for c in batch if isinstance(c, dict)]
        if not calls:
            continue
        if parallel and len(calls) > 1:
            results = await asyncio.gather(*[_guarded(c) for c in calls], return_exceptions=True)
            for res in results:
                if isinstance(res, Exception):
                    raise res
                out.append(res)
        else:
            for c in calls:
                out.append(await _guarded(c))
    return out
