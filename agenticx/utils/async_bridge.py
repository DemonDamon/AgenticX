"""同步代码调用协程的统一入口。

历史上这件事在代码里有三种写法，其中最常见的一种是坏的：

    asyncio.get_event_loop().run_until_complete(coro)

``asyncio.run()`` 退出时会调用 ``set_event_loop(None)``，此后主线程里的
``get_event_loop()`` 直接抛 ``RuntimeError: There is no current event loop in
thread 'MainThread'``。也就是说，进程里只要有任何一处用过 ``asyncio.run``（CLI 和
studio 到处都是），后面所有这样的同步桥就永久坏掉——而且是在全新解释器里跑单个用例
时看不出来的那种坏法。Python 3.12 起更直接：没有正在运行的循环时 ``get_event_loop()``
本身就抛。

另一种写法（``except RuntimeError: new_event_loop() + set_event_loop()``）能绕过上面
这条，但当前线程已经有循环在跑时，``run_until_complete`` 会抛 "This event loop is
already running"。

``run_sync`` 把两种情况都盖住：没有循环就 ``asyncio.run``；已经在循环里就丢到另一个
线程用它自己的循环跑完再取结果。
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Coroutine, TypeVar

T = TypeVar("T")

__all__ = ["run_sync"]


def run_sync(coro: Coroutine[Any, Any, T]) -> T:
    """跑完 ``coro`` 并返回结果，不管调用方所在线程有没有事件循环。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    # 当前线程正跑着事件循环：不能 run_until_complete（会抛 "already running"）。
    # 协程对象本身不绑定循环，换个线程用新循环跑完全没问题。
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="agx-run-sync") as pool:
        return pool.submit(asyncio.run, coro).result()
