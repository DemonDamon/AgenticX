#!/usr/bin/env python3
"""Tool definitions and dispatchers for Studio agent loop.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import base64
import difflib
import fnmatch
import hashlib
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
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
from agenticx.tools.adapters.video_frames import VideoFrameExtractor
from agenticx.runtime.confirm import (
    AsyncConfirmGate,
    AutoApproveConfirmGate,
    ConfirmGate,
    SyncConfirmGate,
)
from agenticx.runtime.clarify import (
    AsyncClarifyGate,
    AutoSuspendClarifyGate,
    ClarifyGate,
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
MAX_READ_CHARS_CODE_DEV = 8_000
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
        "memory_forget",
        "session_search",
        "list_files",
        "liteparse",
        "video_understand",
        "lsp_goto_definition",
        "lsp_find_references",
        "lsp_hover",
        "lsp_diagnostics",
        "code_outline",
        "list_scheduled_tasks",
        "get_automation_task_logs",
        "cc_bridge_list",
        "knowledge_search",  # Plan-Id: machi-kb-stage1-local-mvp — read-only vector search.
        "knowledge_synthesize",
        "web_search",
        "web_fetch",
        "view_image",
        "show_widget",
        "list_data_sources",
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
    from agenticx.workspace.loader import resolve_workspace_dir

    return resolve_workspace_dir()


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
            "name": "request_clarification",
            "description": (
                "Ask the user an open-ended question and BLOCK until they answer. Use this whenever you need a "
                "human decision before proceeding: plan sign-off, choosing between options, missing parameters, "
                "color/style/preference, scope confirmation. Do NOT write the question as plain text and end the "
                "turn -- call this tool instead so the user gets a blocking prompt with option buttons and a free-"
                "text box, and your turn continues from their answer. The tool result text is the user's answer; "
                "continue the same turn based on it. In unattended/automation sessions this returns a suspended "
                "sentinel -- wrap up the turn and persist the pending question as a todo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "The question to ask the user, in natural language. Be specific.",
                    },
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Flat preset options (0-8) when all choices are independent toggles "
                            "or a single combined question. User may select multiple. Prefer "
                            "`decisions` instead when you need separate answers per dimension."
                        ),
                    },
                    "decisions": {
                        "type": "array",
                        "description": (
                            "Structured multi-part sign-off: one entry per independent decision "
                            "(e.g. duration / copy / color). Each item has its own question and "
                            "options; the UI renders a decision chain. Use this when prompt mentions "
                            "multiple key decisions — do NOT flatten into one options list."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": "Stable id, e.g. duration / copy / palette.",
                                },
                                "question": {
                                    "type": "string",
                                    "description": "The decision question for this dimension.",
                                },
                                "options": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "2-6 mutually exclusive options for this dimension.",
                                },
                            },
                            "required": ["question", "options"],
                            "additionalProperties": False,
                        },
                    },
                    "allow_free_text": {
                        "type": "boolean",
                        "description": "Whether the user can type a custom answer (default true).",
                    },
                    "context": {
                        "type": "object",
                        "description": "Optional extra context to show in the prompt card (e.g. plan summary).",
                    },
                },
                "required": ["prompt"],
                "additionalProperties": False,
            },
        },
    },
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
            "name": "code_outline",
            "description": (
                "Return class/function signatures and one-line docstrings for code files "
                "(no function bodies). Prefer this before file_read to save context. "
                "Supports single file or directory (max 50 files)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace file or directory path.",
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional filter by symbol or path substring.",
                    },
                    "max_files": {
                        "type": "integer",
                        "description": "Max files when path is a directory (default 50).",
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
            "name": "file_write",
            "description": (
                "Write full file content; show unified diff and ask confirmation before writing. "
                "Use from_path to copy from a local file instead of inline content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path."},
                    "content": {"type": "string", "description": "New full content (omit when using from_path)."},
                    "from_path": {
                        "type": "string",
                        "description": "Copy content from this local file path (workspace-relative or absolute).",
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
            "description": (
                "Connect one configured MCP server. API keys belong in Near Settings → MCP "
                "(~/.agenticx/mcp.json env) or OS environment—never ask the user to paste secrets in chat."
            ),
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
            "description": (
                "Import MCP server configs from external mcp.json into AgenticX workspace config. "
                "Do not collect API keys in chat; user fills env in Settings → MCP."
            ),
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
                "For 'create': provide action + name + content, or use from_path/from_url "
                "instead of inline content for large SKILL.md files. "
                "For 'patch': provide action + name + old_string + new_string. "
                "For 'delete': provide action + name. "
                "Sub-paths are supported (e.g. name='ima/notes'). "
                "IMPORTANT: never call with empty arguments — action and name are always required."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "patch", "delete", "history", "rollback"],
                        "description": "Operation: create/patch/delete/history/rollback.",
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
                            "For 'create': full SKILL.md text with YAML frontmatter. "
                            "Prefer from_path/from_url for large files instead of inline content."
                        ),
                    },
                    "from_path": {
                        "type": "string",
                        "description": (
                            "For 'create': read SKILL.md from this local path (workspace or ~/.agenticx/). "
                            "Mutually exclusive with content/from_url."
                        ),
                    },
                    "from_url": {
                        "type": "string",
                        "description": (
                            "For 'create': download SKILL.md from an allowlisted https URL "
                            "(raw.githubusercontent.com, gist, registry.clawhub.ai). "
                            "Mutually exclusive with content/from_path."
                        ),
                    },
                    "old_string": {"type": "string", "description": "Required for 'patch': exact substring to find and replace in the existing SKILL.md."},
                    "new_string": {"type": "string", "description": "Required for 'patch': replacement text for old_string."},
                    "mode": {
                        "type": "string",
                        "enum": ["preview", "apply"],
                        "description": "Patch mode. preview only computes diff/token and does not write; apply writes changes.",
                    },
                    "patch_token": {
                        "type": "string",
                        "description": "Token returned by preview; when provided to apply, must match current content hash and patch payload.",
                    },
                    "before_context": {
                        "type": "string",
                        "description": "Optional context before old_string for disambiguation.",
                    },
                    "after_context": {
                        "type": "string",
                        "description": "Optional context after old_string for disambiguation.",
                    },
                    "target_index": {
                        "type": "integer",
                        "description": "Optional index in multi-match candidates; required when preview returns multiple matches and replace_all is false.",
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "If true, patch all matches. Default false.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "For history action: number of versions to return (1-200).",
                    },
                    "to_version": {
                        "type": "string",
                        "description": "For rollback action: target version id from history.",
                    },
                },
                "required": ["action", "name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hook_manage",
            "description": (
                "Create, delete, list, or toggle declarative hooks persisted to "
                "~/.agenticx/config.yaml (hooks.declarative[]). "
                "Declarative hooks run shell commands, HTTP webhooks, model prompts, or "
                "agent reasoning at key lifecycle events (before_tool_call, after_tool_call, "
                "session_start, session_end). "
                "command-type hooks are scanned for dangerous patterns before being saved. "
                "IMPORTANT: action and name are always required except for action='list'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "delete", "list", "toggle"],
                        "description": (
                            "'create': add a new declarative hook; "
                            "'delete': remove by name; "
                            "'list': return all declarative hooks; "
                            "'toggle': enable or disable a hook by name."
                        ),
                    },
                    "name": {
                        "type": "string",
                        "description": "Unique hook name (required for create/delete/toggle).",
                    },
                    "event": {
                        "type": "string",
                        "enum": ["before_tool_call", "after_tool_call", "session_start", "session_end"],
                        "description": "Lifecycle event that fires this hook (required for create).",
                    },
                    "type": {
                        "type": "string",
                        "enum": ["command", "http", "prompt", "agent"],
                        "description": "Hook execution type (required for create). Default: 'command'.",
                    },
                    "command": {
                        "type": "string",
                        "description": "Shell command to run (for type='command'). Supports {tool} placeholder.",
                    },
                    "url": {
                        "type": "string",
                        "description": "HTTP endpoint to POST to (for type='http').",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Model prompt text (for type='prompt' or 'agent').",
                    },
                    "matcher": {
                        "type": "string",
                        "description": "Glob pattern to filter which tool names trigger this hook (optional).",
                    },
                    "block_on_failure": {
                        "type": "boolean",
                        "description": "If true, abort the tool call when the hook fails. Default: false.",
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Hook execution timeout in seconds (1-600). Default: 30.",
                    },
                    "enabled": {
                        "type": "boolean",
                        "description": "For 'toggle': set to true to enable or false to disable the hook.",
                    },
                },
                "required": ["action"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_import_repo",
            "description": (
                "Bulk install skills from a GitHub repository into ~/.agenticx/skills/. "
                "Use dry_run=true first to list pending skills without writing. "
                "Preferred for installing many skills (e.g. mattpocock/skills)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "GitHub repo as owner/name (e.g. mattpocock/skills).",
                    },
                    "branch": {"type": "string", "description": "Branch name (default main)."},
                    "path_glob": {
                        "type": "string",
                        "description": "Glob for SKILL.md paths in the repo tree (default skills/**/SKILL.md).",
                    },
                    "exclude": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Glob patterns to exclude (default deprecated/in-progress).",
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "If true, only return pending/skipped lists without installing.",
                    },
                    "overwrite": {
                        "type": "boolean",
                        "description": "If true, replace existing skills with the same name.",
                    },
                },
                "required": ["repo"],
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
            "description": (
                "Append note to the current subject's workspace memory (meta/avatar/group) "
                "or global user baseline. Default scope=subject writes to this pane's MEMORY.md; "
                "use scope=user_global only when the user wants all subjects to remember "
                "(e.g. a lesson from avatar A that avatar B should also avoid). "
                "Content must be a concise, self-contained fact (max ~400 chars)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "enum": ["daily", "long_term"]},
                    "content": {"type": "string"},
                    "scope": {
                        "type": "string",
                        "enum": ["subject", "user_global"],
                        "description": "subject (default) = current meta/avatar/group; user_global = ~/.agenticx/workspace/USER.md baseline for all subjects.",
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
            "name": "memory_search",
            "description": (
                "Search workspace Markdown memory (MEMORY.md, memory/*.md). "
                "When memory graph is enabled, merges graph facts for the current pane partition. "
                "Chinese keywords use substring matching; English supports FTS."
            ),
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
            "name": "memory_forget",
            "description": (
                "Forget memories matching a topic in the current subject (meta/avatar/group). "
                "Removes matching graph episodes and MEMORY.md bullets (default scope=both). "
                "Pinned episodes are protected. Irreversible."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "scope": {"type": "string", "enum": ["graph", "text", "both"]},
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
            "name": "video_understand",
            "description": (
                "Understand a local video file (mp4/mov/mkv/webm/avi). Probes metadata "
                "(duration, resolution, audio track) and extracts representative frames "
                "adaptively based on duration, then attaches them for the vision model to "
                "view in the next turn. Prefer this over calling ffmpeg via bash_exec: it is "
                "one atomic call with adaptive sampling. Requires a vision-capable model. "
                "Optionally pass `question` to bias sampling toward what the user asks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or workspace-relative path to the video file.",
                    },
                    "question": {
                        "type": "string",
                        "description": "Optional: what the user wants to know about the video.",
                    },
                    "max_frames": {
                        "type": "integer",
                        "description": "Optional cap on extracted frames (clamped to server hard max).",
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
            "name": "list_data_sources",
            "description": (
                "List enabled external data source plugins (finance/macro/academic/"
                "enterprise/legal domains) and their available APIs. Call this first "
                "when unsure which data_source_name or api_name to use with "
                "query_data_source."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {
                        "type": "string",
                        "description": "Optional filter, e.g. 'finance', 'macro', 'academic'.",
                    },
                    "verbose": {
                        "type": "boolean",
                        "description": "If true, include full params_schema for each API.",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_data_source",
            "description": (
                "Unified gateway to query an external data source plugin (stock prices, "
                "macro indicators, academic papers, company registry, legal statutes, etc). "
                "Call list_data_sources first if you don't know the exact api_name or "
                "params shape. Returns structured JSON; follow up with show_widget to "
                "visualize when appropriate (e.g. price history as a chart)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "data_source_name": {
                        "type": "string",
                        "description": "Plugin id, e.g. 'akshare', 'world_bank', 'tushare'.",
                    },
                    "api_name": {
                        "type": "string",
                        "description": "API id exposed by the plugin, from list_data_sources.",
                    },
                    "params": {
                        "type": "object",
                        "description": "API-specific parameters.",
                    },
                },
                "required": ["data_source_name", "api_name", "params"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_widget",
            "description": (
                "Render an inline SVG/HTML visualization in the chat. REQUIRED whenever you "
                "would show a flow, pipeline, sequence, architecture, MitM/proxy path, or any "
                "A->B->C style diagram — including simple 3-node chains. NEVER substitute "
                "markdown text/code blocks (```text```, arrow chains, ↓ lines, mermaid source). "
                "Before calling: output 1-3 sentences of visible intro prose in the same turn "
                "(not in reasoning/thinking). Then call show_widget, then explain in detail. "
                "For structured stock/macro charts, widget_code MUST be JSON starting with "
                '\'{"type": "stock_chart", ...}\' — the "type" field is REQUIRED, omitting it '
                "will render as unreadable raw text instead of a chart."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Widget title shown on the card.",
                    },
                    "widget_code": {
                        "type": "string",
                        "description": (
                            "SVG string starting with '<svg' OR an HTML fragment. "
                            "SVG should use viewBox='0 0 680 H' width='100%' and "
                            "CSS vars like var(--text-primary), var(--text-muted)."
                        ),
                    },
                    "loading_messages": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional rotating loading messages shown before render.",
                    },
                },
                "required": ["title", "widget_code"],
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
                "Search mounted document brains (知识库 / docs brain) for the current session. "
                "Returns {hits, by_brain, used_top_k, brains} — hits are merged top-k; "
                "by_brain groups results per brain. Respects avatar brain mount settings. "
                "Optional brain_id searches a single brain. If nothing is mounted, returns a hint."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language search query."},
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum number of chunks to return (1-20). Omit to use KB setting default Top-K.",
                    },
                    "brain_id": {
                        "type": "string",
                        "description": "Optional: search only this docs brain id (must be visible to the session avatar).",
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
            "name": "knowledge_synthesize",
            "description": (
                "Synthesize an answer from mounted document brains with [N] citations and gap analysis. "
                "Use when the user wants a composed answer from the knowledge base rather than raw chunks. "
                "Requires synthesis to be enabled in brain settings. For raw retrieval only, use knowledge_search."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Question to answer from the knowledge base."},
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum source chunks to retrieve before synthesis (1-20).",
                    },
                    "brain_id": {
                        "type": "string",
                        "description": "Optional: synthesize from a single docs brain id.",
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
            "name": "web_search",
            "description": (
                "Search the public web for up-to-date information (news, live data, documentation "
                "beyond knowledge cutoff). Prefer this for time-sensitive or externally verifiable "
                "facts before answering."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search keywords or question."},
                    "max_results": {
                        "type": "integer",
                        "description": (
                            "Number of results (>=1). Omit to use workspace default; "
                            "values are capped by the configured maximum."
                        ),
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
            "name": "web_fetch",
            "description": (
                "Fetch a single web URL and return its readable text content plus a list of "
                "in-page image URLs. Use this when the user provides a URL whose content you "
                "need to understand. Returns markdown-ish text (HTML stripped) and a structured "
                "tail block '[discovered_images]' listing absolute image URLs in source order. "
                "Combine with view_image when visual content matters. Max page size 2 MB."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Absolute http(s) URL to fetch.",
                    },
                    "max_images": {
                        "type": "integer",
                        "description": "Cap on how many image URLs to return (default 20, hard max 50).",
                    },
                },
                "required": ["url"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "view_image",
            "description": (
                "Load an image so the model can visually inspect it in the next turn. Accepts a "
                "local absolute/relative file path, a http(s) URL (e.g. one returned by "
                "web_fetch's [discovered_images]), or a data:image/* URL. Use when visual content "
                "is necessary to answer (e.g. user asked 'describe the first image'). Returns an "
                "error if the current model is not vision-capable. Each turn caps total attached "
                "images at 4."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "File path, http(s) URL, or data:image/* URL.",
                    },
                    "note": {
                        "type": "string",
                        "description": "Optional short label used in the placeholder text (e.g. 'cover image').",
                    },
                },
                "required": ["target"],
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


_CODE_SEARCH_TOOL: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "code_search",
        "description": (
            "Semantic/hybrid search over mounted code brains (设置 → 知识库 → 代码脑) "
            "or a legacy global code_index codebase. Returns {hits, by_brain, brains}. "
            "Prefer in Explore phase before reading whole files."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "codebase_path": {
                    "type": "string",
                    "description": "Legacy: root path indexed via global code_index (omit when using code brains).",
                },
                "query": {"type": "string", "description": "Natural language or keyword query."},
                "top_k": {"type": "integer", "description": "Number of hits (default 10)."},
                "brain_id": {
                    "type": "string",
                    "description": "Optional: search only this code brain id.",
                },
                "strategy": {
                    "type": "string",
                    "enum": ["hybrid", "semantic", "bm25"],
                    "description": "Search strategy (default hybrid).",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
}


def code_index_config_enabled() -> bool:
    try:
        return bool(ConfigManager.get_value("code_index.enabled"))
    except Exception:
        return False


def _has_enabled_code_brains() -> bool:
    try:
        from agenticx.brain.registry import BrainRegistry
        from agenticx.brain.types import BrainType

        BrainRegistry.instance().bootstrap()
        return any(
            b.enabled and b.type == BrainType.CODE for b in BrainRegistry.instance().list_brains()
        )
    except Exception:
        return False


def _code_search_tool_defs() -> List[Dict[str, Any]]:
    return _code_index_tool_defs()


def studio_tools_for_session(session: Optional[StudioSession] = None) -> List[Dict[str, Any]]:
    """Studio/Meta tool list with optional code_search when mounted code brains exist."""
    tools = merge_computer_use_tools_into(list(STUDIO_TOOLS))
    try:
        from agenticx.brain.mount import session_has_mounted_code_brains

        if session is not None and session_has_mounted_code_brains(session):
            extra = _code_search_tool_defs()
            if extra:
                names = {
                    str(t.get("function", {}).get("name", ""))
                    for t in tools
                    if isinstance(t, dict)
                }
                for spec in extra:
                    n = str(spec.get("function", {}).get("name", ""))
                    if n and n not in names:
                        tools.append(spec)
                        names.add(n)
    except Exception:
        pass
    return tools


_MAX_DESKTOP_SCREENSHOT_BYTES_FOR_B64 = 950_000


def _agenticx_desktop_use_dir() -> Path:
    """Fixed directory for desktop screenshots (under ~/.agenticx, not session cwd)."""
    d = (Path.home() / ".agenticx" / "desktop-use").resolve(strict=False)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _desktop_use_blocked_message() -> str:
    return (
        "ERROR: 桌面操控工具未启用。请在 Near 设置中开启「桌面操控」（写入 ~/.agenticx/config.yaml 的 "
        "computer_use.enabled）后完全重启 Near。"
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


def build_clarification_tool_result(answer: Dict[str, Any]) -> str:
    """Render a structured clarification answer as natural-language tool result.

    The agent reads this text as the tool result of ``request_clarification``
    and continues the same turn. Sentinels ``__timeout__`` / ``__suspended__``
    are translated into explicit guidance so the model wraps up gracefully
    instead of asking again.
    """
    if isinstance(answer, dict):
        if answer.get("__timeout__"):
            return (
                "[CLARIFICATION_TIMEOUT] 用户未在时限内回复该提问。"
                "请把待确认项写入待办并优雅结束本轮，不要重复发起同一提问。"
            )
        if answer.get("__suspended__"):
            return (
                "[CLARIFICATION_PENDING] 当前为无人值守/自动化会话，已向用户发起提问但暂无人回复。"
                "请把待确认项写入待办并结束本轮，等待用户下次回来时再继续。"
            )
    answer_text = str((answer or {}).get("answer_text", "") or "").strip()
    selected = list((answer or {}).get("selected_options", []) or [])
    parts: List[str] = []
    if selected:
        parts.append("用户选择：" + "；".join(selected))
    if answer_text:
        parts.append(f"自定义补充：{answer_text}")
    if not parts:
        return "用户未提供具体内容（视为按你的默认方案推进）。"
    return "；".join(parts) + "。"


def _normalize_clarification_decisions(raw: Any) -> List[Dict[str, Any]]:
    """Parse structured decision groups for multi-part sign-off cards."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw[:6]):
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "") or "").strip()
        raw_opts = item.get("options") or []
        if not question or not isinstance(raw_opts, list):
            continue
        options = [str(opt).strip() for opt in raw_opts if str(opt).strip()][:8]
        if not options:
            continue
        decision_id = str(item.get("id", "") or "").strip() or f"decision-{idx + 1}"
        out.append({"id": decision_id, "question": question, "options": options})
    return out


