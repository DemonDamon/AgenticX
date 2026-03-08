#!/usr/bin/env python3
"""CLI adapter for AgentRuntime event stream.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, Dict, List

from rich.console import Console

from agenticx.runtime import AgentRuntime, EventType, RuntimeEvent, SyncConfirmGate

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any

console = Console()
MAX_TOOL_ROUNDS = 10


def _ensure_agent_history(session: StudioSession) -> List[Dict[str, Any]]:
    existing = getattr(session, "agent_loop_history", None)
    if isinstance(existing, list):
        return existing
    history: List[Dict[str, Any]] = []
    setattr(session, "agent_loop_history", history)
    return history


def run_agent_loop(session: StudioSession, llm: Any, user_input: str) -> str:
    """Run one turn through AgentRuntime and render events to CLI."""

    async def _run() -> str:
        runtime = AgentRuntime(llm, SyncConfirmGate(), max_tool_rounds=MAX_TOOL_ROUNDS)
        final_text = ""
        trace: List[Dict[str, Any]] = []
        async for event in runtime.run_turn(user_input, session):
            trace.append({"type": event.type, "data": dict(event.data)})
            if event.type == EventType.ROUND_START.value:
                console.print(
                    f"[dim]Agent loop round {event.data.get('round')}/"
                    f"{event.data.get('max_rounds')}...[/dim]"
                )
            elif event.type == EventType.TOOL_CALL.value:
                console.print(f"[cyan]↳ 调用工具:[/cyan] {event.data.get('name', '')}")
            elif event.type == EventType.TOKEN.value:
                text = str(event.data.get("text", ""))
                if text:
                    console.print(text, end="")
            elif event.type == EventType.ERROR.value:
                final_text = str(event.data.get("text", ""))
            elif event.type == EventType.FINAL.value:
                final_text = str(event.data.get("text", ""))
        setattr(session, "last_agent_events", trace)
        _ensure_agent_history(session).append({"user_input": user_input, "events": trace})
        return final_text or "任务已执行，但模型未返回文本结论。请查看上方工具结果后继续。"

    return asyncio.run(_run())
