"""run_sync 的回归测试。

守的是这么一个失败模式：``asyncio.get_event_loop().run_until_complete(...)`` 在全新
解释器里是好的，但 ``asyncio.run()`` 退出时会 ``set_event_loop(None)``，此后主线程里
再调 ``get_event_loop()`` 就抛 "There is no current event loop in thread
'MainThread'"。CLI 和 studio 里到处都在用 asyncio.run，所以这些同步桥在真实进程里是
永久坏的——单跑一个用例却看不出来。
"""

from __future__ import annotations

import asyncio
import threading

import pytest

from agenticx.utils.async_bridge import run_sync


async def _answer() -> int:
    await asyncio.sleep(0)
    return 42


def test_raw_get_event_loop_is_broken_after_asyncio_run() -> None:
    """把被修掉的那个前提本身钉住：不是我们臆想出来的失败模式。"""
    asyncio.run(asyncio.sleep(0))
    with pytest.raises(RuntimeError, match="no current event loop"):
        asyncio.get_event_loop()


def test_run_sync_works_after_asyncio_run() -> None:
    asyncio.run(asyncio.sleep(0))
    assert run_sync(_answer()) == 42


def test_run_sync_works_in_a_fresh_thread() -> None:
    """非主线程从来就没有默认循环，get_event_loop() 在那里一直是抛的。"""
    box: dict = {}

    def _worker() -> None:
        try:
            box["value"] = run_sync(_answer())
        except BaseException as exc:  # pragma: no cover - 失败时把原因带出来
            box["error"] = exc

    thread = threading.Thread(target=_worker)
    thread.start()
    thread.join(timeout=10)
    assert "error" not in box, box.get("error")
    assert box["value"] == 42


def test_run_sync_works_from_inside_a_running_loop() -> None:
    """已经在事件循环里时，run_until_complete 会抛 "already running"。"""

    async def _outer() -> int:
        return run_sync(_answer())

    assert asyncio.run(_outer()) == 42


def test_run_sync_propagates_exceptions() -> None:
    async def _boom() -> None:
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        run_sync(_boom())
