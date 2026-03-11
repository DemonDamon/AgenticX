#!/usr/bin/env python3
"""Meta-Agent tools for orchestrating sub-agent teams.

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from agenticx.cli.studio_mcp import import_mcp_config, load_available_servers
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.team_manager import AgentTeamManager

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession


META_AGENT_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "todo_write",
            "description": "Update structured task list for current session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": {"type": "string"},
                                "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
                                "active_form": {"type": "string"},
                                "activeForm": {"type": "string"},
                            },
                            "required": ["content", "status"],
                            "additionalProperties": True,
                        },
                    }
                },
                "required": ["items"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scratchpad_write",
            "description": "Write intermediate result to scratchpad.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "value": {"type": "string"},
                },
                "required": ["key", "value"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scratchpad_read",
            "description": "Read one scratchpad key or list keys.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "list_only": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_append",
            "description": "Append note to daily memory or long-term MEMORY.md.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "enum": ["daily", "long_term"]},
                    "content": {"type": "string"},
                },
                "required": ["target", "content"],
                "additionalProperties": False,
            },
        },
    },
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
                    "mode": {"type": "string", "enum": ["run", "session"]},
                    "cleanup": {"type": "string", "enum": ["keep", "delete"]},
                    "run_timeout_seconds": {"type": "integer"},
                    "tools": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional allowlist of tool names.",
                    },
                    "attachments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "content": {"type": "string"},
                            },
                            "required": ["name", "content"],
                            "additionalProperties": False,
                        },
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
            "name": "retry_subagent",
            "description": "Retry a completed/failed sub-agent with optional refined task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Target sub-agent ID."},
                    "task": {
                        "type": "string",
                        "description": "Optional refined task for retry.",
                    },
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
    {
        "type": "function",
        "function": {
            "name": "list_skills",
            "description": "List all available AgenticX skills with name and description.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_mcps",
            "description": "List configured MCP servers and their connection status.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_search",
            "description": "Search indexed workspace memory via fts/semantic/hybrid.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "mode": {"type": "string", "enum": ["fts", "semantic", "hybrid"]},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mcp_import",
            "description": "Import MCP config from external mcp.json into AgenticX workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_path": {"type": "string", "description": "Path to external mcp.json"},
                },
                "required": ["source_path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delegate_to_avatar",
            "description": "Delegate a task to a specific avatar. The avatar will execute in its own workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "avatar_id": {"type": "string", "description": "Target avatar ID."},
                    "task": {"type": "string", "description": "Task description for the avatar."},
                },
                "required": ["avatar_id", "task"],
                "additionalProperties": False,
            },
        },
    },
]


def _list_skills_payload() -> Dict[str, Any]:
    try:
        skills = get_all_skill_summaries()
    except Exception as exc:
        return {"ok": False, "error": f"failed to load skills: {exc}"}
    return {
        "ok": True,
        "count": len(skills),
        "skills": skills,
    }


def _list_mcps_payload(session: Optional["StudioSession"]) -> Dict[str, Any]:
    if session is None:
        return {"ok": True, "count": 0, "connected_count": 0, "servers": []}

    configs = session.mcp_configs if isinstance(session.mcp_configs, dict) else {}
    connected = (
        session.connected_servers
        if isinstance(session.connected_servers, set)
        else set(session.connected_servers or [])
    )
    servers: List[Dict[str, Any]] = []
    for name, cfg in sorted(configs.items()):
        command = str(getattr(cfg, "command", "") or "")
        servers.append(
            {
                "name": str(name),
                "connected": name in connected,
                "command": command,
            }
        )

    return {
        "ok": True,
        "count": len(servers),
        "connected_count": sum(1 for row in servers if row.get("connected")),
        "servers": servers,
    }


async def dispatch_meta_tool_async(
    name: str,
    arguments: Dict[str, Any],
    *,
    team_manager: AgentTeamManager,
    session: Optional["StudioSession"] = None,
) -> str:
    if name == "spawn_subagent":
        tools = arguments.get("tools")
        tool_list: Optional[List[str]] = None
        if isinstance(tools, list):
            tool_list = [str(item) for item in tools]
        timeout_value = None
        raw_timeout = arguments.get("run_timeout_seconds")
        if raw_timeout is not None and str(raw_timeout).strip():
            try:
                timeout_value = int(raw_timeout)
            except Exception:
                timeout_value = None
        result = await team_manager.spawn_subagent(
            name=str(arguments.get("name", "")).strip(),
            role=str(arguments.get("role", "")).strip(),
            task=str(arguments.get("task", "")).strip(),
            tools=tool_list,
            source_tool_call_id=str(arguments.get("__tool_call_id", "")).strip(),
            parent_agent_id=str(arguments.get("__agent_id", "meta") or "meta").strip(),
            mode=str(arguments.get("mode", "")).strip() or None,
            cleanup=str(arguments.get("cleanup", "")).strip() or None,
            run_timeout_seconds=timeout_value,
            attachments=arguments.get("attachments") if isinstance(arguments.get("attachments"), list) else None,
        )
        return json.dumps(result, ensure_ascii=False)

    if name == "cancel_subagent":
        result = await team_manager.cancel_subagent(str(arguments.get("agent_id", "")).strip())
        return json.dumps(result, ensure_ascii=False)

    if name == "retry_subagent":
        task = arguments.get("task")
        refined_task = str(task).strip() if isinstance(task, str) and str(task).strip() else None
        result = await team_manager.retry_subagent(
            str(arguments.get("agent_id", "")).strip(),
            refined_task=refined_task,
        )
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

    if name == "list_skills":
        return json.dumps(_list_skills_payload(), ensure_ascii=False)

    if name == "list_mcps":
        return json.dumps(_list_mcps_payload(session), ensure_ascii=False)

    if name == "mcp_import":
        source_path = str(arguments.get("source_path", "")).strip()
        if not source_path:
            return json.dumps({"ok": False, "error": "missing source_path"}, ensure_ascii=False)
        result = import_mcp_config(source_path)
        if result.get("ok") and session is not None:
            try:
                session.mcp_configs = load_available_servers()
            except Exception:
                pass
        return json.dumps(result, ensure_ascii=False)

    if name == "memory_search":
        query = str(arguments.get("query", "")).strip()
        if not query:
            return json.dumps({"ok": False, "error": "missing query"}, ensure_ascii=False)
        mode = str(arguments.get("mode", "hybrid") or "hybrid").strip().lower()
        try:
            limit = int(arguments.get("limit", 5) or 5)
        except (TypeError, ValueError):
            return json.dumps({"ok": False, "error": "limit must be integer"}, ensure_ascii=False)
        try:
            store = WorkspaceMemoryStore()
            rows = store.search_sync(query=query, mode=mode, limit=max(1, limit))
        except Exception as exc:
            return json.dumps({"ok": False, "error": f"memory search failed: {exc}"}, ensure_ascii=False)
        return json.dumps({"ok": True, "matches": rows}, ensure_ascii=False)

    if name == "delegate_to_avatar":
        avatar_id = str(arguments.get("avatar_id", "")).strip()
        task = str(arguments.get("task", "")).strip()
        if not avatar_id or not task:
            return json.dumps({"ok": False, "error": "avatar_id and task are required"}, ensure_ascii=False)
        from agenticx.avatar.registry import AvatarRegistry
        registry = AvatarRegistry()
        avatar = registry.get_avatar(avatar_id)
        if avatar is None:
            return json.dumps({"ok": False, "error": f"avatar not found: {avatar_id}"}, ensure_ascii=False)
        result = await team_manager.spawn_subagent(
            name=avatar.name,
            role=avatar.role or "delegated avatar",
            task=task,
            source_tool_call_id=str(arguments.get("__tool_call_id", "")).strip(),
        )
        return json.dumps(result, ensure_ascii=False)

    return json.dumps({"ok": False, "error": f"unknown meta tool: {name}"}, ensure_ascii=False)
