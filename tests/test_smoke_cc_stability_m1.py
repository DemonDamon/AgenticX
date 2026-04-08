#!/usr/bin/env python3
"""Smoke tests: tool batching + parallel dispatch helper (module 1).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time

import pytest

from agenticx.cli.agent_tools import studio_tool_is_concurrency_safe
from agenticx.runtime.tool_orchestrator import execute_batches, partition_tool_calls


def test_partition_groups_consecutive_safe_tools() -> None:
    calls = [
        {"id": "1", "type": "function", "function": {"name": "file_read", "arguments": '{"path":"a"}'}},
        {"id": "2", "type": "function", "function": {"name": "file_read", "arguments": '{"path":"b"}'}},
        {"id": "3", "type": "function", "function": {"name": "file_write", "arguments": '{"path":"c","content":"x"}'}},
    ]
    batches = partition_tool_calls(calls)
    assert len(batches) == 2
    assert len(batches[0]) == 2
    assert len(batches[1]) == 1


def test_studio_tool_bash_read_only_heuristic() -> None:
    assert studio_tool_is_concurrency_safe("file_read", {"path": "/tmp/x"}) is True
    assert studio_tool_is_concurrency_safe("bash_exec", {"command": "ls -la"}) is True
    assert studio_tool_is_concurrency_safe("bash_exec", {"command": "rm -rf /"}) is False


@pytest.mark.asyncio
async def test_execute_batches_gather_parallel() -> None:
    calls = [
        {"id": "1", "function": {"name": "x"}},
        {"id": "2", "function": {"name": "x"}},
    ]

    async def dispatch_fn(c: dict) -> str:
        await asyncio.sleep(0.05)
        return str(c["id"])

    t0 = time.perf_counter()
    out = await execute_batches([calls], dispatch_fn, parallel=True, max_concurrency=8)
    elapsed = time.perf_counter() - t0
    assert out == ["1", "2"]
    assert elapsed < 0.09