async def _request_clarification(
    prompt: str,
    *,
    options: Optional[List[str]] = None,
    decisions: Optional[List[Dict[str, Any]]] = None,
    allow_free_text: bool = True,
    context: Optional[Dict[str, Any]] = None,
    clarify_gate: Optional[ClarifyGate] = None,
    emit_event: Optional[Any] = None,
    is_unattended: bool = False,
) -> str:
    """Block inside a tool call to ask the user an open-ended question.

    Emits ``clarification_required`` (or ``clarification_suspended`` for
    unattended sessions), waits on the clarify gate, and returns a tool-result
    string built by :func:`build_clarification_tool_result`.
    """
    options = list(options or [])
    decisions = list(decisions or [])
    payload_context = dict(context or {})
    request_id = str(payload_context.get("request_id") or uuid.uuid4())
    payload_context["request_id"] = request_id

    # Unattended/automation sessions must never block -- there is no UI to
    # answer. AutoSuspendClarifyGate also hits this branch via isinstance.
    if is_unattended or isinstance(clarify_gate, AutoSuspendClarifyGate):
        _log.info(
            "[clarify] suspended id=%s prompt=%s (unattended)",
            request_id,
            prompt[:80],
        )
        if emit_event is not None:
            await emit_event(
                {
                    "type": "clarification_suspended",
                    "data": {
                        "id": request_id,
                        "prompt": prompt,
                        "options": options,
                        "decisions": decisions,
                        "allow_free_text": allow_free_text,
                        "context": payload_context,
                    },
                }
            )
        return build_clarification_tool_result({"__suspended__": True})

    gate = clarify_gate or AsyncClarifyGate()
    emit_prompt = emit_event is not None and isinstance(gate, AsyncClarifyGate)
    if emit_prompt:
        await emit_event(
            {
                "type": "clarification_required",
                "data": {
                    "id": request_id,
                    "prompt": prompt,
                    "options": options,
                    "decisions": decisions,
                    "allow_free_text": allow_free_text,
                    "context": payload_context,
                },
            }
        )
    _log.info("[clarify] requested id=%s prompt=%s", request_id, prompt[:80])
    answer = await gate.request_clarification(
        prompt,
        options=options,
        allow_free_text=allow_free_text,
        context=payload_context,
    )
    _log.info("[clarify] resolved id=%s answer=%s", request_id, answer)
    if emit_prompt:
        await emit_event(
            {
                "type": "clarification_response",
                "data": {
                    "id": request_id,
                    "answer": answer,
                },
            }
        )
    return build_clarification_tool_result(answer)


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


_CD_PEEL_BLOCK_METACHAR_RE = re.compile(r"\|\||\||>|<|\$\(|`")


def _command_blocks_cd_prefix_peel(command: str) -> bool:
    """If True, do not peel ``cd … &&`` into cwd + argv — preserves pipes/redirs/subshells."""
    return bool(_CD_PEEL_BLOCK_METACHAR_RE.search(command))


_STDERR_REDIRECT_PEEL_HINT_RES = (
    re.compile(r"unrecognized arguments:.*2>", re.I),
    re.compile(r"syntax error.*unexpected token", re.I),
    re.compile(r"unexpected token.*'\|'", re.I),
    re.compile(r"command not found.*&&", re.I),
)


def _stderr_suggests_redirect_peel_damage(text: str) -> bool:
    return any(rx.search(text) for rx in _STDERR_REDIRECT_PEEL_HINT_RES)


def _bash_stdout_output_hint(stdout: str) -> str:
    """Append-only hint so models notice answers already in stdout (FR-10)."""
    if not stdout or not stdout.strip():
        return ""
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    paths: List[str] = []
    for m in re.finditer(r"(?:/[\w./+\-]{3,}|~/[\w./+\-]{2,})", stdout[:50_000]):
        g = m.group(0)
        if g not in paths:
            paths.append(g)
        if len(paths) >= 2:
            break
    path_part = ", ".join(paths[:2]) if paths else "(无路径匹配)"
    return (
        f"\nOUTPUT_HINT: stdout 已包含 {len(lines)} 个非空行，主要文件路径线索 = {path_part}\n"
    )


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
        peeled = (
            None
            if _command_blocks_cd_prefix_peel(command)
            else _try_peel_cd_prefix_parts(parts, session)
        )
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
    # Standalone ``cd DIR`` helper only — compound commands stay on shell/exec path.
    if command_name == "cd" and len(parts) <= 2:
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
    out = (
        f"exit_code={proc.returncode}\n"
        f"stdout:\n{stdout or '(empty)'}\n"
        f"stderr:\n{stderr or '(empty)'}"
    )
    if proc.returncode != 0:
        blob = f"{stdout}\n{stderr}"
        if _stderr_suggests_redirect_peel_damage(blob):
            out += (
                "\n\n[HINT] 检测到 shell 元字符（如 2>&1 / | / > 等）可能因 `cd` 前缀剥离或参数拆分被破坏。"
                "建议：(a) 移除命令内的 cd 前缀并在 bash_exec 的 cwd 参数指定工作目录；"
                "或 (b) 使用 bash -c '...' 显式包裹整条命令。\n"
            )
    elif stdout and len(stdout) >= 200:
        hint_line = _bash_stdout_output_hint(stdout)
        if hint_line:
            out += hint_line
    return out


