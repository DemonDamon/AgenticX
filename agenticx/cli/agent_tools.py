#!/usr/bin/env python3
"""Tool definitions and dispatchers for Studio agent loop.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import base64
import difflib
import fnmatch
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from urllib.parse import urlparse
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.cli.studio_mcp import (
    import_mcp_config,
    load_available_servers,
    mcp_call_tool_async,
    mcp_connect,
)
from agenticx.cli.studio_skill import (
    get_all_skill_summaries,
    skill_is_allowed_for_session,
    skill_use as studio_skill_use,
)
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.memory.session_store import SessionStore
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.skills.guard import scan_skill, should_allow
from agenticx.tools.skill_bundle import SkillBundleLoader
from agenticx.runtime.confirm import (
    AsyncConfirmGate,
    AutoApproveConfirmGate,
    ConfirmGate,
    SyncConfirmGate,
)
from agenticx.workspace.loader import (
    append_daily_memory,
    append_long_term_memory,
    ensure_workspace,
)

if TYPE_CHECKING:
    from agenticx.cli.studio import StudioSession
else:
    StudioSession = Any

_log = logging.getLogger(__name__)
_CC_BRIDGE_AUTO_PROC: Optional[subprocess.Popen[str]] = None
_CC_BRIDGE_IDLE_TASK: Optional[asyncio.Task[Any]] = None
_CC_BRIDGE_LAST_ACTIVE_MONO: float = 0.0


SAFE_COMMANDS = {
    "cd",
    "ls",
    "cat",
    "head",
    "tail",
    "grep",
    "find",
    "wc",
    "python",
    "pip",
    "git",
    "echo",
    "pwd",
    "which",
    "tree",
}

MAX_READ_CHARS = 20_000
# Cap bash_exec command string size (defense in depth; matches audit remediation).
MAX_BASH_EXEC_COMMAND_CHARS = 65536
PATH_GUARDED_READ_COMMANDS = {"cat", "head", "tail", "grep", "find", "wc", "ls", "tree"}

# Tools safe to run concurrently when appearing in the same assistant tool_calls batch.
def tool_denied_by_session_permissions(tool_name: str) -> Optional[str]:
    """Return a denial message if ``permissions.denied_tools`` matches the tool.

    Policy deny must short-circuit before confirm gates (see ADR 0001).
    Patterns use :func:`fnmatch.fnmatch` (e.g. ``bash_*``).
    """
    raw = ConfigManager.get_value("permissions.denied_tools")
    if not isinstance(raw, list):
        return None
    name = str(tool_name or "").strip()
    if not name:
        return None
    for entry in raw:
        pat = str(entry or "").strip()
        if not pat:
            continue
        if fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(name.lower(), pat.lower()):
            return f"工具「{name}」已被会话权限策略拒绝（匹配规则: {pat}）。"
    return None


_CONCURRENCY_SAFE_STUDIO_TOOLS = frozenset(
    {
        "file_read",
        "skill_list",
        "scratchpad_read",
        "memory_search",
        "session_search",
        "list_files",
        "liteparse",
        "lsp_goto_definition",
        "lsp_find_references",
        "lsp_hover",
        "lsp_diagnostics",
        "list_scheduled_tasks",
        "get_automation_task_logs",
        "cc_bridge_list",
        "knowledge_search",  # Plan-Id: machi-kb-stage1-local-mvp — read-only vector search.
    }
)


def _bash_exec_is_read_only(arguments: Dict[str, Any]) -> bool:
    """Heuristic: treat obvious mutating shell patterns as non-read-only."""
    cmd = str(arguments.get("command", "") or "")
    if not cmd.strip():
        return True
    if ">>" in cmd:
        return False
    # Single `>` redirect (not `>=` etc.)
    for i, ch in enumerate(cmd):
        if ch == ">" and (i == 0 or cmd[i - 1] not in ">="):
            return False
    lowered = " " + cmd.lower() + " "
    for needle in (" rm ", " mv ", " mkdir ", " touch ", " tee ", "git push", "git commit"):
        if needle in lowered:
            return False
    stripped = cmd.strip().lower()
    if stripped.startswith(("rm ", "mv ", "mkdir ", "touch ")):
        return False
    return True


def studio_tool_is_concurrency_safe(tool_name: str, arguments: Dict[str, Any]) -> bool:
    """Return True if this invocation may run in parallel with other safe tools."""
    name = str(tool_name or "").strip().lower()
    if not name or name == "none":
        return False
    if name == "bash_exec":
        return _bash_exec_is_read_only(arguments)
    return name in _CONCURRENCY_SAFE_STUDIO_TOOLS


def _workspace_root() -> Path:
    configured = os.getenv("AGX_WORKSPACE_ROOT", "").strip()
    if configured:
        try:
            return Path(configured).expanduser().resolve(strict=False)
        except Exception:
            pass
    return Path.cwd().resolve()


def _session_workspace_roots(session: Optional[StudioSession]) -> List[Path]:
    """Ordered filesystem roots for this session.

    User-added taskspaces (id != \"default\") are listed before the default taskspace
    so tools like list_files(\".\") and relative file_read resolve to the folder the
    user bound in the Desktop workspace panel, not only ~/.agenticx/avatars/.../workspace.
    """
    roots: List[Path] = []
    seen: set[str] = set()

    def _add_path_str(raw: str) -> None:
        text = (raw or "").strip()
        if not text:
            return
        try:
            candidate = Path(text).expanduser().resolve(strict=False)
        except Exception:
            return
        key = str(candidate)
        if key in seen:
            return
        seen.add(key)
        roots.append(candidate)

    if session is not None:
        taskspaces = getattr(session, "taskspaces", None)
        if isinstance(taskspaces, list):
            extra_paths: List[str] = []
            default_paths: List[str] = []
            for item in taskspaces:
                if not isinstance(item, dict):
                    continue
                raw_path = str(item.get("path", "") or "").strip()
                if not raw_path:
                    continue
                ts_id = str(item.get("id", "") or "").strip()
                if ts_id == "default":
                    default_paths.append(raw_path)
                else:
                    extra_paths.append(raw_path)
            for p in extra_paths:
                _add_path_str(p)
            for p in default_paths:
                _add_path_str(p)
        _add_path_str(str(getattr(session, "workspace_dir", "") or ""))

    _add_path_str(str(_workspace_root()))
    if not roots:
        roots.append(Path.cwd().resolve(strict=False))

    # Desktop: user-selected workspace tab must win over merge order (multiple non-default taskspaces).
    if session is not None:
        raw_active = getattr(session, "active_taskspace_id", None)
        active_id = str(raw_active).strip() if raw_active is not None else ""
        if active_id:
            taskspaces_active = getattr(session, "taskspaces", None)
            if isinstance(taskspaces_active, list):
                for item in taskspaces_active:
                    if not isinstance(item, dict):
                        continue
                    if str(item.get("id", "") or "").strip() != active_id:
                        continue
                    raw_path = str(item.get("path", "") or "").strip()
                    if not raw_path:
                        break
                    try:
                        target = Path(raw_path).expanduser().resolve(strict=False)
                    except Exception:
                        break
                    tkey = str(target)
                    roots = [r for r in roots if str(r.resolve(strict=False)) != tkey]
                    roots.insert(0, target)
                    break
    # Computer Use screenshots: always allow reading files under ~/.agenticx/desktop-use
    try:
        _agx_desktop = (Path.home() / ".agenticx" / "desktop-use").resolve(strict=False)
        _add_path_str(str(_agx_desktop))
    except Exception:
        pass
    return roots


def _is_path_under_root(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


def _desktop_unrestricted_fs_enabled() -> bool:
    value = os.getenv("AGX_DESKTOP_UNRESTRICTED_FS", "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _detect_target(text: str) -> str:
    lowered = text.lower()
    if "workflow" in lowered or "工作流" in lowered or "pipeline" in lowered:
        return "workflow"
    if "tool" in lowered or "工具" in lowered:
        return "tool"
    if "skill" in lowered or "技能" in lowered:
        return "skill"
    return "agent"


STUDIO_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "bash_exec",
            "description": (
                "Execute a shell command in the session workspace. Prefer the cwd parameter for the working "
                "directory instead of leading `cd ... &&` (cd && is auto-peeled when cwd is omitted). "
                "After headless `claude -p` / codegen, verify artifacts with list_files or `test -f` — do not "
                "trust exit_code alone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Command to execute."},
                    "cwd": {"type": "string", "description": "Working directory (preferred over cd in command)."},
                    "timeout_sec": {"type": "integer", "description": "Timeout seconds, default 30."},
                },
                "required": ["command"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_read",
            "description": "Read file content with optional line range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path."},
                    "start_line": {"type": "integer", "description": "Start line (1-based)."},
                    "end_line": {"type": "integer", "description": "End line (inclusive)."},
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_write",
            "description": "Write full file content; show unified diff and ask confirmation before writing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path."},
                    "content": {"type": "string", "description": "New full content."},
                },
                "required": ["path", "content"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "file_edit",
            "description": "Replace text in file; show unified diff and ask confirmation before writing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path."},
                    "old_text": {"type": "string", "description": "Text to replace."},
                    "new_text": {"type": "string", "description": "Replacement text."},
                    "occurrence": {
                        "type": "integer",
                        "description": "Which occurrence to replace (1-based). Default replaces first.",
                    },
                },
                "required": ["path", "old_text", "new_text"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "codegen",
            "description": "Generate code artifact using existing CodeGenEngine.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Generation target: agent/workflow/tool/skill.",
                    },
                    "description": {"type": "string", "description": "Generation requirement text."},
                    "output_path": {
                        "type": "string",
                        "description": "Optional explicit output file path. If omitted, the tool will propose a default path and ask user confirmation before writing.",
                    },
                },
                "required": ["description"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mcp_connect",
            "description": "Connect one configured MCP server.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "MCP server name from config."},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cc_bridge_start",
            "description": (
                "Start a local Claude Code headless session via the CC bridge HTTP server (run "
                "`agx cc-bridge serve` in another terminal). Token is read from AGX_CC_BRIDGE_TOKEN or "
                "~/.agenticx/config.yaml cc_bridge.token (auto-generated on first use). Then cc_bridge_send "
                "with the returned session_id; verify output files on disk afterward."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cwd": {
                        "type": "string",
                        "description": "Working directory for claude child; defaults to session workspace_dir.",
                    },
                    "auto_allow_permissions": {
                        "type": "boolean",
                        "description": "If true, bridge auto-approves can_use_tool control_request lines.",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["headless", "visible_tui"],
                        "description": (
                            "Optional explicit mode override. If omitted, runtime auto-selects by intent: "
                            "autonomous/report tasks prefer headless; interactive terminal tasks prefer visible_tui."
                        ),
                    },
                },
                "required": [],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cc_bridge_send",
            "description": (
                "Send a user turn to an existing CC bridge session. In headless mode it waits for result/timeout; "
                "in visible_tui mode it only writes input to PTY and returns immediately (no final result inference). "
                "Requires bridge at cc_bridge.url (default 127.0.0.1:9742) and matching bearer token. "
                "Afterward confirm any expected files with file_read or bash_exec test -f."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Bridge session UUID."},
                    "prompt": {"type": "string", "description": "User message text."},
                    "wait_seconds": {
                        "type": "number",
                        "description": "Max wait for stream-json result success line (default 120).",
                    },
                },
                "required": ["session_id", "prompt"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cc_bridge_list",
            "description": "List active CC bridge sessions (pid, cwd) from the local bridge HTTP server.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cc_bridge_stop",
            "description": "Terminate a CC bridge session by session_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Bridge session UUID."},
                    "force": {
                        "type": "boolean",
                        "description": "Force stop even when visible_tui is still active.",
                    },
                },
                "required": ["session_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cc_bridge_permission",
            "description": (
                "Reply to a pending can_use_tool control_request when auto_allow is off. "
                "Use request_id from bridge logs or captured NDJSON."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "request_id": {"type": "string"},
                    "allow": {"type": "boolean"},
                    "deny_message": {"type": "string", "description": "Used when allow is false."},
                    "tool_use_id": {"type": "string", "description": "Optional; echo from control_request."},
                    "tool_input": {
                        "type": "object",
                        "description": "When allow is true, pass the tool input object from control_request.",
                        "additionalProperties": True,
                    },
                },
                "required": ["session_id", "request_id", "allow"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mcp_call",
            "description": (
                "Call one connected MCP tool by exact name with JSON arguments. "
                "Before using this, call list_mcps and pick tool_name from returned mcp_tool_names; "
                "do not invent names like web.fetch.* or list_tools."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tool_name": {"type": "string", "description": "Connected MCP tool name."},
                    "arguments": {
                        "type": "object",
                        "description": "Tool arguments object.",
                        "additionalProperties": True,
                    },
                    "args": {
                        "type": "object",
                        "description": "Alias of arguments; accepted for compatibility.",
                        "additionalProperties": True,
                    },
                },
                "required": ["tool_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mcp_import",
            "description": "Import MCP server configs from external mcp.json into AgenticX workspace config.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_path": {"type": "string", "description": "Source path to mcp.json."},
                },
                "required": ["source_path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_use",
            "description": (
                "Activate a skill into current context_files (key: skill:<name>). "
                "After calling this tool, use the injected content directly; do not guess paths or run bash to cat SKILL.md."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill name."},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_list",
            "description": (
                "List available skills with source/location/path metadata. "
                "Use these returned paths when you must inspect files; avoid hardcoded ~/.agenticx/skills guesses."
            ),
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
            "name": "skill_manage",
            "description": (
                "Create, patch, or delete skills stored under ~/.agenticx/skills/. "
                "For 'create': provide action + name + content (the full SKILL.md text). "
                "For 'patch': provide action + name + old_string + new_string. "
                "For 'delete': provide action + name. "
                "Sub-paths are supported (e.g. name='ima/notes' creates ~/.agenticx/skills/ima/notes/SKILL.md). "
                "IMPORTANT: never call with empty arguments — action and name are always required."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "patch", "delete"],
                        "description": "Operation: 'create' writes a new SKILL.md; 'patch' edits an existing one; 'delete' removes the skill directory.",
                    },
                    "name": {
                        "type": "string",
                        "description": (
                            "Skill directory name under ~/.agenticx/skills/. "
                            "Simple names like 'ima' or sub-paths like 'ima/notes' are both valid. "
                            "Each segment must be alphanumeric with optional hyphens/underscores (no spaces, no leading dots)."
                        ),
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "Required for 'create': the full SKILL.md text, starting with a YAML frontmatter block "
                            "(--- name: ... description: ... ---) followed by the skill body. "
                            "Must not be empty."
                        ),
                    },
                    "old_string": {"type": "string", "description": "Required for 'patch': exact substring to find and replace in the existing SKILL.md."},
                    "new_string": {"type": "string", "description": "Required for 'patch': replacement text for old_string."},
                },
                "required": ["action", "name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "todo_write",
            "description": "Update structured task list for current agent session.",
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
            "description": "Write intermediate result to session scratchpad.",
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
            "description": "Read one scratchpad key or list all keys.",
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
            "description": "Append note to workspace daily memory or long-term MEMORY.md.",
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
            "name": "session_search",
            "description": (
                "Search past conversation sessions by keyword. "
                "Returns matching message excerpts grouped by session."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search keywords (FTS5 syntax supported). Empty returns recent sessions.",
                    },
                    "role_filter": {
                        "type": "string",
                        "description": "Comma-separated roles to filter: user,assistant,tool,system",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max sessions to return (1-5, default 3).",
                    },
                },
                "required": [],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files/directories under a path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path, default current directory."},
                    "recursive": {"type": "boolean", "description": "Whether to recurse into subdirectories."},
                    "limit": {"type": "integer", "description": "Maximum entries to return, default 200."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "liteparse",
            "description": (
                "Parse a document file (PDF, DOCX, PPTX, XLSX, images) via LiteParse "
                "and return extracted text."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or workspace-relative path to the document.",
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lsp_goto_definition",
            "description": "Jump to symbol definition at given file position.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file": {"type": "string", "description": "Absolute or workspace-relative file path."},
                    "line": {"type": "integer", "description": "Line number (1-based)."},
                    "column": {"type": "integer", "description": "Column number (1-based)."},
                },
                "required": ["file", "line", "column"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lsp_find_references",
            "description": "Find all references to a symbol at given file position.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file": {"type": "string", "description": "Absolute or workspace-relative file path."},
                    "line": {"type": "integer", "description": "Line number (1-based)."},
                    "column": {"type": "integer", "description": "Column number (1-based)."},
                },
                "required": ["file", "line", "column"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lsp_hover",
            "description": "Get type info and documentation for a symbol at given file position.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file": {"type": "string", "description": "Absolute or workspace-relative file path."},
                    "line": {"type": "integer", "description": "Line number (1-based)."},
                    "column": {"type": "integer", "description": "Column number (1-based)."},
                },
                "required": ["file", "line", "column"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lsp_diagnostics",
            "description": "Get lint/type diagnostics for a file or all opened files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file": {"type": "string", "description": "Optional file path."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_task",
            "description": (
                "Create a persistent scheduled/automated task. "
                "The task is saved to disk and executed automatically by the Desktop scheduler at the specified time. "
                "The user can also view, edit and manage the task in the sidebar '定时' section. "
                "Before calling this tool: if the task runs Python scripts, prepare the runtime under the task root only — "
                "the root is the user-provided workspace if set, else ~/.agenticx/crontask/<task_id>/. "
                "Create <task_root>/.venv, pip install there, smoke-run with <task_root>/.venv/bin/python, and reference that path in instruction."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Human-readable task name (e.g. 'A股大盘收盘价日报')"},
                    "instruction": {
                        "type": "string",
                        "description": (
                            "Prompt for the automation runner on each trigger. Must use the same Python/paths as verified during setup. "
                            "Meta-Agent should have already installed deps (pip) in the task workspace or a dedicated venv and confirmed the script runs."
                        ),
                    },
                    "frequency_type": {
                        "type": "string",
                        "enum": ["daily", "interval", "once"],
                        "description": "Schedule type. 'daily' = run at a fixed time on selected days; 'interval' = every N hours; 'once' = one-time on a specific date. Default: 'daily'",
                    },
                    "time": {
                        "type": "string",
                        "description": "Trigger time in HH:MM 24h format (e.g. '22:15'). Required for 'daily' and 'once'. Default: '09:00'",
                    },
                    "days": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Days of week to run (1=Mon … 7=Sun). Default: [1,2,3,4,5,6,7] (every day). For 'once' this is ignored.",
                    },
                    "interval_hours": {
                        "type": "integer",
                        "description": "For frequency_type='interval': run every N hours. Default: 4",
                    },
                    "date": {
                        "type": "string",
                        "description": "For frequency_type='once': the date in YYYY-MM-DD format",
                    },
                    "workspace": {
                        "type": "string",
                        "description": (
                            "Task root directory: all scripts, venv (.venv inside this path), logs, and temp files for this job belong here. "
                            "If omitted, defaults to ~/.agenticx/crontask/<task_id>/ (one directory per task, created automatically)."
                        ),
                    },
                    "enabled": {
                        "type": "boolean",
                        "description": "Whether the task is enabled immediately. Default: true",
                    },
                    "provider": {
                        "type": "string",
                        "description": "Studio LLM provider id (must be set together with model). Optional.",
                    },
                    "model": {
                        "type": "string",
                        "description": "Model name for this task (must be set together with provider). Optional.",
                    },
                },
                "required": ["name", "instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_scheduled_tasks",
            "description": "List all persistent scheduled/automated tasks from disk, including their status, frequency and last run info.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_scheduled_task",
            "description": "Disable or remove a scheduled task by task_id. The task will no longer execute automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "ID of the task to disable/cancel"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_scheduled_task",
            "description": (
                "Partially update an existing scheduled/automated task by task_id. "
                "Only fields explicitly provided will be changed; omitted fields keep their current value. "
                "Use this to tweak an existing task's name, prompt, frequency, workspace, enabled flag or effective date range "
                "via natural-language dialog — no need to delete and recreate."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "ID of the task to update (obtain via list_scheduled_tasks)."},
                    "name": {"type": "string", "description": "New human-readable task name."},
                    "instruction": {
                        "type": "string",
                        "description": (
                            "New prompt for the automation runner. When provided, the tool re-runs MCP preflight and re-injects "
                            "the Execution Contract, replacing any previously auto-injected contract block."
                        ),
                    },
                    "frequency_type": {
                        "type": "string",
                        "enum": ["daily", "interval", "once"],
                        "description": "If provided, rebuilds the frequency. Omitted frequency fields fall back to the task's current values.",
                    },
                    "time": {"type": "string", "description": "HH:MM 24h time for daily/once."},
                    "days": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "Days of week (1=Mon … 7=Sun) for daily/interval.",
                    },
                    "interval_hours": {"type": "integer", "description": "Run every N hours when frequency_type='interval'."},
                    "date": {"type": "string", "description": "YYYY-MM-DD date when frequency_type='once'."},
                    "workspace": {
                        "type": "string",
                        "description": "New task root directory. Pass empty string to reset to default (~/.agenticx/crontask/<task_id>/).",
                    },
                    "enabled": {"type": "boolean", "description": "Enable/disable the task."},
                    "effective_date_range_start": {"type": "string", "description": "Optional effective start date (YYYY-MM-DD). Empty string clears it."},
                    "effective_date_range_end": {"type": "string", "description": "Optional effective end date (YYYY-MM-DD). Empty string clears it."},
                    "provider": {
                        "type": "string",
                        "description": "LLM provider for scheduled runs (set together with model; empty clears both).",
                    },
                    "model": {
                        "type": "string",
                        "description": "LLM model id for scheduled runs (set together with provider; empty clears both).",
                    },
                },
                "required": ["task_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_automation_task_logs",
            "description": (
                "Read the tail of a scheduled/automated task's execution log file "
                "(~/.agenticx/logs/automation/<task_id>.log). "
                "Each run writes [run.begin], [run.session_created|session_reused], [chat.request], "
                "[chat.sse ...], [chat.done|stream_ended|http_error|sse.error|exception], and [run.end] lines. "
                "Use this to diagnose why a task failed (e.g. terminated/timeout, http error, tool error) before proposing a fix."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "Task id (obtain via list_scheduled_tasks)."},
                    "tail": {
                        "type": "integer",
                        "description": "Last N lines to return (default 200, max 2000).",
                    },
                },
                "required": ["task_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        # Plan-Id: machi-kb-stage1-local-mvp (plan §2.3).
        "type": "function",
        "function": {
            "name": "knowledge_search",
            "description": (
                "Search the local knowledge base (Machi Stage-1 MVP). "
                "Returns the top-k most relevant chunks with source path, chunk index, "
                "similarity score, and the chunk text. Use this before making claims that "
                "depend on user-provided documents. Returns {hits: [...], used_top_k, source: 'local'}. "
                "If the KB is disabled or empty, `hits` will be an empty list."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language search query."},
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum number of chunks to return (1-20). Omit to use KB setting default Top-K.",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    # ── task_experience tools (group team session cross-task memory) ──────────
    {
        "type": "function",
        "function": {
            "name": "task_experience_retrieve",
            "description": (
                "Retrieve relevant task experience from previous group team sessions. "
                "Call at the start of every complex task to check for reusable lessons. "
                "Uses hybrid search (BM25 + vector) against ~/.agenticx/groups/<group_id>/experience.json."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Describe the current task or challenge to match past experience.",
                    },
                    "group_id": {
                        "type": "string",
                        "description": "Group ID to scope the experience store. Defaults to current session group.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max number of experience entries to return (1-10, default 5).",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_experience_learn",
            "description": (
                "Record a key finding, rule, or lesson from the current task into the group experience store. "
                "Call before the final reply to preserve reusable knowledge for future sessions. "
                "Recording failed tool calls is especially valuable."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The experience or lesson content to record.",
                    },
                    "section": {
                        "type": "string",
                        "description": "Category label (e.g. 'debugging', 'code_pattern', 'api_usage'). Default 'general'.",
                    },
                    "when_to_use": {
                        "type": "string",
                        "description": "Describe when this experience should be applied in the future.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short title for the experience entry.",
                    },
                    "group_id": {
                        "type": "string",
                        "description": "Group ID to scope the experience store. Defaults to current session group.",
                    },
                },
                "required": ["content"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_experience_clear",
            "description": (
                "Clear all stored task experience for a group. "
                "Only call when explicitly requested by the user. Always confirm before clearing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "string",
                        "description": "Group ID whose experience store should be cleared.",
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Must be true to actually clear. Prevents accidental deletion.",
                    },
                },
                "required": ["confirm"],
                "additionalProperties": False,
            },
        },
    },
]

# Desktop Computer Use tools (injected at runtime when ``computer_use.enabled`` in config).
COMPUTER_USE_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "desktop_screenshot",
            "description": (
                "Capture the entire primary display to a PNG under ~/.agenticx/desktop-use/ "
                "(not the session project folder). On macOS uses ``screencapture``; elsewhere tries ``pyautogui`` if installed. "
                "Prefer this over claiming you cannot screenshot when the user enabled 桌面操控."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Optional basename only (e.g. cap.png); must end with .png.",
                    },
                    "include_base64": {
                        "type": "boolean",
                        "description": "If true (default), include image_base64 when file is under ~900KB.",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "desktop_mouse_click",
            "description": (
                "Click at screen coordinates using pyautogui (requires ``pip install pyautogui``). "
                "Coordinates are in **screen** pixels (origin top-left). High-risk: user confirmation required."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "Screen X coordinate."},
                    "y": {"type": "integer", "description": "Screen Y coordinate."},
                    "clicks": {
                        "type": "integer",
                        "description": "Number of clicks (default 1).",
                    },
                    "button": {
                        "type": "string",
                        "enum": ["left", "right", "middle"],
                        "description": "Mouse button (default left).",
                    },
                },
                "required": ["x", "y"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "desktop_keyboard_type",
            "description": (
                "Type Unicode text as keyboard input using pyautogui (requires ``pip install pyautogui``). "
                "High-risk: user confirmation required; never use for secrets unless the user explicitly asks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to type."},
                    "interval_sec": {
                        "type": "number",
                        "description": "Optional delay between keystrokes (default 0.02).",
                    },
                },
                "required": ["text"],
                "additionalProperties": False,
            },
        },
    },
]

COMPUTER_USE_TOOL_NAMES = frozenset(
    name
    for t in COMPUTER_USE_TOOLS
    if isinstance(t, dict)
    for name in (str(t.get("function", {}).get("name", "") or "").strip(),)
    if name
)


def computer_use_config_enabled() -> bool:
    """True when ``~/.agenticx/config.yaml`` has ``computer_use.enabled: true``."""
    try:
        return bool(ConfigManager.load().computer_use.enabled)
    except Exception:
        return False


def merge_computer_use_tools_into(tool_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Append Computer Use tool specs when enabled; dedupe by function name."""
    if not computer_use_config_enabled():
        return tool_list
    seen: set[str] = set()
    for t in tool_list:
        if not isinstance(t, dict):
            continue
        fn = t.get("function", {})
        if isinstance(fn, dict):
            n = str(fn.get("name", "") or "").strip()
            if n:
                seen.add(n)
    out = list(tool_list)
    for spec in COMPUTER_USE_TOOLS:
        if not isinstance(spec, dict):
            continue
        fn = spec.get("function", {})
        if not isinstance(fn, dict):
            continue
        name = str(fn.get("name", "") or "").strip()
        if not name or name in seen:
            continue
        out.append(spec)
        seen.add(name)
    return out


_MAX_DESKTOP_SCREENSHOT_BYTES_FOR_B64 = 950_000


def _agenticx_desktop_use_dir() -> Path:
    """Fixed directory for desktop screenshots (under ~/.agenticx, not session cwd)."""
    d = (Path.home() / ".agenticx" / "desktop-use").resolve(strict=False)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _desktop_use_blocked_message() -> str:
    return (
        "ERROR: 桌面操控工具未启用。请在 Machi 设置中开启「桌面操控」（写入 ~/.agenticx/config.yaml 的 "
        "computer_use.enabled）后完全重启 Machi。"
    )


def _desktop_screenshot_target_path(session: StudioSession, filename: str | None) -> Path:
    base = _agenticx_desktop_use_dir()
    name = str(filename or "").strip()
    if name:
        safe = os.path.basename(name).replace("..", "_")
        if not safe.lower().endswith(".png"):
            safe = f"{safe}.png" if safe else f"screen_{uuid.uuid4().hex[:10]}.png"
    else:
        safe = f"screen_{uuid.uuid4().hex[:10]}.png"
    if not re.fullmatch(r"[A-Za-z0-9._-]+\.png", safe):
        safe = f"screen_{uuid.uuid4().hex[:10]}.png"
    return (base / safe).resolve(strict=False)


async def _capture_display_to_png(out_path: Path) -> None:
    """Write a full-screen PNG to ``out_path`` (blocking work in a thread)."""

    def _darwin_screencapture() -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.run(
            ["screencapture", "-x", "-t", "png", str(out_path)],
            capture_output=True,
            text=True,
            timeout=90,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip() or "screencapture failed"
            raise RuntimeError(err)

    def _pyautogui_capture() -> None:
        import pyautogui  # type: ignore import-not-found

        out_path.parent.mkdir(parents=True, exist_ok=True)
        img = pyautogui.screenshot()
        img.save(str(out_path))

    if sys.platform == "darwin":
        await asyncio.to_thread(_darwin_screencapture)
        return
    try:
        await asyncio.to_thread(_pyautogui_capture)
    except Exception as exc:
        raise RuntimeError(
            f"Screenshot failed ({exc!r}). Install pyautogui (`pip install pyautogui`) "
            "or use macOS where screencapture is available."
        ) from exc


async def _tool_desktop_screenshot(
    arguments: Dict[str, Any],
    session: Optional[StudioSession],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    if not computer_use_config_enabled():
        return _desktop_use_blocked_message()
    if session is None:
        return "ERROR: desktop_screenshot requires an active Studio session"
    if not await _confirm(
        "将在本机截取**全屏**并保存到 ~/.agenticx/desktop-use/ ，是否继续？",
        confirm_gate=confirm_gate,
        context={"tool": "desktop_screenshot", "risk": "computer_use"},
        emit_event=emit_event,
    ):
        return "CANCELLED: user denied desktop screenshot"
    include_b64 = arguments.get("include_base64")
    if include_b64 is None:
        include_b64 = True
    include_b64 = bool(include_b64)
    try:
        out_path = _desktop_screenshot_target_path(session, str(arguments.get("filename") or ""))
        await _capture_display_to_png(out_path)
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False)
    try:
        size = out_path.stat().st_size
    except OSError as exc:
        return json.dumps({"ok": False, "error": f"stat failed: {exc}"}, ensure_ascii=False)
    payload: Dict[str, Any] = {
        "ok": True,
        "path": str(out_path),
        "bytes": size,
        "hint": "若模型支持多模态，可将该 PNG 路径作为图像输入；否则向用户说明文件路径。",
    }
    if include_b64 and size <= _MAX_DESKTOP_SCREENSHOT_BYTES_FOR_B64:
        try:
            raw = out_path.read_bytes()
            payload["image_base64"] = base64.standard_b64encode(raw).decode("ascii")
        except OSError as exc:
            payload["base64_error"] = str(exc)
    elif include_b64:
        payload["note"] = "PNG 过大，未内联 base64；请使用 path 或压缩后再读。"
    return json.dumps(payload, ensure_ascii=False)


async def _tool_desktop_mouse_click(
    arguments: Dict[str, Any],
    session: Optional[StudioSession],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    if not computer_use_config_enabled():
        return _desktop_use_blocked_message()
    if session is None:
        return "ERROR: desktop_mouse_click requires an active Studio session"
    try:
        x = int(arguments.get("x"))
        y = int(arguments.get("y"))
    except (TypeError, ValueError):
        return "ERROR: desktop_mouse_click requires integer x and y"
    clicks_raw = arguments.get("clicks", 1)
    try:
        clicks = int(clicks_raw)
    except (TypeError, ValueError):
        clicks = 1
    clicks = max(1, min(5, clicks))
    button = str(arguments.get("button") or "left").strip().lower()
    if button not in {"left", "right", "middle"}:
        button = "left"
    if not await _confirm(
        f"将在屏幕坐标 ({x}, {y}) 用 pyautogui 执行 {clicks} 次 {button} 点击，是否继续？",
        confirm_gate=confirm_gate,
        context={"tool": "desktop_mouse_click", "risk": "computer_use", "x": x, "y": y},
        emit_event=emit_event,
    ):
        return "CANCELLED: user denied desktop mouse click"

    def _run() -> str:
        import pyautogui  # type: ignore import-not-found

        pyautogui.click(x=x, y=y, clicks=clicks, button=button)
        return "ok"

    try:
        await asyncio.to_thread(_run)
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "error": str(exc),
                "hint": "需要安装 pyautogui：pip install pyautogui（并在 macOS 上授予辅助功能权限）。",
            },
            ensure_ascii=False,
        )
    return json.dumps({"ok": True, "x": x, "y": y, "clicks": clicks, "button": button}, ensure_ascii=False)


async def _tool_desktop_keyboard_type(
    arguments: Dict[str, Any],
    session: Optional[StudioSession],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    if not computer_use_config_enabled():
        return _desktop_use_blocked_message()
    if session is None:
        return "ERROR: desktop_keyboard_type requires an active Studio session"
    text = str(arguments.get("text", ""))
    if not text:
        return "ERROR: desktop_keyboard_type requires non-empty text"
    if len(text) > 8000:
        return "ERROR: text too long (max 8000 chars)"
    interval_raw = arguments.get("interval_sec", 0.02)
    try:
        interval = float(interval_raw)
    except (TypeError, ValueError):
        interval = 0.02
    interval = max(0.0, min(1.0, interval))
    preview = text if len(text) <= 120 else text[:117] + "..."
    if not await _confirm(
        f"将通过 pyautogui 输入键盘文本（预览）：{preview!r} — 是否继续？",
        confirm_gate=confirm_gate,
        context={"tool": "desktop_keyboard_type", "risk": "computer_use"},
        emit_event=emit_event,
    ):
        return "CANCELLED: user denied desktop keyboard typing"

    def _run() -> None:
        import pyautogui  # type: ignore import-not-found

        pyautogui.write(text, interval=interval)

    try:
        await asyncio.to_thread(_run)
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "error": str(exc),
                "hint": "需要安装 pyautogui：pip install pyautogui（部分字符仅支持 ASCII；复杂输入考虑剪贴板方案）。",
            },
            ensure_ascii=False,
        )
    return json.dumps({"ok": True, "chars": len(text)}, ensure_ascii=False)


META_TOOL_NAMES = {
    "spawn_subagent",
    "cancel_subagent",
    "retry_subagent",
    "query_subagent_status",
    "send_message_to_agent",
    "check_resources",
    "recommend_subagent_model",
    "list_skills",
    "list_mcps",
    "send_bug_report_email",
    "update_email_config",
    "schedule_task",
    "list_scheduled_tasks",
    "cancel_scheduled_task",
    "update_scheduled_task",
    "get_automation_task_logs",
}


async def _confirm(
    question: str,
    *,
    confirm_gate: ConfirmGate,
    context: Optional[Dict[str, Any]] = None,
    emit_event: Optional[Any] = None,
) -> bool:
    payload_context = dict(context or {})
    request_id = str(payload_context.get("request_id") or uuid.uuid4())
    payload_context["request_id"] = request_id
    _log.info(
        "[confirm] requested id=%s question=%s risk=%s tool=%s",
        request_id,
        question,
        payload_context.get("risk"),
        payload_context.get("tool"),
    )
    # IMPORTANT: do not emit confirm_required when the gate auto-approves.
    # Otherwise IM adapters (Feishu/WeChat) will still prompt /approve even though
    # request_confirm() returns immediately (e.g. AutoApproveConfirmGate).
    emit_prompt = emit_event is not None and isinstance(confirm_gate, AsyncConfirmGate)
    if emit_prompt:
        await emit_event(
            {
                "type": "confirm_required",
                "data": {
                    "id": request_id,
                    "question": question,
                    "context": payload_context,
                },
            }
        )
    approved = await confirm_gate.request_confirm(question, payload_context)
    _log.info("[confirm] resolved id=%s approved=%s", request_id, approved)
    if emit_prompt:
        await emit_event(
            {
                "type": "confirm_response",
                "data": {
                    "id": request_id,
                    "approved": approved,
                },
            }
        )
    return approved


def _path_from_arg(path_arg: str) -> Path:
    return Path(path_arg).expanduser()


def _is_protected_config_path(path: Path) -> bool:
    resolved = path.resolve(strict=False)
    home_cfg = (Path.home() / ".agenticx" / "config.yaml").resolve(strict=False)
    if resolved == home_cfg:
        return True
    return resolved.name == "config.yaml" and ".agenticx" in resolved.parts


_TOOL_METADATA_LINE_RE = re.compile(r"^\s*(call_[A-Za-z0-9]+|sa-[a-z0-9]+)\s*$")


def _strip_tool_metadata_noise_lines(text: str) -> str:
    if not text:
        return text
    had_trailing_newline = text.endswith("\n")
    lines = text.splitlines()
    filtered = [line for line in lines if not _TOOL_METADATA_LINE_RE.fullmatch(line)]
    out = "\n".join(filtered)
    if had_trailing_newline and out:
        out += "\n"
    return out


def _command_touches_protected_config(command: str, parts: List[str]) -> bool:
    home_cfg = str((Path.home() / ".agenticx" / "config.yaml").resolve(strict=False))
    markers = {
        "~/.agenticx/config.yaml",
        ".agenticx/config.yaml",
        home_cfg,
    }
    lowered_command = command.lower()
    if any(marker.lower() in lowered_command for marker in markers):
        return True
    for token in parts:
        expanded = token.strip().strip("\"'").replace("\\ ", " ")
        if not expanded:
            continue
        if expanded in markers:
            return True
        if expanded.endswith("/.agenticx/config.yaml"):
            return True
    return False


def _resolve_workspace_path(
    path_arg: str,
    session: Optional[StudioSession] = None,
    *,
    pick_existing: bool = False,
) -> Path:
    raw_path = _path_from_arg(path_arg)
    if _desktop_unrestricted_fs_enabled():
        if raw_path.is_absolute():
            return raw_path.resolve(strict=False)
        return (_workspace_root() / raw_path).resolve(strict=False)

    roots = _session_workspace_roots(session)

    if raw_path.is_absolute():
        resolved = raw_path.resolve(strict=False)
        for root in roots:
            if _is_path_under_root(resolved, root):
                return resolved
        raise ValueError(f"path escapes workspace: {resolved}")

    if pick_existing:
        for root in roots:
            candidate = (root / raw_path).resolve(strict=False)
            if not _is_path_under_root(candidate, root):
                continue
            if candidate.exists():
                return candidate

    primary = roots[0]
    resolved = (primary / raw_path).resolve(strict=False)
    if not _is_path_under_root(resolved, primary):
        raise ValueError(f"path escapes workspace: {resolved}")
    return resolved


def _format_diff(path: Path, old_text: str, new_text: str) -> str:
    diff_lines = difflib.unified_diff(
        old_text.splitlines(),
        new_text.splitlines(),
        fromfile=f"{path} (old)",
        tofile=f"{path} (new)",
        lineterm="",
    )
    return "\n".join(diff_lines)


def _extract_guarded_paths(command_name: str, parts: List[str]) -> List[str]:
    """Extract path-like arguments for guarded read commands."""
    args = parts[1:]
    if not args:
        return []

    if command_name in {"cat", "ls", "tree", "wc"}:
        return [arg for arg in args if arg != "--" and not arg.startswith("-")]

    if command_name in {"head", "tail"}:
        paths: List[str] = []
        skip_next = False
        for arg in args:
            if skip_next:
                skip_next = False
                continue
            if arg == "--":
                continue
            if arg in {"-n", "-c"}:
                skip_next = True
                continue
            if arg.startswith("-"):
                continue
            paths.append(arg)
        return paths

    if command_name == "grep":
        pattern_consumed = False
        explicit_pattern_provided = False
        paths = []
        skip_next = False
        for arg in args:
            if skip_next:
                skip_next = False
                continue
            if arg == "--":
                continue
            if arg in {"-e", "-f", "-m", "-A", "-B", "-C"}:
                if arg == "-e":
                    explicit_pattern_provided = True
                skip_next = True
                continue
            if arg.startswith("-e") and len(arg) > 2:
                explicit_pattern_provided = True
                continue
            if arg.startswith("-"):
                continue
            if not pattern_consumed and not explicit_pattern_provided:
                pattern_consumed = True
                continue
            paths.append(arg)
        return paths

    if command_name == "find":
        paths = []
        for arg in args:
            if arg in {"--", ".", ".."}:
                paths.append(arg)
                continue
            if arg.startswith("-") or arg in {"(", ")", "!", ","}:
                break
            paths.append(arg)
        return paths if paths else ["."]

    return []


def _ensure_paths_within_workspace(
    paths: List[str],
    session: Optional[StudioSession] = None,
) -> Optional[str]:
    """Validate all path arguments stay within session workspace roots."""
    for path_arg in paths:
        if path_arg == "-":
            continue
        try:
            _resolve_workspace_path(path_arg, session, pick_existing=True)
        except ValueError as exc:
            return f"ERROR: {exc}"
    return None


def _first_non_option_token(
    parts: List[str],
    *,
    start: int = 1,
    options_with_value: Optional[set[str]] = None,
) -> Optional[str]:
    """Return first non-option token while skipping known option values."""
    options_with_value = options_with_value or set()
    idx = start
    while idx < len(parts):
        token = parts[idx]
        if token == "--":
            idx += 1
            break
        if token in options_with_value:
            idx += 2
            continue
        if token.startswith("-"):
            idx += 1
            continue
        return token
    if idx < len(parts):
        return parts[idx]
    return None


def _collect_subcommand_risk_reasons(command_name: str, parts: List[str]) -> List[str]:
    """Return confirmation reasons for high-risk subcommands/flags."""
    reasons: List[str] = []
    if command_name == "python":
        if any(token in {"-c", "-m"} for token in parts[1:]):
            reasons.append("python -c/-m may execute arbitrary code")

    if command_name == "pip":
        pip_subcommand = _first_non_option_token(parts)
        if pip_subcommand in {"install", "uninstall", "download", "wheel"}:
            reasons.append(f"pip {pip_subcommand} changes environment or artifacts")

    if command_name == "git":
        git_subcommand = _first_non_option_token(
            parts,
            options_with_value={"-c", "-C", "--git-dir", "--work-tree"},
        )
        if git_subcommand and git_subcommand not in {"status", "log", "diff", "show", "branch"}:
            reasons.append(f"git {git_subcommand} is not in low-risk allowlist")

    return reasons


def _extract_python_script_arg(parts: List[str]) -> Optional[str]:
    """Extract python script path for `python <script>.py` style execution."""
    if any(token in {"-c", "-m"} for token in parts[1:]):
        return None

    idx = 1
    while idx < len(parts):
        token = parts[idx]
        if token == "--":
            idx += 1
            break
        if token in {"-W", "-X"}:
            idx += 2
            continue
        if token.startswith("-"):
            idx += 1
            continue
        return token

    if idx < len(parts):
        return parts[idx]
    return None


def _bash_exec_shell_argv(command: str) -> List[str]:
    """Argv for ``subprocess.run(..., shell=False)`` to run ``command`` in a system shell.

    On Windows, ``/bin/bash`` is not available; use ``cmd.exe`` (COMSPEC) with ``/d /s /c``.
    """
    if sys.platform == "win32":
        comspec = os.environ.get("COMSPEC") or shutil.which("cmd.exe") or "cmd.exe"
        return [comspec, "/d", "/s", "/c", command]
    return ["/bin/bash", "-c", command]


def _bash_exec_default_timeout_sec() -> int:
    """Studio global default for bash_exec when the model omits timeout_sec."""
    try:
        raw = ConfigManager.get_value("tools_options.bash_exec.default_timeout_sec")
    except Exception:
        raw = None
    if raw is None:
        return 30
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return 30
    return max(30, min(3600, v))


def _try_peel_cd_prefix_parts(
    parts: List[str],
    session: Optional[StudioSession],
) -> Optional[Tuple[Path, List[str]]]:
    """If argv is ``cd <path> && ...`` or ``cd <path>; ...``, return cwd + remaining argv."""
    if len(parts) < 4:
        return None
    if parts[0].lower() != "cd":
        return None
    if parts[2] not in ("&&", ";"):
        return None
    rest = parts[3:]
    if not rest:
        return None
    try:
        resolved = _resolve_workspace_path(parts[1], session)
    except ValueError:
        return None
    try:
        if not resolved.is_dir():
            return None
    except OSError:
        return None
    return (resolved, rest)


async def _tool_bash_exec(
    arguments: Dict[str, Any],
    session: Optional[StudioSession] = None,
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    command = str(arguments.get("command", "")).strip()
    if not command:
        return "ERROR: missing command"
    if len(command) > MAX_BASH_EXEC_COMMAND_CHARS:
        return f"ERROR: command exceeds maximum length ({MAX_BASH_EXEC_COMMAND_CHARS} characters)"

    perm_deny = tool_denied_by_session_permissions("bash_exec")
    if perm_deny:
        return f"ERROR: {perm_deny}"

    raw_timeout = arguments.get("timeout_sec")
    if raw_timeout is None:
        timeout_sec = _bash_exec_default_timeout_sec()
    elif isinstance(raw_timeout, str) and not str(raw_timeout).strip():
        timeout_sec = _bash_exec_default_timeout_sec()
    else:
        try:
            timeout_sec = int(raw_timeout)
        except (TypeError, ValueError):
            timeout_sec = _bash_exec_default_timeout_sec()
    timeout_sec = max(1, min(3600, timeout_sec))
    cwd_arg = arguments.get("cwd")
    if cwd_arg:
        try:
            cwd = _resolve_workspace_path(str(cwd_arg), session)
        except ValueError as exc:
            return f"ERROR: {exc}"
    else:
        cwd = None

    try:
        parts = shlex.split(command)
    except ValueError as exc:
        return f"ERROR: command parse failed: {exc}"
    if not parts:
        return "ERROR: empty command"

    if cwd is None:
        peeled = _try_peel_cd_prefix_parts(parts, session)
        if peeled:
            cwd, parts = peeled
            command = shlex.join(parts)

    command_name = Path(parts[0]).name
    if command_name.startswith("firecrawl_"):
        return (
            f"ERROR: '{command_name}' is an MCP tool name, not a shell command. "
            "Use mcp_call with JSON arguments, e.g. "
            "{\"tool_name\":\"firecrawl_scrape\",\"arguments\":{\"url\":\"https://example.com\"}}. "
            "For multiple URLs, iterate single-url calls or use firecrawl_crawl/firecrawl_map."
        )
    if session is not None and getattr(session, "mcp_hub", None) is not None:
        try:
            routed = getattr(session.mcp_hub, "_tool_routing", {}) or {}
            if command_name in routed:
                return (
                    f"ERROR: '{command_name}' is an MCP tool name, not a shell command. "
                    "Use mcp_call with JSON arguments. "
                    "Tip: call list_mcps and copy tool_name from mcp_tool_names."
                )
        except Exception:
            pass
    if command_name == "cd":
        target = str(parts[1]) if len(parts) > 1 else "~"
        try:
            resolved = _resolve_workspace_path(target, session)
        except ValueError as exc:
            return f"ERROR: {exc}"
        if not resolved.exists() or not resolved.is_dir():
            return f"ERROR: target directory not found: {resolved}"
        return (
            f"OK: cd {resolved}\n"
            "说明：`cd` 是 shell 内建命令，不会在无 shell 的单次执行中持久化。\n"
            "请在后续 bash_exec 调用里通过 `cwd` 参数指定工作目录。"
        )

    if command_name not in SAFE_COMMANDS:
        confirm_question = (
            f"Command '{command_name}' is not in SAFE_COMMANDS. Execute anyway?"
        )
        if not await _confirm(
            confirm_question,
            confirm_gate=confirm_gate,
            context={"tool": "bash_exec", "command": command, "risk": "non_whitelisted"},
            emit_event=emit_event,
        ):
            return "CANCELLED: user denied non-whitelisted command"

    if _command_touches_protected_config(command, parts):
        return (
            "ERROR: direct access to ~/.agenticx/config.yaml is blocked for safety. "
            "Use update_email_config for notifications.email.* changes."
        )

    if command_name in PATH_GUARDED_READ_COMMANDS:
        guarded_paths = _extract_guarded_paths(command_name, parts)
        validation_error = _ensure_paths_within_workspace(guarded_paths, session)
        if validation_error:
            return validation_error

    if command_name == "python":
        python_script = _extract_python_script_arg(parts)
        if python_script and python_script != "-":
            try:
                _resolve_workspace_path(python_script, session, pick_existing=True)
            except ValueError as exc:
                return f"ERROR: {exc}"

    risk_reasons: List[str] = []
    risk_reasons.extend(_collect_subcommand_risk_reasons(command_name, parts))
    if command_name == "python" and _extract_python_script_arg(parts):
        risk_reasons.append("python script execution requires confirmation")
    if re.search(r"(;|&&|\|\||\||`|\$\(|>|<|\n)", command):
        risk_reasons.append("suspicious shell metacharacters")
    if command_name == "rm" and any(flag in {"-rf", "-fr", "-r", "-R", "-f", "--no-preserve-root"} for flag in parts[1:]):
        risk_reasons.append("destructive rm flags")
    if command_name == "git":
        if len(parts) >= 3 and parts[1] == "reset" and parts[2] == "--hard":
            risk_reasons.append("destructive git reset --hard")
        if len(parts) >= 2 and parts[1] == "clean" and any(flag.startswith("-f") for flag in parts[2:]):
            risk_reasons.append("destructive git clean")
        if len(parts) >= 2 and parts[1] == "push" and any("--force" in flag for flag in parts[2:]):
            risk_reasons.append("force push")
    if command_name in {"dd", "mkfs", "shutdown", "reboot", "poweroff"}:
        risk_reasons.append("high-risk system command")

    if risk_reasons:
        joined_reasons = ", ".join(risk_reasons)
        if not await _confirm(
            f"High-risk command detected ({joined_reasons}). Execute anyway?",
            confirm_gate=confirm_gate,
            context={
                "tool": "bash_exec",
                "command": command,
                "risk": "high",
                "reasons": risk_reasons,
            },
            emit_event=emit_event,
        ):
            return "CANCELLED: user denied high-risk command"

    use_shell = bool(re.search(r"(;|&&|\|\||\||`|\$\(|>|<|\n)", command))
    if not use_shell:
        # Support common env-prefix command style like: FOO=bar cmd --arg
        use_shell = bool(
            re.match(
                r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)+[^\s].*$",
                command,
            )
        ) or command.lstrip().startswith("export ")
    if sys.platform == "win32" and not use_shell and parts:
        resolved0 = shutil.which(parts[0])
        if resolved0:
            parts = [resolved0] + list(parts[1:])
    argv = _bash_exec_shell_argv(command) if use_shell else parts
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd) if cwd else None,
        )
    except Exception as exc:
        return f"ERROR: command failed to start: {exc}"

    stdout_lines: List[str] = []
    stderr_lines: List[str] = []
    _STREAM_THROTTLE_SEC = 0.2
    _last_emit_time = 0.0

    async def _read_pipe(
        stream: asyncio.StreamReader,
        target: List[str],
        label: str,
    ) -> None:
        nonlocal _last_emit_time
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            target.append(line)
            if emit_event is not None:
                now = asyncio.get_event_loop().time()
                if now - _last_emit_time >= _STREAM_THROTTLE_SEC:
                    _last_emit_time = now
                    try:
                        await emit_event({
                            "type": "tool_output",
                            "data": {
                                "stream": label,
                                "line": line,
                            },
                        })
                    except Exception:
                        pass

    try:
        await asyncio.wait_for(
            asyncio.gather(
                _read_pipe(proc.stdout, stdout_lines, "stdout"),
                _read_pipe(proc.stderr, stderr_lines, "stderr"),
            ),
            timeout=max(1, timeout_sec),
        )
        await proc.wait()
    except asyncio.TimeoutError:
        try:
            proc.kill()
            await proc.wait()
        except Exception:
            pass
        return f"ERROR: command timeout after {timeout_sec}s"

    stdout = "\n".join(stdout_lines).strip()
    stderr = "\n".join(stderr_lines).strip()
    return (
        f"exit_code={proc.returncode}\n"
        f"stdout:\n{stdout or '(empty)'}\n"
        f"stderr:\n{stderr or '(empty)'}"
    )


