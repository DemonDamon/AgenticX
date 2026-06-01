#!/usr/bin/env python3
"""Smoke tests: proactive compaction persists to session.agent_messages.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from agenticx.runtime.agent_runtime import _sanitize_context_messages
from agenticx.runtime.compactor import ContextCompactor


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("summary: decisions and tool outcomes preserved")


def _build_long_history(n: int) -> List[Dict[str, Any]]:
    return [{"role": "user", "content": f"msg-{i}"} for i in range(n)]


async def _simulate_proactive_compact_turn(
    agent_messages: List[Dict[str, Any]],
    *,
    compactor: ContextCompactor,
    append_after: Dict[str, Any] | None = None,
) -> tuple[bool, int]:
    """Mirror agent_runtime proactive compaction + FR-1 persist."""
    history = _sanitize_context_messages(agent_messages)
    compacted_history, did_compact, _summary, compacted_count, _pending = await compactor.maybe_compact(
        history,
        model="",
    )
    if did_compact:
        agent_messages[:] = list(compacted_history)
    if append_after is not None:
        agent_messages.append(append_after)
    return did_compact, compacted_count


def test_ac1_persisted_compact_skips_next_turn() -> None:
    """AC-1: after first compaction persists, next turn with one new msg does not recompact."""
    compactor = ContextCompactor(_LLM(), threshold_messages=20, retain_recent_messages=8)
    agent_messages = _build_long_history(22)

    did1, count1 = asyncio.run(_simulate_proactive_compact_turn(agent_messages, compactor=compactor))
    assert did1 is True
    assert count1 == 14
    assert len(agent_messages) == 9  # 1 compacted system + 8 retained
    assert "[compacted]" in agent_messages[0]["content"]

    did2, count2 = asyncio.run(
        _simulate_proactive_compact_turn(
            agent_messages,
            compactor=compactor,
            append_after={"role": "assistant", "content": "收到"},
        )
    )
    assert did2 is False
    assert count2 == 0
    assert len(agent_messages) == 10


def test_ac2_rolling_compact_after_enough_new_messages() -> None:
    """AC-2: second compaction only after enough new messages accumulate post-persist."""
    compactor = ContextCompactor(_LLM(), threshold_messages=20, retain_recent_messages=8)
    agent_messages = _build_long_history(22)

    asyncio.run(_simulate_proactive_compact_turn(agent_messages, compactor=compactor))
    assert len(agent_messages) == 9

    # One assistant turn: still below threshold (AC-1).
    asyncio.run(
        _simulate_proactive_compact_turn(
            agent_messages,
            compactor=compactor,
            append_after={"role": "assistant", "content": "收到"},
        )
    )
    assert len(agent_messages) == 10

    # Add 12 more user turns -> 22 total, triggers rolling compaction.
    for i in range(12):
        agent_messages.append({"role": "user", "content": f"follow-up-{i}"})

    did3, count3 = asyncio.run(_simulate_proactive_compact_turn(agent_messages, compactor=compactor))
    assert did3 is True
    assert count3 == 14  # 22 - 8 retained, not 15/16 linear per-turn bump
    assert len(agent_messages) == 9
    assert "[compacted]" in agent_messages[0]["content"]
