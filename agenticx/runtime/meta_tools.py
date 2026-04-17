#!/usr/bin/env python3
"""Meta-Agent tools for orchestrating sub-agent teams.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import smtplib
import time
import uuid
from email.message import EmailMessage
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING

_meta_log = logging.getLogger(__name__)

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio_mcp import import_mcp_config, load_available_servers
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.provider_fault import is_provider_session_blocked
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.team_manager import AgentTeamManager
from agenticx.workspace.loader import (
    append_daily_memory,
    append_long_term_memory,
    resolve_workspace_dir,
)

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession

# Set each /api/chat turn by Studio from ChatRequest.meta_leader_display_name (default Machi).
META_LEADER_LABEL_SCRATCH_KEY = "__meta_leader_display_name__"
_DEFAULT_META_PRODUCT_LABEL = "Machi"

TASK_CATEGORIES: Dict[str, str] = {
    "visual": "Visual/UI/frontend focused tasks",
    "deep": "Deep research or long-horizon execution tasks",
    "quick": "Simple, single-file, low-complexity tasks",
    "architect": "System design and architecture decision tasks",
}

CATEGORY_MODEL_HINTS: Dict[str, List[str]] = {
    "visual": ["vision", "vl", "4o", "sonnet", "gemini"],
    "deep": ["opus", "o1", "deepseek", "r1", "reason"],
    "quick": ["haiku", "mini", "flash", "small", "lite"],
    "architect": ["opus", "o1", "gpt-5", "reason", "architect"],
}


def _meta_display_name_for_delegation(session: Any, scratchpad: Dict[str, Any]) -> str:
    direct = str(getattr(session, "meta_leader_display_name", None) or "").strip()
    if direct:
        return direct
    raw = scratchpad.get(META_LEADER_LABEL_SCRATCH_KEY)
    if isinstance(raw, str):
        s = raw.strip()
        if s:
            return s
    return _DEFAULT_META_PRODUCT_LABEL


def _clone_taskspaces(session: Any) -> list[dict[str, Any]]:
    taskspaces = getattr(session, "taskspaces", None)
    if not isinstance(taskspaces, list):
        return []
    cloned: list[dict[str, Any]] = []
    for item in taskspaces:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path", "")).strip()
        if not path:
            continue
        cloned.append(dict(item))
    return cloned


def _collect_path_hints(session: Any) -> list[str]:
    hints: list[str] = []
    seen: set[str] = set()

    def _add(raw: str) -> None:
        text = str(raw or "").strip()
        if not text:
            return
        try:
            resolved = str(Path(text).expanduser().resolve(strict=False))
        except Exception:
            resolved = text
        if resolved in seen:
            return
        seen.add(resolved)
        hints.append(resolved)

    for item in _clone_taskspaces(session):
        _add(item.get("path", ""))

    context_files = getattr(session, "context_files", None)
    if isinstance(context_files, dict):
        for raw_path in context_files.keys():
            _add(str(raw_path))

    return hints


_META_ONLY_TOOLS: List[Dict[str, Any]] = [
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
            "description": (
                "Persist a fact to workspace memory so it survives across sessions. "
                "Use 'daily' for transient session outcomes; use 'long_term' for user preferences, "
                "important URLs, recurring instructions, or anything the user explicitly asks to remember. "
                "Content should be a concise, self-contained note (not raw conversation text)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "enum": ["daily", "long_term"],
                        "description": "daily = today's session log; long_term = persistent MEMORY.md anchors.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Concise fact to persist. Include key details (URLs, paths, names).",
                    },
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
                    "category": {
                        "type": "string",
                        "enum": ["visual", "deep", "quick", "architect"],
                        "description": "Optional task category used for model routing when provider/model are omitted.",
                    },
                    "mode": {"type": "string", "enum": ["run", "session"]},
                    "cleanup": {"type": "string", "enum": ["keep", "delete"]},
                    "run_timeout_seconds": {
                        "type": "integer",
                        "description": (
                            "Wall-clock cap for the whole sub-agent run. "
                            "Use 900–1800 for multi-step coding + bash + file tools; "
                            "values below the runtime floor are raised automatically (default floor 600s, env AGX_SUBAGENT_MIN_RUN_TIMEOUT_SECONDS)."
                        ),
                    },
                    "provider": {"type": "string", "description": "Optional provider override for this sub-agent."},
                    "model": {"type": "string", "description": "Optional model override for this sub-agent."},
                    "workspace_dir": {"type": "string", "description": "Optional workspace override for this sub-agent."},
                    "system_prompt": {"type": "string", "description": "Optional persona/system prompt for this sub-agent."},
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
            "description": "Cancel a running sub-agent by ID or avatar name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Sub-agent ID or avatar name."},
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
                    "agent_id": {"type": "string", "description": "Sub-agent ID or avatar name."},
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
            "description": "Query status for one/all sub-agents. Supports agent_id, avatar name, or avatar_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Sub-agent ID, avatar name, or avatar ID."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_message_to_agent",
            "description": (
                "Send a follow-up instruction to a running or completed sub-agent or delegation (sa-* or dlg-*). "
                "Use the agent_id returned by spawn_subagent or delegate_to_avatar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string", "description": "Sub-agent ID (sa-*) or delegation ID (dlg-*)."},
                    "message": {"type": "string", "description": "Follow-up instruction for the agent."},
                },
                "required": ["agent_id", "message"],
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
            "name": "recommend_subagent_model",
            "description": "Recommend a model for a delegated sub-agent task based on complexity and configured providers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Delegated task description."},
                    "role": {"type": "string", "description": "Optional role, e.g. coder/researcher/tester."},
                },
                "required": ["task"],
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
                "properties": {
                    "reload": {
                        "type": "boolean",
                        "description": "Whether to reload MCP configs from disk before listing (default: true).",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_taskspace",
            "description": "Set or add a taskspace path for current session. The path will be registered after current turn.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute directory path."},
                    "label": {"type": "string", "description": "Optional display alias for this taskspace."},
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_bug_report_email",
            "description": "Send bug report email using user-configured SMTP settings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "description": "Email subject."},
                    "bug_summary": {"type": "string", "description": "One-paragraph bug summary."},
                    "bug_context": {"type": "string", "description": "Detailed bug context, logs, and repro info."},
                    "to_email": {
                        "type": "string",
                        "description": "Recipient email. Defaults to configured default recipient or AgenticX team address.",
                    },
                    "include_recent_chat": {
                        "type": "boolean",
                        "description": "Whether to append recent user/assistant chat context.",
                    },
                },
                "required": ["bug_summary", "bug_context"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_email_config",
            "description": "Safely update notifications.email.* config with strict allowlist validation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"},
                    "smtp_host": {"type": "string"},
                    "smtp_port": {"type": "integer"},
                    "smtp_username": {"type": "string"},
                    "smtp_password": {"type": "string"},
                    "smtp_use_tls": {"type": "boolean"},
                    "from_email": {"type": "string"},
                    "default_to_email": {"type": "string"},
                },
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
                    "category": {
                        "type": "string",
                        "enum": ["visual", "deep", "quick", "architect"],
                        "description": "Optional task category hint for selecting fallback model.",
                    },
                },
                "required": ["avatar_id", "task"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_avatar_workspace",
            "description": "Read files from avatar workspace without spawning sub-agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "avatar_id": {"type": "string", "description": "Target avatar ID."},
                    "files": {
                        "type": "array",
                        "description": "Optional relative file paths in avatar workspace.",
                        "items": {"type": "string"},
                    },
                },
                "required": ["avatar_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "chat_with_avatar",
            "description": "Send an internal question to an avatar and return its reply.",
            "parameters": {
                "type": "object",
                "properties": {
                    "avatar_id": {"type": "string", "description": "Target avatar ID."},
                    "message": {"type": "string", "description": "Question sent to avatar."},
                    "relay_mode": {
                        "type": "string",
                        "enum": ["verbatim", "summary"],
                        "description": "How the meta-agent should relay this reply to user.",
                    },
                },
                "required": ["avatar_id", "message"],
                "additionalProperties": False,
            },
        },
    },
]

_studio_tool_names = {
    t.get("function", {}).get("name") for t in STUDIO_TOOLS if isinstance(t, dict)
}
_meta_only_names = {
    t.get("function", {}).get("name") for t in _META_ONLY_TOOLS if isinstance(t, dict)
} - _studio_tool_names
META_AGENT_TOOLS: List[Dict[str, Any]] = list(STUDIO_TOOLS) + [
    t for t in _META_ONLY_TOOLS
    if t.get("function", {}).get("name") not in _studio_tool_names
]

_DEFAULT_AVATAR_WS_FILES: List[str] = ["IDENTITY.md", "MEMORY.md", "memory/today"]


def _collapse_text(text: str) -> str:
    return " ".join(str(text or "").split())


def _safe_read_text(path: Path, *, limit: int = 3000) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            raw = fh.read(limit + 1)
    except FileNotFoundError:
        return {"ok": True, "exists": False, "content": "", "truncated": False}
    except Exception as exc:
        return {"ok": False, "exists": False, "content": "", "truncated": False, "error": str(exc)}
    truncated = len(raw) > limit
    content = raw[:limit] if truncated else raw
    return {"ok": True, "exists": True, "content": content, "truncated": truncated}


def _resolve_workspace_file_specs(requested_files: Any) -> List[str]:
    if isinstance(requested_files, list):
        specs = [str(item or "").strip() for item in requested_files if str(item or "").strip()]
        return specs or list(_DEFAULT_AVATAR_WS_FILES)
    return list(_DEFAULT_AVATAR_WS_FILES)


def _expand_workspace_specs(specs: List[str]) -> List[str]:
    expanded: List[str] = []
    seen: set[str] = set()
    today = datetime.now().date()
    recent_days = [(today - timedelta(days=offset)).isoformat() for offset in range(0, 3)]
    for spec in specs:
        if spec == "memory/today":
            for date_text in recent_days:
                rel = f"memory/{date_text}.md"
                if rel not in seen:
                    seen.add(rel)
                    expanded.append(rel)
            continue
        if spec not in seen:
            seen.add(spec)
            expanded.append(spec)
    return expanded


def _read_avatar_workspace_payload(avatar_id: str, requested_files: Any) -> Dict[str, Any]:
    from agenticx.avatar.registry import AvatarRegistry

    registry = AvatarRegistry()
    avatar = registry.get_avatar(avatar_id)
    if avatar is None:
        return {"ok": False, "error": f"avatar not found: {avatar_id}"}
    workspace_dir = str(avatar.workspace_dir or "").strip()
    if not workspace_dir:
        return {"ok": False, "error": f"avatar workspace not configured: {avatar_id}"}
    workspace_root = Path(workspace_dir).expanduser().resolve(strict=False)
    specs = _expand_workspace_specs(_resolve_workspace_file_specs(requested_files))
    rows: List[Dict[str, Any]] = []
    for rel in specs[:20]:
        if not rel or rel.startswith("/") or ".." in Path(rel).parts:
            rows.append({"path": rel, "ok": False, "error": "invalid relative path"})
            continue
        target = (workspace_root / rel).resolve(strict=False)
        try:
            target.relative_to(workspace_root)
        except Exception:
            rows.append({"path": rel, "ok": False, "error": "path escapes avatar workspace"})
            continue
        payload = _safe_read_text(target)
        rows.append({"path": rel, **payload})
    return {
        "ok": True,
        "avatar": {
            "id": avatar.id,
            "name": avatar.name,
            "role": avatar.role or "",
        },
        "workspace_dir": str(workspace_root),
        "files": rows,
    }


def _load_avatar_recent_chat_messages(avatar_id: str, *, limit: int = 8) -> Dict[str, Any]:
    from agenticx.memory.session_store import SessionStore

    store = SessionStore()
    try:
        sessions = store._list_latest_sessions_sync(limit=200)
    except Exception:
        sessions = []
    candidates: List[Dict[str, Any]] = []
    for row in sessions:
        metadata = row.get("metadata", {})
        if not isinstance(metadata, dict):
            continue
        if str(metadata.get("avatar_id", "")).strip() != avatar_id:
            continue
        if bool(metadata.get("archived", False)):
            continue
        session_id = str(row.get("session_id", "")).strip()
        if not session_id:
            continue
        updated_at = metadata.get("updated_at") or metadata.get("created_at") or 0
        try:
            sort_key = float(updated_at)
        except (TypeError, ValueError):
            sort_key = 0.0
        candidates.append({"session_id": session_id, "sort_key": sort_key})
    if not candidates:
        return {"session_id": "", "messages": []}
    candidates.sort(key=lambda item: float(item.get("sort_key", 0)), reverse=True)
    chosen_id = str(candidates[0].get("session_id", "")).strip()
    if not chosen_id:
        return {"session_id": "", "messages": []}
    messages_path = Path.home() / ".agenticx" / "sessions" / chosen_id / "messages.json"
    try:
        data = json.loads(messages_path.read_text(encoding="utf-8"))
    except Exception:
        return {"session_id": chosen_id, "messages": []}
    if not isinstance(data, list):
        return {"session_id": chosen_id, "messages": []}
    normalized: List[Dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip()
        if role not in {"user", "assistant"}:
            continue
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        normalized.append({"role": role, "content": content[:1000]})
    return {"session_id": chosen_id, "messages": normalized[-max(1, limit):]}


async def _chat_with_avatar_payload(
    avatar_id: str,
    message: str,
    *,
    relay_mode: str,
    session: Optional["StudioSession"],
) -> Dict[str, Any]:
    from agenticx.avatar.registry import AvatarRegistry

    registry = AvatarRegistry()
    avatar = registry.get_avatar(avatar_id)
    if avatar is None:
        return {"ok": False, "error": f"avatar not found: {avatar_id}"}

    workspace_payload = _read_avatar_workspace_payload(avatar_id, ["IDENTITY.md", "MEMORY.md"])
    file_lines: List[str] = []
    for item in workspace_payload.get("files", []) if isinstance(workspace_payload, dict) else []:
        if not isinstance(item, dict) or not item.get("exists"):
            continue
        path = str(item.get("path", "")).strip()
        content = str(item.get("content", "")).strip()
        if not path or not content:
            continue
        file_lines.append(f"## {path}\n{content[:1200]}")
    workspace_context = "\n\n".join(file_lines)

    provider_name = str(avatar.default_provider or "").strip() or str(getattr(session, "provider_name", "") or "").strip()
    model_name = str(avatar.default_model or "").strip() or str(getattr(session, "model_name", "") or "").strip()
    if not provider_name or not model_name:
        return {"ok": False, "error": "provider/model not configured for avatar or current session"}

    try:
        llm = ProviderResolver.resolve(provider_name=provider_name, model=model_name)
    except Exception as exc:
        return {"ok": False, "error": f"failed to initialize avatar model: {exc}"}

    recent_chat = await asyncio.to_thread(_load_avatar_recent_chat_messages, avatar_id)
    recent_messages = recent_chat.get("messages", []) if isinstance(recent_chat, dict) else []
    if not isinstance(recent_messages, list):
        recent_messages = []

    system_prompt = (
        f"你是 AgenticX 分身 {avatar.name}。\n"
        f"角色: {avatar.role or 'General Assistant'}\n"
        f"分身系统提示: {avatar.system_prompt or '(none)'}\n"
        "请基于分身身份与记忆回答问题，回答要直接、简洁、可执行。"
    )
    if workspace_context:
        system_prompt += f"\n\n以下是该分身 workspace 的已知信息：\n{workspace_context}"

    llm_messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    llm_messages.extend(recent_messages[-8:])
    llm_messages.append({"role": "user", "content": message})
    try:
        response = await llm.ainvoke(llm_messages)
    except Exception as exc:
        return {"ok": False, "error": f"avatar chat failed: {exc}"}
    raw_reply = str(getattr(response, "content", "") or "").strip()
    if not raw_reply:
        raw_reply = "(empty reply)"
    relay_text = raw_reply if relay_mode == "verbatim" else _collapse_text(raw_reply)[:280]
    return {
        "ok": True,
        "avatar": {
            "id": avatar.id,
            "name": avatar.name,
            "role": avatar.role or "",
        },
        "provider": provider_name,
        "model": model_name,
        "source_session_id": str(recent_chat.get("session_id", "")).strip() if isinstance(recent_chat, dict) else "",
        "relay_mode": relay_mode,
        "reply": raw_reply,
        "relay_text": relay_text,
    }


def _list_skills_payload(session: Optional["StudioSession"] = None) -> Dict[str, Any]:
    try:
        bound = (
            str(getattr(session, "bound_avatar_id", "") or "").strip() or None
            if session is not None
            else None
        )
        skills = get_all_skill_summaries(bound_avatar_id=bound)
    except Exception as exc:
        return {"ok": False, "error": f"failed to load skills: {exc}"}
    return {
        "ok": True,
        "count": len(skills),
        "skills": skills,
    }


def _mcp_tool_names_by_server(session: "StudioSession") -> Dict[str, List[str]]:
    """Routed tool names per MCP server (for mcp_call), only for connected servers."""
    hub = getattr(session, "mcp_hub", None)
    if hub is None or not getattr(hub, "_tool_routing", None):
        return {}
    connected = (
        session.connected_servers
        if isinstance(session.connected_servers, set)
        else set(session.connected_servers or [])
    )
    by_server: Dict[str, List[str]] = {}
    routing = hub._tool_routing
    for routed_name, route in routing.items():
        try:
            srv = route.client.server_config.name
        except Exception:
            continue
        if srv not in connected:
            continue
        by_server.setdefault(str(srv), []).append(str(routed_name))
    for srv in by_server:
        by_server[srv] = sorted(set(by_server[srv]))
    return by_server


def _list_mcps_payload(
    session: Optional["StudioSession"],
    *,
    reload: bool = True,
) -> Dict[str, Any]:
    if session is None:
        return {"ok": True, "count": 0, "connected_count": 0, "servers": []}

    if reload:
        try:
            session.mcp_configs = load_available_servers()
        except Exception as exc:
            _meta_log.warning("list_mcps reload failed: %s", exc)

    configs = session.mcp_configs if isinstance(session.mcp_configs, dict) else {}
    connected = (
        session.connected_servers
        if isinstance(session.connected_servers, set)
        else set(session.connected_servers or [])
    )
    # Keep session connection snapshot coherent when config files changed on disk.
    stale_connected = connected - set(configs.keys())
    if stale_connected and isinstance(session.connected_servers, set):
        session.connected_servers.difference_update(stale_connected)
        connected = set(session.connected_servers)

    tools_by_server = _mcp_tool_names_by_server(session)
    servers: List[Dict[str, Any]] = []
    for name, cfg in sorted(configs.items()):
        command = str(getattr(cfg, "command", "") or "")
        row: Dict[str, Any] = {
            "name": str(name),
            "connected": name in connected,
            "command": command,
        }
        if name in tools_by_server:
            row["mcp_tool_names"] = tools_by_server[name]
        servers.append(row)

    return {
        "ok": True,
        "count": len(servers),
        "connected_count": sum(1 for row in servers if row.get("connected")),
        "servers": servers,
        "hint": (
            "对每个已连接服务器，`mcp_tool_names` 为可用 `mcp_call.tool_name`；"
            "勿编造 list_pages、browse_to、list_tools、web.fetch.* 等名称。"
        ),
    }


def _automation_task_mcp_preflight(
    *,
    session: Optional["StudioSession"],
    instruction: str,
) -> Dict[str, Any]:
    """Run lightweight MCP feasibility checks before persisting a scheduled task."""
    if session is None:
        return {
            "ok": False,
            "reason": "no_session",
            "connected_servers": [],
            "strategy": "",
            "hints": ["schedule_task called without session context"],
        }

    tools_by_server = _mcp_tool_names_by_server(session)
    connected_servers = sorted(tools_by_server.keys())
    firecrawl_tools = set(tools_by_server.get("firecrawl", []))
    basic_tools = set(tools_by_server.get("basic-web-crawler", []))
    instruction_lower = instruction.lower()

    strategy = ""
    hints: List[str] = []

    # Catch the most common misuse from logs: treating firecrawl_scrape as batch API.
    if (
        "firecrawl_scrape" in instruction_lower
        and re.search(r"(批量|urls?\b|url\s*列表|19\s*个|多站点)", instruction_lower, re.IGNORECASE)
    ):
        hints.append("firecrawl_scrape supports single url only; do not pass urls array")

    if "batch_browser_extract" in basic_tools:
        strategy = (
            "Use basic-web-crawler batch_browser_extract for site-list pages first; "
            "then filter items by last 7 days and extract details."
        )
    elif "firecrawl_crawl" in firecrawl_tools:
        strategy = (
            "Use firecrawl_crawl per site list page; collect entries and filter by last 7 days."
        )
    elif "firecrawl_map" in firecrawl_tools and "firecrawl_scrape" in firecrawl_tools:
        strategy = (
            "Use firecrawl_map to discover list links, then iterate firecrawl_scrape with single url."
        )
    elif "firecrawl_scrape" in firecrawl_tools:
        strategy = (
            "Iterate firecrawl_scrape with single url only; no urls array."
        )

    ok = bool(strategy)
    if not ok:
        hints.append(
            "No suitable crawler tool found. Connect firecrawl/basic-web-crawler first."
        )

    return {
        "ok": ok,
        "connected_servers": connected_servers,
        "firecrawl_tools": sorted(firecrawl_tools),
        "basic_web_crawler_tools": sorted(basic_tools),
        "strategy": strategy,
        "hints": hints,
    }


def _augment_automation_instruction_with_contract(
    instruction: str,
    *,
    preflight: Dict[str, Any],
) -> str:
    """Inject a strict execution contract to reduce runtime ask-backs."""
    strategy = str(preflight.get("strategy", "")).strip()
    hints = preflight.get("hints", [])
    if not isinstance(hints, list):
        hints = []
    hint_lines = [f"- {str(h).strip()}" for h in hints if str(h).strip()]
    strategy_line = strategy or "Use connected crawler MCP tools only."
    block_lines = [
        "## Execution Contract (Auto Injected)",
        "- 这是执行任务，不是方案讨论。禁止输出“是否按此方案执行”。",
        "- 禁止把 MCP 工具名当作 bash 命令执行（例如 firecrawl_scrape）。",
        "- mcp_call 参数字段优先使用 arguments；调用前核对目标工具 schema。",
        "- 若某工具参数校验失败，立即按 schema 修正并继续执行；不要向用户追问。",
        f"- Preflight strategy: {strategy_line}",
        "- 时间窗口必须严格限定在最近 7 天，无法解析日期的条目直接丢弃。",
    ]
    if hint_lines:
        block_lines.append("- Preflight hints:")
        block_lines.extend(hint_lines)
    contract = "\n".join(block_lines).strip()
    return f"{contract}\n\n{instruction.strip()}"


def _model_capability_score(provider: str, model: str) -> int:
    text = f"{provider}/{model}".lower()
    score = 50
    strong_tokens = ("gpt-4", "sonnet", "opus", "glm-5", "r1", "max", "pro", "plus", "4.1")
    weak_tokens = ("mini", "nano", "flash", "lite", "small", "tiny")
    for token in strong_tokens:
        if token in text:
            score += 8
    for token in weak_tokens:
        if token in text:
            score -= 7
    return max(10, min(100, score))


def _provider_enabled(provider_cfg: Dict[str, Any]) -> bool:
    """Return True when provider config is enabled (default True)."""
    raw = provider_cfg.get("enabled", True)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        v = raw.strip().lower()
        if v in {"false", "0", "no", "off"}:
            return False
        if v in {"true", "1", "yes", "on"}:
            return True
    if isinstance(raw, (int, float)):
        return bool(raw)
    return True


def _resolve_model_for_category(
    *,
    category: str,
    session: Optional["StudioSession"] = None,
) -> Dict[str, str]:
    """Resolve provider/model using category hints from configured candidates."""
    category_key = str(category or "deep").strip().lower()
    hints = CATEGORY_MODEL_HINTS.get(category_key, [])
    if not hints:
        return {"provider": "", "model": ""}
    candidates: List[Dict[str, str]] = []
    enabled_provider_names: set[str] = set()
    try:
        cfg = ConfigManager.load()
        providers = cfg.providers if isinstance(cfg.providers, dict) else {}
        for provider_name, provider_cfg in providers.items():
            if not isinstance(provider_cfg, dict):
                continue
            if not _provider_enabled(provider_cfg):
                continue
            enabled_provider_names.add(str(provider_name).strip())
            model_name = str(provider_cfg.get("model", "")).strip()
            if not model_name:
                continue
            candidates.append({"provider": str(provider_name).strip(), "model": model_name})
    except Exception:
        candidates = []

    current_provider = str(getattr(session, "provider_name", "") or "").strip()
    current_model = str(getattr(session, "model_name", "") or "").strip()
    if current_provider and current_model and (
        not enabled_provider_names or current_provider in enabled_provider_names
    ):
        exists = any(
            item["provider"] == current_provider and item["model"] == current_model
            for item in candidates
        )
        if not exists:
            candidates.append({"provider": current_provider, "model": current_model})

    best: Dict[str, str] = {"provider": "", "model": ""}
    best_score = -1
    for item in candidates:
        text = f"{item['provider']}/{item['model']}".lower()
        hint_score = sum(1 for hint in hints if hint in text)
        if hint_score <= 0:
            continue
        capability = _model_capability_score(item["provider"], item["model"])
        score = hint_score * 100 + capability
        if score > best_score:
            best_score = score
            best = item
    return best


def _read_email_config() -> Dict[str, Any]:
    cfg = ConfigManager.load()
    raw = cfg.providers if isinstance(cfg.providers, dict) else {}
    # Backward-compatible path via set_value/get_value:
    # notifications.email.*
    email_cfg = ConfigManager.get_value("notifications.email")
    if not isinstance(email_cfg, dict):
        email_cfg = {}
    # Also allow old top-level "email" block.
    legacy_email_cfg = ConfigManager.get_value("email")
    if isinstance(legacy_email_cfg, dict):
        merged = dict(legacy_email_cfg)
        merged.update(email_cfg)
        email_cfg = merged

    raw_port = email_cfg.get("smtp_port", 587)
    try:
        smtp_port = int(raw_port)
    except Exception:
        smtp_port = 587
    if smtp_port <= 0 or smtp_port > 65535:
        smtp_port = 587

    try:
        smtp_use_tls = _normalize_bool(email_cfg.get("smtp_use_tls", True), field="smtp_use_tls")
    except ValueError:
        smtp_use_tls = True
    try:
        enabled = _normalize_bool(email_cfg.get("enabled", True), field="enabled")
    except ValueError:
        enabled = True

    return {
        "smtp_host": str(email_cfg.get("smtp_host", "")).strip(),
        "smtp_port": smtp_port,
        "smtp_username": str(email_cfg.get("smtp_username", "")).strip(),
        "smtp_password": str(email_cfg.get("smtp_password", "")).strip(),
        "smtp_use_tls": smtp_use_tls,
        "from_email": str(email_cfg.get("from_email", "")).strip(),
        "default_to_email": str(email_cfg.get("default_to_email", "bingzhenli@hotmail.com")).strip() or "bingzhenli@hotmail.com",
        "enabled": enabled,
        "providers_count": len(raw),
    }


def _mask_password(secret: str) -> str:
    text = str(secret or "")
    if not text:
        return ""
    if len(text) <= 4:
        return "*" * len(text)
    return f"{text[:2]}{'*' * (len(text) - 4)}{text[-2:]}"


def _normalize_bool(value: Any, *, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    raise ValueError(f"{field} must be a boolean")


def _update_email_config(arguments: Dict[str, Any]) -> Dict[str, Any]:
    allowlist = {
        "enabled",
        "smtp_host",
        "smtp_port",
        "smtp_username",
        "smtp_password",
        "smtp_use_tls",
        "from_email",
        "default_to_email",
    }
    raw_updates = dict(arguments or {})
    updates: Dict[str, Any] = {}
    for key, value in raw_updates.items():
        if key not in allowlist:
            return {"ok": False, "error": "invalid_key", "message": f"非法配置键: {key}"}
        if key in {"enabled", "smtp_use_tls"}:
            try:
                updates[key] = _normalize_bool(value, field=key)
            except ValueError as exc:
                return {"ok": False, "error": "invalid_value", "message": str(exc)}
            continue
        if key == "smtp_port":
            try:
                port = int(value)
            except Exception:
                return {"ok": False, "error": "invalid_value", "message": "smtp_port must be integer"}
            if port <= 0 or port > 65535:
                return {"ok": False, "error": "invalid_value", "message": "smtp_port must be in 1..65535"}
            updates[key] = port
            continue
        updates[key] = str(value or "").strip()

    if not updates:
        return {"ok": False, "error": "empty_update", "message": "未提供可更新字段"}

    for key, value in updates.items():
        ConfigManager.set_value(f"notifications.email.{key}", value)

    current = _read_email_config()
    masked = dict(current)
    masked["smtp_password"] = _mask_password(str(masked.get("smtp_password", "")))
    return {
        "ok": True,
        "message": "邮件配置已更新。",
        "updated_keys": sorted(list(updates.keys())),
        "config": masked,
    }


def _send_bug_report_email(
    *,
    subject: str,
    bug_summary: str,
    bug_context: str,
    to_email: str,
    include_recent_chat: bool,
    session: Optional["StudioSession"],
) -> Dict[str, Any]:
    cfg = _read_email_config()
    if not cfg["enabled"]:
        return {"ok": False, "error": "email_disabled", "message": "邮箱发送功能已在配置中禁用（notifications.email.enabled=false）。"}
    required_keys = ["smtp_host", "smtp_username", "smtp_password", "from_email"]
    missing = [key for key in required_keys if not str(cfg.get(key, "")).strip()]
    if missing:
        return {
            "ok": False,
            "error": "email_not_configured",
            "message": (
                "邮箱配置不完整，请先配置 notifications.email.*。"
                f"缺失字段: {', '.join(missing)}"
            ),
            "required_config_example": {
                "notifications": {
                    "email": {
                        "enabled": True,
                        "smtp_host": "smtp.office365.com",
                        "smtp_port": 587,
                        "smtp_username": "your_email@example.com",
                        "smtp_password": "your_app_password_or_smtp_password",
                        "smtp_use_tls": True,
                        "from_email": "your_email@example.com",
                        "default_to_email": "bingzhenli@hotmail.com",
                    }
                }
            },
        }

    final_subject = subject.strip() if subject and subject.strip() else f"[AgenticX Bug Report] {bug_summary[:60]}"
    recipient = to_email.strip() if to_email and to_email.strip() else str(cfg["default_to_email"])
    provider_name = str(getattr(session, "provider_name", "") or "")
    model_name = str(getattr(session, "model_name", "") or "")
    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    body_parts = [
        f"时间: {now_text}",
        f"来源: AgenticX Meta-Agent",
        f"Provider/Model: {provider_name or '(unknown)'}/{model_name or '(unknown)'}",
        "",
        "## Bug Summary",
        bug_summary.strip(),
        "",
        "## Bug Context",
        bug_context.strip(),
    ]

    if include_recent_chat and session is not None:
        history = list(getattr(session, "chat_history", []) or [])[-12:]
        if history:
            body_parts.append("")
            body_parts.append("## Recent Chat Context")
            for msg in history:
                role = str(msg.get("role", "")).strip() or "unknown"
                content = str(msg.get("content", "")).strip()
                if content:
                    body_parts.append(f"- {role}: {content[:500]}")

    body_text = "\n".join(body_parts).strip()

    message = EmailMessage()
    message["Subject"] = final_subject
    message["From"] = str(cfg["from_email"])
    message["To"] = recipient
    message.set_content(body_text)

    try:
        with smtplib.SMTP(str(cfg["smtp_host"]), int(cfg["smtp_port"]), timeout=30) as smtp:
            if bool(cfg["smtp_use_tls"]):
                smtp.starttls()
            smtp.login(str(cfg["smtp_username"]), str(cfg["smtp_password"]))
            smtp.send_message(message)
    except Exception as exc:
        _meta_log.warning("send_bug_report_email failed: %s", exc)
        return {"ok": False, "error": "email_send_failed", "message": "发送失败，请检查 SMTP 配置与网络连通性。"}

    return {
        "ok": True,
        "message": "邮件发送成功。",
        "to_email": recipient,
        "subject": final_subject,
    }


def _recommend_subagent_model_payload(
    *,
    task: str,
    role: str = "",
    session: Optional["StudioSession"] = None,
) -> Dict[str, Any]:
    task_text = (task or "").strip()
    if not task_text:
        return {"ok": False, "error": "missing task"}

    role_text = (role or "").strip().lower()
    lowered = task_text.lower()
    # Heuristic complexity signals
    hard_patterns = [
        r"架构|重构|多智能体|并发|并行|跨文件|端到端|e2e|性能|优化|安全|迁移|数据库|mcp|生产|部署|回滚|排障|调试",
        r"system|architecture|refactor|migration|security|benchmark|profil|incident|debug",
    ]
    easy_patterns = [
        r"润色|改写|翻译|摘要|总结|文案|小改|微调|格式化",
        r"rewrite|polish|translate|summar|copy|minor|small",
    ]
    hard_hits = sum(len(re.findall(pat, lowered, flags=re.IGNORECASE)) for pat in hard_patterns)
    easy_hits = sum(len(re.findall(pat, lowered, flags=re.IGNORECASE)) for pat in easy_patterns)

    base_score = 30
    len_score = min(len(task_text) // 60, 20)
    role_bonus = 8 if role_text in {"coder", "researcher", "architect", "tester"} else 0
    complexity_score = base_score + len_score + hard_hits * 8 - easy_hits * 6 + role_bonus
    complexity_score = max(0, min(100, complexity_score))
    if complexity_score <= 40:
        level = "low"
    elif complexity_score <= 70:
        level = "medium"
    else:
        level = "high"

    reasons: List[str] = []
    if hard_hits > 0:
        reasons.append(f"检测到 {hard_hits} 个高复杂度信号")
    if easy_hits > 0:
        reasons.append(f"检测到 {easy_hits} 个低复杂度信号")
    if len(task_text) > 400:
        reasons.append("任务描述较长，通常需要更强推理稳定性")
    if role_bonus > 0:
        reasons.append(f"角色={role_text}，通常需要更多工具调用与规划能力")
    if not reasons:
        reasons.append("任务信息有限，按中等复杂度保守评估")

    configured_candidates: List[Dict[str, Any]] = []
    enabled_provider_names: set[str] = set()
    try:
        cfg = ConfigManager.load()
        for provider, provider_cfg in (cfg.providers or {}).items():
            if not isinstance(provider_cfg, dict):
                continue
            if not _provider_enabled(provider_cfg):
                continue
            enabled_provider_names.add(str(provider).strip())
            model_name = str(provider_cfg.get("model", "")).strip()
            if not model_name:
                continue
            configured_candidates.append(
                {
                    "provider": str(provider).strip(),
                    "model": model_name,
                    "score": _model_capability_score(str(provider), model_name),
                }
            )
    except Exception:
        configured_candidates = []

    configured_candidates = [
        item
        for item in configured_candidates
        if not (
            str(item.get("provider", "") or "").strip()
            and is_provider_session_blocked(session, str(item.get("provider", "")))
        )
    ]

    current_provider = str(getattr(session, "provider_name", "") or "").strip()
    current_model = str(getattr(session, "model_name", "") or "").strip()
    current_score = (
        _model_capability_score(current_provider, current_model)
        if current_provider and current_model
        else 0
    )

    all_candidates = list(configured_candidates)
    if current_provider and current_model and (
        not enabled_provider_names or current_provider in enabled_provider_names
    ):
        exists = any(
            item["provider"] == current_provider and item["model"] == current_model
            for item in all_candidates
        )
        if not exists:
            all_candidates.append(
                {
                    "provider": current_provider,
                    "model": current_model,
                    "score": current_score,
                }
            )
    all_candidates.sort(key=lambda item: int(item.get("score", 0)), reverse=True)
    all_candidates = [
        item
        for item in all_candidates
        if not (
            str(item.get("provider", "") or "").strip()
            and is_provider_session_blocked(session, str(item.get("provider", "")))
        )
    ]

    target_score = 40 if level == "low" else (60 if level == "medium" else 75)
    chosen: Optional[Dict[str, Any]] = None
    for item in all_candidates:
        if int(item.get("score", 0)) >= target_score:
            chosen = item
            break
    if chosen is None and all_candidates:
        chosen = all_candidates[0]

    if not all_candidates:
        return {
            "ok": True,
            "complexity": {
                "score": complexity_score,
                "level": level,
                "reasons": reasons[:5],
            },
            "current": {
                "provider": current_provider,
                "model": current_model,
                "score": current_score,
            },
            "recommended": {
                "provider": "",
                "model": "",
                "score": 0,
                "reason": "本会话内全部候选 provider 均因计费/鉴权硬失败被列入临时不可用；请用户检查配置或更换 provider。",
            },
            "alternatives": [],
            "note": "无可推荐模型时请勿 spawn_subagent 到已拉黑 provider。",
        }

    recommendation = {
        "provider": current_provider or "",
        "model": current_model or "",
        "score": current_score,
    }
    rec_reason = "保持当前模型，避免额外切换成本。"
    if chosen is not None:
        recommendation = {
            "provider": str(chosen.get("provider", "")),
            "model": str(chosen.get("model", "")),
            "score": int(chosen.get("score", 0)),
        }
        if recommendation["provider"] == current_provider and recommendation["model"] == current_model:
            rec_reason = "当前会话模型已满足该任务复杂度。"
        else:
            rec_reason = "推荐切换到能力更匹配的模型以提升子智能体稳定性。"

    alternatives: List[Dict[str, Any]] = []
    for item in all_candidates[:5]:
        alternatives.append(
            {
                "provider": str(item.get("provider", "")),
                "model": str(item.get("model", "")),
                "score": int(item.get("score", 0)),
            }
        )

    return {
        "ok": True,
        "complexity": {
            "score": complexity_score,
            "level": level,
            "reasons": reasons[:5],
        },
        "current": {
            "provider": current_provider,
            "model": current_model,
            "score": current_score,
        },
        "recommended": {
            **recommendation,
            "reason": rec_reason,
        },
        "alternatives": alternatives,
        "note": "可在 spawn_subagent 中传 provider/model 来按推荐模型启动该子智能体。",
    }


def _find_or_create_avatar_session(
    session_manager: Any,
    avatar_id: str,
    avatar_config: Any,
) -> Any:
    """Find active avatar session, or create one using avatar defaults."""
    target_id = str(avatar_id or "").strip()
    if not target_id:
        raise ValueError("avatar_id is required")

    sessions_dict = getattr(session_manager, "_sessions", None) or {}
    best = None
    best_updated = 0.0
    for managed in sessions_dict.values():
        if getattr(managed, "archived", False):
            continue
        if str(getattr(managed, "avatar_id", "")).strip() != target_id:
            continue
        updated = float(getattr(managed, "updated_at", 0) or 0)
        if best is None or updated > best_updated:
            best = managed
            best_updated = updated
    if best is not None:
        return best

    try:
        rows = session_manager.list_sessions(avatar_id=target_id)
    except Exception:
        rows = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict) or row.get("archived"):
                continue
            sid = str(row.get("session_id", "")).strip()
            if not sid:
                continue
            managed = session_manager.get(sid, touch=False)
            if managed is not None:
                return managed

    provider_name = str(getattr(avatar_config, "default_provider", "") or "").strip() or None
    model_name = str(getattr(avatar_config, "default_model", "") or "").strip() or None
    managed = session_manager.create(provider=provider_name, model=model_name)
    managed.avatar_id = target_id
    managed.avatar_name = str(getattr(avatar_config, "name", "") or "").strip() or target_id
    managed.session_name = managed.avatar_name
    managed.updated_at = time.time()

    session = managed.studio_session
    if provider_name:
        session.provider_name = provider_name
    if model_name:
        session.model_name = model_name
    workspace_dir = str(getattr(avatar_config, "workspace_dir", "") or "").strip()
    if workspace_dir:
        session.workspace_dir = workspace_dir
    setattr(session, "_session_manager", session_manager)
    setattr(session, "_owner_session_id", managed.session_id)
    session_manager.persist(managed.session_id)
    return managed


def _extract_recent_assistant_text(session: Any) -> str:
    chat_history = getattr(session, "chat_history", None) or []
    for msg in reversed(chat_history):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role", "")).strip() != "assistant":
            continue
        content = str(msg.get("content", "")).strip()
        if content:
            return content
    return ""


async def _run_delegation_in_avatar_session(
    *,
    avatar_managed: Any,
    avatar_config: Any,
    task: str,
    meta_scratchpad: Dict[str, Any],
    delegation_id: str,
    session_manager: Any,
    cancel_event: asyncio.Event,
    meta_team_manager: Optional[AgentTeamManager] = None,
    fallback_provider: Optional[str] = None,
    fallback_model: Optional[str] = None,
    meta_display_name: str = _DEFAULT_META_PRODUCT_LABEL,
    source_session: Optional[Any] = None,
) -> None:
    from agenticx.runtime.agent_runtime import AgentRuntime
    from agenticx.runtime.events import EventType, RuntimeEvent

    avatar_session = avatar_managed.studio_session
    setattr(avatar_session, "_session_manager", session_manager)
    setattr(avatar_session, "_owner_session_id", avatar_managed.session_id)

    workspace_dir = str(getattr(avatar_config, "workspace_dir", "") or "").strip()
    if workspace_dir:
        avatar_session.workspace_dir = workspace_dir
    parent_taskspaces = _clone_taskspaces(source_session)
    if parent_taskspaces:
        setattr(avatar_session, "taskspaces", parent_taskspaces)
    if workspace_dir and isinstance(getattr(avatar_session, "taskspaces", None), list):
        workspace_dir_resolved = str(Path(workspace_dir).expanduser().resolve(strict=False))
        has_workspace = False
        for item in avatar_session.taskspaces:
            if not isinstance(item, dict):
                continue
            item_path = str(item.get("path", "")).strip()
            if not item_path:
                continue
            try:
                item_path = str(Path(item_path).expanduser().resolve(strict=False))
            except Exception:
                pass
            if item_path == workspace_dir_resolved:
                has_workspace = True
                break
        if not has_workspace:
            avatar_session.taskspaces.append(
                {"id": "avatar-workspace", "label": "avatar-workspace", "path": workspace_dir_resolved}
            )
    if isinstance(getattr(avatar_session, "taskspaces", None), list):
        avatar_managed.taskspaces = list(avatar_session.taskspaces)
    parent_context_files = getattr(source_session, "context_files", None)
    if isinstance(parent_context_files, dict) and parent_context_files:
        avatar_session.context_files.update(dict(parent_context_files))

    provider_name = (
        str(getattr(avatar_config, "default_provider", "") or "").strip()
        or str(getattr(avatar_session, "provider_name", "") or "").strip()
        or (fallback_provider or "").strip()
    )
    model_name = (
        str(getattr(avatar_config, "default_model", "") or "").strip()
        or str(getattr(avatar_session, "model_name", "") or "").strip()
        or (fallback_model or "").strip()
    )
    if not provider_name or not model_name:
        raise RuntimeError("avatar provider/model not configured")

    llm = ProviderResolver.resolve(provider_name=provider_name, model=model_name)
    avatar_session.provider_name = provider_name
    avatar_session.model_name = model_name

    team_manager = avatar_managed.get_or_create_team(
        llm_factory=lambda: ProviderResolver.resolve(provider_name=provider_name, model=model_name),
        event_emitter=None,
        summary_sink=None,
    )
    setattr(avatar_session, "_team_manager", team_manager)

    runtime = AgentRuntime(
        llm,
        avatar_managed.get_confirm_gate("meta"),
        team_manager=team_manager,
    )
    avatar_name = str(getattr(avatar_config, "name", "") or "").strip() or str(getattr(avatar_managed, "avatar_name", "") or "").strip()
    avatar_role = str(getattr(avatar_config, "role", "") or "").strip()
    avatar_sys_prompt = str(getattr(avatar_config, "system_prompt", "") or "").strip()
    avatar_context = {
        "name": avatar_name,
        "role": avatar_role,
        "system_prompt": avatar_sys_prompt,
    }

    workspace_hint = str(getattr(avatar_session, "workspace_dir", "") or "").strip()
    delegation_system_prompt = (
        f"你是 AgenticX 分身 **{avatar_name}**。\n"
        f"角色: {avatar_role or 'General Assistant'}\n"
    )
    if avatar_sys_prompt:
        delegation_system_prompt += f"分身自定义指令: {avatar_sys_prompt}\n"
    delegation_system_prompt += (
        "\n## 核心规则\n"
        "- 你是一个执行型 agent，优先亲自动手完成任务。\n"
        "- 如果委派任务复杂需要拆分，可以使用 `spawn_subagent` 创建临时子智能体帮忙。\n"
        f"- **严禁创建与自己同名（{avatar_name}）的子智能体**。子智能体必须用不同的名字（如 '{avatar_name}-researcher'、'{avatar_name}-coder' 等）。\n"
        "- 禁止调用 `delegate_to_avatar`（那是 Meta-Agent 专属工具）。\n"
        "- 可以用 `query_subagent_status` 查询自己创建的子智能体进度。\n"
        "- 回复使用中文，简洁务实。\n\n"
        "## 回复要求\n"
        "- 优先动手执行，不要反复确认。\n"
        "- 边做边汇报，每完成一步简要说明。\n"
        "- 完成后给出结构化总结。\n"
    )
    if workspace_hint:
        delegation_system_prompt += f"\n## 工作目录\n- {workspace_hint}\n"

    running_info: Dict[str, Any] = {
        "delegation_id": delegation_id,
        "task": task,
        "status": "running",
        "delegation_system_prompt": delegation_system_prompt,
        "avatar_session_id": avatar_managed.session_id,
    }
    prev_info = getattr(avatar_managed, "_delegation_info", None)
    if isinstance(prev_info, dict):
        running_info = {**prev_info, **running_info}
    setattr(avatar_managed, "_delegation_info", running_info)

    delegated_input = f"[委派任务] 来自「{meta_display_name}」:\n{task}"
    path_hints = _collect_path_hints(source_session)
    if path_hints:
        hint_lines = "\n".join(f"- {path}" for path in path_hints[:20])
        delegated_input += (
            "\n\n[可用绝对路径提示]\n"
            "用户可能通过 @ 引用了文件。若需要读文件，请优先使用下列绝对路径或其子路径，不要退回到分身默认目录猜测路径：\n"
            f"{hint_lines}"
        )
    final_text = ""
    error_text = ""
    status = "running"

    async def _should_stop() -> bool:
        return bool(cancel_event.is_set())

    last_persist_at = time.time()
    persist_interval = 5.0

    try:
        async for event in runtime.run_turn(
            delegated_input,
            avatar_session,
            should_stop=_should_stop,
            agent_id=delegation_id,
            tools=[t for t in META_AGENT_TOOLS if t.get("function", {}).get("name") != "delegate_to_avatar"],
            system_prompt=delegation_system_prompt,
        ):
            if event.type == EventType.FINAL.value:
                final_text = str(event.data.get("text", "")).strip()
            elif event.type == EventType.ERROR.value:
                error_text = str(event.data.get("text", "")).strip()
            now = time.time()
            if now - last_persist_at >= persist_interval:
                try:
                    session_manager.persist(avatar_managed.session_id)
                except Exception:
                    pass
                last_persist_at = now
        summary = final_text or _extract_recent_assistant_text(avatar_session) or "任务执行完成（无文本输出）"
        if error_text and not final_text:
            status = "failed"
        elif cancel_event.is_set():
            status = "cancelled"
            if not error_text:
                error_text = "任务已取消"
        else:
            status = "completed"
    except Exception as exc:
        status = "failed"
        error_text = str(exc)
        summary = ""

    if status == "failed":
        summary = summary if "summary" in locals() else ""
        if not summary:
            summary = f"委派执行失败: {error_text or '未知错误'}"
    elif status == "cancelled":
        summary = summary if "summary" in locals() else ""
        if not summary:
            summary = "委派任务已取消"

    result_text = (
        f"[{avatar_context['name']}] 状态={status}, "
        f"摘要: {(summary or '(无)')[:500]}"
    )
    if error_text and status != "completed":
        result_text += f", 错误: {error_text[:300]}"
    meta_scratchpad[f"delegation_result::{delegation_id}"] = result_text
    # Keep backward-compatible fallback channel for status aggregation.
    meta_scratchpad[f"subagent_result::{delegation_id}"] = result_text

    pending_reports = meta_scratchpad.get("__pending_subagent_summaries__", [])
    if not isinstance(pending_reports, list):
        pending_reports = []
    pending_reports.append(
        f"[delegation_summary] [{avatar_context['name']}] (ID: {delegation_id}) 状态={status}\n{summary}"
    )
    meta_scratchpad["__pending_subagent_summaries__"] = pending_reports[-50:]

    info = getattr(avatar_managed, "_delegation_info", None)
    if not isinstance(info, dict):
        info = {}
    info.update(
        {
            "delegation_id": delegation_id,
            "task": task,
            "status": status,
            "summary": summary,
            "error": error_text,
            "avatar_session_id": avatar_managed.session_id,
            "completed_at": time.time(),
            "delegation_system_prompt": delegation_system_prompt,
        }
    )
    setattr(avatar_managed, "_delegation_info", info)
    avatar_managed.updated_at = time.time()

    if meta_team_manager is not None:
        event_type = EventType.SUBAGENT_COMPLETED.value if status == "completed" else EventType.SUBAGENT_ERROR.value
        event_payload: Dict[str, Any] = {
            "agent_id": delegation_id,
            "name": avatar_context["name"] or delegation_id,
            "status": status,
            "summary": summary,
            "text": error_text or summary,
            "delegation": True,
            "avatar_id": str(getattr(avatar_config, "id", "") or ""),
            "avatar_session_id": avatar_managed.session_id,
        }
        try:
            await meta_team_manager._emit(
                RuntimeEvent(
                    type=event_type,
                    data=event_payload,
                    agent_id="meta",
                )
            )
        except Exception:
            _meta_log.debug("emit delegation terminal event failed", exc_info=True)

    session_manager.persist(avatar_managed.session_id)


async def _run_delegation_followup_turn(
    *,
    avatar_managed: Any,
    delegation_id: str,
    user_message: str,
    delegation_system_prompt: str,
    session_manager: Any,
    meta_team_manager: Optional[AgentTeamManager],
    meta_scratchpad: Dict[str, Any],
) -> None:
    """Resume a completed delegation with a new user message on the avatar session."""
    from agenticx.runtime.agent_runtime import AgentRuntime
    from agenticx.runtime.events import EventType, RuntimeEvent

    avatar_session = avatar_managed.studio_session
    provider_name = str(getattr(avatar_session, "provider_name", "") or "").strip()
    model_name = str(getattr(avatar_session, "model_name", "") or "").strip()
    if not provider_name or not model_name:
        _meta_log.warning("delegation follow-up skipped: missing provider/model")
        return
    llm = ProviderResolver.resolve(provider_name=provider_name, model=model_name)
    team_manager = avatar_managed.get_or_create_team(
        llm_factory=lambda: ProviderResolver.resolve(provider_name=provider_name, model=model_name),
        event_emitter=None,
        summary_sink=None,
    )
    setattr(avatar_session, "_team_manager", team_manager)
    runtime = AgentRuntime(
        llm,
        avatar_managed.get_confirm_gate("meta"),
        team_manager=team_manager,
    )
    final_text = ""
    error_text = ""
    try:
        async for event in runtime.run_turn(
            user_message,
            avatar_session,
            should_stop=lambda: False,
            agent_id=delegation_id,
            tools=[t for t in META_AGENT_TOOLS if t.get("function", {}).get("name") != "delegate_to_avatar"],
            system_prompt=delegation_system_prompt,
        ):
            if event.type == EventType.FINAL.value:
                final_text = str(event.data.get("text", "") or "").strip()
            elif event.type == EventType.ERROR.value:
                error_text = str(event.data.get("text", "") or "").strip()
    except Exception as exc:
        error_text = str(exc)
    summary = final_text or _extract_recent_assistant_text(avatar_session) or "跟进任务完成"
    status = "failed" if error_text and not final_text else "completed"
    info = getattr(avatar_managed, "_delegation_info", None)
    if not isinstance(info, dict):
        info = {}
    info.update(
        {
            "delegation_id": delegation_id,
            "status": status,
            "summary": summary,
            "error": error_text,
            "completed_at": time.time(),
            "delegation_system_prompt": delegation_system_prompt,
        }
    )
    setattr(avatar_managed, "_delegation_info", info)
    avatar_managed.updated_at = time.time()
    meta_scratchpad[f"delegation_result::{delegation_id}"] = (
        f"[follow-up] 状态={status}, 摘要: {summary[:500]}"
    )
    try:
        session_manager.persist(avatar_managed.session_id)
    except Exception:
        pass
    if meta_team_manager is not None:
        try:
            evt_type = (
                EventType.SUBAGENT_COMPLETED.value if status == "completed" else EventType.SUBAGENT_ERROR.value
            )
            await meta_team_manager._emit(
                RuntimeEvent(
                    type=evt_type,
                    data={
                        "agent_id": delegation_id,
                        "status": status,
                        "summary": summary,
                        "text": error_text or summary,
                        "delegation": True,
                        "avatar_session_id": avatar_managed.session_id,
                    },
                    agent_id="meta",
                )
            )
        except Exception:
            _meta_log.debug("emit follow-up delegation event failed", exc_info=True)


async def _send_message_to_delegation(
    agent_id: str,
    message: str,
    *,
    session: Any,
    team_manager: AgentTeamManager,
) -> str:
    sm = getattr(session, "_session_manager", None)
    sessions_dict = getattr(sm, "_sessions", None) if sm is not None else None
    if not isinstance(sessions_dict, dict):
        return json.dumps({"ok": False, "error": "no_session_manager"}, ensure_ascii=False)
    target = None
    needle = agent_id.strip().lower()
    for managed in sessions_dict.values():
        if getattr(managed, "archived", False):
            continue
        info = getattr(managed, "_delegation_info", None)
        if not isinstance(info, dict):
            continue
        did = str(info.get("delegation_id", "")).strip().lower()
        if did != needle:
            continue
        target = managed
        break
    if target is None:
        return json.dumps({"ok": False, "error": "delegation_not_found"}, ensure_ascii=False)
    avatar_session = getattr(target, "studio_session", None)
    info = getattr(target, "_delegation_info", None) or {}
    sys_prompt = str(info.get("delegation_system_prompt", "") or "").strip()
    if avatar_session is None:
        return json.dumps({"ok": False, "error": "no_avatar_session"}, ensure_ascii=False)
    text = message.strip()
    if not text:
        return json.dumps({"ok": False, "error": "empty_message"}, ensure_ascii=False)
    avatar_session.agent_messages.append({"role": "user", "content": text})
    avatar_session.chat_history.append({"role": "user", "content": text})
    existing = getattr(target, "_delegation_task", None)
    if existing is not None and not existing.done():
        return json.dumps({"ok": True, "queued": True, "agent_id": agent_id}, ensure_ascii=False)
    if not sys_prompt:
        return json.dumps({"ok": False, "error": "missing_delegation_prompt"}, ensure_ascii=False)
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        scratch = {}

    async def _resume() -> None:
        await _run_delegation_followup_turn(
            avatar_managed=target,
            delegation_id=agent_id,
            user_message=text,
            delegation_system_prompt=sys_prompt,
            session_manager=sm,
            meta_team_manager=team_manager,
            meta_scratchpad=scratch,
        )

    setattr(target, "_delegation_task", asyncio.create_task(_resume()))
    return json.dumps({"ok": True, "resumed": True, "agent_id": agent_id}, ensure_ascii=False)


def _lookup_avatar_session_status(session_manager: Any, query: str) -> Optional[Dict[str, Any]]:
    """Search SessionManager for an active avatar session matching query (name or avatar_id)."""
    q = query.strip().lower()
    if not q:
        return None
    sessions_dict = getattr(session_manager, "_sessions", None)
    if not sessions_dict:
        return None
    best = None
    best_updated = 0.0
    for sid, managed in sessions_dict.items():
        if getattr(managed, "archived", False):
            continue
        avatar_name = (getattr(managed, "avatar_name", None) or "").strip().lower()
        avatar_id = (getattr(managed, "avatar_id", None) or "").strip().lower()
        delegation_info = getattr(managed, "_delegation_info", None)
        delegation_id = ""
        if isinstance(delegation_info, dict):
            delegation_id = str(delegation_info.get("delegation_id", "")).strip().lower()
        if avatar_name != q and avatar_id != q and delegation_id != q:
            continue
        updated = float(getattr(managed, "updated_at", 0) or 0)
        if best is None or updated > best_updated:
            best = managed
            best_updated = updated
    if best is None:
        return None
    studio_sess = getattr(best, "studio_session", None)
    chat_len = len(getattr(studio_sess, "chat_history", []) or []) if studio_sess else 0
    agent_msgs_len = len(getattr(studio_sess, "agent_messages", []) or []) if studio_sess else 0
    last_messages: List[str] = []
    if studio_sess:
        for msg in reversed(getattr(studio_sess, "chat_history", []) or []):
            content = str(msg.get("content", "")).strip()
            if content and msg.get("role") == "assistant":
                last_messages.append(content[:300])
                if len(last_messages) >= 3:
                    break
    tm = getattr(best, "team_manager", None)
    has_running_tasks = False
    if tm is not None:
        has_running_tasks = any(not t.done() for t in getattr(tm, "_tasks", {}).values())
    delegation_task = getattr(best, "_delegation_task", None)
    delegation_info = getattr(best, "_delegation_info", None)
    has_running_delegation = bool(delegation_task is not None and not delegation_task.done())
    delegation_status = ""
    if isinstance(delegation_info, dict):
        delegation_status = str(delegation_info.get("status", "")).strip().lower()
    is_active = has_running_tasks or has_running_delegation or (time.time() - best_updated < 120)
    status_value = "running" if is_active else "idle"
    if not is_active and delegation_status in {"completed", "failed", "cancelled"}:
        status_value = delegation_status
    task_text = "(avatar independent session)"
    if isinstance(delegation_info, dict):
        task_text = str(delegation_info.get("task", "")).strip() or task_text
    return {
        "agent_id": best.session_id,
        "name": getattr(best, "avatar_name", None) or query,
        "avatar_id": getattr(best, "avatar_id", None) or "",
        "role": "avatar",
        "task": task_text,
        "status": status_value,
        "updated_at": best_updated,
        "chat_messages": chat_len,
        "agent_messages": agent_msgs_len,
        "recent_output": last_messages,
        "delegation_running": has_running_delegation,
        "delegation_info": delegation_info if isinstance(delegation_info, dict) else None,
        "source": "avatar_session_fallback",
    }


async def dispatch_meta_tool_async(
    name: str,
    arguments: Dict[str, Any],
    *,
    team_manager: AgentTeamManager,
    session: Optional["StudioSession"] = None,
) -> str:
    if name == "spawn_subagent":
        spawn_name = str(arguments.get("name", "")).strip()
        if spawn_name and session is not None:
            _own_avatar_name = ""
            _session_manager = getattr(session, "_session_manager", None)
            if _session_manager is not None:
                _owner_sid = str(getattr(session, "_owner_session_id", "") or "").strip()
                if _owner_sid:
                    _own_managed = getattr(_session_manager, "_sessions", {}).get(_owner_sid)
                    if _own_managed is not None:
                        _own_avatar_name = str(getattr(_own_managed, "avatar_name", "") or "").strip()
            if _own_avatar_name and spawn_name.lower() == _own_avatar_name.lower():
                return json.dumps({
                    "ok": False,
                    "error": "self_name_blocked",
                    "message": (
                        f"禁止创建与自己同名（{_own_avatar_name}）的子智能体。"
                        f"请使用不同的名字，如 '{_own_avatar_name}-researcher' 或 '{_own_avatar_name}-coder'。"
                    ),
                }, ensure_ascii=False)
        if spawn_name:
            from agenticx.avatar.registry import AvatarRegistry
            _avatar_registry = AvatarRegistry()
            _all_avatars = _avatar_registry.list_avatars()
            for _av in _all_avatars:
                if spawn_name.lower() in (
                    (_av.name or "").lower(),
                    (_av.id or "").lower(),
                ):
                    _meta_log.warning(
                        "[dispatch] BLOCKED spawn_subagent for registered avatar '%s' (id=%s), redirecting to delegate_to_avatar",
                        spawn_name, _av.id,
                    )
                    return json.dumps({
                        "ok": False,
                        "error": "avatar_exists",
                        "message": (
                            f"'{spawn_name}' 是已注册的数字分身（avatar_id={_av.id}），"
                            f"禁止用 spawn_subagent 创建同名临时智能体。"
                            f"请改用 delegate_to_avatar(avatar_id=\"{_av.id}\", task=\"...\") 来委派任务。"
                        ),
                    }, ensure_ascii=False)
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
        category = str(arguments.get("category", "deep") or "deep").strip().lower()
        requested_provider = str(arguments.get("provider", "")).strip()
        requested_model = str(arguments.get("model", "")).strip()
        if requested_provider and is_provider_session_blocked(session, requested_provider):
            return json.dumps(
                {
                    "ok": False,
                    "error": "provider_session_blocked",
                    "message": (
                        f"Provider「{requested_provider}」在本会话因计费/鉴权硬失败已列入临时不可用，"
                        "请勿重复 spawn。请调用 recommend_subagent_model 或改用其他已配置 provider。"
                    ),
                },
                ensure_ascii=False,
            )
        if not requested_provider and not requested_model:
            routed = _resolve_model_for_category(category=category, session=session)
            requested_provider = routed.get("provider", "")
            requested_model = routed.get("model", "")
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
            provider=requested_provider or None,
            model=requested_model or None,
            workspace_dir=str(arguments.get("workspace_dir", "")).strip() or None,
            system_prompt=str(arguments.get("system_prompt", "")).strip() or None,
        )
        return json.dumps(result, ensure_ascii=False)

    if name == "send_message_to_agent":
        agent_key = str(arguments.get("agent_id", "")).strip()
        msg = str(arguments.get("message", "")).strip()
        if not agent_key or not msg:
            return json.dumps(
                {"ok": False, "error": "missing_fields", "message": "agent_id and message are required"},
                ensure_ascii=False,
            )
        if agent_key.lower().startswith("dlg-"):
            return await _send_message_to_delegation(agent_key, msg, session=session, team_manager=team_manager)
        result = await team_manager.send_message_to_subagent(agent_key, msg)
        return json.dumps(result, ensure_ascii=False)

    if name == "cancel_subagent":
        requested_id = str(arguments.get("agent_id", "")).strip()
        result = await team_manager.cancel_subagent(requested_id)
        if result.get("ok"):
            return json.dumps(result, ensure_ascii=False)
        # Fallback: true delegation task running in avatar real session.
        if requested_id and session is not None:
            sm = getattr(session, "_session_manager", None)
            sessions_dict = getattr(sm, "_sessions", None) if sm is not None else None
            if isinstance(sessions_dict, dict):
                for managed in sessions_dict.values():
                    if getattr(managed, "archived", False):
                        continue
                    info = getattr(managed, "_delegation_info", None)
                    if not isinstance(info, dict):
                        continue
                    delegation_id = str(info.get("delegation_id", "")).strip()
                    if delegation_id != requested_id:
                        continue
                    cancel_evt = getattr(managed, "_delegation_cancel_event", None)
                    if isinstance(cancel_evt, asyncio.Event):
                        cancel_evt.set()
                        info["status"] = "cancelled"
                        info["cancelled_at"] = time.time()
                    return json.dumps(
                        {
                            "ok": True,
                            "agent_id": requested_id,
                            "status": "cancelled",
                            "message": "delegation cancel requested",
                        },
                        ensure_ascii=False,
                    )
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
        requested_id = str(arguments.get("agent_id", "")).strip() or None
        owner_session_id = getattr(team_manager, "owner_session_id", None)
        active_tasks = {tid: (not t.done()) for tid, t in team_manager._tasks.items()}
        agent_keys = list(team_manager._agents.keys())
        archived_keys = list(team_manager._archived_agents.keys())

        # --- Fallback 1: session._team_manager might be a different instance ---
        session_tm = getattr(session, "_team_manager", None) if session else None
        if session_tm is not None and session_tm is not team_manager:
            _meta_log.warning(
                "[dispatch] MISMATCH: tool tm=%s (agents=%s) vs session._tm=%s (agents=%s archived=%s)",
                id(team_manager), agent_keys,
                id(session_tm),
                list(session_tm._agents.keys()),
                list(session_tm._archived_agents.keys()),
            )
            stm_status = session_tm.get_status()
            stm_rows = stm_status.get("subagents", [])
            if stm_rows and not agent_keys and not archived_keys:
                _meta_log.warning("[dispatch] using session._team_manager as primary (has %d agents)", len(stm_rows))
                team_manager = session_tm
                owner_session_id = getattr(team_manager, "owner_session_id", None)
                active_tasks = {tid: (not t.done()) for tid, t in team_manager._tasks.items()}
                agent_keys = list(team_manager._agents.keys())
                archived_keys = list(team_manager._archived_agents.keys())

        _meta_log.info(
            "[dispatch] query_subagent_status: tm=%s agents=%s archived=%s tasks=%s sid=%s",
            id(team_manager),
            list(team_manager._agents.keys()),
            list(team_manager._archived_agents.keys()),
            active_tasks,
            owner_session_id,
        )
        result = team_manager.get_status_with_task_fallback(requested_id)
        if requested_id and not result.get("ok"):
            global_hit = AgentTeamManager.lookup_global_status(
                requested_id,
                session_id=owner_session_id,
            )
            if global_hit is not None:
                _meta_log.warning("[dispatch] fallback global hit for agent_id=%s", requested_id)
                result = {"ok": True, "subagent": global_hit}

        # --- Avatar session fallback ---
        # If still not found, check SessionManager for an active avatar session
        if requested_id and not result.get("ok") and session is not None:
            sm = getattr(session, "_session_manager", None)
            if sm is not None:
                avatar_hit = _lookup_avatar_session_status(sm, requested_id)
                if avatar_hit is not None:
                    _meta_log.info("[dispatch] avatar session fallback hit for '%s'", requested_id)
                    result = {"ok": True, "subagent": avatar_hit}
        if result.get("ok") and requested_id is None:
            rows = result.get("subagents", [])
            if isinstance(rows, list):
                # --- Fallback 2: global registry ---
                if not rows:
                    global_rows = AgentTeamManager.collect_global_statuses(
                        session_id=owner_session_id,
                    )
                    if global_rows:
                        _meta_log.warning("[dispatch] fallback to global statuses, count=%d", len(global_rows))
                        result["subagents"] = global_rows
                        rows = global_rows

                # --- Fallback 3: scratchpad subagent_result:: entries ---
                if not rows and session is not None:
                    scratchpad = getattr(session, "scratchpad", None) or {}
                    synth_rows: List[Dict[str, Any]] = []
                    for key, value in scratchpad.items():
                        if not key.startswith("subagent_result::"):
                            continue
                        agent_id_from_key = key.split("::", 1)[1]
                        synth_rows.append({
                            "agent_id": agent_id_from_key,
                            "name": agent_id_from_key,
                            "status": "completed",
                            "result_summary": str(value)[:500],
                            "source": "scratchpad_fallback",
                        })
                    if synth_rows:
                        _meta_log.warning("[dispatch] fallback to scratchpad, count=%d", len(synth_rows))
                        result["subagents"] = synth_rows
                        rows = synth_rows

                # --- Fallback 4: chat_history summary entries ---
                if not rows and session is not None:
                    chat_history = getattr(session, "chat_history", None) or []
                    summary_rows: List[Dict[str, Any]] = []
                    for msg in reversed(chat_history):
                        content = str(msg.get("content", ""))
                        if not content.startswith("子智能体汇总:"):
                            continue
                        summary_rows.append({
                            "agent_id": "unknown",
                            "name": "子智能体",
                            "status": "completed",
                            "result_summary": content[len("子智能体汇总:"):].strip()[:500],
                            "source": "chat_history_fallback",
                        })
                        if len(summary_rows) >= 10:
                            break
                    if summary_rows:
                        _meta_log.warning("[dispatch] fallback to chat_history summaries, count=%d", len(summary_rows))
                        result["subagents"] = summary_rows
                        rows = summary_rows

                running_tasks = sum(1 for running in active_tasks.values() if running)
                if not rows and running_tasks > 0:
                    _meta_log.error(
                        "[dispatch] BUG: empty status while tasks running. tm=%s sid=%s tasks=%s agents=%s archived=%s",
                        id(team_manager),
                        owner_session_id,
                        active_tasks,
                        list(team_manager._agents.keys()),
                        list(team_manager._archived_agents.keys()),
                    )
                result["summary"] = {
                    "total": len(rows),
                    "running": sum(1 for item in rows if item.get("status") == "running"),
                    "pending": sum(1 for item in rows if item.get("status") == "pending"),
                    "completed": sum(1 for item in rows if item.get("status") == "completed"),
                    "failed": sum(1 for item in rows if item.get("status") == "failed"),
                    "cancelled": sum(1 for item in rows if item.get("status") == "cancelled"),
                }
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

    if name == "recommend_subagent_model":
        payload = _recommend_subagent_model_payload(
            task=str(arguments.get("task", "")).strip(),
            role=str(arguments.get("role", "")).strip(),
            session=session,
        )
        return json.dumps(payload, ensure_ascii=False)

    if name == "list_skills":
        return json.dumps(_list_skills_payload(session), ensure_ascii=False)

    if name == "list_mcps":
        reload = arguments.get("reload", True)
        should_reload = True if reload is None else bool(reload)
        return json.dumps(
            _list_mcps_payload(session, reload=should_reload),
            ensure_ascii=False,
        )

    if name == "set_taskspace":
        raw_path = str(arguments.get("path", "")).strip()
        label = str(arguments.get("label", "")).strip()
        if not raw_path:
            return json.dumps({"ok": False, "error": "missing path"}, ensure_ascii=False)
        if session is None:
            return json.dumps({"ok": False, "error": "session unavailable"}, ensure_ascii=False)
        scratchpad = getattr(session, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            return json.dumps({"ok": False, "error": "session scratchpad unavailable"}, ensure_ascii=False)
        scratchpad["__taskspace_hint__"] = raw_path
        if label:
            scratchpad["__taskspace_label_hint__"] = label
        taskspaces = getattr(session, "taskspaces", None)
        if isinstance(taskspaces, list):
            exists = False
            for item in taskspaces:
                if not isinstance(item, dict):
                    continue
                if str(item.get("path", "")).strip() == raw_path:
                    exists = True
                    break
            if not exists:
                taskspaces.append(
                    {
                        "id": f"hint-{datetime.utcnow().timestamp()}",
                        "label": label or "taskspace",
                        "path": raw_path,
                    }
                )
        return json.dumps(
            {
                "ok": True,
                "path": raw_path,
                "label": label,
                "message": "taskspace request accepted; desktop session will register it immediately.",
            },
            ensure_ascii=False,
        )

    if name == "send_bug_report_email":
        result = _send_bug_report_email(
            subject=str(arguments.get("subject", "") or ""),
            bug_summary=str(arguments.get("bug_summary", "") or "").strip(),
            bug_context=str(arguments.get("bug_context", "") or "").strip(),
            to_email=str(arguments.get("to_email", "") or "").strip(),
            include_recent_chat=bool(arguments.get("include_recent_chat", True)),
            session=session,
        )
        return json.dumps(result, ensure_ascii=False)

    if name == "update_email_config":
        return json.dumps(_update_email_config(arguments), ensure_ascii=False)

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

    if name == "memory_append":
        target = str(arguments.get("target", "daily") or "daily").strip().lower()
        content = str(arguments.get("content", "")).strip()
        if not content:
            return json.dumps({"ok": False, "error": "missing content"}, ensure_ascii=False)
        workspace_dir = resolve_workspace_dir()
        if target == "long_term":
            append_long_term_memory(workspace_dir, content)
        else:
            append_daily_memory(workspace_dir, content)
        try:
            store = WorkspaceMemoryStore()
            store.index_workspace_sync(workspace_dir)
        except Exception:
            pass
        return json.dumps(
            {"ok": True, "target": target, "content": content[:200]},
            ensure_ascii=False,
        )

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
            return json.dumps(
                {
                    "ok": True,
                    "skipped": True,
                    "reason": "missing_args",
                    "message": "delegate_to_avatar skipped: avatar_id and task are required",
                    "suggestion": "For identity questions, answer directly from avatars list; use chat_with_avatar for internal relay chat.",
                },
                ensure_ascii=False,
            )
        from agenticx.avatar.registry import AvatarRegistry
        registry = AvatarRegistry()
        avatar = registry.get_avatar(avatar_id)
        if avatar is None:
            return json.dumps({"ok": False, "error": f"avatar not found: {avatar_id}"}, ensure_ascii=False)

        if session is None:
            return json.dumps({"ok": False, "error": "session unavailable"}, ensure_ascii=False)
        session_manager = getattr(session, "_session_manager", None)
        if session_manager is None:
            return json.dumps({"ok": False, "error": "SessionManager not available"}, ensure_ascii=False)
        scratchpad = getattr(session, "scratchpad", None)
        if not isinstance(scratchpad, dict):
            return json.dumps({"ok": False, "error": "session scratchpad unavailable"}, ensure_ascii=False)

        avatar_managed = _find_or_create_avatar_session(session_manager, avatar_id, avatar)

        existing_task = getattr(avatar_managed, "_delegation_task", None)
        existing_info = getattr(avatar_managed, "_delegation_info", None)
        if existing_task is not None and not existing_task.done():
            existing_dlg_id = ""
            if isinstance(existing_info, dict):
                existing_dlg_id = str(existing_info.get("delegation_id", "")).strip()
            return json.dumps(
                {
                    "ok": True,
                    "delegated": True,
                    "already_running": True,
                    "delegation_id": existing_dlg_id,
                    "avatar_id": avatar_id,
                    "avatar_name": avatar.name,
                    "avatar_session_id": avatar_managed.session_id,
                    "message": f"{avatar.name} 已有一个委派任务正在执行（{existing_dlg_id}），请等待完成后再委派新任务。",
                },
                ensure_ascii=False,
            )

        delegation_id = f"dlg-{uuid.uuid4().hex[:8]}"
        cancel_event = asyncio.Event()
        meta_provider = str(getattr(session, "provider_name", "") or "").strip()
        meta_model = str(getattr(session, "model_name", "") or "").strip()
        if "category" in arguments:
            category = str(arguments.get("category", "deep") or "deep").strip().lower()
            routed = _resolve_model_for_category(category=category, session=session)
            if routed.get("provider") and routed.get("model"):
                meta_provider = str(routed.get("provider", "")).strip()
                meta_model = str(routed.get("model", "")).strip()
        meta_display_name = _meta_display_name_for_delegation(session, scratchpad)

        async def _delegation_wrapper() -> None:
            try:
                await _run_delegation_in_avatar_session(
                    avatar_managed=avatar_managed,
                    avatar_config=avatar,
                    task=task,
                    meta_scratchpad=scratchpad,
                    delegation_id=delegation_id,
                    session_manager=session_manager,
                    cancel_event=cancel_event,
                    meta_team_manager=team_manager,
                    fallback_provider=meta_provider,
                    fallback_model=meta_model,
                    meta_display_name=meta_display_name,
                    source_session=session,
                )
            except Exception as exc:
                _meta_log.error(
                    "[delegation] background task failed for dlg=%s avatar=%s: %s",
                    delegation_id, avatar_id, exc, exc_info=True,
                )
                info = getattr(avatar_managed, "_delegation_info", None)
                if isinstance(info, dict):
                    info["status"] = "failed"
                    info["error"] = str(exc)
                    info["completed_at"] = time.time()
                scratchpad[f"delegation_result::{delegation_id}"] = (
                    f"[{avatar.name}] 状态=failed, 错误: {str(exc)[:500]}"
                )
                try:
                    session_manager.persist(avatar_managed.session_id)
                except Exception:
                    pass

        background_task = asyncio.create_task(_delegation_wrapper())
        setattr(avatar_managed, "_delegation_task", background_task)
        setattr(avatar_managed, "_delegation_cancel_event", cancel_event)
        setattr(
            avatar_managed,
            "_delegation_info",
            {
                "delegation_id": delegation_id,
                "task": task,
                "from_session": str(
                    getattr(session, "_owner_session_id", "")
                    or getattr(team_manager, "owner_session_id", "")
                    or ""
                ).strip(),
                "status": "running",
                "started_at": time.time(),
                "avatar_id": avatar_id,
                "avatar_name": str(avatar.name or ""),
                "avatar_session_id": avatar_managed.session_id,
            },
        )
        avatar_managed.updated_at = time.time()
        session_manager.persist(avatar_managed.session_id)

        from agenticx.runtime.events import EventType, RuntimeEvent

        await team_manager._emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_STARTED.value,
                data={
                    "agent_id": delegation_id,
                    "name": avatar.name,
                    "role": avatar.role or "delegated avatar",
                    "task": task,
                    "delegation": True,
                    "avatar_id": avatar_id,
                    "avatar_session_id": avatar_managed.session_id,
                },
                agent_id="meta",
            )
        )

        return json.dumps(
            {
                "ok": True,
                "delegated": True,
                "delegation_id": delegation_id,
                "agent_id": delegation_id,
                "avatar_id": avatar_id,
                "avatar_name": avatar.name,
                "avatar_session_id": avatar_managed.session_id,
                "task": task,
            },
            ensure_ascii=False,
        )

    if name == "read_avatar_workspace":
        avatar_id = str(arguments.get("avatar_id", "")).strip()
        if not avatar_id:
            return json.dumps({"ok": False, "error": "avatar_id is required"}, ensure_ascii=False)
        payload = _read_avatar_workspace_payload(avatar_id, arguments.get("files"))
        return json.dumps(payload, ensure_ascii=False)

    if name == "chat_with_avatar":
        avatar_id = str(arguments.get("avatar_id", "")).strip()
        message = str(arguments.get("message", "")).strip()
        relay_mode = str(arguments.get("relay_mode", "summary") or "summary").strip().lower()
        if relay_mode not in {"verbatim", "summary"}:
            relay_mode = "summary"
        if not avatar_id or not message:
            return json.dumps({"ok": False, "error": "avatar_id and message are required"}, ensure_ascii=False)
        payload = await _chat_with_avatar_payload(
            avatar_id,
            message,
            relay_mode=relay_mode,
            session=session,
        )
        return json.dumps(payload, ensure_ascii=False)

    # --- Persistent automation task tools (bridged to Desktop AutomationScheduler) ---
    if name in ("schedule_task", "list_scheduled_tasks", "cancel_scheduled_task", "update_scheduled_task"):
        from agenticx.runtime._automation_tasks_io import (
            load_automation_tasks,
            save_automation_tasks,
            generate_task_id,
        )

        if name == "schedule_task":
            task_name = str(arguments.get("name", "")).strip()
            instruction = str(arguments.get("instruction", "")).strip()
            if not task_name or not instruction:
                return json.dumps({"ok": False, "error": "name and instruction are required"}, ensure_ascii=False)

            preflight = _automation_task_mcp_preflight(
                session=session,
                instruction=instruction,
            )
            if not bool(preflight.get("ok")):
                return json.dumps(
                    {
                        "ok": False,
                        "error": "automation preflight failed: no suitable connected crawler MCP tools",
                        "preflight": preflight,
                    },
                    ensure_ascii=False,
                )
            instruction = _augment_automation_instruction_with_contract(
                instruction,
                preflight=preflight,
            )

            freq_type = str(arguments.get("frequency_type", "daily")).strip()
            time_str = str(arguments.get("time", "09:00")).strip()
            days = arguments.get("days")
            if not isinstance(days, list) or not days:
                days = [1, 2, 3, 4, 5, 6, 7]
            days = [int(d) for d in days if isinstance(d, (int, float))]

            if freq_type == "interval":
                interval_hours = int(arguments.get("interval_hours", 4) or 4)
                frequency: dict = {"type": "interval", "hours": interval_hours, "days": days}
            elif freq_type == "once":
                date_str = str(arguments.get("date", "")).strip()
                if not date_str:
                    from datetime import date as _date_cls
                    date_str = _date_cls.today().isoformat()
                frequency = {"type": "once", "time": time_str, "date": date_str}
            else:
                frequency = {"type": "daily", "time": time_str, "days": days}

            enabled = arguments.get("enabled")
            if not isinstance(enabled, bool):
                enabled = True

            task_id = generate_task_id()
            task_obj = {
                "id": task_id,
                "name": task_name,
                "prompt": instruction,
                "frequency": frequency,
                "enabled": enabled,
                "createdAt": datetime.now().isoformat(),
            }
            ws = str(arguments.get("workspace", "") or "").strip()
            if ws:
                task_obj["workspace"] = ws
            else:
                # 与 Desktop 一致：每任务独占 ~/.agenticx/crontask/<id>/
                default_ws = str(Path.home() / ".agenticx" / "crontask" / task_id)
                task_obj["workspace"] = default_ws
                Path(default_ws).mkdir(parents=True, exist_ok=True)
            # 不写入 sessionId：若绑定 Machi/当前对话的会话 ID，侧栏打开「定时」窗格会错误加载该会话历史。
            # 专属会话应在 Desktop 侧栏点击该任务时由 automation:<task_id> 创建并回写。

            tasks = load_automation_tasks()
            tasks.insert(0, task_obj)
            save_automation_tasks(tasks)

            return json.dumps(
                {
                    "ok": True,
                    "task_id": task_id,
                    "name": task_name,
                    "frequency": frequency,
                    "preflight": preflight,
                    "message": "已创建定时任务，可在侧栏「定时」区域查看和编辑。",
                },
                ensure_ascii=False,
            )

        if name == "list_scheduled_tasks":
            tasks = load_automation_tasks()
            items = []
            for t in tasks:
                items.append({
                    "task_id": t.get("id", ""),
                    "name": t.get("name", ""),
                    "enabled": t.get("enabled", False),
                    "frequency": t.get("frequency"),
                    "workspace": t.get("workspace"),
                    "prompt": t.get("prompt"),
                    "effectiveDateRange": t.get("effectiveDateRange"),
                    "createdAt": t.get("createdAt"),
                    "lastRunAt": t.get("lastRunAt"),
                    "lastRunStatus": t.get("lastRunStatus"),
                    "lastRunError": t.get("lastRunError"),
                })
            return json.dumps({"ok": True, "tasks": items}, ensure_ascii=False)

        if name == "cancel_scheduled_task":
            task_id = str(arguments.get("task_id", "")).strip()
            if not task_id:
                return json.dumps({"ok": False, "error": "task_id is required"}, ensure_ascii=False)
            tasks = load_automation_tasks()
            found = False
            for t in tasks:
                if t.get("id") == task_id:
                    t["enabled"] = False
                    found = True
                    break
            if found:
                save_automation_tasks(tasks)
            return json.dumps(
                {"ok": found, "task_id": task_id, "message": "已禁用该定时任务。" if found else "未找到该任务。"},
                ensure_ascii=False,
            )

        if name == "update_scheduled_task":
            task_id = str(arguments.get("task_id", "")).strip()
            if not task_id:
                return json.dumps({"ok": False, "error": "task_id is required"}, ensure_ascii=False)

            tasks = load_automation_tasks()
            target: Optional[Dict[str, Any]] = None
            for t in tasks:
                if t.get("id") == task_id:
                    target = t
                    break
            if target is None:
                return json.dumps({"ok": False, "error": f"task not found: {task_id}"}, ensure_ascii=False)

            changed: List[str] = []

            # --- name ---
            if "name" in arguments:
                new_name = str(arguments.get("name", "")).strip()
                if new_name and new_name != target.get("name"):
                    target["name"] = new_name
                    changed.append("name")

            # --- instruction / prompt (re-run preflight + re-inject contract) ---
            preflight_payload: Optional[Dict[str, Any]] = None
            if "instruction" in arguments:
                new_instruction = str(arguments.get("instruction", "")).strip()
                if not new_instruction:
                    return json.dumps(
                        {"ok": False, "error": "instruction must be non-empty when provided"},
                        ensure_ascii=False,
                    )
                preflight_payload = _automation_task_mcp_preflight(
                    session=session,
                    instruction=new_instruction,
                )
                if not bool(preflight_payload.get("ok")):
                    return json.dumps(
                        {
                            "ok": False,
                            "error": "automation preflight failed: no suitable connected crawler MCP tools",
                            "preflight": preflight_payload,
                        },
                        ensure_ascii=False,
                    )
                augmented = _augment_automation_instruction_with_contract(
                    new_instruction,
                    preflight=preflight_payload,
                )
                if augmented != target.get("prompt"):
                    target["prompt"] = augmented
                    changed.append("prompt")

            # --- frequency (rebuild when frequency_type provided; else allow in-place edits) ---
            existing_freq = target.get("frequency") if isinstance(target.get("frequency"), dict) else {}
            if "frequency_type" in arguments:
                freq_type = str(arguments.get("frequency_type", "daily")).strip() or "daily"
                # Fallbacks preserve current time/days when caller omits them.
                prev_time = str(existing_freq.get("time", "09:00")) if existing_freq.get("type") in ("daily", "once") else "09:00"
                prev_days_raw = existing_freq.get("days") if existing_freq.get("type") in ("daily", "interval") else None
                prev_days = (
                    [int(d) for d in prev_days_raw if isinstance(d, (int, float))]
                    if isinstance(prev_days_raw, list) and prev_days_raw
                    else [1, 2, 3, 4, 5, 6, 7]
                )
                time_str = str(arguments.get("time", prev_time)).strip() or prev_time
                days_arg = arguments.get("days")
                if isinstance(days_arg, list) and days_arg:
                    days = [int(d) for d in days_arg if isinstance(d, (int, float))]
                else:
                    days = prev_days

                if freq_type == "interval":
                    prev_hours = int(existing_freq.get("hours", 4) or 4) if existing_freq.get("type") == "interval" else 4
                    interval_hours = int(arguments.get("interval_hours", prev_hours) or prev_hours)
                    new_frequency: Dict[str, Any] = {"type": "interval", "hours": interval_hours, "days": days}
                elif freq_type == "once":
                    prev_date = str(existing_freq.get("date", "")) if existing_freq.get("type") == "once" else ""
                    date_str = str(arguments.get("date", prev_date)).strip()
                    if not date_str:
                        from datetime import date as _date_cls
                        date_str = _date_cls.today().isoformat()
                    new_frequency = {"type": "once", "time": time_str, "date": date_str}
                else:
                    new_frequency = {"type": "daily", "time": time_str, "days": days}
                target["frequency"] = new_frequency
                changed.append("frequency")
            else:
                # In-place tweaks on existing frequency (time/days/interval_hours/date)
                freq_dirty = False
                freq = dict(existing_freq) if existing_freq else None
                if freq and "time" in arguments and freq.get("type") in ("daily", "once"):
                    freq["time"] = str(arguments.get("time", "")).strip() or freq.get("time", "09:00")
                    freq_dirty = True
                if freq and "days" in arguments and freq.get("type") in ("daily", "interval"):
                    days_arg = arguments.get("days")
                    if isinstance(days_arg, list) and days_arg:
                        freq["days"] = [int(d) for d in days_arg if isinstance(d, (int, float))]
                        freq_dirty = True
                if freq and "interval_hours" in arguments and freq.get("type") == "interval":
                    freq["hours"] = int(arguments.get("interval_hours", 4) or 4)
                    freq_dirty = True
                if freq and "date" in arguments and freq.get("type") == "once":
                    freq["date"] = str(arguments.get("date", "")).strip() or freq.get("date", "")
                    freq_dirty = True
                if freq_dirty:
                    target["frequency"] = freq
                    changed.append("frequency")

            # --- workspace ---
            if "workspace" in arguments:
                ws_raw = str(arguments.get("workspace", "") or "").strip()
                if ws_raw:
                    target["workspace"] = ws_raw
                else:
                    default_ws = str(Path.home() / ".agenticx" / "crontask" / task_id)
                    target["workspace"] = default_ws
                    Path(default_ws).mkdir(parents=True, exist_ok=True)
                changed.append("workspace")

            # --- enabled ---
            if "enabled" in arguments and isinstance(arguments.get("enabled"), bool):
                new_enabled = bool(arguments.get("enabled"))
                if new_enabled != target.get("enabled"):
                    target["enabled"] = new_enabled
                    changed.append("enabled")

            # --- effective date range ---
            if "effective_date_range_start" in arguments or "effective_date_range_end" in arguments:
                existing_range = target.get("effectiveDateRange") if isinstance(target.get("effectiveDateRange"), dict) else {}
                new_range: Dict[str, str] = dict(existing_range) if existing_range else {}
                if "effective_date_range_start" in arguments:
                    raw = str(arguments.get("effective_date_range_start", "") or "").strip()
                    if raw:
                        new_range["start"] = raw
                    else:
                        new_range.pop("start", None)
                if "effective_date_range_end" in arguments:
                    raw = str(arguments.get("effective_date_range_end", "") or "").strip()
                    if raw:
                        new_range["end"] = raw
                    else:
                        new_range.pop("end", None)
                if new_range:
                    target["effectiveDateRange"] = new_range
                elif "effectiveDateRange" in target:
                    target.pop("effectiveDateRange", None)
                changed.append("effectiveDateRange")

            if not changed:
                return json.dumps(
                    {"ok": True, "task_id": task_id, "changed": [], "message": "未提供任何要修改的字段。"},
                    ensure_ascii=False,
                )

            save_automation_tasks(tasks)

            summary = {
                "task_id": task_id,
                "name": target.get("name"),
                "enabled": target.get("enabled"),
                "frequency": target.get("frequency"),
                "workspace": target.get("workspace"),
                "effectiveDateRange": target.get("effectiveDateRange"),
            }
            payload: Dict[str, Any] = {
                "ok": True,
                "changed": changed,
                "task": summary,
                "message": f"已更新定时任务字段：{', '.join(changed)}。",
            }
            if preflight_payload is not None:
                payload["preflight"] = preflight_payload
            return json.dumps(payload, ensure_ascii=False)

    return json.dumps({"ok": False, "error": f"unknown meta tool: {name}"}, ensure_ascii=False)