def _max_read_chars_for_session(session: Optional[StudioSession]) -> int:
    if session is None:
        return MAX_READ_CHARS
    try:
        from agenticx.runtime.session_mode import is_code_dev

        return MAX_READ_CHARS_CODE_DEV if is_code_dev(session) else MAX_READ_CHARS
    except Exception:
        return MAX_READ_CHARS


def _tool_code_search(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    try:
        from agenticx.code_index.tools import dispatch_code_search  # type: ignore
    except ImportError:
        return (
            "ERROR: code_index 依赖未安装。请执行: pip install 'agenticx[code_index]'"
        )
    return dispatch_code_search(arguments, session)


def _tool_code_index_create(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    from agenticx.code_index.tools import dispatch_code_index_create

    return dispatch_code_index_create(arguments, session)


def _tool_code_index_status(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    from agenticx.code_index.tools import dispatch_code_index_status

    return dispatch_code_index_status(arguments, session)


def _tool_code_index_clear(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    from agenticx.code_index.tools import dispatch_code_index_clear

    return dispatch_code_index_clear(arguments, session)


def _tool_code_index_cancel(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    from agenticx.code_index.tools import dispatch_code_index_cancel

    return dispatch_code_index_cancel(arguments, session)


_CODE_INDEX_LIFECYCLE_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "code_index_create",
            "description": "Start background indexing for a codebase (code_index.enabled).",
            "parameters": {
                "type": "object",
                "properties": {
                    "codebase_path": {"type": "string", "description": "Root path to index."},
                },
                "required": ["codebase_path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_index_status",
            "description": "Query code index build status for a codebase (or all tasks if path omitted).",
            "parameters": {
                "type": "object",
                "properties": {
                    "codebase_path": {"type": "string", "description": "Optional root path."},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_index_clear",
            "description": "Drop in-memory code index for a codebase and free memory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "codebase_path": {"type": "string", "description": "Root path to clear."},
                },
                "required": ["codebase_path"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_index_cancel",
            "description": "Cooperatively cancel an in-progress code index build by task_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "Task id from code_index_create/status."},
                },
                "required": ["task_id"],
                "additionalProperties": False,
            },
        },
    },
]


def _code_index_tool_defs() -> List[Dict[str, Any]]:
    if not code_index_config_enabled() and not _has_enabled_code_brains():
        return []
    try:
        import importlib

        importlib.import_module("agenticx.code_index")
    except ImportError:
        return []
    tools: List[Dict[str, Any]] = [_CODE_SEARCH_TOOL]
    if code_index_config_enabled():
        tools.extend(_CODE_INDEX_LIFECYCLE_TOOLS)
    return tools


def _tool_code_outline(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    from agenticx.runtime.code_outline import build_outline, format_outline_result

    raw_path = str(arguments.get("path", "")).strip()
    if not raw_path:
        return "ERROR: path is required"
    try:
        resolved = _resolve_workspace_path(raw_path, session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    query = str(arguments.get("query", "") or "").strip() or None
    max_files = int(arguments.get("max_files") or 50)
    max_files = min(max(max_files, 1), 50)
    payload = build_outline(resolved, query=query, max_files=max_files)
    if payload.get("error"):
        return f"ERROR: {payload['error']}"
    return format_outline_result(payload)


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
    max_chars = _max_read_chars_for_session(session)
    whole_file = start_line is None and end_line is None
    if start_line is not None or end_line is not None:
        lines = content.splitlines()
        start = max(1, int(start_line or 1))
        end = min(len(lines), int(end_line or len(lines)))
        if start > end:
            return "ERROR: invalid line range"
        selected = lines[start - 1 : end]
        numbered = [f"{idx+start}|{line}" for idx, line in enumerate(selected)]
        out = "\n".join(numbered)
        if session is not None:
            from agenticx.runtime.code_read_cache import record_file_read

            record_file_read(session, path, start_line=start, end_line=end, total_lines=len(lines))
        return out

    if session is not None:
        try:
            from agenticx.runtime.code_read_cache import record_file_read
            from agenticx.runtime.session_mode import (
                EXPLORE_WHOLE_FILE_READ_WARN_KEY,
                PHASE_EXPLORE,
                get_session_phase,
                is_code_dev,
            )

            record_file_read(
                session,
                path,
                start_line=None,
                end_line=None,
                total_lines=len(content.splitlines()),
            )
            if is_code_dev(session) and get_session_phase(session) == PHASE_EXPLORE:
                scratch = getattr(session, "scratchpad", None) or {}
                if isinstance(scratch, dict):
                    count = int(scratch.get(EXPLORE_WHOLE_FILE_READ_WARN_KEY, 0) or 0) + 1
                    scratch[EXPLORE_WHOLE_FILE_READ_WARN_KEY] = str(count)
        except Exception:
            pass

    if len(content) > max_chars:
        suffix = (
            f"\n... (truncated, total {len(content)} chars)"
            + (
                " 建议：code_dev 模式下请使用 start_line/end_line 缩小范围，或先用 code_outline。"
                if max_chars <= MAX_READ_CHARS_CODE_DEV
                else ""
            )
        )
        out = content[:max_chars] + suffix
    else:
        out = content
    if session is not None:
        tracker = getattr(session, "file_state_tracker", None)
        if tracker is not None and whole_file:
            tracker.record_read(str(path), content)
    return out


def _autoheal_skill_md_after_write(path: Path, base_msg: str) -> str:
    """Ensure a SKILL.md written via file tools is discoverable by the Skills system.

    When ``path`` points at ``<...>/skills/<name>/SKILL.md`` we normalize the YAML
    frontmatter (injecting ``name=<dir>`` / placeholder description when missing) and
    verify the SkillBundleLoader can parse it.  This guarantees that any "saved"
    reply for a skill equals "searchable in Settings → Skills".  Non-skill writes are
    returned unchanged.
    """
    try:
        if path.name != "SKILL.md":
            return base_msg
        parts = [p for p in path.parts]
        if "skills" not in parts:
            return base_msg
        skill_dir = path.parent
        # SKILL.md must live in skills/<name>/SKILL.md, not directly under skills/.
        if not skill_dir.name or skill_dir.name == "skills":
            return base_msg

        from agenticx.skills.frontmatter import (
            SkillFrontmatterError,
            normalize_skill_md,
            verify_skill_discoverable,
        )

        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            return base_msg

        try:
            normalized, fixed = normalize_skill_md(content, skill_dir.name)
        except SkillFrontmatterError as exc:
            return (
                f"ERROR: skill 不会被收录 — {exc}。"
                "SKILL.md 必须以 YAML frontmatter（`---\\nname: <名称>\\ndescription: <描述>\\n---`）开头。"
                f"文件已写入 {path}，但**不会**出现在设置 → Skills，请修正 frontmatter 后重写。"
            )

        if fixed:
            try:
                path.write_text(normalized, encoding="utf-8")
            except OSError as exc:
                return f"{base_msg}\n[warn] 自动补全 frontmatter 失败：{exc}（skill 可能无法被检索）"

        discoverable, skill_name, errors = verify_skill_discoverable(skill_dir)
        if not discoverable:
            detail = "; ".join(errors) if errors else "unknown parse failure"
            return (
                f"ERROR: skill 写入后仍不可被检索（{detail}）。"
                f"文件已写入 {path}，但**不会**出现在设置 → Skills。"
            )

        note = f"（已自动补全 frontmatter：{', '.join(fixed)}）" if fixed else ""
        return f"{base_msg}\nOK: skill '{skill_name}' 已可在设置 → Skills 检索{note}"
    except Exception:
        # Never let auto-heal failures break the underlying write result.
        return base_msg


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
    from_path_arg = str(arguments.get("from_path", "") or "").strip()
    raw_content = arguments.get("content")
    if from_path_arg:
        try:
            src = _resolve_workspace_path(from_path_arg, session, pick_existing=True)
        except ValueError as exc:
            return f"ERROR: {exc}"
        if not src.is_file():
            return f"ERROR: from_path not found: {src}"
        try:
            new_text = _strip_tool_metadata_noise_lines(src.read_text(encoding="utf-8", errors="replace"))
        except OSError as exc:
            return f"ERROR: read from_path failed: {exc}"
    elif raw_content is None:
        return (
            "ERROR: missing required parameter 'content' or 'from_path'. "
            "You must provide file content, e.g. file_write(path='/Users/.../file.py', content='...')"
        )
    else:
        new_text = _strip_tool_metadata_noise_lines(str(raw_content))
    try:
        path = _resolve_workspace_path(raw_path, session)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if _is_protected_config_path(path):
        return (
            "ERROR: direct writes to ~/.agenticx/config.yaml are blocked for safety. "
            "Use update_email_config meta tool for notifications.email.* updates."
        )
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
    return _autoheal_skill_md_after_write(path, f"OK: wrote {path}")


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
    return _autoheal_skill_md_after_write(path, f"OK: edited {path}")


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
    from agenticx.llms.vision import is_vision_capable

    return not is_vision_capable(provider, model)


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
        from pathlib import Path

        hint = (
            f"Skill '{name}' was not found in the skill index. "
            "Common causes: SKILL.md missing YAML `name:` (only `title:` is not enough), "
            "skill not under a scanned path, or name mismatch vs frontmatter. "
            "Run skill_list for discoverable names, or fix frontmatter then retry skill_use."
        )
        guessed = Path.home() / ".agenticx" / "skills" / name / "SKILL.md"
        if guessed.is_file():
            hint += (
                f" File exists at {guessed} but is not indexed — add "
                f"`name: {name}` to frontmatter (or use skill_manage create/patch)."
            )
        return f"ERROR: skill activation failed. {hint}"

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
    old_value = scratchpad.get(key, "")
    scratchpad[key] = value
    try:
        from agenticx.runtime.session_mode import (
            PHASE_AUTHOR,
            PHASE_READ,
            PHASE_SCRATCH_KEY,
            is_code_dev,
        )

        if is_code_dev(session) and key == PHASE_SCRATCH_KEY:
            prev = str(old_value or "").strip().lower()
            new = value.strip().lower()
            if prev == PHASE_READ and new == PHASE_AUTHOR:
                setattr(session, "_code_dev_phase_compact_pending", True)
    except Exception:
        pass
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
    session: Optional["StudioSession"] = None,
) -> str:
    target = str(arguments.get("target", "")).strip().lower()
    content = str(arguments.get("content", "")).strip()
    scope = str(arguments.get("scope", "subject") or "subject").strip().lower()
    if target not in {"daily", "long_term"}:
        return "ERROR: target must be daily or long_term"
    if scope not in {"subject", "user_global"}:
        return "ERROR: scope must be subject or user_global"
    if not content:
        return "ERROR: content is required"

    from datetime import date

    from agenticx.workspace.loader import (
        DAILY_MEMORY_TEMPLATE,
        append_daily_memory,
        append_long_term_memory,
        append_user_global_preference,
        resolve_subject_workspace_dir,
        resolve_workspace_dir,
    )

    if scope == "user_global":
        if target != "long_term":
            return "ERROR: user_global scope only supports target=long_term"
        if not await _confirm(
            "Append preference to global USER.md (all subjects)?",
            confirm_gate=confirm_gate,
            context={"tool": "memory_append", "scope": scope, "preview": content[:200]},
            emit_event=emit_event,
        ):
            return "CANCELLED: user denied memory append"
        append_user_global_preference(content)
        workspace_dir = resolve_workspace_dir()
    else:
        workspace_dir = resolve_subject_workspace_dir(session=session)
        workspace_dir.mkdir(parents=True, exist_ok=True)
        if target == "long_term":
            if not await _confirm(
                "Append note into this subject's long-term MEMORY.md?",
                confirm_gate=confirm_gate,
                context={"tool": "memory_append", "target": target, "preview": content[:200]},
                emit_event=emit_event,
            ):
                return "CANCELLED: user denied memory append"
            append_long_term_memory(workspace_dir, content)
        else:
            memory_dir = workspace_dir / "memory"
            memory_dir.mkdir(parents=True, exist_ok=True)
            today_file = memory_dir / f"{date.today().isoformat()}.md"
            if not today_file.exists():
                today_file.write_text(
                    DAILY_MEMORY_TEMPLATE.format(today=date.today().isoformat()),
                    encoding="utf-8",
                )
            append_daily_memory(workspace_dir, content)

    try:
        store = WorkspaceMemoryStore()
        store.index_workspace_sync(workspace_dir)
        global_ws = resolve_workspace_dir()
        if workspace_dir.resolve(strict=False) != global_ws.resolve(strict=False):
            store.index_workspace_sync(global_ws)
    except Exception:
        pass
    return f"OK: appended to {target} (scope={scope})"


def _tool_knowledge_search(
    arguments: Dict[str, Any], session: Optional["StudioSession"] = None
) -> str:
    """Search mounted docs brains (multi-brain architecture)."""

    query = str(arguments.get("query", "")).strip()
    if not query:
        return json.dumps(
            {"ok": False, "error": "query is required", "hits": []},
            ensure_ascii=False,
        )
    try:
        from agenticx.brain.search import search_docs_brains
        from agenticx.studio.kb import KBManager
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"KB subsystem unavailable: {exc}", "hits": []},
            ensure_ascii=False,
        )

    cfg = KBManager.instance().read_config()
    default_top_k = int(getattr(getattr(cfg, "retrieval", None), "top_k", 5) or 5)
    raw_top_k = arguments.get("top_k")
    try:
        top_k = int(raw_top_k) if raw_top_k is not None else default_top_k
    except (TypeError, ValueError):
        top_k = default_top_k
    top_k = max(1, min(20, top_k))

    avatar_id = None
    if session is not None:
        avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    brain_id = str(arguments.get("brain_id") or "").strip() or None

    try:
        payload = search_docs_brains(
            query=query,
            top_k=top_k,
            avatar_id=avatar_id,
            brain_id=brain_id,
        )
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"search failed: {exc}", "hits": []},
            ensure_ascii=False,
        )
    return json.dumps(payload, ensure_ascii=False)


def _tool_knowledge_synthesize(
    arguments: Dict[str, Any], session: Optional["StudioSession"] = None
) -> str:
    query = str(arguments.get("query", "")).strip()
    if not query:
        return json.dumps(
            {"ok": False, "error": "query is required", "answer": ""},
            ensure_ascii=False,
        )
    try:
        from agenticx.brain.synthesis import synthesize_docs_brains
        from agenticx.studio.kb import KBManager
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"KB subsystem unavailable: {exc}", "answer": ""},
            ensure_ascii=False,
        )

    cfg = KBManager.instance().read_config()
    default_top_k = int(getattr(getattr(cfg, "retrieval", None), "top_k", 5) or 5)
    raw_top_k = arguments.get("top_k")
    try:
        top_k = int(raw_top_k) if raw_top_k is not None else default_top_k
    except (TypeError, ValueError):
        top_k = default_top_k
    top_k = max(1, min(20, top_k))

    avatar_id = None
    if session is not None:
        avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    brain_id = str(arguments.get("brain_id") or "").strip() or None

    try:
        payload = synthesize_docs_brains(
            query=query,
            top_k=top_k,
            avatar_id=avatar_id,
            brain_id=brain_id,
        )
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"synthesis failed: {exc}", "answer": ""},
            ensure_ascii=False,
        )
    return json.dumps(payload, ensure_ascii=False)


