#!/usr/bin/env python3
"""Hook that tracks active agent runs for skill write freeze.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from agenticx.runtime.hooks import AgentHook
from agenticx.runtime.session_freeze import dec_active, inc_active


class SessionFreezeHook(AgentHook):
    """Increment/decrement active run counter around each agent turn."""

    async def on_agent_start(self, session: Any, agent_id: str, user_input: str) -> None:
        _ = session, agent_id, user_input
        inc_active()

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        _ = final_text, session
        dec_active()
