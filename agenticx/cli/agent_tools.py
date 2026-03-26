#!/usr/bin/env python3
"""Tool definitions and dispatchers for Studio agent loop.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
import os
import re
import shlex
import subprocess
import sys
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.cli.studio_mcp import (
    import_mcp_config,
    load_available_servers,
    mcp_call_tool_async,
    mcp_connect,
)
from agenticx.cli.studio_skill import get_all_skill_summaries, skill_use as studio_skill_use
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.confirm import AsyncConfirmGate, ConfirmGate, SyncConfirmGate
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
PATH_GUARDED_READ_COMMANDS = {"cat", "head", "tail", "grep", "find", "wc", "ls", "tree"}


def _workspace_root() -> Path:
    configured = os.getenv("AGX_WORKSPACE_ROOT", "").strip()
    if configured:
        try:
            return Path(configured).expanduser().resolve(strict=False)
        except Exception:
            pass
    return Path.cwd().resolve()


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
            "description": "Execute a shell command in current workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Command to execute."},
                    "cwd": {"type": "string", "description": "Optional working directory."},
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
            "name": "mcp_call",
            "description": "Call one connected MCP tool by name with JSON arguments.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tool_name": {"type": "string", "description": "Connected MCP tool name."},
                    "arguments": {
                        "type": "object",
                        "description": "Tool arguments object.",
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
            "description": "Activate a skill into current context.",
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
            "description": "List available local/remote skill summaries.",
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
            "description": "Schedule a background task to run asynchronously. The task will execute even while the user is not actively chatting.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Human-readable task name"},
                    "instruction": {"type": "string", "description": "Task instructions for the agent to execute"},
                },
                "required": ["name", "instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_scheduled_tasks",
            "description": "List all background/scheduled tasks and their status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_scheduled_task",
            "description": "Cancel a background task by task_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "ID of the task to cancel"},
                },
                "required": ["task_id"],
            },
        },
    },
]

META_TOOL_NAMES = {
    "spawn_subagent",
    "cancel_subagent",
    "retry_subagent",
    "query_subagent_status",
    "check_resources",
    "recommend_subagent_model",
    "list_skills",
    "list_mcps",
    "send_bug_report_email",
    "update_email_config",
    "schedule_task",
    "list_scheduled_tasks",
    "cancel_scheduled_task",
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
    if emit_event is not None:
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
    if emit_event is not None:
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


def _resolve_workspace_path(path_arg: str) -> Path:
    workspace = _workspace_root()
    raw_path = _path_from_arg(path_arg)
    if raw_path.is_absolute():
        resolved = raw_path.resolve(strict=False)
    else:
        resolved = (workspace / raw_path).resolve(strict=False)
    if _desktop_unrestricted_fs_enabled():
        return resolved
    try:
        resolved.relative_to(workspace)
    except ValueError as exc:
        raise ValueError(f"path escapes workspace: {resolved}") from exc
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


def _ensure_paths_within_workspace(paths: List[str]) -> Optional[str]:
    """Validate all path arguments stay within workspace root."""
    for path_arg in paths:
        if path_arg == "-":
            continue
        try:
            _resolve_workspace_path(path_arg)
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


async def _tool_bash_exec(
    arguments: Dict[str, Any],
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    command = str(arguments.get("command", "")).strip()
    if not command:
        return "ERROR: missing command"

    timeout_sec = int(arguments.get("timeout_sec", 30) or 30)
    cwd_arg = arguments.get("cwd")
    if cwd_arg:
        try:
            cwd = _resolve_workspace_path(str(cwd_arg))
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

    command_name = Path(parts[0]).name
    if command_name == "cd":
        target = str(parts[1]) if len(parts) > 1 else "~"
        try:
            resolved = _resolve_workspace_path(target)
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
        validation_error = _ensure_paths_within_workspace(guarded_paths)
        if validation_error:
            return validation_error

    if command_name == "python":
        python_script = _extract_python_script_arg(parts)
        if python_script and python_script != "-":
            try:
                _resolve_workspace_path(python_script)
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
    try:
        if use_shell:
            proc = await asyncio.to_thread(
                subprocess.run,
                command,
                shell=True,
                executable="/bin/bash",
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=max(1, timeout_sec),
            )
        else:
            proc = await asyncio.to_thread(
                subprocess.run,
                parts,
                shell=False,
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=max(1, timeout_sec),
            )
    except subprocess.TimeoutExpired:
        return f"ERROR: command timeout after {timeout_sec}s"
    except Exception as exc:
        return f"ERROR: command failed to start: {exc}"

    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()
    return (
        f"exit_code={proc.returncode}\n"
        f"stdout:\n{stdout or '(empty)'}\n"
        f"stderr:\n{stderr or '(empty)'}"
    )


def _tool_file_read(arguments: Dict[str, Any]) -> str:
    try:
        path = _resolve_workspace_path(str(arguments.get("path", "")))
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
        return content[:MAX_READ_CHARS] + f"\n... (truncated, total {len(content)} chars)"
    return content


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
        path = _resolve_workspace_path(raw_path)
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
    *,
    confirm_gate: ConfirmGate,
    emit_event: Optional[Any] = None,
) -> str:
    try:
        path = _resolve_workspace_path(str(arguments.get("path", "")))
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
            output_path = _resolve_workspace_path(output_path_raw)
        except ValueError as exc:
            return f"ERROR: invalid output_path: {exc}"
    else:
        # If user did not explicitly provide output directory/path, require confirmation
        # on the inferred destination to prevent writing to unexpected locations.
        inferred = infer_output_path(target=target, description=description)
        try:
            output_path = _resolve_workspace_path(str(inferred))
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
    ok = mcp_connect(session.mcp_hub, session.mcp_configs, session.connected_servers, name)
    return "OK" if ok else "ERROR: connect failed"


async def _tool_mcp_call_async(arguments: Dict[str, Any], session: StudioSession) -> str:
    if session.mcp_hub is None:
        return "ERROR: no MCP hub connected"
    tool_name = str(arguments.get("tool_name", "")).strip()
    if not tool_name:
        return "ERROR: missing tool_name"
    args_obj = arguments.get("arguments", {})
    if not isinstance(args_obj, dict):
        return "ERROR: arguments must be an object"
    result = await mcp_call_tool_async(
        session.mcp_hub,
        tool_name,
        json.dumps(args_obj, ensure_ascii=False),
        echo=False,
    )
    return result if result is not None else "ERROR: mcp_call failed"


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
    ok = studio_skill_use(session.context_files, name)
    return "OK" if ok else "ERROR: skill activation failed"


def _tool_skill_list() -> str:
    try:
        summaries = get_all_skill_summaries()
    except Exception as exc:
        return f"ERROR: list skill failed: {exc}"
    if not summaries:
        return "No skills found."
    lines = [f"- {item['name']}: {item['description']}" for item in summaries]
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


def _tool_ask_user(arguments: Dict[str, Any], *, service_mode: bool = False) -> str:
    if service_mode:
        return "ERROR: ask_user is not supported in service mode; use confirm_required flow."
    question = str(arguments.get("question", "")).strip()
    if not question:
        return "ERROR: missing question"
    answer = input(f"{question}\n> ").strip()
    return answer or "(empty)"


def _tool_list_files(arguments: Dict[str, Any]) -> str:
    path_arg = str(arguments.get("path", "."))
    try:
        root = _resolve_workspace_path(path_arg)
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
    # Prefer the first taskspace path when available.
    try:
        taskspaces = getattr(session, "taskspaces", None)
        if isinstance(taskspaces, list) and taskspaces:
            root = str(taskspaces[0].get("path", "")).strip()
            if root:
                return str(Path(root).expanduser().resolve(strict=False))
    except Exception:
        pass
    try:
        workspace_dir = str(getattr(session, "workspace_dir", "") or "").strip()
        if workspace_dir:
            return str(Path(workspace_dir).expanduser().resolve(strict=False))
    except Exception:
        pass
    return str(_workspace_root())


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
            return await _tool_bash_exec(arguments, confirm_gate=gate, emit_event=event_callback)
        if name == "file_read":
            return _tool_file_read(arguments)
        if name == "file_write":
            return await _tool_file_write(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "file_edit":
            return await _tool_file_edit(arguments, confirm_gate=gate, emit_event=event_callback)
        if name == "codegen":
            return await _tool_codegen(arguments, session, confirm_gate=gate, emit_event=event_callback)
        if name == "mcp_connect":
            return _tool_mcp_connect(arguments, session)
        if name == "mcp_call":
            return await _tool_mcp_call_async(arguments, session)
        if name == "mcp_import":
            return _tool_mcp_import(arguments, session)
        if name == "skill_use":
            return _tool_skill_use(arguments, session)
        if name == "skill_list":
            return _tool_skill_list()
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
        if name == "ask_user":
            return _tool_ask_user(arguments, service_mode=isinstance(gate, AsyncConfirmGate))
        if name == "list_files":
            return _tool_list_files(arguments)
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