def _tool_web_search(arguments: Dict[str, Any], session: Optional["StudioSession"] = None) -> str:
    query = str(arguments.get("query", "")).strip()
    if not query:
        return "ERROR: web_search requires a non-empty query"
    raw_mr = arguments.get("max_results")
    try:
        from agenticx.studio.web_search.service import WebSearchService
        from agenticx.studio.references import queue_web_search_batch

        svc = WebSearchService.from_config()
        mr: int | None = None
        if raw_mr is not None and str(raw_mr).strip() != "":
            mr = int(raw_mr)
        hits = svc.search(query, max_results=mr)
        if session is not None:
            queue_web_search_batch(
                session,
                query=query,
                hits=hits,
                provider=str(svc._cfg.default_provider or "duckduckgo"),
            )
        return WebSearchService.format_results(hits)
    except Exception as exc:
        return f"ERROR: web_search failed: {exc}"


PENDING_VISUAL_ATTACHMENTS_KEY = "__pending_visual_attachments__"
VIEW_IMAGE_INJECT_LLM_TEXT = (
    "<system-injected> attached images requested via view_image tool:"
)
VIEW_IMAGE_INJECT_METADATA_SOURCE = "view_image_inject"
_WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024
_WEB_FETCH_BODY_CHAR_LIMIT = 12_000
_VIEW_IMAGE_MAX_BYTES = 8 * 1024 * 1024
_VIEW_IMAGE_MAX_PENDING = 4
_VIDEO_UNDERSTAND_DEFAULT_MAX_FRAMES = 12
_VIDEO_UNDERSTAND_HARD_MAX_FRAMES = 24
_VIDEO_UNDERSTAND_DEFAULT_INTERVAL_SECONDS = 8.0
_VIDEO_UNDERSTAND_MIN_FRAMES = 4
_VIDEO_UNDERSTAND_MAX_VIDEO_BYTES = 512 * 1024 * 1024
_ALLOWED_WEB_FETCH_CONTENT_TYPES = (
    "text/html",
    "application/xhtml",
    "text/plain",
    "text/markdown",
)


def _httpx_transport_for_url(url: str):
    import httpx

    host = (urlparse(url).hostname or "").lower()
    if host in {"127.0.0.1", "localhost", "::1"}:
        return httpx.AsyncHTTPTransport()
    return None


def _detect_image_mime(data: bytes) -> str | None:
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 6 and data[:6] in {b"GIF87a", b"GIF89a"}:
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 2 and data[:2] == b"BM":
        return "image/bmp"
    return None


def _filename_from_url(url: str, mime: str) -> str:
    path = urlparse(url).path.rsplit("/", 1)[-1].strip()
    if path and "." in path:
        return path
    ext = "png"
    if "jpeg" in mime or "jpg" in mime:
        ext = "jpg"
    elif "webp" in mime:
        ext = "webp"
    elif "gif" in mime:
        ext = "gif"
    elif "bmp" in mime:
        ext = "bmp"
    return f"image.{ext}"


def _data_url_from_bytes(data: bytes, mime: str) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _parse_data_image_url(target: str) -> tuple[bytes, str] | None:
    raw = str(target or "").strip()
    if not raw.startswith("data:image/"):
        return None
    header, _, payload = raw.partition(",")
    if not payload:
        return None
    mime = header[5:].split(";", 1)[0].strip() or "image/png"
    try:
        if ";base64" in header.lower():
            data = base64.b64decode(payload, validate=False)
        else:
            from urllib.parse import unquote_to_bytes

            data = unquote_to_bytes(payload)
    except Exception:
        return None
    return data, mime


async def _fetch_http_bytes(url: str, *, timeout: float, max_bytes: int) -> tuple[bytes, str, str]:
    import httpx

    transport = _httpx_transport_for_url(url)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        transport=transport,
    ) as client:
        response = await client.get(url)
        final_url = str(response.url)
        if response.status_code != 200:
            raise ValueError(f"http {response.status_code}")
        content_type = str(response.headers.get("content-type", "") or "").split(";", 1)[0].strip().lower()
        data = response.content
        if len(data) > max_bytes:
            raise ValueError("too-large")
        return data, content_type, final_url


def _pending_visual_attachments(session: Optional[StudioSession]) -> list[dict[str, Any]]:
    if session is None:
        return []
    scratchpad = getattr(session, "scratchpad", None)
    if not isinstance(scratchpad, dict):
        session.scratchpad = {}
        scratchpad = session.scratchpad
    pending = scratchpad.get(PENDING_VISUAL_ATTACHMENTS_KEY)
    if not isinstance(pending, list):
        pending = []
        scratchpad[PENDING_VISUAL_ATTACHMENTS_KEY] = pending
    return pending


def _session_vision_capable(session: Optional[StudioSession]) -> bool:
    from agenticx.llms.vision import is_vision_capable

    provider = str(getattr(session, "provider_name", "") or "")
    model = str(getattr(session, "model_name", "") or "")
    return is_vision_capable(provider, model)


