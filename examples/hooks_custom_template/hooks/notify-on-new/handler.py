"""工作区自定义钩子的最小示例。

复制整个 ``hooks/notify-on-new/`` 目录到你自己工作区的 ``hooks/`` 下面就能生效——
``discover_hooks(workspace_dir)`` 会扫 ``<workspace>/hooks/*/``，认的是同时存在
``HOOK.yaml`` 和 ``handler.py`` 的目录。

约定：
- ``HOOK.yaml`` 里的 ``export`` 指定本文件里作为入口的函数名（这里是 ``handle``）。
- 入口必须是 async 函数，签名为 ``(event: HookEvent) -> bool | None``。
- 返回 ``False`` 表示否决；对 ``before_tool_call`` / ``before_llm_call`` 这类闸门事件
  会拦下这次调用，并且后面的钩子不再执行。返回 ``True`` 或 ``None`` 表示放行。
- ``HOOK.yaml`` 里的 ``events`` 是 ``"<type>:<action>"`` 列表；只订阅 ``"<type>"``
  就能收到该类型的全部 action。
"""

from __future__ import annotations

import logging

from agenticx.hooks.types import HookEvent

logger = logging.getLogger(__name__)


async def handle(event: HookEvent) -> bool | None:
    # 同一个 handler 可能被多个 action 触发，先按需要挑一下。
    if event.type != "command" or event.action not in {"new", "reset"}:
        return True

    logger.info(
        "[notify-on-new] session %s %s (agent=%s)",
        event.session_key or "<unknown>",
        event.action,
        event.agent_id or "<unknown>",
    )
    return True
