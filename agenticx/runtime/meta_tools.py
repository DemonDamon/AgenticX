#!/usr/bin/env python3
"""Meta-Agent tools for orchestrating sub-agent teams."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from agenticx.runtime.team_manager import AgentTeamManager


META_AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "spawn_subagent",
            "description": "Spawn one sub-agent worker for a delegated task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Sub-agent display name."},
                    "role": {"type": "string", "description": "Sub-agent role, e.g. coder/researcher/tester."},
                    "task": {"type": "string", "description": "Detailed delegated task for this sub-agent."},
                    "tools": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional allowlist of tool names.",
                    },
                },
                "required": ["name", "role", "task"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_subagent",
            "description": "Cancel a running sub-agent by ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Target sub-agent ID."},
                },
                "required": ["agent_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_subagent_status",
            "description": "Query status for one/all sub-agents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Optional sub-agent ID."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_resources",
            "description": "Inspect current host resource usage before scheduling.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
]


async def dispatch_meta_tool_async(
    name: str,
    arguments: Dict[str, Any],
    *,
    team_manager: AgentTeamManager,
) -> str:
    if name == "spawn_subagent":
        tools = arguments.get("tools")
        tool_list: Optional[List[str]] = None
        if isinstance(tools, list):
            tool_list = [str(item) for item in tools]
        result = await team_manager.spawn_subagent(
            name=str(arguments.get("name", "")).strip(),
            role=str(arguments.get("role", "")).strip(),
            task=str(arguments.get("task", "")).strip(),
            tools=tool_list,
            source_tool_call_id=str(arguments.get("__tool_call_id", "")).strip(),
        )
        return json.dumps(result, ensure_ascii=False)

    if name == "cancel_subagent":
        result = await team_manager.cancel_subagent(str(arguments.get("agent_id", "")).strip())
        return json.dumps(result, ensure_ascii=False)

    if name == "query_subagent_status":
        result = team_manager.get_status(str(arguments.get("agent_id", "")).strip() or None)
        return json.dumps(result, ensure_ascii=False)

    if name == "check_resources":
        active = team_manager.get_status().get("subagents", [])
        running_count = sum(1 for item in active if item.get("status") == "running")
        check = team_manager.resource_monitor.can_spawn(active_subagents=running_count)
        suggestion = (
            "资源充足，可继续并行启动子智能体。"
            if check["allowed"]
            else "资源紧张，建议先等待当前子智能体完成。"
        )
        payload = {"ok": True, "check": check, "suggestion": suggestion}
        return json.dumps(payload, ensure_ascii=False)

    return json.dumps({"ok": False, "error": f"unknown meta tool: {name}"}, ensure_ascii=False)