def _tool_file_read(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    try:
        path = _resolve_workspace_path(str(arguments.get("path", "")), session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not path.exists():
        return f"ERROR: file not found: {path}"
    if not path.is_file():
        return f"ERROR: not a file: {path}"

    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return f"ERROR: read failed: {exc}"

    start_line = arguments.get("start_line")
    end_line = arguments.get("end_line")
    if start_line is not None or end_line is not None:
        lines = content.splitlines()
        start = max(1, int(start_line or 1))
        end = min(len(lines), int(end_line or len(lines)))
        if start > end:
            return "ERROR: invalid line range"
        selected = lines[start - 1 : end]
        numbered = [f"{idx+start}|{line}" for idx, line in enumerate(selected)]
        return "\n".join(numbered)

    if len(content) > MAX_READ_CHARS:
        out = content[:MAX_READ_CHARS] + f"\n... (truncated, total {len(content)} chars)"
    else:
        out = content
    if session is not None:
        tracker = getattr(session, "file_state_tracker", None)
        if tracker is not None and start_line is None and end_line is None:
            tracker.record_read(str(path), content)
    return out


async def _tool_file_write(
    arguments: Dict[str, Any],
    session: StudioSession,
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    raw_path = str(arguments.get("path", "")).strip()
    if not raw_path:
        return (
            "ERROR: missing required parameter 'path'. "
            "You must provide a full file path, e.g. file_write(path='/Users/.../file.py', content='...')"
        )
    raw_content = arguments.get("content")
    if raw_content is None:
        return (
            "ERROR: missing required parameter 'content'. "
            "You must provide file content, e.g. file_write(path='/Users/.../file.py', content='...')"
        )
    try:
        path = _resolve_workspace_path(raw_path, session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if _is_protected_config_path(path):
        return (
            "ERROR: direct writes to ~/.agenticx/config.yaml are blocked for safety. "
            "Use update_email_config meta tool for notifications.email.* updates."
        )
    new_text = _strip_tool_metadata_noise_lines(str(raw_content))
    old_text = ""
    if path.exists():
        if not path.is_file():
            return f"ERROR: not a file: {path}"
        try:
            old_text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return f"ERROR: read old file failed: {exc}"

    diff = _format_diff(path, old_text, new_text)
    if not await _confirm(
        f"Write changes to {path}?",
        confirm_gate=confirm_gate,
        context={"tool": "file_write", "path": str(path), "diff": diff},
        emit_event=emit_event,
    ):
        return "CANCELLED: user denied file write"

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new_text, encoding="utf-8")
    except OSError as exc:
        return f"ERROR: write failed: {exc}"
    scratchpad = getattr(session, "scratchpad", None)
    if isinstance(scratchpad, dict):
        scratchpad["__taskspace_hint__"] = str(path)
    return f"OK: wrote {path}"


async def _tool_file_edit(
    arguments: Dict[str, Any],
    session: Optional[StudioSession] = None,
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    try:
        path = _resolve_workspace_path(str(arguments.get("path", "")), session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if _is_protected_config_path(path):
        return (
            "ERROR: direct edits to ~/.agenticx/config.yaml are blocked for safety. "
            "Use update_email_config meta tool for notifications.email.* updates."
        )
    old_text_snippet = str(arguments.get("old_text", ""))
    new_text_snippet = _strip_tool_metadata_noise_lines(str(arguments.get("new_text", "")))
    occurrence = int(arguments.get("occurrence", 1) or 1)
    if old_text_snippet == "":
        return "ERROR: old_text cannot be empty"
    if occurrence < 1:
        return "ERROR: occurrence must be >= 1"
    if not path.exists() or not path.is_file():
        return f"ERROR: file not found: {path}"

    tracker = getattr(session, "file_state_tracker", None) if session is not None else None
    if tracker is not None:
        stale = tracker.check_staleness(str(path))
        if stale:
            return stale

    try:
        old_text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return f"ERROR: read failed: {exc}"
    if old_text_snippet not in old_text:
        return "ERROR: old_text not found in file"

    start_idx = -1
    cursor = 0
    for _ in range(occurrence):
        start_idx = old_text.find(old_text_snippet, cursor)
        if start_idx < 0:
            return f"ERROR: old_text occurrence {occurrence} not found"
        cursor = start_idx + len(old_text_snippet)

    end_idx = start_idx + len(old_text_snippet)
    updated_text = old_text[:start_idx] + new_text_snippet + old_text[end_idx:]

    diff = _format_diff(path, old_text, updated_text)
    if not await _confirm(
        f"Apply edit to {path}?",
        confirm_gate=confirm_gate,
        context={"tool": "file_edit", "path": str(path), "diff": diff},
        emit_event=emit_event,
    ):
        return "CANCELLED: user denied file edit"

    try:
        path.write_text(updated_text, encoding="utf-8")
    except OSError as exc:
        return f"ERROR: write failed: {exc}"
    return f"OK: edited {path}"


async def _tool_codegen(
    arguments: Dict[str, Any],
    session: StudioSession,
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    description = str(arguments.get("description", "")).strip()
    if not description:
        return "ERROR: description is required"
    target = str(arguments.get("target") or _detect_target(description)).strip().lower()

    try:
        llm = ProviderResolver.resolve(
            provider_name=session.provider_name,
            model=session.model_name,
        )
    except Exception as exc:
        return f"ERROR: cannot resolve provider: {exc}"

    try:
        engine = CodeGenEngine(llm)
        generated = engine.generate(target=target, description=description, context={"reference_files": dict(session.context_files)})
    except Exception as exc:
        return f"ERROR: code generation failed: {exc}"

    output_path_raw = str(arguments.get("output_path", "")).strip()
    if output_path_raw:
        try:
            output_path = _resolve_workspace_path(output_path_raw, session)
        except ValueError as exc:
            return f"ERROR: invalid output_path: {exc}"
    else:
        # If user did not explicitly provide output directory/path, require confirmation
        # on the inferred destination to prevent writing to unexpected locations.
        inferred = infer_output_path(target=target, description=description)
        try:
            output_path = _resolve_workspace_path(str(inferred), session)
        except ValueError as exc:
            return f"ERROR: inferred output path invalid: {exc}"
        should_confirm = isinstance(confirm_gate, AsyncConfirmGate) or sys.stdin.isatty()
        if should_confirm and not await _confirm(
            (
                "未检测到你显式指定落盘目录。"
                f"建议写入：{output_path}。是否确认按该路径生成？"
            ),
            confirm_gate=confirm_gate,
            context={"tool": "codegen", "path": str(output_path), "target": target},
            emit_event=emit_event,
        ):
            return (
                "CANCELLED: user denied inferred codegen path. "
                "Please provide output_path explicitly, e.g. "
                '{"target":"agent","description":"...","output_path":"./docs/xxx.md"}'
            )
    try:
        write_generated_file(output_path, generated.code)
    except Exception as exc:
        return f"ERROR: failed to write generated file: {exc}"
    if not output_path.exists() or not output_path.is_file():
        return f"ERROR: write returned but output missing on disk: {output_path}"

    session.artifacts[output_path] = generated.code
    try:
        from agenticx.cli.studio import HistoryRecord

        session.history.append(HistoryRecord(description=description, file_path=output_path, target=target))
    except Exception:
        pass
    return f"OK: generated {output_path.resolve()}"


def _tool_mcp_connect(arguments: Dict[str, Any], session: StudioSession) -> str:
    name = str(arguments.get("name", "")).strip()
    if not name:
        return "ERROR: missing server name"

    if session.mcp_hub is None:
        from agenticx.tools.mcp_hub import MCPHub

        session.mcp_hub = MCPHub(clients=[], auto_mode=False)
    ok, detail = mcp_connect(session.mcp_hub, session.mcp_configs, session.connected_servers, name)
    if ok:
        return "OK"
    d = (detail or "").strip()
    return f"ERROR: connect failed: {d}" if d else "ERROR: connect failed"


def _find_git_root_for_cc_bridge(start: Path, *, max_up: int = 48) -> Optional[Path]:
    """Walk upward from start looking for a `.git` directory."""
    cur = start
    for _ in range(max_up):
        try:
            if (cur / ".git").exists():
                return cur
        except OSError:
            break
        parent = cur.parent
        if parent == cur:
            break
        cur = parent
    return None


def _session_default_cwd_for_cc_bridge(session: StudioSession) -> str:
    w = str(getattr(session, "workspace_dir", "") or "").strip()
    if w:
        base = Path(w).expanduser().resolve(strict=False)
        git_root = _find_git_root_for_cc_bridge(base)
        if git_root is not None:
            return str(git_root)
        return str(base)
    return str(Path.cwd().resolve(strict=False))


def _cc_bridge_is_loopback_base(base_url: str) -> tuple[bool, str, int]:
    """Parse bridge URL and return (is_loopback, host, port)."""
    try:
        parsed = urlparse(base_url)
    except ValueError:
        return (False, "127.0.0.1", 9742)
    host = (parsed.hostname or "").strip().lower()
    port = int(parsed.port or 9742)
    is_loopback = host in {"127.0.0.1", "localhost", "::1", "[::1]"}
    return (is_loopback, host or "127.0.0.1", port)


def _cc_bridge_http_client_kwargs(base_url: str, timeout_sec: float) -> Dict[str, Any]:
    """Build httpx client kwargs; bypass env proxies for localhost bridge calls."""
    kwargs: Dict[str, Any] = {"timeout": timeout_sec}
    is_loopback, _host, _port = _cc_bridge_is_loopback_base(base_url)
    if is_loopback:
        # Avoid SOCKS/HTTP proxy hijacking localhost requests (common source of bridge 502).
        kwargs["transport"] = __import__("httpx").AsyncHTTPTransport()
        kwargs["trust_env"] = False
    return kwargs


def _cc_bridge_proc_running() -> bool:
    global _CC_BRIDGE_AUTO_PROC
    return _CC_BRIDGE_AUTO_PROC is not None and _CC_BRIDGE_AUTO_PROC.poll() is None


def _cc_bridge_idle_stop_seconds() -> int:
    """Idle timeout for auto-started local bridge (0 disables auto-stop)."""
    raw = os.getenv("AGX_CC_BRIDGE_IDLE_STOP_SECONDS", "").strip()
    if not raw:
        try:
            cfg = ConfigManager.get_value("cc_bridge.idle_stop_seconds")
        except Exception:
            cfg = None
        if cfg is not None:
            raw = str(cfg).strip()
    if not raw:
        return 600
    try:
        v = int(raw)
    except ValueError:
        return 600
    return max(0, min(86400, v))


async def _cc_bridge_has_active_sessions(base_url: str, token: str) -> bool:
    try:
        import httpx
    except ImportError:
        return True
    try:
        async with httpx.AsyncClient(**_cc_bridge_http_client_kwargs(base_url, 5.0)) as client:
            r = await client.get(
                f"{base_url}/v1/sessions",
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception:
        return True
    if r.status_code != 200:
        return True
    try:
        body = r.json()
    except Exception:
        return True
    sessions = body.get("sessions")
    return isinstance(sessions, list) and len(sessions) > 0


async def _cc_bridge_idle_reaper(base_url: str, token: str, idle_sec: int) -> None:
    global _CC_BRIDGE_AUTO_PROC
    global _CC_BRIDGE_LAST_ACTIVE_MONO
    if idle_sec <= 0:
        return
    await asyncio.sleep(float(idle_sec))
    if not _cc_bridge_proc_running():
        return
    if (time.monotonic() - _CC_BRIDGE_LAST_ACTIVE_MONO) < float(idle_sec):
        return
    if await _cc_bridge_has_active_sessions(base_url, token):
        return
    proc = _CC_BRIDGE_AUTO_PROC
    if proc is None:
        return
    try:
        proc.terminate()
        try:
            await asyncio.to_thread(proc.wait, 3)
        except Exception:
            proc.kill()
    except Exception:
        pass
    _CC_BRIDGE_AUTO_PROC = None


def _touch_cc_bridge_activity(base_url: str, token: str) -> None:
    global _CC_BRIDGE_IDLE_TASK
    global _CC_BRIDGE_LAST_ACTIVE_MONO
    if not _cc_bridge_proc_running():
        return
    idle_sec = _cc_bridge_idle_stop_seconds()
    if idle_sec <= 0:
        return
    _CC_BRIDGE_LAST_ACTIVE_MONO = time.monotonic()
    if _CC_BRIDGE_IDLE_TASK is not None and not _CC_BRIDGE_IDLE_TASK.done():
        _CC_BRIDGE_IDLE_TASK.cancel()
    _CC_BRIDGE_IDLE_TASK = asyncio.create_task(
        _cc_bridge_idle_reaper(base_url, token, idle_sec)
    )


def _ensure_cc_bridge_local_process(base_url: str, token: str) -> tuple[bool, str]:
    """Best-effort lazy autostart for local cc-bridge process."""
    global _CC_BRIDGE_AUTO_PROC
    if _cc_bridge_proc_running():
        return (True, "already running")
    is_loopback, host, port = _cc_bridge_is_loopback_base(base_url)
    if not is_loopback:
        return (False, "non-loopback URL; skip autostart")

    visible = os.getenv("AGX_CC_BRIDGE_AUTOSTART_VISIBLE_TERMINAL", "").strip().lower() in {
        "1", "true", "yes", "on"
    }
    if visible and sys.platform == "darwin":
        try:
            agx_path = shutil.which("agx") or "agx"
            cmd = (
                f"export CC_BRIDGE_TOKEN={shlex.quote(token)} AGX_CC_BRIDGE_TOKEN={shlex.quote(token)}; "
                f"if command -v {shlex.quote(agx_path)} >/dev/null 2>&1; then "
                f"{shlex.quote(agx_path)} cc-bridge serve --host {shlex.quote(host)} --port {port}; "
                f"else {shlex.quote(sys.executable)} -m agenticx.cli.main cc-bridge serve "
                f"--host {shlex.quote(host)} --port {port}; fi"
            )
            cmd_escaped = cmd.replace("\\", "\\\\").replace('"', '\\"')
            script = (
                'tell application "Terminal"\n'
                "activate\n"
                f'do script "{cmd_escaped}"\n'
                "end tell\n"
            )
            subprocess.Popen(
                ["osascript", "-e", script],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                text=True,
            )
            return (True, "started in visible Terminal.app")
        except Exception as exc:
            _log.warning("visible cc-bridge terminal launch failed: %s", exc)

    env = os.environ.copy()
    if token:
        env.setdefault("CC_BRIDGE_TOKEN", token)
        env.setdefault("AGX_CC_BRIDGE_TOKEN", token)

    candidates: list[list[str]] = []
    agx_bin = shutil.which("agx")
    if agx_bin:
        candidates.append([agx_bin, "cc-bridge", "serve", "--host", host, "--port", str(port)])
    candidates.append([sys.executable, "-m", "agenticx.cli.main", "cc-bridge", "serve", "--host", host, "--port", str(port)])

    last_err = "unknown"
    for cmd in candidates:
        try:
            _CC_BRIDGE_AUTO_PROC = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                env=env,
                start_new_session=True,
                text=True,
            )
            return (True, f"started pid={_CC_BRIDGE_AUTO_PROC.pid}")
        except Exception as exc:  # pragma: no cover - platform/env specific
            last_err = str(exc)
            continue
    _CC_BRIDGE_AUTO_PROC = None
    return (False, f"failed to spawn bridge process: {last_err}")


async def _tool_cc_bridge_http(
    session: StudioSession,
    method: str,
    path: str,
    json_body: Optional[Dict[str, Any]] = None,
    *,
    timeout_sec: float = 300.0,
) -> str:
    _ = session
    from agenticx.cc_bridge.settings import (
        cc_bridge_base_url,
        cc_bridge_token,
        validate_bridge_url_for_studio,
    )

    try:
        import httpx
    except ImportError:
        return "ERROR: httpx is required for cc_bridge tools"

    base = cc_bridge_base_url()
    err = validate_bridge_url_for_studio(base)
    if err:
        return f"ERROR: {err}"
    token = cc_bridge_token()
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{base}{path}"
    client_kwargs = _cc_bridge_http_client_kwargs(base, timeout_sec)

    async def _do_request() -> Any:
        async with httpx.AsyncClient(**client_kwargs) as client:
            m = method.upper()
            if m == "GET":
                return await client.get(url, headers=headers)
            elif m == "POST":
                return await client.post(url, headers=headers, json=json_body)
            elif m == "DELETE":
                return await client.delete(url, headers=headers)
            else:
                return f"ERROR: unsupported HTTP method {method}"
    tried_autostart = False
    try:
        r = await _do_request()
        if isinstance(r, str):
            return r
    except httpx.ConnectError as exc:
        started, detail = _ensure_cc_bridge_local_process(base, token)
        if started:
            tried_autostart = True
            await asyncio.sleep(0.9)
            try:
                r = await _do_request()
                if isinstance(r, str):
                    return r
            except httpx.ConnectError as exc2:
                return (
                    "ERROR: CC bridge not reachable and autostart did not become healthy. "
                    f"Autostart: {detail}. URL: {base}. Details: {exc2}"
                )
            except httpx.TimeoutException as exc2:
                return f"ERROR: CC bridge autostart succeeded but HTTP timed out: {exc2}"
            except httpx.HTTPError as exc2:
                return f"ERROR: bridge HTTP failed after autostart: {exc2}"
        else:
            return (
                "ERROR: CC bridge not reachable (connection refused). "
                f"Autostart skipped/failed: {detail}. "
                "You can still start manually: agx cc-bridge serve "
                f"(expects {base}). Details: {exc}"
            )
    except httpx.TimeoutException as exc:
        return f"ERROR: CC bridge HTTP timed out: {exc}"
    except httpx.HTTPError as exc:
        return f"ERROR: bridge HTTP failed: {exc}"
    # Bridge may be reachable but unhealthy (e.g., stale process / boot race / reverse proxy 5xx).
    if r.status_code >= 500:
        started, detail = _ensure_cc_bridge_local_process(base, token)
        if started:
            tried_autostart = True
            await asyncio.sleep(0.9)
            try:
                r2 = await _do_request()
                if isinstance(r2, str):
                    return r2
                r = r2
            except httpx.HTTPError as exc:
                return f"ERROR: bridge HTTP failed after 5xx recovery: {exc}"
            except Exception as exc:
                return f"ERROR: bridge 5xx recovery failed: {exc}"
        if r.status_code >= 500:
            # one-shot lightweight diagnostics for clearer operator message
            health_hint = ""
            try:
                async with httpx.AsyncClient(**_cc_bridge_http_client_kwargs(base, 5.0)) as client:
                    hr = await client.get(f"{base}/health")
                    health_hint = f"health={hr.status_code}"
            except Exception:
                health_hint = "health=unreachable"
            body = (r.text or "").strip()
            if not body:
                body = "<empty>"
            return (
                f"ERROR: bridge {r.status_code}: {body[:400]} "
                f"(diag: {health_hint}, autostart={detail})"
            )
    text = r.text
    if r.status_code in (401, 403):
        return (
            f"ERROR: CC bridge auth rejected (HTTP {r.status_code}). "
            "Use the same token on the bridge as in ~/.agenticx/config.yaml (cc_bridge.token) "
            f"or set matching CC_BRIDGE_TOKEN / AGX_CC_BRIDGE_TOKEN. Body: {text[:800]}"
        )
    if r.status_code >= 400:
        return f"ERROR: bridge {r.status_code}: {text[:2000]}"
    _touch_cc_bridge_activity(base, token)
    if tried_autostart:
        return f"{text}\n\n[cc-bridge] autostarted in background."
    return text


async def _tool_cc_bridge_start(arguments: Dict[str, Any], session: StudioSession) -> str:
    from agenticx.cc_bridge.settings import cc_bridge_mode, cc_bridge_mode_configured

    explicit_mode = str(arguments.get("mode", "") or "").strip().lower()
    if explicit_mode not in {"", "headless", "visible_tui"}:
        return "ERROR: mode must be one of: headless, visible_tui"

    def _latest_user_intent() -> str:
        hist = getattr(session, "chat_history", None) or []
        for msg in reversed(hist):
            if str(msg.get("role", "")) == "user":
                return str(msg.get("content", "") or "")
        return ""

    def _choose_mode(config_mode: str, configured_mode: str | None) -> str:
        if explicit_mode in {"headless", "visible_tui"}:
            return explicit_mode
        sid = str(getattr(session, "session_id", "") or "").strip().lower()
        if sid.startswith("im-"):
            return "headless"
        # Respect explicit user config from Settings first; only auto-infer when
        # no persisted mode is set.
        if configured_mode in {"headless", "visible_tui"}:
            return configured_mode
        intent = _latest_user_intent().lower()
        interactive_hints = (
            "visible_tui",
            "visible tui",
            "可见",
            "交互",
            "终端",
            "手动",
            "按键",
            "点击确认",
            "在cc里",
        )
        autonomous_hints = (
            "自动",
            "直接给我结果",
            "报告",
            "摘要",
            "总结",
            "分析",
            "不要改代码",
            "无需交互",
            "无需确认",
            "session_id +",
        )
        if any(k in intent for k in interactive_hints):
            return "visible_tui"
        if any(k in intent for k in autonomous_hints):
            return "headless"
        return config_mode

    cwd = str(arguments.get("cwd", "") or "").strip()
    if not cwd:
        cwd = _session_default_cwd_for_cc_bridge(session)
    auto = bool(arguments.get("auto_allow_permissions", False))
    resolved_mode = _choose_mode(cc_bridge_mode(), cc_bridge_mode_configured())
    return await _tool_cc_bridge_http(
        session,
        "POST",
        "/v1/sessions",
        {"cwd": cwd, "auto_allow_permissions": auto, "mode": resolved_mode},
        timeout_sec=60.0,
    )


async def _cc_bridge_resolve_session_mode(session: StudioSession, sid: str) -> Tuple[Optional[str], str]:
    """Resolve headless|visible_tui for sid via GET /v1/sessions/{id}, then list fallback.

    Returns (mode, ""). If session is missing, (None, error_text).
    """
    from agenticx.cc_bridge.settings import (
        cc_bridge_base_url,
        cc_bridge_mode,
        cc_bridge_token,
        validate_bridge_url_for_studio,
    )

    try:
        import httpx
    except ImportError:
        return (None, "ERROR: httpx is required for cc_bridge tools")

    detail = await _tool_cc_bridge_http(
        session, "GET", f"/v1/sessions/{sid}", None, timeout_sec=15.0
    )
    if not detail.startswith("ERROR:"):
        try:
            obj = json.loads(detail)
            if isinstance(obj, dict):
                mv = str(obj.get("mode", "")).strip().lower()
                if mv in {"headless", "visible_tui"}:
                    return (mv, "")
        except Exception:
            pass
    else:
        err = detail
        if "session not found" in err.lower():
            return (None, err)

    resolved_mode = str(cc_bridge_mode() or "headless").strip().lower()
    if resolved_mode not in {"headless", "visible_tui"}:
        resolved_mode = "headless"

    base = cc_bridge_base_url()
    err = validate_bridge_url_for_studio(base)
    if not err:
        token = cc_bridge_token()
        headers = {"Authorization": f"Bearer {token}"}
        list_url = f"{base}/v1/sessions"
        try:
            async with httpx.AsyncClient(**_cc_bridge_http_client_kwargs(base, 15.0)) as client:
                r = await client.get(list_url, headers=headers)
            if r.status_code < 400:
                payload = r.json() if r.content else {}
                if isinstance(payload, dict):
                    sessions = payload.get("sessions")
                    if isinstance(sessions, list):
                        for item in sessions:
                            if not isinstance(item, dict):
                                continue
                            if str(item.get("session_id", "")).strip() != sid:
                                continue
                            mode_value = str(item.get("mode", "")).strip().lower()
                            if mode_value in {"headless", "visible_tui"}:
                                return (mode_value, "")
                            break
        except Exception:
            pass

    return (resolved_mode, "")


async def _tool_cc_bridge_send(arguments: Dict[str, Any], session: StudioSession) -> str:
    sid = str(arguments.get("session_id", "")).strip()
    prompt = str(arguments.get("prompt", "") or "")
    if not sid or not prompt:
        return "ERROR: session_id and prompt are required"
    wait = arguments.get("wait_seconds", 120.0)
    try:
        wait_f = float(wait)
    except (TypeError, ValueError):
        wait_f = 120.0
    wait_f = max(1.0, min(3600.0, wait_f))

    resolved_mode, resolve_err = await _cc_bridge_resolve_session_mode(session, sid)
    if resolved_mode is None:
        return resolve_err

    async def _post_message() -> str:
        return await _tool_cc_bridge_http(
            session,
            "POST",
            f"/v1/sessions/{sid}/message",
            {"text": prompt, "wait_seconds": wait_f},
            timeout_sec=wait_f + 45.0,
        )

    def _decorate_message_response(resp_text: str, *, mode_corrected: bool) -> str:
        if not mode_corrected:
            return resp_text
        if resp_text.startswith("ERROR:"):
            return resp_text
        try:
            obj = json.loads(resp_text)
            if isinstance(obj, dict):
                obj["mode_corrected"] = True
                return json.dumps(obj, ensure_ascii=False)
        except Exception:
            pass
        return f"{resp_text}\n[cc-bridge] mode_corrected=true"

    if resolved_mode == "visible_tui":
        write_res = await _tool_cc_bridge_http(
            session,
            "POST",
            f"/v1/sessions/{sid}/write",
            {"data": f"{prompt}\r"},
            timeout_sec=30.0,
        )
        if write_res.startswith("ERROR:") and "write is only for visible_tui" in write_res.lower():
            msg_res = await _post_message()
            return _decorate_message_response(msg_res, mode_corrected=True)
        if write_res.startswith("ERROR:"):
            return write_res
        return json.dumps(
            {
                "ok": True,
                "mode": "visible_tui",
                "interactive": True,
                "parsed_response": "",
                "parse_confidence": 0.0,
                "tail": "",
                "status": "sent",
                "final_available": False,
                "evidence_level": "none",
                "must_not_summarize_as_complete": True,
                "message": "Prompt sent to visible TUI terminal",
                "next_action": "wait_for_user_terminal_interaction",
            },
            ensure_ascii=False,
        )

    resp_text = await _post_message()
    if resp_text.startswith("ERROR:"):
        return resp_text
    try:
        obj = json.loads(resp_text)
        if isinstance(obj, dict):
            ok = bool(obj.get("ok", False))
            if not ok:
                obj.setdefault("final_available", False)
                obj.setdefault("evidence_level", "low")
                obj.setdefault("must_not_summarize_as_complete", True)
                obj.setdefault(
                    "message",
                    "No verified final output from cc_bridge_send; report status and next action only.",
                )
                return json.dumps(obj, ensure_ascii=False)
    except Exception:
        pass
    return resp_text


async def _tool_cc_bridge_list(arguments: Dict[str, Any], session: StudioSession) -> str:
    _ = arguments
    return await _tool_cc_bridge_http(session, "GET", "/v1/sessions", None, timeout_sec=30.0)


async def _tool_cc_bridge_stop(arguments: Dict[str, Any], session: StudioSession) -> str:
    from agenticx.cc_bridge.settings import (
        cc_bridge_base_url,
        cc_bridge_token,
        validate_bridge_url_for_studio,
    )

    try:
        import httpx
    except ImportError:
        return "ERROR: httpx is required for cc_bridge tools"

    sid = str(arguments.get("session_id", "") or "").strip()
    force = bool(arguments.get("force", False))
    if not sid:
        return "ERROR: session_id required"
    if not force:
        base = cc_bridge_base_url()
        err = validate_bridge_url_for_studio(base)
        if not err:
            token = cc_bridge_token()
            headers = {"Authorization": f"Bearer {token}"}
            try:
                async with httpx.AsyncClient(**_cc_bridge_http_client_kwargs(base, 10.0)) as client:
                    resp = await client.get(f"{base}/v1/sessions", headers=headers)
                if resp.status_code < 400:
                    payload = resp.json() if resp.content else {}
                    rows = payload.get("sessions") if isinstance(payload, dict) else None
                    if isinstance(rows, list):
                        for row in rows:
                            if not isinstance(row, dict):
                                continue
                            if str(row.get("session_id", "")).strip() != sid:
                                continue
                            mode = str(row.get("mode", "")).strip().lower()
                            poll = row.get("poll")
                            if mode == "visible_tui" and poll is None:
                                return (
                                    "ERROR: visible_tui session is still active; stopping now may lose interactive state. "
                                    "Only stop after user confirms terminal flow is done, or call cc_bridge_stop with force=true."
                                )
                            break
            except Exception:
                pass
    return await _tool_cc_bridge_http(session, "DELETE", f"/v1/sessions/{sid}", None, timeout_sec=30.0)


async def _tool_cc_bridge_permission(arguments: Dict[str, Any], session: StudioSession) -> str:
    sid = str(arguments.get("session_id", "") or "").strip()
    rid = str(arguments.get("request_id", "") or "").strip()
    if not sid or not rid:
        return "ERROR: session_id and request_id are required"
    if "allow" not in arguments:
        return "ERROR: allow is required"
    allow = bool(arguments.get("allow"))
    deny_message = str(arguments.get("deny_message", "") or "Denied by operator")
    body: Dict[str, Any] = {
        "request_id": rid,
        "allow": allow,
        "deny_message": deny_message,
    }
    tuid = arguments.get("tool_use_id")
    if tuid is not None and str(tuid).strip():
        body["tool_use_id"] = str(tuid).strip()
    tin = arguments.get("tool_input")
    if isinstance(tin, dict):
        body["tool_input"] = tin
    return await _tool_cc_bridge_http(
        session,
        "POST",
        f"/v1/sessions/{sid}/permission",
        body,
        timeout_sec=30.0,
    )


_SCREENSHOT_TOOL_NAMES = frozenset({
    "browser_screenshot", "screenshot", "take_screenshot",
    "browser_take_screenshot", "computer_screenshot",
})


def _is_non_vision_model(session: StudioSession) -> bool:
    provider = str(getattr(session, "provider_name", "") or "").strip().lower()
    model = str(getattr(session, "model_name", "") or "").strip().lower()
    if not model:
        return False
    from agenticx.studio.server import (
        _minimax_m2_family_no_vision,
        _zhipu_glm5_family_no_vision,
    )
    if provider == "minimax" and _minimax_m2_family_no_vision(model):
        return True
    if provider == "zhipu" and _zhipu_glm5_family_no_vision(model):
        return True
    return False


_SCREENSHOT_NON_VISION_HINT = (
    "\n\n⚠️ 当前模型不支持图片识别，无法查看截图内容。"
    "请改用以下文本工具获取页面信息：\n"
    "- browser_get_state：获取页面 URL、标题和可交互元素列表\n"
    "- browser_extract_content(query='...')：按查询提取页面文本内容\n"
    "- browser_get_html：获取页面 HTML 源码\n"
    "请勿再次调用 browser_screenshot。"
)


_MCP_REPEAT_GUARD_KEY = "__mcp_repeat_guard__"
_MCP_REPEAT_GUARDED_TOOLS = frozenset({"browser_type", "browser_navigate"})


def _mcp_action_signature(tool_name: str, args_obj: Dict[str, Any]) -> str | None:
    if tool_name == "browser_type":
        index = args_obj.get("index")
        text = str(args_obj.get("text", "")).strip()
        if index is None or not text:
            return None
        return f"browser_type::{index}::{text}"
    if tool_name == "browser_navigate":
        url = str(args_obj.get("url", "")).strip()
        if not url:
            return None
        return f"browser_navigate::{url}"
    return None


def _check_mcp_repeat_guard(session: StudioSession, tool_name: str, args_obj: Dict[str, Any]) -> str | None:
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        session.scratchpad = {}
        scratchpad = session.scratchpad

    if tool_name not in _MCP_REPEAT_GUARDED_TOOLS:
        scratchpad.pop(_MCP_REPEAT_GUARD_KEY, None)
        return None

    sig = _mcp_action_signature(tool_name, args_obj)
    if not sig:
        scratchpad.pop(_MCP_REPEAT_GUARD_KEY, None)
        return None

    raw_state = scratchpad.get(_MCP_REPEAT_GUARD_KEY)
    state = raw_state if isinstance(raw_state, dict) else {}
    prev_sig = str(state.get("sig", "")).strip()
    prev_count = int(state.get("count", 0) or 0)
    count = prev_count + 1 if prev_sig == sig else 1
    scratchpad[_MCP_REPEAT_GUARD_KEY] = {"sig": sig, "count": count}

    if count < 3:
        return None

    if tool_name == "browser_type":
        return (
            "ERROR: repeated browser_type detected (same index/text called >=3 times). "
            "Do not type again. Next action must be one of: "
            "1) browser_click on the search/submit button, or "
            "2) browser_get_state to refresh interactive elements."
        )
    return (
        "ERROR: repeated browser_navigate detected (same url called >=3 times). "
        "Do not navigate again. Next action must be browser_get_state or browser_click."
    )


async def _tool_mcp_call_async(arguments: Dict[str, Any], session: StudioSession) -> str:
    if session.mcp_hub is None:
        return "ERROR: no MCP hub connected"
    tool_name = str(arguments.get("tool_name", "")).strip()
    if not tool_name:
        return "ERROR: missing tool_name"

    raw_args = arguments.get("arguments", None)
    if raw_args is None and "args" in arguments:
        raw_args = arguments.get("args")
    args_obj = raw_args if raw_args is not None else {}
    if not isinstance(args_obj, dict):
        return "ERROR: arguments/args must be an object"

    # Firecrawl scrape is a single-url API. Guard common misuse early.
    if (
        tool_name == "firecrawl_scrape"
        and "url" not in args_obj
        and isinstance(args_obj.get("urls"), list)
    ):
        return (
            "ERROR: firecrawl_scrape expects a single 'url' string, not 'urls' array. "
            "Use: {\"url\":\"https://example.com\"}. "
            "For multiple pages, iterate firecrawl_scrape per URL or use firecrawl_crawl/firecrawl_map."
        )
    repeat_guard_error = _check_mcp_repeat_guard(session, tool_name, args_obj)
    if repeat_guard_error:
        return repeat_guard_error
    if tool_name in _SCREENSHOT_TOOL_NAMES and _is_non_vision_model(session):
        return (
            f'{{"size_bytes": 0, "viewport": {{}}, "skipped": true}}'
            + _SCREENSHOT_NON_VISION_HINT
        )
    result = await mcp_call_tool_async(
        session.mcp_hub,
        tool_name,
        json.dumps(args_obj, ensure_ascii=False),
        echo=False,
    )
    return result


def _tool_mcp_import(arguments: Dict[str, Any], session: StudioSession) -> str:
    source_path = str(arguments.get("source_path", "")).strip()
    if not source_path:
        return "ERROR: missing source_path"
    result = import_mcp_config(source_path)
    if not result.get("ok"):
        return f"ERROR: {result.get('error', 'mcp_import failed')}"
    try:
        session.mcp_configs = load_available_servers()
    except Exception:
        pass
    return json.dumps(result, ensure_ascii=False)


def _tool_skill_use(arguments: Dict[str, Any], session: StudioSession) -> str:
    name = str(arguments.get("name", "")).strip()
    if not name:
        return "ERROR: missing skill name"
    bound = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    allowed, err = skill_is_allowed_for_session(name, bound_avatar_id=bound)
    if not allowed:
        return f"ERROR: {err}"
    ok = studio_skill_use(
        session.context_files, name, bound_avatar_id=bound, quiet=True
    )
    if not ok:
        return "ERROR: skill activation failed"

    meta = SkillBundleLoader().get_skill(name)
    try:
        from agenticx.learning.skill_usage_tracker import record_use
        skill_dir = meta.base_dir if meta else None
        if skill_dir:
            sid = str(getattr(session, "session_id", "") or getattr(session, "id", "") or "")
            record_use(skill_dir, session_id=sid)
    except Exception:
        pass
    if meta is None:
        return f"OK: activated skill '{name}' into context_files key 'skill:{name}'"
    return (
        f"OK: activated skill '{name}' into context_files key 'skill:{name}'. "
        f"source={meta.source}, location={meta.location}, "
        f"base_dir={meta.base_dir}, skill_md={meta.skill_md_path}"
    )


def _tool_skill_list(session: StudioSession) -> str:
    try:
        bound = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
        summaries = get_all_skill_summaries(bound_avatar_id=bound)
    except Exception as exc:
        return f"ERROR: list skill failed: {exc}"
    if not summaries:
        return "No skills found."
    lines = []
    for item in summaries:
        source = str(item.get("source", "unknown"))
        location = str(item.get("location", "unknown"))
        base_dir = str(item.get("base_dir", ""))
        lines.append(
            f"- {item['name']}: {item['description']} "
            f"[source={source}, location={location}, base_dir={base_dir}]"
        )
    return "\n".join(lines)


def _tool_todo_write(arguments: Dict[str, Any], session: StudioSession) -> str:
    items = arguments.get("items", [])
    todo_manager = getattr(session, "todo_manager", None)
    if todo_manager is None:
        return "ERROR: todo manager unavailable in session"
    try:
        return todo_manager.update(items)
    except ValueError as exc:
        return f"ERROR: {exc}"


def _tool_scratchpad_write(arguments: Dict[str, Any], session: StudioSession) -> str:
    key = str(arguments.get("key", "")).strip()
    value = str(arguments.get("value", ""))
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        session.scratchpad = {}
        scratchpad = session.scratchpad
    if not key:
        return "ERROR: key is required"
    if key not in scratchpad and len(scratchpad) >= 50:
        return "ERROR: scratchpad key limit exceeded (50)"
    if len(value) > 10_000:
        value = value[:10_000] + "\n... (truncated to 10000 chars)"
    scratchpad[key] = value
    return f"OK: scratchpad[{key}] updated"


def _tool_scratchpad_read(arguments: Dict[str, Any], session: StudioSession) -> str:
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        return "No scratchpad entries."
    if bool(arguments.get("list_only", False)):
        keys = sorted(scratchpad.keys())
        return "\n".join(keys) if keys else "No scratchpad entries."
    key = str(arguments.get("key", "")).strip()
    if not key:
        keys = sorted(scratchpad.keys())
        return "\n".join(keys) if keys else "No scratchpad entries."
    if key not in scratchpad:
        return f"ERROR: key not found: {key}"
    return str(scratchpad[key])


async def _tool_memory_append(
    arguments: Dict[str, Any],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    target = str(arguments.get("target", "")).strip().lower()
    content = str(arguments.get("content", "")).strip()
    if target not in {"daily", "long_term"}:
        return "ERROR: target must be daily or long_term"
    if not content:
        return "ERROR: content is required"

    workspace_dir = ensure_workspace(index_memory=False)
    if target == "long_term":
        if not await _confirm(
            "Append note into long-term MEMORY.md?",
            confirm_gate=confirm_gate,
            context={"tool": "memory_append", "target": target, "preview": content[:200]},
            emit_event=emit_event,
        ):
            return "CANCELLED: user denied memory append"
        append_long_term_memory(workspace_dir, content)
    else:
        append_daily_memory(workspace_dir, content)

    # Keep memory index hot for subsequent memory_search calls.
    try:
        store = WorkspaceMemoryStore()
        store.index_workspace_sync(workspace_dir)
    except Exception:
        pass
    return f"OK: appended to {target}"


def _tool_knowledge_search(arguments: Dict[str, Any]) -> str:
    """Search the Stage-1 local knowledge base.

    Plan-Id: machi-kb-stage1-local-mvp (plan §2.3). Returns a JSON payload
    matching ``KBSearchResponse.to_dict()`` so the UI and the model share the
    same ``hits[]`` shape.
    """

    query = str(arguments.get("query", "")).strip()
    if not query:
        return json.dumps(
            {"ok": False, "error": "query is required", "hits": []},
            ensure_ascii=False,
        )
    try:
        from agenticx.studio.kb import KBManager
    except Exception as exc:  # pragma: no cover - packaging issue
        return json.dumps(
            {"ok": False, "error": f"KB subsystem unavailable: {exc}", "hits": []},
            ensure_ascii=False,
        )

    try:
        manager = KBManager.instance()
    except Exception as exc:  # pragma: no cover - first-boot errors
        return json.dumps(
            {"ok": False, "error": f"KB not initialised: {exc}", "hits": []},
            ensure_ascii=False,
        )

    cfg = manager.read_config()
    default_top_k = int(getattr(getattr(cfg, "retrieval", None), "top_k", 5) or 5)
    raw_top_k = arguments.get("top_k")
    try:
        top_k = int(raw_top_k) if raw_top_k is not None else default_top_k
    except (TypeError, ValueError):
        top_k = default_top_k
    top_k = max(1, min(20, top_k))

    if not cfg.enabled:
        return json.dumps(
            {
                "ok": True,
                "hits": [],
                "used_top_k": 0,
                "source": "local",
                "disabled": True,
                "hint": "Knowledge base is disabled in settings.",
            },
            ensure_ascii=False,
        )

    try:
        hits = manager.runtime.search(query, top_k=top_k)
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"search failed: {exc}", "hits": []},
            ensure_ascii=False,
        )

    return json.dumps(
        {
            "ok": True,
            "hits": [h.to_dict() for h in hits],
            "used_top_k": len(hits),
            "source": "local",
        },
        ensure_ascii=False,
    )


def _tool_memory_search(arguments: Dict[str, Any]) -> str:
    query = str(arguments.get("query", "")).strip()
    if not query:
        return "ERROR: query is required"
    mode = str(arguments.get("mode", "hybrid") or "hybrid").strip().lower()
    limit = int(arguments.get("limit", 5) or 5)
    try:
        store = WorkspaceMemoryStore()
        rows = store.search_sync(query=query, mode=mode, limit=max(1, limit))
    except Exception as exc:
        return f"ERROR: memory search failed: {exc}"
    if not rows:
        return "No memory matches."
    lines: List[str] = []
    for idx, row in enumerate(rows, start=1):
        text = str(row.get("text", "")).replace("\n", " ")
        if len(text) > 240:
            text = text[:240] + "..."
        lines.append(
            f"{idx}. score={row.get('score', 0.0)} "
            f"path={row.get('path')}:{row.get('start_line')}-{row.get('end_line')} "
            f"text={text}"
        )
    return "\n".join(lines)


def _skill_manage_enabled() -> bool:
    v = os.environ.get("AGX_SKILL_MANAGE", "0").strip().lower()
    if v in {"1", "true", "yes", "on"}:
        return True
    if os.environ.get("AGX_CONFIRM_STRATEGY", "").strip().lower() == "auto":
        return True
    return False


def _safe_skill_dir_name(name: str) -> Optional[str]:
    """Validate a skill name, allowing sub-paths like ``ima/notes``.

    Each path segment must start with an alphanumeric character and contain
    only alphanumerics, dots, underscores, or hyphens.  Back-references
    (``..``) and hidden segments (starting with ``.``) are rejected.
    """
    n = str(name or "").strip().replace("\\", "/")
    if not n:
        return None
    _SEG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
    segments = n.split("/")
    for seg in segments:
        if not seg or seg.startswith(".") or seg == "..":
            return None
        if not _SEG.fullmatch(seg):
            return None
    return n


def _agent_created_skill_root() -> Path:
    return Path.home() / ".agenticx" / "skills"


def _tool_session_search(arguments: Dict[str, Any], session: Optional[StudioSession]) -> str:
    _ = session
    from agenticx.memory.session_store import session_fts_enabled

    store = SessionStore()
    raw_q = str(arguments.get("query", "") or "").strip()
    role_raw = str(arguments.get("role_filter", "") or "").strip()
    role_parts = [x.strip().lower() for x in role_raw.split(",") if x.strip()] if role_raw else None
    lim = int(arguments.get("limit", 3) or 3)
    lim = max(1, min(lim, 5))

    if not raw_q:
        rows = store._list_latest_sessions_sync(lim)
        sessions = [
            {
                "session_id": r["session_id"],
                "created_at": r["created_at"],
                "metadata": r["metadata"],
            }
            for r in rows
        ]
        return json.dumps({"mode": "recent", "sessions": sessions}, ensure_ascii=False)

    if not session_fts_enabled():
        return json.dumps({"mode": "search", "sessions": []}, ensure_ascii=False)

    hits = store._search_session_messages_sync(raw_q, role_parts, limit=500)
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for h in hits:
        sid = h["session_id"]
        if sid not in groups:
            if len(groups) >= lim:
                continue
            groups[sid] = []
        groups[sid].append(h)

    def _truncate_hits(items: List[Dict[str, Any]], max_chars: int = 10_000) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        total = 0
        for it in items:
            frag = json.dumps(it, ensure_ascii=False)
            if total + len(frag) > max_chars and out:
                break
            out.append(it)
            total += len(frag) + 1
        return out

    sessions_out = [{"session_id": sid, "hits": _truncate_hits(items)} for sid, items in groups.items()]
    return json.dumps({"mode": "search", "sessions": sessions_out}, ensure_ascii=False)


def _tool_skill_manage(arguments: Dict[str, Any], session: Optional[StudioSession]) -> str:
    _ = session
    if not _skill_manage_enabled():
        return (
            "ERROR: skill_manage is disabled. Set AGX_SKILL_MANAGE=1 "
            "or AGX_CONFIRM_STRATEGY=auto (Run Everything hook)."
        )
    action = str(arguments.get("action", "") or "").strip().lower()
    if not action:
        return (
            "ERROR: 'action' is required. "
            "Call skill_manage with action='create'|'patch'|'delete', name=<skill-name>, "
            "and content=<full SKILL.md text> for create."
        )
    raw_name = str(arguments.get("name", "") or "").strip()
    if not raw_name:
        return (
            "ERROR: 'name' is required. "
            "Provide the skill directory name, e.g. name='my-skill' or name='ima/notes'."
        )
    name = _safe_skill_dir_name(raw_name)
    if name is None:
        return (
            f"ERROR: invalid skill name {raw_name!r}. "
            "Name must be alphanumeric with hyphens/underscores. "
            "Sub-paths like 'ima/notes' are allowed; spaces and leading dots are not."
        )
    root = _agent_created_skill_root().expanduser().resolve(strict=False)
    skill_dir = (root / name).resolve(strict=False)
    try:
        skill_dir.relative_to(root)
    except ValueError:
        return "ERROR: skill path outside skills root"

    if action == "create":
        content = str(arguments.get("content", "") or "")
        if not content.strip():
            return "ERROR: content is required for create"
        if skill_dir.exists():
            return "ERROR: skill already exists"
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_md = skill_dir / "SKILL.md"
        try:
            skill_md.write_text(content, encoding="utf-8")
            result = scan_skill(skill_dir, source="agent-created")
            ok, reason = should_allow(result, "agent-created")
            if not ok:
                shutil.rmtree(skill_dir, ignore_errors=True)
                return f"ERROR: guard rejected create ({reason})"
        except OSError as exc:
            shutil.rmtree(skill_dir, ignore_errors=True)
            return f"ERROR: {exc}"
        try:
            from agenticx.skills.versioning import append_changelog
            append_changelog(skill_dir, action="create", summary="agent-created skill")
        except Exception:
            pass
        return json.dumps({"ok": True, "action": "create", "path": str(skill_md)}, ensure_ascii=False)

    if action == "patch":
        old_s = str(arguments.get("old_string", ""))
        new_s = str(arguments.get("new_string", ""))
        replace_all = bool(arguments.get("replace_all", False))
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            return "ERROR: SKILL.md not found"
        try:
            original = skill_md.read_text(encoding="utf-8")
        except OSError as exc:
            return f"ERROR: read failed: {exc}"
        from agenticx.skills.fuzzy_patch import fuzzy_find_and_replace
        updated, match_count, strategy, match_err = fuzzy_find_and_replace(
            original, old_s, new_s, replace_all=replace_all,
        )
        if match_err:
            return f"ERROR: {match_err}"
        backup = original
        try:
            skill_md.write_text(updated, encoding="utf-8")
            result = scan_skill(skill_dir, source="agent-created")
            ok, reason = should_allow(result, "agent-created")
            if not ok:
                skill_md.write_text(backup, encoding="utf-8")
                return f"ERROR: guard rejected patch ({reason})"
        except OSError as exc:
            skill_md.write_text(backup, encoding="utf-8")
            return f"ERROR: {exc}"
        try:
            from agenticx.skills.versioning import append_changelog
            append_changelog(skill_dir, action="patch", summary=f"fuzzy:{strategy}, {match_count} replacement(s)")
        except Exception:
            pass
        return json.dumps({"ok": True, "action": "patch", "path": str(skill_md), "strategy": strategy, "matches": match_count}, ensure_ascii=False)

    if action == "delete":
        if not skill_dir.exists():
            return json.dumps({"ok": True, "action": "delete", "removed": False}, ensure_ascii=False)
        try:
            from agenticx.skills.versioning import append_changelog
            append_changelog(skill_dir, action="delete", summary="skill deleted by agent")
        except Exception:
            pass
        try:
            shutil.rmtree(skill_dir)
        except OSError as exc:
            return f"ERROR: delete failed: {exc}"
        return json.dumps({"ok": True, "action": "delete", "removed": True}, ensure_ascii=False)

    return "ERROR: unknown action"


def _tool_ask_user(arguments: Dict[str, Any], *, service_mode: bool = False) -> str:
    if service_mode:
        return "ERROR: ask_user is not supported in service mode; use confirm_required flow."
    question = str(arguments.get("question", "")).strip()
    if not question:
        return "ERROR: missing question"
    answer = input(f"{question}\n> ").strip()
    return answer or "(empty)"


def _tool_list_files(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    path_arg = str(arguments.get("path", "."))
    try:
        root = _resolve_workspace_path(path_arg, session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    recursive = bool(arguments.get("recursive", False))
    limit = int(arguments.get("limit", 200) or 200)
    if limit < 1:
        limit = 1
    if limit > 2000:
        limit = 2000
    if not root.exists():
        return f"ERROR: path not found: {root}"
    if not root.is_dir():
        return f"ERROR: not a directory: {root}"

    entries: List[Path]
    if recursive:
        entries = sorted((p for p in root.rglob("*")), key=lambda p: str(p))
    else:
        entries = sorted(root.iterdir(), key=lambda p: str(p))

    lines: List[str] = []
    for item in entries[:limit]:
        suffix = "/" if item.is_dir() else ""
        lines.append(str(item) + suffix)
    if len(entries) > limit:
        lines.append(f"... (truncated, total {len(entries)} entries)")
    return "\n".join(lines) if lines else "(empty directory)"


async def _tool_liteparse(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    """Parse one document strictly via LiteParse adapter."""
    raw_path = str(arguments.get("path", "")).strip()
    if not raw_path:
        return "ERROR: missing required parameter 'path'."
    try:
        path = _resolve_workspace_path(raw_path, session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not path.exists():
        return f"ERROR: file not found: {path}"
    if path.is_dir():
        return f"ERROR: expected a file path, got directory: {path}"

    from agenticx.tools.adapters.liteparse import LiteParseAdapter

    if not LiteParseAdapter.is_available():
        return (
            "ERROR: liteparse CLI is not available. "
            "Install with: npm i -g @llamaindex/liteparse"
        )

    try:
        adapter = LiteParseAdapter(config={"debug": False})
        content = await adapter.parse_to_text(path)
    except Exception as exc:
        return f"ERROR: liteparse parsing failed: {exc}"

    if not content.strip():
        return "ERROR: liteparse returned empty content."
    return content


def _resolve_lsp_settings() -> tuple[bool, float]:
    try:
        global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
        project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
        merged = ConfigManager._deep_merge(global_data, project_data)
        enabled_raw = ConfigManager._get_nested(merged, "lsp.enabled")
        timeout_raw = ConfigManager._get_nested(merged, "lsp.startup_timeout")
    except Exception:
        enabled_raw = None
        timeout_raw = None

    if enabled_raw is None:
        enabled = True
    elif isinstance(enabled_raw, bool):
        enabled = enabled_raw
    elif isinstance(enabled_raw, str):
        lowered = enabled_raw.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            enabled = True
        elif lowered in {"0", "false", "no", "off"}:
            enabled = False
        else:
            enabled = True
    else:
        enabled = bool(enabled_raw)
    try:
        timeout = float(timeout_raw if timeout_raw is not None else 30.0)
    except (TypeError, ValueError):
        timeout = 30.0
    timeout = max(1.0, min(120.0, timeout))
    return enabled, timeout


def _infer_lsp_workspace_root(session: StudioSession) -> str:
    roots = _session_workspace_roots(session)
    return str(roots[0]) if roots else str(_workspace_root())


async def _dispatch_lsp_tool(name: str, arguments: Dict[str, Any], session: StudioSession) -> str:
    from agenticx.tools.lsp_manager import LSPManager

    mgr: Optional[LSPManager] = getattr(session, "_lsp_manager", None)
    enabled, startup_timeout = _resolve_lsp_settings()
    if mgr is None:
        mgr = LSPManager(
            _infer_lsp_workspace_root(session),
            startup_timeout=startup_timeout,
            enabled=enabled,
        )
        setattr(session, "_lsp_manager", mgr)

    file_path = str(arguments.get("file", "")).strip()
    line_raw = arguments.get("line", 1)
    column_raw = arguments.get("column", 1)
    try:
        line = int(line_raw)
    except (TypeError, ValueError):
        line = 1
    try:
        column = int(column_raw)
    except (TypeError, ValueError):
        column = 1

    try:
        if name == "lsp_goto_definition":
            return await mgr.tool_goto_definition(file_path, line, column)
        if name == "lsp_find_references":
            return await mgr.tool_find_references(file_path, line, column)
        if name == "lsp_hover":
            return await mgr.tool_hover(file_path, line, column)
        if name == "lsp_diagnostics":
            return await mgr.tool_diagnostics(file_path or None)
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"LSP error: {exc}"}, ensure_ascii=False)
    return json.dumps({"ok": False, "error": f"unknown LSP tool: {name}"}, ensure_ascii=False)


_TOOL_REQUIRED_PARAMS: Dict[str, List[str]] = {}
for _td in STUDIO_TOOLS:
    _fn = _td.get("function", {})
    _name = _fn.get("name", "")
    _req = _fn.get("parameters", {}).get("required", [])
    if _name and _req:
        _TOOL_REQUIRED_PARAMS[_name] = _req
for _td in COMPUTER_USE_TOOLS:
    _fn = _td.get("function", {})
    _name = _fn.get("name", "")
    _req = _fn.get("parameters", {}).get("required", [])
    if _name and _req:
        _TOOL_REQUIRED_PARAMS[_name] = _req


def _repair_malformed_file_tool_arguments(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Best-effort repair for malformed file tool arguments from weaker models."""
    if name not in {"file_write", "file_edit"}:
        return arguments
    if not isinstance(arguments, dict):
        return arguments

    def _is_tool_metadata_noise(value: Any) -> bool:
        text = _strip_tool_metadata_noise_lines(str(value or "")).strip()
        if not text:
            return False
        return bool(re.fullmatch(r"(call_[A-Za-z0-9]+|sa-[a-z0-9]+)", text))

    def _collect_safe_extra_payload(extra_keys: List[str]) -> str:
        # Only merge text-like alias fields; drop unknown keys to avoid
        # leaking streamed tool-call metadata fragments into file content.
        alias_keys = {"text", "body", "code", "value", "new_content", "newText"}
        payloads: List[str] = []
        for key in extra_keys:
            if key not in alias_keys:
                continue
            raw = arguments.get(key, "")
            if _is_tool_metadata_noise(raw):
                continue
            text = _strip_tool_metadata_noise_lines(str(raw)).strip()
            if text:
                payloads.append(text)
        return "\n".join(payloads)

    if name == "file_write":
        allowed_keys = {"path", "content"}
        extra_keys = [k for k in arguments.keys() if k not in allowed_keys]
        if not extra_keys:
            return arguments
        repaired = dict(arguments)
        extra_payload = _collect_safe_extra_payload(extra_keys)
        existing_content = _strip_tool_metadata_noise_lines(str(repaired.get("content", "")))
        if extra_payload:
            repaired["content"] = f"{existing_content}\n{extra_payload}".strip() if existing_content else extra_payload
        for key in extra_keys:
            repaired.pop(key, None)
        _log.warning(
            "[tool-args-repair] repaired malformed file_write args, removed keys=%s",
            extra_keys,
        )
        return repaired

    allowed_keys = {"path", "old_text", "new_text", "occurrence"}
    extra_keys = [k for k in arguments.keys() if k not in allowed_keys]
    if not extra_keys:
        return arguments
    repaired = dict(arguments)
    extra_payload = _collect_safe_extra_payload(extra_keys)
    if extra_payload:
        base_new_text = _strip_tool_metadata_noise_lines(str(repaired.get("new_text", "")))
        repaired["new_text"] = f"{base_new_text}\n{extra_payload}".strip() if base_new_text else extra_payload
    for key in extra_keys:
        repaired.pop(key, None)
    _log.warning(
        "[tool-args-repair] repaired malformed file_edit args, removed keys=%s",
        extra_keys,
    )
    return repaired


# ── task_experience implementation ────────────────────────────────────────────

def _experience_path(group_id: str) -> Path:
    """Return the JSON file path for a group's experience store."""
    import pathlib
    base = pathlib.Path.home() / ".agenticx" / "groups" / group_id
    base.mkdir(parents=True, exist_ok=True)
    return base / "experience.json"


def _experience_load(group_id: str) -> List[Dict[str, Any]]:
    p = _experience_path(group_id)
    if not p.exists():
        return []
    try:
        import json as _json
        return _json.loads(p.read_text(encoding="utf-8")) or []
    except Exception:
        return []


def _experience_save(group_id: str, entries: List[Dict[str, Any]]) -> None:
    import json as _json
    p = _experience_path(group_id)
    p.write_text(_json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def _experience_retrieve_impl(query: str, group_id: str, limit: int = 5) -> str:
    """Simple keyword-based retrieval from the JSON experience store.

    Falls back to pure keyword search when WorkspaceMemoryStore is unavailable.
    Hybrid search integration can be added without changing the tool schema.
    """
    import json as _json
    entries = _experience_load(group_id)
    if not entries:
        return _json.dumps({"status": "no_experience", "results": [], "group_id": group_id})

    q_lower = query.casefold()
    q_tokens = set(q_lower.split())

    def _score(entry: Dict[str, Any]) -> float:
        text = (
            (entry.get("content") or "")
            + " " + (entry.get("title") or "")
            + " " + (entry.get("when_to_use") or "")
        ).casefold()
        return sum(1 for t in q_tokens if t in text) / max(len(q_tokens), 1)

    scored = sorted(entries, key=_score, reverse=True)
    top = [e for e in scored if _score(e) > 0][:limit] or scored[:limit]
    return _json.dumps({
        "status": "ok",
        "group_id": group_id,
        "count": len(top),
        "results": top,
    }, ensure_ascii=False)


def _experience_learn_impl(
    content: str,
    group_id: str,
    section: str = "general",
    when_to_use: str = "",
    title: str = "",
) -> str:
    import json as _json
    import uuid
    from datetime import datetime, timezone
    entries = _experience_load(group_id)
    entry = {
        "id": uuid.uuid4().hex[:12],
        "section": section or "general",
        "content": content,
        "title": title or content[:60],
        "when_to_use": when_to_use,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    entries.append(entry)
    _experience_save(group_id, entries)
    return _json.dumps({"status": "ok", "group_id": group_id, "entry_id": entry["id"]})


def _experience_clear_impl(group_id: str, confirm: bool) -> str:
    import json as _json
    if not confirm:
        return _json.dumps({"status": "aborted", "reason": "confirm must be true"})
    p = _experience_path(group_id)
    if p.exists():
        p.write_text("[]", encoding="utf-8")
    return _json.dumps({"status": "cleared", "group_id": group_id})


def _resolve_group_id(session: "StudioSession", arg_group_id: str | None) -> str:
    """Best-effort resolution of group_id from session or argument."""
    if arg_group_id and str(arg_group_id).strip():
        return str(arg_group_id).strip()
    # Try to read from session scratchpad if set by run_group_turn.
    scratchpad = getattr(session, "scratchpad", {}) or {}
    gid = str(scratchpad.get("__group_id", "") or "").strip()
    return gid or "default"


async def dispatch_tool_async(
    name: str,
    arguments: Dict[str, Any],
    session: StudioSession,
    *,
    confirm_gate: Optional[ConfirmGate] = None,
    event_callback: Optional[Any] = None,
    team_manager: Optional[Any] = None,
) -> str:
    """Dispatch one tool call asynchronously and return result text."""
    arguments = _repair_malformed_file_tool_arguments(name, arguments)
    required = _TOOL_REQUIRED_PARAMS.get(name)
    if required and not arguments:
        return (
            f"ERROR: {name}() called with empty arguments. "
            f"Required parameters: {', '.join(required)}. "
            f"Please provide all required parameters."
        )
    gate = confirm_gate or SyncConfirmGate()
    try:
        if name in META_TOOL_NAMES:
            tm = team_manager or getattr(session, "_team_manager", None)
            import logging as _logging
            _logging.getLogger("agenticx.cli.agent_tools").debug(
                "[dispatch_tool] meta_tool=%s session=%s tm=%s (explicit=%s, attr=%s)",
                name,
                id(session),
                id(tm) if tm else "None",
                id(team_manager) if team_manager else "None",
                id(getattr(session, "_team_manager", None)) if getattr(session, "_team_manager", None) else "None",
            )
            if tm is None:
                return "ERROR: meta tool requires team manager in session"
            from agenticx.runtime.meta_tools import dispatch_meta_tool_async

            return await dispatch_meta_tool_async(
                name,
                arguments,
                team_manager=tm,
                session=session,
            )
        if name == "bash_exec":
            return await _tool_bash_exec(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "file_read":
            return _tool_file_read(arguments, session)
        if name == "file_write":
            return await _tool_file_write(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "file_edit":
            return await _tool_file_edit(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "codegen":
            return await _tool_codegen(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "mcp_connect":
            return _tool_mcp_connect(arguments, session)
        if name == "cc_bridge_start":
            return await _tool_cc_bridge_start(arguments, session)
        if name == "cc_bridge_send":
            return await _tool_cc_bridge_send(arguments, session)
        if name == "cc_bridge_list":
            return await _tool_cc_bridge_list(arguments, session)
        if name == "cc_bridge_stop":
            return await _tool_cc_bridge_stop(arguments, session)
        if name == "cc_bridge_permission":
            return await _tool_cc_bridge_permission(arguments, session)
        if name == "desktop_screenshot":
            return await _tool_desktop_screenshot(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "desktop_mouse_click":
            return await _tool_desktop_mouse_click(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "desktop_keyboard_type":
            return await _tool_desktop_keyboard_type(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "mcp_call":
            return await _tool_mcp_call_async(arguments, session)
        if name == "mcp_import":
            return _tool_mcp_import(arguments, session)
        if name == "skill_use":
            return _tool_skill_use(arguments, session)
        if name == "skill_list":
            return _tool_skill_list(session)
        if name == "skill_manage":
            return _tool_skill_manage(arguments, session)
        if name == "todo_write":
            return _tool_todo_write(arguments, session)
        if name == "scratchpad_write":
            return _tool_scratchpad_write(arguments, session)
        if name == "scratchpad_read":
            return _tool_scratchpad_read(arguments, session)
        if name == "memory_append":
            return await _tool_memory_append(arguments, confirm_gate=gate, emit_event=event_callback)
        if name == "memory_search":
            return _tool_memory_search(arguments)
        if name == "knowledge_search":
            # Plan-Id: machi-kb-stage1-local-mvp — offloaded to a thread so the
            # underlying chromadb + litellm calls don't block the event loop.
            return await asyncio.to_thread(_tool_knowledge_search, arguments)
        if name == "session_search":
            return _tool_session_search(arguments, session)
        if name == "ask_user":
            return _tool_ask_user(arguments, service_mode=isinstance(gate, AsyncConfirmGate))
        if name == "list_files":
            return _tool_list_files(arguments, session)
        if name == "liteparse":
            return await _tool_liteparse(arguments, session)
        if name == "task_experience_retrieve":
            gid = _resolve_group_id(session, arguments.get("group_id"))
            limit = min(max(int(arguments.get("limit") or 5), 1), 10)
            return _experience_retrieve_impl(
                query=str(arguments.get("query", "")),
                group_id=gid,
                limit=limit,
            )
        if name == "task_experience_learn":
            gid = _resolve_group_id(session, arguments.get("group_id"))
            return _experience_learn_impl(
                content=str(arguments.get("content", "")),
                group_id=gid,
                section=str(arguments.get("section") or "general"),
                when_to_use=str(arguments.get("when_to_use") or ""),
                title=str(arguments.get("title") or ""),
            )
        if name == "task_experience_clear":
            gid = _resolve_group_id(session, arguments.get("group_id"))
            confirm = bool(arguments.get("confirm", False))
            return _experience_clear_impl(group_id=gid, confirm=confirm)
        if name.startswith("lsp_"):
            return await _dispatch_lsp_tool(name, arguments, session)
    except Exception as exc:
        return f"ERROR: {name} crashed: {exc}"
    if name.startswith("confirm_"):
        return (
            "ERROR: Desktop mode does not provide confirm_* tools. "
            "To request approval, directly call the real tool (e.g. bash_exec); "
            "runtime will emit confirm_required and wait for UI confirmation."
        )
    # --- Fallback chain: try resolving via registered ToolFallbackChain ---
    _fallback_chain = getattr(session, "_fallback_chain", None)
    if _fallback_chain is not None:
        try:
            from agenticx.tools.fallback_chain import ToolFallbackChain
            if isinstance(_fallback_chain, ToolFallbackChain):
                _fb_result = await _fallback_chain.execute(name, **arguments)
                return _fb_result.output
        except Exception as _fb_exc:
            logging.getLogger(__name__).debug(
                "Fallback chain could not resolve '%s': %s", name, _fb_exc,
            )
    return f"ERROR: unknown tool '{name}'"


def dispatch_tool(
    name: str,
    arguments: Dict[str, Any],
    session: StudioSession,
    *,
    confirm_gate: Optional[ConfirmGate] = None,
) -> str:
    """Backward-compatible sync dispatcher for tests/CLI."""
    return asyncio.run(
        dispatch_tool_async(
            name,
            arguments,
            session,
            confirm_gate=confirm_gate,
        )
    )