async def _tool_web_fetch(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    url = str(arguments.get("url", "") or "").strip()
    if not url:
        return "ERROR: missing required parameter 'url'"
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return "ERROR: only http(s) URLs are supported"
    raw_max_images = arguments.get("max_images")
    try:
        max_images = int(raw_max_images) if raw_max_images is not None else 20
    except (TypeError, ValueError):
        max_images = 20
    max_images = max(1, min(max_images, 50))
    try:
        body, content_type, final_url = await _fetch_http_bytes(
            url,
            timeout=15.0,
            max_bytes=_WEB_FETCH_MAX_BYTES,
        )
    except ValueError as exc:
        reason = str(exc)
        if reason == "too-large":
            return "ERROR: page exceeds 2MB limit"
        if reason.startswith("http "):
            return f"ERROR: {reason}"
        return f"ERROR: network"
    except Exception:
        return "ERROR: network"
    if not any(content_type.startswith(prefix) for prefix in _ALLOWED_WEB_FETCH_CONTENT_TYPES):
        return f"ERROR: unsupported content-type {content_type or '(missing)'}"
    from agenticx.tools.html_extractor import extract_readable_text

    html = body.decode("utf-8", errors="replace")
    extracted = extract_readable_text(html, final_url)
    title = str(extracted.get("title", "") or "").strip() or "(untitled)"
    text = str(extracted.get("text", "") or "").strip()
    total_chars = len(text)
    truncated = False
    if total_chars > _WEB_FETCH_BODY_CHAR_LIMIT:
        text = text[:_WEB_FETCH_BODY_CHAR_LIMIT]
        truncated = True
    lines = [f"Title: {title}", f"URL: {final_url}", "", text]
    if truncated:
        lines.append(f"...[truncated, total ~{total_chars} chars]")
    images = list(extracted.get("images") or [])[:max_images]
    if images:
        lines.append("")
        lines.append("[discovered_images]")
        for idx, image_url in enumerate(images, start=1):
            lines.append(f"{idx}. {image_url}")
    return "\n".join(lines).strip()


async def _tool_view_image(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    target = str(arguments.get("target", "") or "").strip()
    note = str(arguments.get("note", "") or "").strip()
    if not target:
        return "ERROR: missing required parameter 'target'"
    if not _session_vision_capable(session):
        model = str(getattr(session, "model_name", "") or "unknown")
        return (
            f"ERROR: current model '{model}' does not support vision; "
            "switch to a vision-capable model first."
        )
    pending = _pending_visual_attachments(session)
    if len(pending) >= _VIEW_IMAGE_MAX_PENDING:
        return "ERROR: too many pending visual attachments (max 4 per turn)"
    data: bytes
    mime: str
    name: str
    source = target
    parsed = urlparse(target)
    if target.startswith("data:image/"):
        parsed_data = _parse_data_image_url(target)
        if parsed_data is None:
            return "ERROR: unsupported image type"
        data, mime = parsed_data
        name = "clipboard-image"
    elif parsed.scheme in {"http", "https"}:
        try:
            data, content_type, final_url = await _fetch_http_bytes(
                target,
                timeout=10.0,
                max_bytes=_VIEW_IMAGE_MAX_BYTES,
            )
        except ValueError as exc:
            reason = str(exc)
            if reason == "too-large":
                return "ERROR: image exceeds 8MB limit"
            if reason.startswith("http "):
                return f"ERROR: {reason}"
            return "ERROR: network"
        except Exception:
            return "ERROR: network"
        mime = _detect_image_mime(data) or (
            content_type if content_type.startswith("image/") else None
        )
        if not mime:
            return "ERROR: unsupported image type"
        source = final_url
        name = _filename_from_url(final_url, mime)
    elif parsed.scheme in {"file", ""} or target.startswith("/") or (len(target) > 2 and target[1] == ":"):
        session_hit = None
        if session is not None:
            try:
                from agenticx.studio.chat_attachments import resolve_session_chat_image

                session_hit = resolve_session_chat_image(session, target)
            except Exception:
                session_hit = None
        if session_hit is not None:
            data, mime, name, source = session_hit
        else:
            try:
                path = _resolve_workspace_path(target, session, pick_existing=True)
            except ValueError as exc:
                return f"ERROR: {exc}"
            if not path.exists() or not path.is_file():
                return f"ERROR: file not found: {path}"
            data = path.read_bytes()
            if len(data) > _VIEW_IMAGE_MAX_BYTES:
                return "ERROR: image exceeds 8MB limit"
            mime = _detect_image_mime(data)
            if not mime:
                return "ERROR: unsupported image type"
            name = path.name
            source = str(path)
    else:
        return "ERROR: only http(s) URLs, data:image/* URLs, and local file paths are supported"
    if len(data) > _VIEW_IMAGE_MAX_BYTES:
        return "ERROR: image exceeds 8MB limit"
    data_url = _data_url_from_bytes(data, mime)
    pending.append(
        {
            "name": name,
            "data_url": data_url,
            "mime_type": mime,
            "size": len(data),
            "source": source,
            "note": note,
        }
    )
    size_kb = max(1, len(data) // 1024)
    note_clause = f" ({note})" if note else ""
    return (
        f"[image loaded: {name} ({size_kb} KB, {mime}); "
        f"will be visually attached in next turn{note_clause}]"
    )


async def _tool_memory_search(arguments: Dict[str, Any], session: StudioSession) -> str:
    query = str(arguments.get("query", "")).strip()
    if not query:
        return "ERROR: query is required"
    mode = str(arguments.get("mode", "hybrid") or "hybrid").strip().lower()
    limit = int(arguments.get("limit", 5) or 5)
    avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    session_id = str(getattr(session, "session_id", "") or "").strip() or None
    try:
        from agenticx.memory.recall import search_memory_for_chat

        recall = await search_memory_for_chat(
            query,
            limit=max(1, limit),
            mode=mode,
            avatar_id=avatar_id,
            session_id=session_id,
        )
        rows = recall.matches
    except Exception as exc:
        return f"ERROR: memory search failed: {exc}"
    if not rows:
        return "No memory matches."
    lines: List[str] = []
    for idx, row in enumerate(rows, start=1):
        text = str(row.get("text", "")).replace("\n", " ")
        if len(text) > 240:
            text = text[:240] + "..."
        source = str(row.get("source") or "workspace")
        path = str(row.get("path") or "")
        loc = f"path={path}:{row.get('start_line')}-{row.get('end_line')}" if path else f"source={source}"
        lines.append(
            f"{idx}. score={row.get('score', 0.0)} {loc} text={text}"
        )
    if recall.graph_skipped_reason:
        lines.append(f"(graph skipped: {recall.graph_skipped_reason})")
    return "\n".join(lines)


async def _tool_memory_forget(arguments: Dict[str, Any], session: StudioSession) -> str:
    query = str(arguments.get("query", "")).strip()
    scope = str(arguments.get("scope", "both") or "both").strip().lower()
    avatar_id = str(getattr(session, "bound_avatar_id", "") or "").strip() or None
    session_id = str(getattr(session, "session_id", "") or "").strip() or None
    try:
        from agenticx.memory.graph.forget import forget_memory_for_session

        result = await forget_memory_for_session(
            query,
            scope=scope,
            avatar_id=avatar_id,
            session_id=session_id,
        )
    except Exception as exc:
        return f"ERROR: memory forget failed: {exc}"
    return json.dumps(result, ensure_ascii=False)


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


def _skill_url_allowlist() -> List[str]:
    defaults = [
        "raw.githubusercontent.com",
        "gist.githubusercontent.com",
        "registry.clawhub.ai",
    ]
    try:
        from agenticx.cli.config_manager import ConfigManager

        raw = ConfigManager.get_value("skill_manage.url_allowlist")
        if isinstance(raw, list) and raw:
            return [str(x).strip().lower() for x in raw if str(x).strip()]
    except Exception:
        pass
    return defaults


def _skill_max_url_bytes() -> int:
    try:
        from agenticx.cli.config_manager import ConfigManager

        raw = ConfigManager.get_value("skill_manage.max_url_payload_bytes")
        if raw is not None:
            return max(1024, int(raw))
    except Exception:
        pass
    return 1_048_576


def _resolve_skill_content_path(path_arg: str, session: Optional[StudioSession]) -> Path:
    """Resolve a local path for skill content (workspace or ~/.agenticx/)."""
    agx_root = (Path.home() / ".agenticx").resolve()
    try:
        resolved = _resolve_workspace_path(path_arg, session, pick_existing=True)
    except ValueError:
        raw = _path_from_arg(path_arg)
        if not raw.is_absolute():
            raw = (Path.home() / raw).resolve(strict=False)
        else:
            raw = raw.resolve(strict=False)
        if not _is_path_under_root(raw, agx_root) and not _desktop_unrestricted_fs_enabled():
            raise ValueError(f"path must be under workspace or ~/.agenticx/: {raw}") from None
        resolved = raw
    if not resolved.is_file():
        raise ValueError(f"file not found: {resolved}")
    return resolved


def _fetch_skill_content_from_url(url: str) -> str:
    from urllib.parse import urlparse
    import urllib.request

    parsed = urlparse(str(url or "").strip())
    if parsed.scheme != "https":
        raise ValueError("only https URLs are allowed for from_url")
    host = (parsed.hostname or "").lower()
    allow = _skill_url_allowlist()
    if host not in allow:
        raise ValueError(f"host not in skill_manage.url_allowlist: {host}")
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    max_bytes = _skill_max_url_bytes()
    if len(data) > max_bytes:
        raise ValueError(f"URL payload exceeds max_url_payload_bytes ({max_bytes})")
    return data.decode("utf-8")


def _resolve_skill_create_content(arguments: Dict[str, Any], session: Optional[StudioSession]) -> Tuple[Optional[str], Optional[str]]:
    from_path = str(arguments.get("from_path", "") or "").strip()
    from_url = str(arguments.get("from_url", "") or "").strip()
    content = str(arguments.get("content", "") or "")
    if from_path and from_url:
        return None, "ERROR: from_path and from_url are mutually exclusive"
    if from_path:
        try:
            path = _resolve_skill_content_path(from_path, session)
            return path.read_text(encoding="utf-8"), None
        except ValueError as exc:
            return None, f"ERROR: {exc}"
        except OSError as exc:
            return None, f"ERROR: read failed: {exc}"
    if from_url:
        try:
            return _fetch_skill_content_from_url(from_url), None
        except Exception as exc:
            return None, f"ERROR: from_url fetch failed: {exc}"
    if not content.strip():
        return None, "ERROR: content is required for create (or provide from_path/from_url)"
    return content, None


def _skill_manage_error(code: str, message: str) -> str:
    return f"ERROR[{code.upper()}]: {message}"


def _skill_patch_token_payload(
    *,
    name: str,
    strategy: str,
    old_hash: str,
    old_string: str,
    new_string: str,
    before_context: str,
    after_context: str,
    ranges: list[dict[str, int]],
) -> dict[str, Any]:
    return {
        "v": 1,
        "name": name,
        "strategy": strategy,
        "old_hash": old_hash,
        "old_string_sha256": hashlib.sha256(old_string.encode("utf-8")).hexdigest(),
        "new_string_sha256": hashlib.sha256(new_string.encode("utf-8")).hexdigest(),
        "before_context_sha256": hashlib.sha256(before_context.encode("utf-8")).hexdigest() if before_context else "",
        "after_context_sha256": hashlib.sha256(after_context.encode("utf-8")).hexdigest() if after_context else "",
        "ranges": ranges,
        "issued_at": int(time.time()),
    }


def _encode_patch_token(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    checksum = hashlib.sha256(body).hexdigest()
    envelope = {"p": payload, "c": checksum}
    raw = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_patch_token(token: str) -> Tuple[Optional[dict[str, Any]], Optional[str]]:
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
        obj = json.loads(raw.decode("utf-8"))
        payload = obj.get("p")
        checksum = str(obj.get("c", ""))
        if not isinstance(payload, dict):
            return None, "invalid patch token payload"
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        expected = hashlib.sha256(body).hexdigest()
        if checksum != expected:
            return None, "patch token checksum mismatch"
        return payload, None
    except Exception as exc:
        return None, f"invalid patch token: {exc}"


def _looks_like_stock_chart_payload(parsed: Dict[str, Any]) -> bool:
    """Detect a stock_chart JSON even if the model forgot the `type` field.

    Models sometimes emit `{"chart_type": ..., "watchlist": [...]}` without the
    literal `"type": "stock_chart"` marker. Recognizing the shape (watchlist /
    points-with-OHLC-keys) avoids silently degrading to a raw-JSON HTML widget.
    """
    if parsed.get("type") == "stock_chart":
        return True
    if parsed.get("type") not in (None, "", "stock_chart"):
        return False
    watchlist = parsed.get("watchlist") or parsed.get("instruments") or parsed.get("series")
    if isinstance(watchlist, list) and watchlist:
        first = watchlist[0]
        if isinstance(first, dict) and isinstance(first.get("points") or first.get("data"), list):
            return True
    rows = parsed.get("points") or parsed.get("data")
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        keys = {str(k).lower() for k in rows[0].keys()}
        ohlc_keys = {"open", "high", "low", "close", "开盘", "最高", "最低", "收盘"}
        if keys & ohlc_keys:
            return True
    return False


def _tool_show_widget(arguments: Dict[str, Any]) -> str:
    """Return a widget payload JSON consumed by the Desktop ToolCallCard.

    The backend does no rendering; it validates and passes the widget code
    through to the frontend as a structured JSON string.
    """
    title = str(arguments.get("title") or "").strip()
    widget_code = str(arguments.get("widget_code") or "")
    raw_msgs = arguments.get("loading_messages")
    loading_messages = (
        [str(m).strip() for m in raw_msgs if str(m).strip()]
        if isinstance(raw_msgs, list)
        else []
    )
    if not widget_code.strip():
        return "ERROR: show_widget requires non-empty widget_code."
    stripped = widget_code.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict) and _looks_like_stock_chart_payload(parsed):
                parsed.setdefault("type", "stock_chart")
                return json.dumps(parsed, ensure_ascii=False)
        except json.JSONDecodeError:
            pass
    payload = {
        "type": "widget",
        "title": title,
        "widget_code": widget_code,
        "loading_messages": loading_messages,
    }
    return json.dumps(payload, ensure_ascii=False)


_DATA_SOURCE_REGISTRY: Optional[Any] = None


def _get_data_source_registry() -> Any:
    global _DATA_SOURCE_REGISTRY
    if _DATA_SOURCE_REGISTRY is None:
        from agenticx.data_sources.registry import build_registry_from_config

        _DATA_SOURCE_REGISTRY = build_registry_from_config()
    return _DATA_SOURCE_REGISTRY


def reset_data_source_registry_cache() -> None:
    """Clear cached registry (e.g. after config changes from Desktop settings)."""
    global _DATA_SOURCE_REGISTRY
    _DATA_SOURCE_REGISTRY = None


async def _tool_list_data_sources(arguments: Dict[str, Any]) -> str:
    registry = _get_data_source_registry()
    domain_filter = str(arguments.get("domain") or "").strip().lower()
    verbose = bool(arguments.get("verbose", False))
    items: List[Dict[str, Any]] = []
    for plugin in registry.list_plugins():
        if domain_filter and plugin.domain.lower() != domain_filter:
            continue
        apis = plugin.list_apis()
        items.append(
            {
                "name": plugin.name,
                "display_name": plugin.display_name,
                "domain": plugin.domain,
                "requires_credential": plugin.requires_credential,
                "apis": [
                    {"name": a.name, "description": a.description}
                    if not verbose
                    else {
                        "name": a.name,
                        "description": a.description,
                        "params_schema": a.params_schema,
                    }
                    for a in apis
                ],
            }
        )
    return json.dumps({"data_sources": items}, ensure_ascii=False)


async def _tool_query_data_source(arguments: Dict[str, Any]) -> str:
    from agenticx.data_sources.errors import DataSourceError, MissingCredentialError

    registry = _get_data_source_registry()
    data_source_name = str(arguments.get("data_source_name") or "").strip()
    api_name = str(arguments.get("api_name") or "").strip()
    params = arguments.get("params") or {}
    if not isinstance(params, dict):
        return "ERROR: query_data_source params must be an object."
    if not data_source_name or not api_name:
        return "ERROR: query_data_source requires data_source_name and api_name."
    try:
        result = await registry.call(data_source_name, api_name, params)
    except MissingCredentialError:
        return (
            f"ERROR: data source '{data_source_name}' requires credentials. "
            "Configure via Desktop 设置 → 数据源."
        )
    except DataSourceError as exc:
        return f"ERROR: {exc}"
    except Exception as exc:
        logging.getLogger("agenticx.cli.agent_tools").warning(
            "query_data_source unexpected failure: %s", exc
        )
        return f"ERROR: query_data_source failed unexpectedly: {exc}"
    return json.dumps(result.to_dict(), ensure_ascii=False, default=str)


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


def _should_queue_skill_write() -> bool:
    from agenticx.learning.config import get_learning_config

    cfg = get_learning_config()
    if bool(cfg.get("agent_writes_require_approval", True)):
        return True
    if bool(cfg.get("freeze_during_session", True)):
        try:
            from agenticx.runtime.session_freeze import is_frozen

            return is_frozen()
        except Exception:
            return False
    return False


def _queue_skill_proposal(
    *,
    action: str,
    name: str,
    skill_md_text: str,
    session: Optional[StudioSession],
    diff_summary: str = "",
    candidate_index: int = 1,
    total_candidates: int = 1,
    review_model: str = "",
    scores: Optional[Dict[str, float]] = None,
) -> str:
    from agenticx.learning.gepa_proposer import write_proposal

    session_id = str(getattr(session, "session_id", "") or "") if session else ""
    pdir = write_proposal(
        base_skill=name,
        action=action,
        skill_md_text=skill_md_text,
        session_id=session_id,
        review_model=review_model,
        diff_summary=diff_summary,
        candidate_index=candidate_index,
        total_candidates=total_candidates,
        scores=scores,
    )
    pid = pdir.name
    payload: Dict[str, Any] = {
        "ok": True,
        "action": f"{action}_pending",
        "name": name,
        "path": str(pdir / "SKILL.md"),
        "proposal_id": pid,
        "message": f"Proposal queued for approval: {pid}",
    }
    return json.dumps(payload, ensure_ascii=False)


def _skill_manage_success_payload(
    *,
    action: str,
    skill_md: Path,
    discoverable: bool,
    skill_name: Optional[str],
    frontmatter_fixed: List[str],
    validation_warnings: List[str],
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    payload: Dict[str, Any] = {
        "ok": True,
        "action": action,
        "path": str(skill_md),
        "discoverable": discoverable,
        "skill_name": skill_name,
        "frontmatter_fixed": frontmatter_fixed,
        "validation_warnings": validation_warnings,
    }
    if extra:
        payload.update(extra)
    return json.dumps(payload, ensure_ascii=False)


def _write_skill_md_with_checks(
    *,
    action: str,
    skill_dir: Path,
    content: str,
    canonical_name: str,
    on_rollback: Optional[Any] = None,
    extra: Optional[Dict[str, Any]] = None,
    skip_queue: bool = False,
) -> Tuple[Optional[str], Optional[str]]:
    """Normalize, write, guard-scan, and verify discoverability.

    Returns:
        (success_json, error_message) — exactly one is non-None.
    """
    from agenticx.skills.frontmatter import (
        SkillFrontmatterError,
        normalize_skill_md,
        verify_skill_discoverable,
    )

    try:
        normalized, frontmatter_fixed = normalize_skill_md(content, canonical_name)
    except SkillFrontmatterError as exc:
        return None, f"ERROR: {exc}"

    if action == "create":
        from agenticx.skills.frontmatter import ensure_skill_source, write_skill_provenance

        normalized = ensure_skill_source(normalized, "agent_created")

    from agenticx.learning.config import get_learning_config
    from agenticx.learning.skill_quality_gate import check_size_limits
    from agenticx.skills.frontmatter import get_description_from_frontmatter

    _cfg = get_learning_config()
    _desc = get_description_from_frontmatter(normalized) or ""
    _size = check_size_limits(
        normalized,
        _desc,
        max_bytes=int(_cfg.get("max_skill_bytes", 15360)),
        max_desc_chars=int(_cfg.get("max_description_chars", 500)),
    )
    if not _size["ok"]:
        return None, _skill_manage_error("size_limit", f"{_size['error']}. {_size['hint']}")

    session_obj = extra.get("_session") if isinstance(extra, dict) else None
    if not skip_queue and _should_queue_skill_write():
        queued = _queue_skill_proposal(
            action=action,
            name=canonical_name,
            skill_md_text=normalized,
            session=session_obj,
        )
        if on_rollback:
            on_rollback()
        return queued, None

    # Defense-in-depth: block classic remote pipe-to-shell patterns even if
    # guard pattern sets or confidence filters drift over time.
    if re.search(r"(curl|wget)[^\n]*\|\s*(?:ba)?sh\b", normalized, re.IGNORECASE):
        return None, _skill_manage_error("policy", "危险命令模式：检测到远程下载并管道执行 shell")

    validation_warnings: List[str] = []
    skill_md = skill_dir / "SKILL.md"
    try:
        skill_md.write_text(normalized, encoding="utf-8")
        if action == "create":
            from agenticx.skills.frontmatter import write_skill_provenance

            write_skill_provenance(skill_dir, "agent_created", extra={"name": canonical_name})
        result = scan_skill(skill_dir, source="agent-created")
        ok, reason = should_allow(result, "agent-created")
        if not ok:
            if on_rollback:
                on_rollback()
            else:
                skill_md.unlink(missing_ok=True)
            from agenticx.skills.guard import format_guard_rejection_message

            return None, format_guard_rejection_message(result, action=action)

        discoverable, skill_name, errors = verify_skill_discoverable(skill_dir)
        if not discoverable:
            if on_rollback:
                on_rollback()
            else:
                skill_md.unlink(missing_ok=True)
            detail = "; ".join(errors) if errors else "unknown parse failure"
            return None, f"ERROR: skill not discoverable after write ({detail})"

        return (
            _skill_manage_success_payload(
                action=action,
                skill_md=skill_md,
                discoverable=discoverable,
                skill_name=skill_name,
                frontmatter_fixed=frontmatter_fixed,
                validation_warnings=validation_warnings,
                extra=extra,
            ),
            None,
        )
    except OSError as exc:
        if on_rollback:
            on_rollback()
        else:
            skill_md.unlink(missing_ok=True)
        return None, f"ERROR: {exc}"


def _hook_manage_enabled() -> bool:
    """Whether hook_manage is allowed. Default-on; set AGX_HOOK_MANAGE=0 to disable."""
    v = os.environ.get("AGX_HOOK_MANAGE", "1").strip().lower()
    return v in {"1", "true", "yes", "on"}


def _scan_hook_command(command: str) -> Optional[str]:
    """Scan a command-type hook body for dangerous patterns via the skill guard.

    Returns a human-readable reason string when the command must be blocked,
    or ``None`` when it is allowed. Wraps the command in a fenced shell block so
    both v1 and v2 guard scanners inspect it.
    """
    try:
        from agenticx.skills.guard import scan_skill_markdown_text, should_allow
    except ImportError:
        return None
    fenced = f"```bash\n{command}\n```\n"
    try:
        result = scan_skill_markdown_text(fenced, source="agent-created")
        allowed, reason = should_allow(result, source="agent-created")
    except Exception:
        return None
    if not allowed:
        return reason
    return None


def _tool_hook_manage(arguments: Dict[str, Any], session: Optional[StudioSession]) -> str:  # noqa: ARG001
    """Implement the hook_manage agent tool — create/delete/list/toggle declarative hooks."""
    if not _hook_manage_enabled():
        return (
            "ERROR: hook_manage is disabled (AGX_HOOK_MANAGE=0). "
            "Re-enable it in settings to create/modify hooks."
        )
    action = str(arguments.get("action", "")).strip().lower()
    if action not in ("create", "delete", "list", "toggle"):
        return "ERROR: hook_manage requires action='create'|'delete'|'list'|'toggle'."

    try:
        from agenticx.cli.config_manager import ConfigManager
        from agenticx.hooks.list_api import invalidate_hooks_list_cache
    except ImportError as exc:
        return f"ERROR: config subsystem unavailable: {exc}"

    def _load_declarative() -> List[Dict[str, Any]]:
        raw = ConfigManager.get_value("hooks.declarative") or []
        return [d for d in raw if isinstance(d, dict)]

    def _save_declarative(entries: List[Dict[str, Any]]) -> None:
        ConfigManager.set_value("hooks.declarative", entries)
        invalidate_hooks_list_cache()

    if action == "list":
        entries = _load_declarative()
        if not entries:
            return json.dumps({"ok": True, "hooks": [], "count": 0}, ensure_ascii=False)
        return json.dumps({"ok": True, "hooks": entries, "count": len(entries)}, ensure_ascii=False)

    name = str(arguments.get("name", "")).strip()
    if not name:
        return "ERROR: 'name' is required for action='create'|'delete'|'toggle'."

    entries = _load_declarative()

    if action == "delete":
        new_entries = [e for e in entries if e.get("name") != name]
        if len(new_entries) == len(entries):
            return json.dumps({"ok": False, "error": f"hook '{name}' not found"}, ensure_ascii=False)
        _save_declarative(new_entries)
        return json.dumps({"ok": True, "action": "deleted", "name": name}, ensure_ascii=False)

    if action == "toggle":
        enabled_val = arguments.get("enabled")
        if enabled_val is None:
            return "ERROR: 'enabled' (true/false) is required for action='toggle'."
        target = next((e for e in entries if e.get("name") == name), None)
        if target is None:
            return json.dumps({"ok": False, "error": f"hook '{name}' not found"}, ensure_ascii=False)
        target["enabled"] = bool(enabled_val)
        _save_declarative(entries)
        state = "enabled" if bool(enabled_val) else "disabled"
        return json.dumps({"ok": True, "action": state, "name": name}, ensure_ascii=False)

    # action == "create"
    event = str(arguments.get("event", "")).strip()
    valid_events = {"before_tool_call", "after_tool_call", "session_start", "session_end"}
    if event not in valid_events:
        return f"ERROR: 'event' must be one of {sorted(valid_events)}."

    hook_type = str(arguments.get("type", "command")).strip()
    valid_types = {"command", "http", "prompt", "agent"}
    if hook_type not in valid_types:
        return f"ERROR: 'type' must be one of {sorted(valid_types)}."

    if hook_type == "command":
        cmd_body = str(arguments.get("command", "")).strip()
        if not cmd_body:
            return "ERROR: 'command' is required for type='command'."
        block_reason = _scan_hook_command(cmd_body)
        if block_reason:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"command hook blocked by safety scan: {block_reason}",
                    "hint": "Revise the command to avoid dangerous patterns, or use type='http'/'prompt'/'agent'.",
                },
                ensure_ascii=False,
            )
    if hook_type == "http" and not str(arguments.get("url", "")).strip():
        return "ERROR: 'url' is required for type='http'."
    if hook_type in ("prompt", "agent") and not str(arguments.get("prompt", "")).strip():
        return "ERROR: 'prompt' is required for type='prompt'/'agent'."

    if any(e.get("name") == name for e in entries):
        return json.dumps({"ok": False, "error": f"hook '{name}' already exists; use delete first to replace."}, ensure_ascii=False)

    new_hook: Dict[str, Any] = {
        "name": name,
        "event": event,
        "type": hook_type,
        "enabled": True,
    }
    if hook_type == "command":
        new_hook["command"] = str(arguments.get("command", "")).strip()
    elif hook_type == "http":
        new_hook["url"] = str(arguments.get("url", "")).strip()
    elif hook_type in ("prompt", "agent"):
        new_hook["prompt"] = str(arguments.get("prompt", "")).strip()

    for opt_field in ("matcher", "block_on_failure", "timeout_seconds"):
        val = arguments.get(opt_field)
        if val is not None:
            new_hook[opt_field] = val

    entries.append(new_hook)
    _save_declarative(entries)
    return json.dumps({"ok": True, "action": "created", "hook": new_hook}, ensure_ascii=False)


async def _tool_skill_manage(
    arguments: Dict[str, Any],
    session: Optional[StudioSession],
    *,
    confirm_gate: Optional[ConfirmGate] = None,
    emit_event: Optional[Any] = None,
) -> str:
    _ = session
    if not _skill_manage_enabled():
        return (
            "ERROR: skill_manage is disabled. Set AGX_SKILL_MANAGE=1 "
            "or AGX_CONFIRM_STRATEGY=auto (Run Everything hook)."
        )
    # Interactive mode: user approves/rejects inline in the chat.
    # Non-interactive (e.g. session_review_hook): falls back to pending queue.
    _interactive = emit_event is not None and isinstance(confirm_gate, AsyncConfirmGate)
    action = str(arguments.get("action", "") or "").strip().lower()
    if not action:
        return (
            "ERROR: 'action' is required. "
            "Call skill_manage with action='create'|'patch'|'delete'|'history'|'rollback', name=<skill-name>, "
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
        content, content_err = _resolve_skill_create_content(arguments, session)
        if content_err:
            return content_err
        assert content is not None
        if skill_dir.exists():
            return "ERROR: skill already exists"
        from agenticx.skills.frontmatter import SkillFrontmatterError, normalize_skill_md

        try:
            normalize_skill_md(content, name)
        except SkillFrontmatterError as exc:
            return f"ERROR: {exc}"
        if _interactive:
            preview = content[:400] + ("\n\n…（已截断）" if len(content) > 400 else "")
            approved = await _confirm(
                f"skill_manage 请求**创建**新技能「{name}」\n\n内容预览：\n\n```\n{preview}\n```\n\n确认写入 `~/.agenticx/skills/{name}/SKILL.md`？",
                confirm_gate=confirm_gate,  # type: ignore[arg-type]
                context={"tool": "skill_manage", "action": "create", "skill": name},
                emit_event=emit_event,
            )
            if not approved:
                return "CANCELLED: 用户拒绝了 skill_manage create 操作"
        skill_dir.mkdir(parents=True, exist_ok=True)
        success, err = _write_skill_md_with_checks(
            action="create",
            skill_dir=skill_dir,
            content=content,
            canonical_name=name,
            on_rollback=lambda: shutil.rmtree(skill_dir, ignore_errors=True),
            extra={"_session": session},
            skip_queue=_interactive,
        )
        if err:
            if skill_dir.exists() and not (skill_dir / "SKILL.md").is_file():
                shutil.rmtree(skill_dir, ignore_errors=True)
            return err
        try:
            from agenticx.skills.versioning import append_changelog

            append_changelog(skill_dir, action="create", summary="agent-created skill")
        except Exception:
            pass
        return success or "ERROR: unknown create failure"

    if action == "patch":
        old_s = str(arguments.get("old_string", ""))
        new_s = str(arguments.get("new_string", ""))
        mode = str(arguments.get("mode", "apply") or "apply").strip().lower()
        if mode not in {"preview", "apply"}:
            return _skill_manage_error("validation", "mode must be 'preview' or 'apply'")
        replace_all = bool(arguments.get("replace_all", False))
        before_context = str(arguments.get("before_context", "") or "")
        after_context = str(arguments.get("after_context", "") or "")
        target_index_raw = arguments.get("target_index")
        target_index: Optional[int] = None
        if target_index_raw is not None:
            try:
                target_index = int(target_index_raw)
            except Exception:
                return _skill_manage_error("validation", "target_index must be an integer")
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            return _skill_manage_error("validation", "SKILL.md not found")
        try:
            original = skill_md.read_text(encoding="utf-8")
        except OSError as exc:
            return _skill_manage_error("validation", f"read failed: {exc}")
        from agenticx.skills.fuzzy_patch import fuzzy_find_and_replace, fuzzy_find_matches
        from agenticx.skills.guard import scan_skill_markdown_text

        matches_info = fuzzy_find_matches(
            original,
            old_s,
            before_context=before_context,
            after_context=after_context,
        )
        if matches_info.get("error"):
            return _skill_manage_error("validation", str(matches_info["error"]))
        ranges = list(matches_info.get("matches", []))
        strategy = str(matches_info.get("strategy", "") or "")
        if not ranges:
            return _skill_manage_error("validation", "Could not find a match for old_string in the file")
        if len(ranges) > 1 and not replace_all:
            if target_index is None:
                payload = {
                    "ok": False,
                    "action": "patch",
                    "mode": mode,
                    "requires_target_selection": True,
                    "strategy": strategy,
                    "match_count": len(ranges),
                    "target_ranges": ranges,
                }
                return json.dumps(payload, ensure_ascii=False)
            if target_index < 0 or target_index >= len(ranges):
                return _skill_manage_error("validation", "target_index out of range")
            selected = ranges[target_index]
            ranges = [selected]
            s = int(selected.get("start", 0))
            e = int(selected.get("end", s))
            before_context = original[max(0, s - 80) : s]
            after_context = original[e : min(len(original), e + 80)]
            replace_all = False

        updated, match_count, strategy2, match_err = fuzzy_find_and_replace(
            original,
            old_s,
            new_s,
            replace_all=replace_all,
            before_context=before_context,
            after_context=after_context,
        )
        if match_err:
            return _skill_manage_error("validation", match_err)
        strategy = strategy2 or strategy

        old_hash = hashlib.sha256(original.encode("utf-8")).hexdigest()
        token_payload = _skill_patch_token_payload(
            name=name,
            strategy=strategy or "exact",
            old_hash=old_hash,
            old_string=old_s,
            new_string=new_s,
            before_context=before_context,
            after_context=after_context,
            ranges=ranges,
        )
        patch_token = _encode_patch_token(token_payload)
        quick_result = scan_skill_markdown_text(updated, source="agent-created")
        quick_allowed, quick_reason = should_allow(quick_result, "agent-created")
        preview_payload = {
            "ok": True,
            "action": "patch",
            "mode": "preview",
            "strategy": strategy,
            "match_count": match_count,
            "target_ranges": ranges,
            "old_sha256": old_hash,
            "new_sha256": hashlib.sha256(updated.encode("utf-8")).hexdigest(),
            "patch_token": patch_token,
            "risk": {
                "verdict": quick_result.verdict,
                "allowed": quick_allowed,
                "reason": quick_reason,
                "findings": [f.pattern_name for f in quick_result.findings[:8]],
            },
            "diff": "\n".join(
                difflib.unified_diff(
                    original.splitlines(),
                    updated.splitlines(),
                    fromfile="SKILL.md (old)",
                    tofile="SKILL.md (new)",
                    lineterm="",
                )
            ),
        }
        if mode == "preview":
            return json.dumps(preview_payload, ensure_ascii=False)

        token_arg = str(arguments.get("patch_token", "") or "").strip()
        if token_arg:
            decoded, token_err = _decode_patch_token(token_arg)
            if token_err:
                return _skill_manage_error("validation", token_err)
            assert decoded is not None
            if str(decoded.get("name", "")) != name:
                return _skill_manage_error("validation", "patch token skill mismatch")
            if str(decoded.get("old_hash", "")) != old_hash:
                return _skill_manage_error("validation", "patch token outdated: file changed since preview")
            if str(decoded.get("old_string_sha256", "")) != hashlib.sha256(old_s.encode("utf-8")).hexdigest():
                return _skill_manage_error("validation", "patch token old_string mismatch")
            if str(decoded.get("new_string_sha256", "")) != hashlib.sha256(new_s.encode("utf-8")).hexdigest():
                return _skill_manage_error("validation", "patch token new_string mismatch")
            if str(decoded.get("before_context_sha256", "")) != (
                hashlib.sha256(before_context.encode("utf-8")).hexdigest() if before_context else ""
            ):
                return _skill_manage_error("validation", "patch token before_context mismatch")
            if str(decoded.get("after_context_sha256", "")) != (
                hashlib.sha256(after_context.encode("utf-8")).hexdigest() if after_context else ""
            ):
                return _skill_manage_error("validation", "patch token after_context mismatch")

        backup = original

        def _rollback_patch() -> None:
            skill_md.write_text(backup, encoding="utf-8")

        if _interactive:
            old_preview = old_s[:200] + ("…" if len(old_s) > 200 else "")
            new_preview = new_s[:200] + ("…" if len(new_s) > 200 else "")
            approved = await _confirm(
                f"skill_manage 请求**修改**技能「{name}」（{match_count} 处替换）\n\n"
                f"**旧内容：**\n```\n{old_preview}\n```\n\n"
                f"**新内容：**\n```\n{new_preview}\n```\n\n"
                f"确认应用补丁？",
                confirm_gate=confirm_gate,  # type: ignore[arg-type]
                context={"tool": "skill_manage", "action": "patch", "skill": name},
                emit_event=emit_event,
            )
            if not approved:
                return "CANCELLED: 用户拒绝了 skill_manage patch 操作"

        try:
            from agenticx.skills.skill_versions import save_snapshot

            save_snapshot(
                skills_root=root,
                skill_name=name,
                content=original,
                actor="agent",
                session_id=str(getattr(session, "session_id", "") or ""),
                summary=f"pre-patch fuzzy:{strategy}",
            )
        except Exception:
            pass

        success, err = _write_skill_md_with_checks(
            action="patch",
            skill_dir=skill_dir,
            content=updated,
            canonical_name=name,
            on_rollback=_rollback_patch,
            extra={"strategy": strategy, "matches": match_count, "mode": "apply", "_session": session},
            skip_queue=_interactive,
        )
        if err:
            if err.startswith("ERROR: 技能内容被安全策略拦截"):
                return _skill_manage_error("policy", err)
            return _skill_manage_error("validation", err)
        try:
            from agenticx.skills.versioning import append_changelog

            append_changelog(
                skill_dir,
                action="patch",
                summary=f"fuzzy:{strategy}, {match_count} replacement(s)",
            )
        except Exception:
            pass
        return success or _skill_manage_error("validation", "unknown patch failure")

    if action == "delete":
        if not skill_dir.exists():
            return json.dumps({"ok": True, "action": "delete", "removed": False}, ensure_ascii=False)
        if _interactive:
            approved = await _confirm(
                f"skill_manage 请求**删除**技能「{name}」\n\n路径：`~/.agenticx/skills/{name}/`\n\n此操作不可撤销（除非系统有版本快照），确认删除？",
                confirm_gate=confirm_gate,  # type: ignore[arg-type]
                context={"tool": "skill_manage", "action": "delete", "skill": name, "risk": "destructive"},
                emit_event=emit_event,
            )
            if not approved:
                return "CANCELLED: 用户拒绝了 skill_manage delete 操作"
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

    if action == "history":
        limit = int(arguments.get("limit", 50) or 50)
        limit = max(1, min(limit, 200))
        try:
            from agenticx.skills.skill_versions import list_versions

            versions = list_versions(skills_root=root, skill_name=name, limit=limit)
        except Exception as exc:
            return _skill_manage_error("validation", f"history failed: {exc}")
        payload = {
            "ok": True,
            "action": "history",
            "name": name,
            "versions": [
                {
                    "version": v.version,
                    "created_at": v.created_at,
                    "actor": v.actor,
                    "session_id": v.session_id,
                    "content_sha256": v.content_sha256,
                    "summary": v.summary,
                }
                for v in versions
            ],
        }
        return json.dumps(payload, ensure_ascii=False)

    if action == "rollback":
        to_version = str(arguments.get("to_version", "") or "").strip()
        if not to_version:
            return _skill_manage_error("validation", "to_version is required for rollback")
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            return _skill_manage_error("validation", "SKILL.md not found")
        try:
            from agenticx.skills.skill_versions import get_version_content, save_snapshot
        except Exception as exc:
            return _skill_manage_error("validation", f"versioning unavailable: {exc}")
        try:
            original = skill_md.read_text(encoding="utf-8")
            target = get_version_content(skills_root=root, skill_name=name, version=to_version)
        except FileNotFoundError as exc:
            return _skill_manage_error("validation", str(exc))
        except Exception as exc:
            return _skill_manage_error("validation", f"rollback read failed: {exc}")

        def _rollback_original() -> None:
            skill_md.write_text(original, encoding="utf-8")

        try:
            save_snapshot(
                skills_root=root,
                skill_name=name,
                content=original,
                actor="agent",
                session_id=str(getattr(session, "session_id", "") or ""),
                summary=f"pre-rollback -> {to_version}",
            )
        except Exception:
            pass

        success, err = _write_skill_md_with_checks(
            action="rollback",
            skill_dir=skill_dir,
            content=target,
            canonical_name=name,
            on_rollback=_rollback_original,
            extra={"to_version": to_version, "_session": session},
        )
        if err:
            if err.startswith("ERROR: 技能内容被安全策略拦截"):
                return _skill_manage_error("policy", err)
            return _skill_manage_error("validation", err)
        try:
            from agenticx.skills.versioning import append_changelog

            append_changelog(skill_dir, action="edit", summary=f"rollback to {to_version}")
        except Exception:
            pass
        return success or _skill_manage_error("validation", "unknown rollback failure")

    return "ERROR: unknown action"


def _tool_skill_import_repo(arguments: Dict[str, Any], session: Optional[StudioSession]) -> str:
    _ = session
    if not _skill_manage_enabled():
        return (
            "ERROR: skill_import_repo is disabled. Set AGX_SKILL_MANAGE=1 "
            "or AGX_CONFIRM_STRATEGY=auto (Run Everything hook)."
        )
    repo = str(arguments.get("repo", "") or "").strip()
    if not repo:
        return "ERROR: repo is required (owner/name)"
    branch = str(arguments.get("branch", "main") or "main").strip() or "main"
    path_glob = str(arguments.get("path_glob", "skills/**/SKILL.md") or "skills/**/SKILL.md").strip()
    exclude_raw = arguments.get("exclude")
    exclude: Optional[List[str]] = None
    if isinstance(exclude_raw, list):
        exclude = [str(x) for x in exclude_raw if str(x).strip()]
    dry_run = bool(arguments.get("dry_run", False))
    overwrite = bool(arguments.get("overwrite", False))
    from agenticx.skills.import_repo import import_skills_from_repo, result_to_json

    result = import_skills_from_repo(
        repo=repo,
        branch=branch,
        path_glob=path_glob,
        exclude=exclude,
        dry_run=dry_run,
        overwrite=overwrite,
    )
    return result_to_json(result)


def _tool_ask_user(arguments: Dict[str, Any], *, service_mode: bool = False) -> str:
    if service_mode:
        return (
            "ERROR: ask_user is not supported in service mode; "
            "use the request_clarification tool to ask the user an open-ended question."
        )
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


def _video_understand_settings() -> Dict[str, Any]:
    """Read video_understanding.* from config with safe fallbacks."""

    def _int(key: str, default: int) -> int:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        try:
            return int(raw) if raw is not None else default
        except (TypeError, ValueError):
            return default

    def _float(key: str, default: float) -> float:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        try:
            return float(raw) if raw is not None else default
        except (TypeError, ValueError):
            return default

    def _bool(key: str, default: bool) -> bool:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            return raw.strip().lower() in {"1", "true", "yes", "on"}
        return default

    def _str(key: str, default: str) -> str:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        if raw is None:
            return default
        return str(raw)

    max_frames = min(
        _int("max_frames", _VIDEO_UNDERSTAND_DEFAULT_MAX_FRAMES),
        _VIDEO_UNDERSTAND_HARD_MAX_FRAMES,
    )
    return {
        "max_frames": max(1, max_frames),
        "interval_seconds": max(
            1.0,
            _float("interval_seconds", _VIDEO_UNDERSTAND_DEFAULT_INTERVAL_SECONDS),
        ),
        "min_frames": max(1, _int("min_frames", _VIDEO_UNDERSTAND_MIN_FRAMES)),
        "use_scene_detection": _bool("use_scene_detection", False),
        "enable_audio_transcription": _bool("enable_audio_transcription", True),
        "transcription_language": _str("transcription_language", "").strip(),
    }


async def _transcribe_video_audio(audio_path: Path, language: str) -> tuple[str, str]:
    """Best-effort audio transcription that never breaks video visual flow."""
    try:
        # Inline import avoids circular dependency:
        # voice_endpoints imports STUDIO_TOOLS/dispatch_tool_async from this module.
        from agenticx.studio.voice_endpoints import (
            _resolve_transcribe_provider,
            _transcribe_doubao_flash,
            _transcribe_openai_whisper,
        )
    except Exception as exc:
        return "", f"transcription module unavailable: {exc}"

    try:
        provider = _resolve_transcribe_provider()
    except Exception as exc:
        return "", f"transcribe provider resolve failed: {exc}"
    if not provider:
        return "", "no transcription backend configured (see 设置 → 语音)"

    try:
        raw = audio_path.read_bytes()
    except OSError as exc:
        return "", f"cannot read extracted audio: {exc}"

    try:
        if provider == "openai_whisper":
            text = await _transcribe_openai_whisper(
                raw,
                filename=audio_path.name,
                content_type="audio/mpeg",
                language=(language or "zh"),
            )
        elif provider == "doubao_flash":
            text = await _transcribe_doubao_flash(raw)
        else:
            return "", f"unknown transcription provider: {provider}"
    except Exception as exc:
        return "", f"transcription failed ({provider}): {exc}"
    return (text or "").strip(), ""


async def _tool_video_understand(arguments: Dict[str, Any], session: Optional[StudioSession] = None) -> str:
    """Probe and extract representative video frames, then stage for vision input."""
    raw_path = str(arguments.get("path", "")).strip()
    if not raw_path:
        return "ERROR: missing required parameter 'path'."

    if not _session_vision_capable(session):
        model = str(getattr(session, "model_name", "") or "unknown")
        return (
            f"ERROR: current model '{model}' does not support vision; "
            "switch to a vision-capable model before understanding a video."
        )

    try:
        path = _resolve_workspace_path(raw_path, session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not path.exists() or not path.is_file():
        return f"ERROR: video not found: {path}"

    ext = path.suffix.lower()
    if ext not in VideoFrameExtractor.SUPPORTED_FORMATS:
        return (
            f"ERROR: unsupported video format '{ext}'. "
            f"Supported: {', '.join(VideoFrameExtractor.SUPPORTED_FORMATS)}"
        )

    try:
        size = path.stat().st_size
    except OSError as exc:
        return f"ERROR: cannot stat video: {exc}"
    if size > _VIDEO_UNDERSTAND_MAX_VIDEO_BYTES:
        return f"ERROR: video too large ({size // (1024 * 1024)} MB); limit is 512 MB."

    if not VideoFrameExtractor.is_available():
        return (
            "ERROR: ffmpeg/ffprobe not found. Install with: brew install ffmpeg "
            "(macOS) or your platform package manager."
        )

    settings = _video_understand_settings()
    req_max = arguments.get("max_frames")
    if req_max is not None:
        try:
            settings["max_frames"] = max(
                1,
                min(int(req_max), _VIDEO_UNDERSTAND_HARD_MAX_FRAMES),
            )
        except (TypeError, ValueError):
            pass

    extractor = VideoFrameExtractor()
    tmp_dir = Path(tempfile.mkdtemp(prefix="agenticx_video_"))
    probe = None
    result = None
    staged = 0
    transcript = ""
    degrade_reason = ""
    try:
        probe = await extractor.probe(path)
        frame_count = extractor.plan_frame_count(
            probe.duration_seconds,
            interval=settings["interval_seconds"],
            min_frames=settings["min_frames"],
            max_frames=settings["max_frames"],
        )
        if settings["use_scene_detection"]:
            result = await extractor.extract_scene(
                path,
                tmp_dir,
                max_frames=settings["max_frames"],
                probe=probe,
            )
        if result is None or len(result.frames) < 2:
            result = await extractor.extract_interval(
                path,
                tmp_dir,
                frame_count=frame_count,
                probe=probe,
            )
        if not result.frames:
            return "ERROR: failed to extract any frame from the video."

        pending = _pending_visual_attachments(session)
        for idx, frame_path in enumerate(result.frames):
            try:
                data = frame_path.read_bytes()
            except OSError:
                continue
            ts = result.timestamps[idx] if idx < len(result.timestamps) else 0.0
            data_url = _data_url_from_bytes(data, "image/png")
            pending.append(
                {
                    "name": f"{path.stem}_frame_{idx + 1:02d}_t{ts:.1f}s.png",
                    "data_url": data_url,
                    "mime_type": "image/png",
                    "size": len(data),
                    "source": str(path),
                    "note": f"video frame @ {ts:.1f}s",
                }
            )
            staged += 1
        if staged == 0:
            return "ERROR: extracted frames could not be read for attachment."

        if probe.has_audio and settings.get("enable_audio_transcription", True):
            audio_path = await extractor.extract_audio(path, tmp_dir)
            if audio_path is None:
                degrade_reason = "audio extraction unavailable"
            else:
                transcript, degrade_reason = await _transcribe_video_audio(
                    audio_path,
                    str(settings.get("transcription_language", "") or ""),
                )
    except Exception as exc:
        return (
            f"ERROR: video_understand failed for {path.name}: {exc}\n"
            f"{traceback.format_exc(limit=3)}"
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if probe is None or result is None:
        return "ERROR: internal video_understand state error."
    audio_note = (
        "with audio (transcribed)"
        if transcript
        else ("with audio (not transcribed)" if probe.has_audio else "no audio track")
    )
    lines = [
        f"[video_understand] {path.name}",
        (
            f"duration={probe.duration_seconds:.1f}s resolution={probe.width}x{probe.height} "
            f"{audio_note} strategy={result.strategy} frames_attached={staged}"
        ),
        "Frames are attached as images in the NEXT turn; combine them with the transcript below.",
    ]
    if transcript:
        clipped = transcript if len(transcript) <= 6000 else transcript[:6000] + " ...[truncated]"
        lines.append("")
        lines.append("[audio_transcript]")
        lines.append(clipped)
    elif probe.has_audio:
        lines.append(
            f"NOTE: audio present but not transcribed ({degrade_reason or 'unknown'})."
        )
    return "\n".join(lines)


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


# Project state harness tools (.agx/project state machine).
try:
    from agenticx.project_state.tools import project_state_tool_schemas as _project_state_schemas

    STUDIO_TOOLS.extend(_project_state_schemas())
except Exception as _exc:  # pragma: no cover - defensive import isolation
    logging.getLogger(__name__).warning(
        "project_state tool registration skipped: %s", _exc,
    )


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
    clarify_gate: Optional[ClarifyGate] = None,
    is_unattended: bool = False,
) -> str:
    """Dispatch one tool call asynchronously and return result text."""
    arguments = _repair_malformed_file_tool_arguments(name, arguments)
    required = _TOOL_REQUIRED_PARAMS.get(name)
    if required and not arguments:
        # FR-B.1：空参数往往源于流式工具调用被截断或弱模型忘填字段；
        # 错误文本必须强引导"立即重试本工具"，避免模型读到 ERROR 后转去
        # 自言自语而放弃任务。对常见的文件类工具补充字段释义。
        param_hints = {
            "file_write": (
                "path（绝对路径，不要省略）, content（要写入的完整文档正文，至少几百字的实际内容，不能是空字符串或省略号）"
            ),
            "file_edit": (
                "path（绝对路径）, old_string（原文片段）, new_string（替换后的内容）"
            ),
            "skill_manage": (
                "action（create / patch / delete）, name（skill 名称，可含子路径如 ima/notes）, "
                "以及 content / from_path / from_url（create）或 old_string / new_string（patch）"
            ),
            "skill_import_repo": (
                "repo（owner/name）, 可选 branch/path_glob/exclude/dry_run/overwrite"
            ),
            "schedule_task": (
                "name（任务名）、frequency / time / date 至少一项、instruction（具体指令）、workspace（执行目录）"
            ),
        }
        guidance = param_hints.get(name, "见工具 schema 中的 required 列表")
        return (
            f"ERROR: {name}() called with empty arguments. "
            f"Required parameters: {', '.join(required)}.\n"
            f"参数说明：{guidance}\n"
            f"行动要求：请立即重新调用 {name} 一次，并把上述所有必填参数完整填入；"
            f"不要换其他工具、不要把这次失败汇报给用户、不要在没有重新调用前给出最终回复。"
            f"如果你忘记了目标路径或正文内容，请回头查看用户最近的原始任务描述（含 [user-pending-question] 与 [user-goal-anchor]）以及 system prompt 里的工作区根，再生成完整调用。"
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
        if name == "code_outline":
            return _tool_code_outline(arguments, session)
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
        if name == "hook_manage":
            return _tool_hook_manage(arguments, session)
        if name == "skill_manage":
            return await _tool_skill_manage(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "skill_import_repo":
            return _tool_skill_import_repo(arguments, session)
        if name == "todo_write":
            return _tool_todo_write(arguments, session)
        if name == "scratchpad_write":
            return _tool_scratchpad_write(arguments, session)
        if name == "scratchpad_read":
            return _tool_scratchpad_read(arguments, session)
        if name in {
            "project_init",
            "project_status",
            "feature_select",
            "feature_complete",
            "progress_append",
            "verify_run",
        }:
            from agenticx.project_state.tools import dispatch_project_state_tool

            return await asyncio.to_thread(
                dispatch_project_state_tool, name, arguments, session
            )
        if name == "memory_append":
            return await _tool_memory_append(
                arguments,
                confirm_gate=gate,
                emit_event=event_callback,
                session=session,
            )
        if name == "memory_search":
            return await _tool_memory_search(arguments, session)
        if name == "memory_forget":
            return await _tool_memory_forget(arguments, session)
        if name == "knowledge_search":
            return await asyncio.to_thread(_tool_knowledge_search, arguments, session)
        if name == "knowledge_synthesize":
            return await asyncio.to_thread(_tool_knowledge_synthesize, arguments, session)
        if name == "web_search":
            return await asyncio.to_thread(_tool_web_search, arguments, session)
        if name == "web_fetch":
            return await _tool_web_fetch(arguments, session)
        if name == "view_image":
            return await _tool_view_image(arguments, session)
        if name == "session_search":
            return _tool_session_search(arguments, session)
        if name == "code_search":
            return await asyncio.to_thread(_tool_code_search, arguments, session)
        if name == "code_index_create":
            return await asyncio.to_thread(_tool_code_index_create, arguments, session)
        if name == "code_index_status":
            return await asyncio.to_thread(_tool_code_index_status, arguments, session)
        if name == "code_index_clear":
            return await asyncio.to_thread(_tool_code_index_clear, arguments, session)
        if name == "code_index_cancel":
            return await asyncio.to_thread(_tool_code_index_cancel, arguments, session)
        if name == "ask_user":
            return _tool_ask_user(arguments, service_mode=isinstance(gate, AsyncConfirmGate))
        if name == "request_clarification":
            prompt = str(arguments.get("prompt", "") or "").strip()
            if not prompt:
                return (
                    "ERROR: request_clarification requires a non-empty `prompt`. "
                    "请立即重新调用 request_clarification 并填写 prompt。"
                )
            raw_options = arguments.get("options") or []
            if not isinstance(raw_options, list):
                raw_options = []
            options = [str(opt).strip() for opt in raw_options if str(opt).strip()]
            options = options[:8]
            raw_decisions = arguments.get("decisions") or []
            decisions = _normalize_clarification_decisions(raw_decisions)
            allow_free_text = bool(arguments.get("allow_free_text", True))
            ctx = arguments.get("context")
            if not isinstance(ctx, dict):
                ctx = None
            return await _request_clarification(
                prompt,
                options=options,
                decisions=decisions,
                allow_free_text=allow_free_text,
                context=ctx,
                clarify_gate=clarify_gate,
                emit_event=event_callback,
                is_unattended=is_unattended,
            )
        if name == "list_files":
            return _tool_list_files(arguments, session)
        if name == "liteparse":
            return await _tool_liteparse(arguments, session)
        if name == "video_understand":
            return await _tool_video_understand(arguments, session)
        if name == "list_data_sources":
            return await _tool_list_data_sources(arguments)
        if name == "query_data_source":
            return await _tool_query_data_source(arguments)
        if name == "show_widget":
            return _tool_show_widget(arguments)
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
