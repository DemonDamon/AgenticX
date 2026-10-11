"""Mobile turn-stream hub: 桌面 turn_progress → 订阅该会话的手机 WS 广播。

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class MobileStreamHub:
    """session_id → 已订阅 mobile WS 连接集合。

    全部操作都发生在同一事件循环里（device WS 消费循环与 mobile WS
    端点协程），无并发竞争，不加锁。广播失败的连接就地剔除。
    """

    def __init__(self) -> None:
        self._subs: Dict[str, Set[WebSocket]] = {}

    def subscribe(self, session_id: str, ws: WebSocket) -> None:
        if not session_id:
            return
        self._subs.setdefault(session_id, set()).add(ws)

    def unsubscribe(self, session_id: str, ws: WebSocket) -> None:
        conns = self._subs.get(session_id)
        if conns is None:
            return
        conns.discard(ws)
        if not conns:
            self._subs.pop(session_id, None)

    def subscriber_count(self, session_id: str) -> int:
        return len(self._subs.get(session_id, ()))

    async def broadcast(self, session_id: str, payload: Dict[str, Any]) -> None:
        """向该会话的全部订阅连接推送一帧；失败连接剔除。"""
        conns = list(self._subs.get(session_id, ()))
        if not conns:
            return
        frame = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(frame)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(session_id, ws)
            logger.debug("mobile stream ws dropped (session=%s)", session_id)
