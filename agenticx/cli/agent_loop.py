#!/usr/bin/env python3
"""CLI adapter for AgentRuntime event stream.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import os
from typing import TYPE_CHECKING, Any, Dict, List

from rich.console import Console

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime import AgentRuntime, EventType, RuntimeEvent, SyncConfirmGate

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any

console = Console()
_max_rounds_text = str(os.getenv("AGX_MAX_TOOL_ROUNDS", "")).strip()
if not _max_rounds_text:
    try:
        _global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
        _project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
        _merged = ConfigManager._deep_merge(_global_data, _project_data)
        _cfg_val = ConfigManager._get_nested(_merged, "runtime.max_tool_rounds")
    except Exception:
        _cfg_val = None
    if _cfg_val is not None:
        _max_rounds_text = str(_cfg_val).strip()
if not _max_rounds_text:
    _max_rounds_text = "30"
try:
    _max_rounds_raw = int(_max_rounds_text)
except ValueError:
    _max_rounds_raw = 30
MAX_TOOL_ROUNDS = max(10, min(120, _max_rounds_raw))


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
