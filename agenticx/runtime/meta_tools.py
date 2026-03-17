#!/usr/bin/env python3
"""Meta-Agent tools for orchestrating sub-agent teams.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
import smtplib
from email.message import EmailMessage
from datetime import datetime
from typing import Any, Dict, List, Optional, TYPE_CHECKING

_meta_log = logging.getLogger(__name__)

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.cli.studio_mcp import import_mcp_config, load_available_servers
from agenticx.cli.studio_skill import get_all_skill_summaries
from agenticx.cli.config_manager import ConfigManager
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.team_manager import AgentTeamManager

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession


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
                    "provider": {"type": "string", "description": "Optional provider override for this sub-agent."},
                    "model": {"type": "string", "description": "Optional model override for this sub-agent."},
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
                "properties": {},
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
                },
                "required": ["avatar_id", "task"],
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
}
META_AGENT_TOOLS: List[Dict[str, Any]] = list(STUDIO_TOOLS) + [
    t for t in _META_ONLY_TOOLS
    if t.get("function", {}).get("name") not in _studio_tool_names
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
    try:
        cfg = ConfigManager.load()
        for provider, provider_cfg in (cfg.providers or {}).items():
            if not isinstance(provider_cfg, dict):
                continue
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

    current_provider = str(getattr(session, "provider_name", "") or "").strip()
    current_model = str(getattr(session, "model_name", "") or "").strip()
    current_score = (
        _model_capability_score(current_provider, current_model)
        if current_provider and current_model
        else 0
    )

    all_candidates = list(configured_candidates)
    if current_provider and current_model:
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

    target_score = 40 if level == "low" else (60 if level == "medium" else 75)
    chosen: Optional[Dict[str, Any]] = None
    for item in all_candidates:
        if int(item.get("score", 0)) >= target_score:
            chosen = item
            break
    if chosen is None and all_candidates:
        chosen = all_candidates[0]

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
            provider=str(arguments.get("provider", "")).strip() or None,
            model=str(arguments.get("model", "")).strip() or None,
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
        return json.dumps(_list_skills_payload(), ensure_ascii=False)

    if name == "list_mcps":
        return json.dumps(_list_mcps_payload(session), ensure_ascii=False)

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
