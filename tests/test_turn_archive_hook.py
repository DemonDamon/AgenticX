#!/usr/bin/env python3
"""Tests for TurnArchiveHook.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from agenticx.runtime.hooks.turn_archive_hook import TurnArchiveHook


class _FakeSession:
    session_id = "sess-hook"
    bound_avatar_id = "avatar-1"
    chat_history = [
        {"role": "user", "content": "Please explain the ruflo compaction bridge in detail"},
        {"role": "assistant", "content": "It archives each turn before context compaction happens"},
    ]


def test_turn_archive_hook_disabled_does_not_archive() -> None:
    hook = TurnArchiveHook(enabled=False)
    with patch("agenticx.runtime.hooks.turn_archive_hook.asyncio.create_task") as create_task:
        asyncio.run(hook.on_agent_end("done", _FakeSession()))
        create_task.assert_not_called()


def test_turn_archive_hook_enabled_schedules_archive() -> None:
    hook = TurnArchiveHook(enabled=True)
    with patch("agenticx.runtime.hooks.turn_archive_hook.asyncio.create_task") as create_task:
        asyncio.run(hook.on_agent_end("done", _FakeSession()))
        create_task.assert_called_once()
        # MagicMock 不会 await 传进去的协程。不主动关掉，它会在之后随便哪次 GC 时抛
        # "coroutine was never awaited"，并被记在当时碰巧在跑的那个用例头上。
        create_task.call_args.args[0].close()


def test_turn_archive_hook_on_compaction_sets_boost_flag() -> None:
    hook = TurnArchiveHook(enabled=True)
    session = SimpleNamespace()
    asyncio.run(hook.on_compaction(5, "summary", session))
    assert getattr(session, "_recall_boost_pending", False) is True


def test_archive_task_is_kept_alive_until_it_finishes():
    """asyncio 只对运行中的 task 持弱引用。

    create_task 的返回值不留住就可能在跑到一半时被 GC 掉——归档静悄悄地丢了。测试里
    的表现是那个游离 task 活过了用例自己的事件循环，等 GC 时循环已经关掉，抛出
    "Event loop is closed" 的 unraisable 异常，被 pytest 记在当时碰巧在跑的那个用例
    头上（实测这个报错在不同轮次里落到不同文件上）。
    """
    import gc

    asyncio.run(_exercise_archive_task_lifetime(gc))


async def _exercise_archive_task_lifetime(gc) -> None:
    from agenticx.runtime.hooks.turn_archive_hook import TurnArchiveHook

    hook = TurnArchiveHook(enabled=True)
    started = asyncio.Event()
    finished = asyncio.Event()

    async def _slow(*_args, **_kwargs):
        started.set()
        await asyncio.sleep(0.05)
        finished.set()

    hook._archive = _slow  # type: ignore[assignment]

    class _Session:
        session_id = "sess-archive"
        bound_avatar_id = ""
        chat_history = [
            {"role": "user", "content": "问题" * 40},
            {"role": "assistant", "content": "回答" * 40},
        ]

    await hook.on_agent_end("done", _Session())
    await asyncio.wait_for(started.wait(), timeout=1)

    # 任务在飞的时候必须被 hook 强引用着，GC 一轮也不能把它带走。
    assert len(hook._pending) == 1
    gc.collect()
    assert len(hook._pending) == 1

    await asyncio.wait_for(finished.wait(), timeout=1)
    await asyncio.sleep(0)
    # 跑完之后要自己摘掉，不能攒成内存泄漏。
    assert hook._pending == set()
