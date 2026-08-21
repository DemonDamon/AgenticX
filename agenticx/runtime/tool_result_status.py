#!/usr/bin/env python3
"""Classify a tool result payload as ``done`` or ``error``.

工具报错在这个代码库里有三种写法，而 chat_history 的 ``tool_status`` 历史上只认第一种：

1. ``"ERROR: ..."`` 前缀字符串
2. ``{"error": "..."}``            —— ``tool_search`` 少传 ``query`` 走的就是这条
3. ``{"ok": false, "error": "..."}``

认错了不只是图标不对。前端把 ``toolStatus == "error"`` 当作「关键状态」：错误行会
强制展开过程卡、并汇总成「N 个步骤执行失败」。报成 ``done``，失败就会被折叠进
「已完成 N 个步骤」里，用户看不到出过错。

判定取保守的一侧：拿不准就算成功。把成功误报成失败会平白吓人一跳，还会把本该
折叠的过程卡强行展开。

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any

TOOL_STATUS_DONE = "done"
TOOL_STATUS_ERROR = "error"

_ERROR_PREFIX = "ERROR:"


def _payload_is_error(payload: dict[str, Any]) -> bool:
    """True for an error-shaped JSON object."""
    ok = payload.get("ok")
    if ok is False:
        return True
    if ok is True:
        # 显式说了成功就信它，哪怕带了个空的 error 字段。
        return False
    if "error" not in payload:
        return False
    error = payload.get("error")
    if error is None or error is False:
        return False
    if isinstance(error, str):
        return bool(error.strip())
    # 非空的 dict / list / 其它真值都算报错；0 和 "" 不算。
    return bool(error)


def result_is_error(result: Any) -> bool:
    """True when a tool result payload reports failure."""
    if isinstance(result, dict):
        return _payload_is_error(result)

    text = str(result if result is not None else "").strip()
    if not text:
        return False
    if text.startswith(_ERROR_PREFIX):
        return True
    # 只有看着像 JSON 对象才去解析：工具正文里出现一句 "error" 不该算报错。
    if not (text.startswith("{") and text.endswith("}")):
        return False
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return False
    return _payload_is_error(parsed) if isinstance(parsed, dict) else False


def tool_status_for_result(result: Any) -> str:
    """``"error"`` / ``"done"`` for the chat_history ``tool_status`` field."""
    return TOOL_STATUS_ERROR if result_is_error(result) else TOOL_STATUS_DONE
