#!/usr/bin/env python3
"""Interactive AGX Studio REPL.

Author: Damon Li
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
import mimetypes
import os
from pathlib import Path
import re as _re
import subprocess
import sys
from typing import Dict, List, Optional

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from agenticx.cli.codegen_engine import write_generated_file
from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.cli.studio_mcp import (
    auto_connect_servers,
    import_mcp_config,
    load_available_servers,
    mcp_list_servers,
    mcp_connect,
    mcp_disconnect,
    mcp_show_tools,
    mcp_call_tool,
    build_mcp_tools_context,
)
from agenticx.cli.studio_skill import (
    skill_list,
    skill_search,
    skill_use,
    skill_info,
    get_all_skill_summaries,
)
from agenticx.runtime.todo_manager import TodoManager
from agenticx.workspace.loader import ensure_workspace


console = Console()


@dataclass
class StudioSession:
    """State for an AGX studio session."""

    provider_name: Optional[str] = None
    model_name: Optional[str] = None
    artifacts: Dict[Path, str] = field(default_factory=dict)
    history: List["HistoryRecord"] = field(default_factory=list)
    snapshots: List["StudioSnapshot"] = field(default_factory=list)
    image_b64: List[Dict[str, str]] = field(default_factory=list)
    chat_history: List[Dict[str, str]] = field(default_factory=list)
    agent_messages: List[Dict[str, object]] = field(default_factory=list)
    last_agent_events: List[Dict[str, object]] = field(default_factory=list)
    context_files: Dict[str, str] = field(default_factory=dict)
    workspace_dir: Optional[str] = None
    # MCP state
    mcp_hub: Optional[object] = None  # MCPHub instance (lazy init)
    mcp_configs: Dict[str, object] = field(default_factory=dict)  # name -> MCPServerConfig
    connected_servers: set = field(default_factory=set)
    todo_manager: TodoManager = field(default_factory=TodoManager)
    scratchpad: Dict[str, str] = field(default_factory=dict)


@dataclass
class HistoryRecord:
    """Record for each generation round."""

    description: str
    file_path: Path
    target: str


@dataclass
class StudioSnapshot:
    """Undo snapshot for studio state."""

    artifacts: Dict[Path, str]
    history: List[HistoryRecord]
    image_b64: List[Dict[str, str]]
    context_files: Dict[str, str] = field(default_factory=dict)
    scratchpad: Dict[str, str] = field(default_factory=dict)
    todo_items: List[Dict[str, str]] = field(default_factory=list)


def _detect_target(text: str) -> str:
    lowered = text.lower()
    if "workflow" in lowered or "工作流" in lowered or "pipeline" in lowered:
        return "workflow"
    if "tool" in lowered or "工具" in lowered:
        return "tool"
    if "skill" in lowered or "技能" in lowered:
        return "skill"
    return "agent"


def _workspace_root() -> Path:
    configured = os.getenv("AGX_WORKSPACE_ROOT", "").strip()
    if configured:
        try:
            return Path(configured).expanduser().resolve(strict=False)
        except Exception:
            pass
    return Path.cwd().resolve()


def _resolve_mcp_auto_connect_setting() -> Optional[List[str]]:
    """Resolve mcp.auto_connect from config.

    Returns:
      - None: connect all
      - []: disable auto connect
      - [names...]: connect listed servers
    """
    try:
        value = ConfigManager.get_value("mcp.auto_connect")
    except Exception:
        value = None
    if value is None:
        return []
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"", "none", "off", "false", "0"}:
            return []
        if lowered == "all":
            return None
        return [value.strip()]
    if isinstance(value, list):
        names = [str(item).strip() for item in value if str(item).strip()]
        return names
    return []


def _resolve_workspace_path(path_arg: str) -> Path:
    workspace = _workspace_root()
    raw = Path(path_arg).expanduser()
    resolved = raw.resolve(strict=False) if raw.is_absolute() else (workspace / raw).resolve(strict=False)
    try:
        resolved.relative_to(workspace)
    except ValueError as exc:
        raise ValueError(f"path escapes workspace: {resolved}") from exc
    return resolved


def _print_header(session: StudioSession) -> None:
    config_table = Table(show_header=False, box=None)
    config_table.add_column(style="bold cyan")
    config_table.add_column()
    config_table.add_row("Provider", session.provider_name or "default")
    config_table.add_row("Model", session.model_name or "default")
    command_table = Table(title="Commands")
    command_table.add_column("命令", style="bold")
    command_table.add_column("说明")
    command_table.add_row("/run", "运行最新 Python 产物")
    command_table.add_row("/save", "保存当前所有产物")
    command_table.add_row("/show", "高亮显示当前产物")
    command_table.add_row("/history", "查看迭代历史")
    command_table.add_row("/image <path>", "添加图片上下文（base64）")
    command_table.add_row("/image clear", "清空已添加的图片上下文")
    command_table.add_row("/undo", "回退到上一次快照")
    command_table.add_row("/ctx add <path>", "添加文件到上下文（类似 Cursor 的 @）")
    command_table.add_row("/ctx list", "查看当前上下文文件")
    command_table.add_row("/ctx remove <path>", "移除指定上下文文件")
    command_table.add_row("/ctx clear", "清空所有上下文文件")
    command_table.add_row("/mcp list", "查看可用的 MCP 服务器")
    command_table.add_row("/mcp import <path>", "从外部 mcp.json 导入到 ~/.agenticx/mcp.json")
    command_table.add_row("/mcp connect <name>", "连接 MCP 服务器并发现工具")
    command_table.add_row("/mcp disconnect <name>", "断开 MCP 服务器")
    command_table.add_row("/mcp tools", "查看所有已连接的 MCP 工具")
    command_table.add_row("/mcp call <tool> <json>", "调用 MCP 工具")
    command_table.add_row("/skill list", "查看可用的 Skills")
    command_table.add_row("/skill search <query>", "搜索 Skill 注册中心")
    command_table.add_row("/skill use <name>", "激活 Skill 到上下文")
    command_table.add_row("/skill info <name>", "查看 Skill 详情")
    command_table.add_row("/discover <描述>", "智能推荐 MCP + Skill")
    command_table.add_row("/config [provider] [model]", "查看或修改模型配置")
    command_table.add_row("/trace", "查看最近一次 Agent Loop 事件流")
    command_table.add_row("/exit", "退出 Studio")

    console.print(
        Panel.fit(
            config_table,
            title="AgenticX Studio",
            subtitle="交互式代码生成",
            border_style="cyan",
        )
    )
    console.print(command_table)
    console.print("[cyan]直接用自然语言描述你想做什么，或输入 shell 命令。[/cyan]")
    console.print("[dim]Tip: use @filepath to reference code files, or /ctx add <path> to add context.[/dim]")
    console.print("")


def _syntax_language(path: Path) -> str:
    if path.suffix == ".md":
        return "markdown"
    if path.suffix == ".py":
        return "python"
    return "text"


def _print_artifact(path: Path, code: str) -> None:
    console.print(f"\n[bold]{path}[/bold]")
    console.print(Syntax(code, _syntax_language(path), line_numbers=True))


def _latest_artifact_path(session: StudioSession) -> Optional[Path]:
    if not session.artifacts:
        return None
    return list(session.artifacts.keys())[-1]


def _handle_image_command(session: StudioSession, user_input: str) -> None:
    parts = user_input.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        console.print("[yellow]用法: /image <path> 或 /image clear[/yellow]")
        console.print(f"[cyan]当前图片上下文数量: {len(session.image_b64)}[/cyan]")
        return
    image_arg = parts[1].strip()
    if image_arg == "clear":
        cleared = len(session.image_b64)
        session.image_b64.clear()
        console.print(f"[green]已清空图片上下文，共移除 {cleared} 张图片。[/green]")
        return
    image_path = Path(image_arg).expanduser()
    try:
        image_data = image_path.read_bytes()
    except FileNotFoundError:
        console.print(f"[red]图片不存在:[/red] {image_path}")
        return
    except OSError as exc:
        console.print(f"[red]读取图片失败:[/red] {exc}")
        return
    encoded = base64.b64encode(image_data).decode("ascii")
    guessed_mime, _ = mimetypes.guess_type(str(image_path))
    mime = guessed_mime if guessed_mime and guessed_mime.startswith("image/") else "image/png"
    session.image_b64.append({"data": encoded, "mime": mime})
    console.print(f"[green]已添加图片上下文[/green] {image_path}")


def _take_snapshot(session: StudioSession) -> None:
    """Save a full undo snapshot for the current session."""
    session.snapshots.append(
        StudioSnapshot(
            artifacts=dict(session.artifacts),
            history=list(session.history),
            image_b64=[dict(image) for image in session.image_b64],
            context_files=dict(session.context_files),
            scratchpad=dict(session.scratchpad),
            todo_items=session.todo_manager.to_payload(),
        )
    )


def _restore_last_snapshot(session: StudioSession) -> bool:
    """Restore previous snapshot state if one exists."""
    if not session.snapshots:
        return False
    snapshot = session.snapshots.pop()
    session.artifacts = dict(snapshot.artifacts)
    session.history = list(snapshot.history)
    session.image_b64 = [dict(image) for image in snapshot.image_b64]
    session.context_files = dict(snapshot.context_files)
    session.scratchpad = dict(snapshot.scratchpad)
    try:
        session.todo_manager.load_payload(snapshot.todo_items)
    except Exception:
        pass
    return True


def _build_context_block(session: StudioSession) -> str:
    """Build a context block from artifacts and context files for LLM."""
    parts: List[str] = []

    if session.artifacts:
        parts.append("=== Generated code in current session ===")
        for path, code in session.artifacts.items():
            parts.append(f"\n--- {path} ---\n{code}")

    if session.context_files:
        parts.append("\n=== User-referenced context files ===")
        for fpath, content in session.context_files.items():
            parts.append(f"\n--- {fpath} ---\n{content}")

    return "\n".join(parts)


def _resolve_at_references(session: StudioSession, user_input: str) -> str:
    """Resolve @path references in user input, loading file contents into context.

    Supports:
      @path/to/file.py       - single file
      @path/to/file.py:10-20 - line range (1-indexed, inclusive)

    Returns the original user_input unchanged (keeps @path visible to LLM).
    """
    pattern = r'@([\w./\-_]+(?:\.\w+)?)(?::(\d+)-(\d+))?'

    for match in _re.finditer(pattern, user_input):
        file_path_str = match.group(1)
        line_start = int(match.group(2)) if match.group(2) else None
        line_end = int(match.group(3)) if match.group(3) else None

        ref_key = match.group(0)
        if ref_key in session.context_files:
            continue

        try:
            file_path = _resolve_workspace_path(file_path_str)
        except ValueError as exc:
            console.print(f"[yellow]@ref rejected: {exc}[/yellow]")
            continue
        if not file_path.exists():
            console.print(f"[yellow]@ref file not found: {file_path}[/yellow]")
            continue
        if not file_path.is_file():
            console.print(f"[yellow]@ref is not a file: {file_path}[/yellow]")
            continue

        try:
            full_content = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            console.print(f"[yellow]@ref read failed: {file_path} ({exc})[/yellow]")
            continue

        if line_start is not None and line_end is not None:
            lines = full_content.splitlines()
            selected = lines[max(0, line_start - 1):line_end]
            content = "\n".join(selected)
            display_key = f"{file_path}:{line_start}-{line_end}"
        else:
            max_chars = 10000
            if len(full_content) > max_chars:
                content = (
                    full_content[:max_chars]
                    + f"\n... (truncated, {len(full_content)} chars total"
                    + f", use @{file_path_str}:start-end for a range)"
                )
            else:
                content = full_content
            display_key = str(file_path)

        session.context_files[display_key] = content
        console.print(f"[dim]+ context: {display_key} ({len(content)} chars)[/dim]")

    return user_input


def run_studio(provider: Optional[str] = None, model: Optional[str] = None) -> None:
    """Start interactive studio REPL."""
    try:
        ensure_workspace()
    except Exception as exc:
        console.print(f"[yellow]workspace bootstrap skipped: {exc}[/yellow]")
    session = StudioSession(
        provider_name=provider,
        model_name=model,
        workspace_dir=str(_workspace_root()),
    )
    _print_header(session)

    # Load available MCP server configs
    try:
        session.mcp_configs = load_available_servers()
    except Exception:
        session.mcp_configs = {}
    auto_connect_names = _resolve_mcp_auto_connect_setting()
    if session.mcp_configs and auto_connect_names != []:
        from agenticx.tools.mcp_hub import MCPHub

        session.mcp_hub = MCPHub(clients=[], auto_mode=False)
        auto_connect_servers(
            session.mcp_hub,
            session.mcp_configs,
            session.connected_servers,
            auto_connect_names,
        )

    while True:
        user_input = input("studio> ").strip()
        if not user_input:
            continue
        if user_input == "/exit":
            break
        if user_input == "/show":
            if not session.artifacts:
                console.print("[yellow]No generated artifacts.[/yellow]")
                continue
            for path, code in session.artifacts.items():
                _print_artifact(path, code)
            console.print("")
            continue
        if user_input == "/history":
            if not session.history:
                console.print("[yellow]暂无迭代历史。[/yellow]")
                continue
            history_table = Table(title="迭代历史")
            history_table.add_column("序号", style="bold cyan")
            history_table.add_column("目标")
            history_table.add_column("描述")
            history_table.add_column("文件路径")
            for idx, record in enumerate(session.history, start=1):
                history_table.add_row(str(idx), record.target, record.description, str(record.file_path))
            console.print(history_table)
            continue
        if user_input == "/trace":
            events = getattr(session, "last_agent_events", [])
            if not events:
                console.print("[yellow]暂无可用 trace。先执行一次自然语言请求。[/yellow]")
                continue
            trace_table = Table(title="Last Agent Loop Trace")
            trace_table.add_column("#", style="bold cyan")
            trace_table.add_column("type", style="bold")
            trace_table.add_column("data")
            for idx, item in enumerate(events, start=1):
                trace_table.add_row(str(idx), str(item.get("type", "")), str(item.get("data", {}))[:300])
            console.print(trace_table)
            continue
        if user_input.startswith("/image"):
            _handle_image_command(session, user_input)
            continue
        if user_input.startswith("/ctx"):
            parts = user_input.split(maxsplit=2)
            subcmd = parts[1] if len(parts) > 1 else ""
            if subcmd == "list":
                if not session.context_files:
                    console.print("[yellow]No context files.[/yellow]")
                else:
                    ctx_table = Table(title="Context Files")
                    ctx_table.add_column("File", style="bold")
                    ctx_table.add_column("Size")
                    for fpath, content in session.context_files.items():
                        ctx_table.add_row(fpath, f"{len(content)} chars")
                    console.print(ctx_table)
            elif subcmd == "clear":
                cleared = len(session.context_files)
                session.context_files.clear()
                console.print(f"[green]Cleared {cleared} context file(s).[/green]")
            elif subcmd == "add" and len(parts) > 2:
                fpath_str = parts[2].strip()
                try:
                    fpath = _resolve_workspace_path(fpath_str)
                except ValueError as exc:
                    console.print(f"[red]{exc}[/red]")
                    continue
                if not fpath.exists():
                    console.print(f"[red]File not found: {fpath}[/red]")
                elif not fpath.is_file():
                    console.print(f"[red]Not a file: {fpath}[/red]")
                else:
                    try:
                        content = fpath.read_text(encoding="utf-8", errors="replace")
                        max_chars = 10000
                        if len(content) > max_chars:
                            content = content[:max_chars] + f"\n... (truncated, {len(content)} chars total)"
                        session.context_files[str(fpath)] = content
                        console.print(f"[green]Added context:[/green] {fpath} ({len(content)} chars)")
                    except OSError as exc:
                        console.print(f"[red]Read failed:[/red] {exc}")
            elif subcmd == "remove" and len(parts) > 2:
                fpath_str = parts[2].strip()
                removed = False
                for key in list(session.context_files.keys()):
                    if fpath_str in key:
                        del session.context_files[key]
                        console.print(f"[green]Removed:[/green] {key}")
                        removed = True
                        break
                if not removed:
                    console.print(f"[yellow]No matching context file: {fpath_str}[/yellow]")
            else:
                console.print("[yellow]Usage: /ctx add <path> | /ctx list | /ctx remove <path> | /ctx clear[/yellow]")
            continue
        if user_input.startswith("/mcp"):
            parts = user_input.split(maxsplit=2)
            subcmd = parts[1] if len(parts) > 1 else ""
            if subcmd == "list":
                mcp_list_servers(session.mcp_configs, session.connected_servers)
            elif subcmd == "connect" and len(parts) > 2:
                server_name = parts[2].strip()
                if session.mcp_hub is None:
                    from agenticx.tools.mcp_hub import MCPHub
                    session.mcp_hub = MCPHub(clients=[], auto_mode=False)
                mcp_connect(session.mcp_hub, session.mcp_configs, session.connected_servers, server_name)
            elif subcmd == "import" and len(parts) > 2:
                source_path = parts[2].strip()
                result = import_mcp_config(source_path)
                if result.get("ok"):
                    session.mcp_configs = load_available_servers()
                    console.print(
                        f"[green]导入完成[/green] imported={result.get('total_imported', 0)}, "
                        f"total={result.get('total_servers', 0)}"
                    )
                else:
                    console.print(f"[red]导入失败:[/red] {result.get('error', 'unknown error')}")
            elif subcmd == "disconnect" and len(parts) > 2:
                server_name = parts[2].strip()
                if session.mcp_hub is not None:
                    mcp_disconnect(session.mcp_hub, session.mcp_configs, session.connected_servers, server_name)
                else:
                    console.print("[yellow]暂无 MCP 连接。[/yellow]")
            elif subcmd == "tools":
                if session.mcp_hub is not None:
                    mcp_show_tools(session.mcp_hub)
                else:
                    console.print("[yellow]暂无 MCP 连接。使用 /mcp connect <name> 连接。[/yellow]")
            elif subcmd == "call" and len(parts) > 2:
                call_parts = parts[2].strip().split(maxsplit=1)
                tool_name = call_parts[0]
                args_json = call_parts[1] if len(call_parts) > 1 else "{}"
                if session.mcp_hub is not None:
                    result = mcp_call_tool(session.mcp_hub, tool_name, args_json)
                    if result:
                        session.chat_history.append({"role": "user", "content": f"/mcp call {tool_name}"})
                        session.chat_history.append({"role": "assistant", "content": f"MCP 工具 {tool_name} 返回:\n{result[:500]}"})
                else:
                    console.print("[yellow]暂无 MCP 连接。[/yellow]")
            else:
                console.print("[yellow]用法: /mcp list | /mcp import <path> | /mcp connect <name> | /mcp disconnect <name> | /mcp tools | /mcp call <tool> <json>[/yellow]")
            continue
        if user_input.startswith("/skill"):
            parts = user_input.split(maxsplit=2)
            subcmd = parts[1] if len(parts) > 1 else ""
            if subcmd == "list":
                skill_list()
            elif subcmd == "search" and len(parts) > 2:
                skill_search(parts[2].strip())
            elif subcmd == "use" and len(parts) > 2:
                skill_use(session.context_files, parts[2].strip())
            elif subcmd == "info" and len(parts) > 2:
                skill_info(parts[2].strip())
            else:
                console.print("[yellow]用法: /skill list | /skill search <query> | /skill use <name> | /skill info <name>[/yellow]")
            continue
        if user_input.startswith("/discover"):
            discover_desc = user_input[len("/discover"):].strip()
            if not discover_desc:
                console.print("[yellow]用法: /discover <描述你想做什么>[/yellow]")
                continue
            try:
                llm = ProviderResolver.resolve(
                    provider_name=session.provider_name,
                    model=session.model_name,
                )
            except Exception as exc:
                console.print(f"[red]模型配置错误:[/red] {exc}")
                continue
            mcp_server_names = list(session.mcp_configs.keys()) if session.mcp_configs else []
            skill_summaries = []
            try:
                skill_summaries = get_all_skill_summaries()
            except Exception:
                pass
            discover_prompt = (
                "你是一个智能推荐助手。根据用户描述，推荐合适的 MCP 服务器和 Skills。\n"
                "只能从以下列表中推荐，不要编造不存在的。\n\n"
                f"可用 MCP 服务器: {', '.join(mcp_server_names) or '(无)'}\n"
                "可用 Skills:\n"
            )
            for s in skill_summaries:
                discover_prompt += f"  - {s['name']}: {s['description']}\n"
            discover_prompt += (
                f"\n用户需求: {discover_desc}\n\n"
                "请返回 JSON 格式:\n"
                '{"recommended_mcps": ["server_name1"], "recommended_skills": ["skill_name1"], "reason": "推荐理由"}\n'
                "如果没有合适的推荐，对应数组留空。"
            )
            messages = [
                {"role": "system", "content": "你是智能推荐助手，只输出 JSON。"},
                {"role": "user", "content": discover_prompt},
            ]
            try:
                response = llm.invoke(messages, temperature=0.2, max_tokens=512)
                import json as _json
                import re as _discover_re
                text = response.content.strip()
                json_match = _discover_re.search(r'\{.*\}', text, _discover_re.DOTALL)
                if json_match:
                    rec = _json.loads(json_match.group())
                else:
                    rec = _json.loads(text)
                rec_mcps = rec.get("recommended_mcps", [])
                rec_skills = rec.get("recommended_skills", [])
                reason = rec.get("reason", "")
                console.print("\n[bold cyan]推荐结果[/bold cyan]")
                if reason:
                    console.print(f"[dim]{reason}[/dim]")
                if rec_mcps:
                    console.print(f"  MCP: {', '.join(rec_mcps)}")
                if rec_skills:
                    console.print(f"  Skills: {', '.join(rec_skills)}")
                if not rec_mcps and not rec_skills:
                    console.print("[yellow]没有找到匹配的推荐。[/yellow]")
                    continue
                confirm = input("是否自动连接推荐的 MCP 并激活推荐的 Skill？[y/n] ").strip().lower()
                if confirm in {"y", "yes", "是"}:
                    for mcp_name in rec_mcps:
                        if mcp_name in session.mcp_configs:
                            if session.mcp_hub is None:
                                from agenticx.tools.mcp_hub import MCPHub
                                session.mcp_hub = MCPHub(clients=[], auto_mode=False)
                            mcp_connect(session.mcp_hub, session.mcp_configs, session.connected_servers, mcp_name)
                    for skill_name in rec_skills:
                        skill_use(session.context_files, skill_name)
            except Exception as exc:
                console.print(f"[red]推荐失败:[/red] {exc}")
            continue
        if user_input == "/save":
            if not session.artifacts:
                console.print("[yellow]Nothing to save.[/yellow]")
                continue
            for path, code in session.artifacts.items():
                write_generated_file(path, code)
                console.print(f"[green]Saved[/green] {path.resolve()}")
            continue
        if user_input == "/undo":
            if not _restore_last_snapshot(session):
                console.print("[yellow]No undo snapshot.[/yellow]")
                continue
            console.print("[green]Undo complete.[/green]")
            continue
        if user_input == "/run":
            if not session.artifacts:
                console.print("[yellow]No runnable artifact.[/yellow]")
                continue
            latest_path = _latest_artifact_path(session)
            if latest_path is None:
                console.print("[yellow]No runnable artifact.[/yellow]")
                continue
            if latest_path.suffix != ".py":
                console.print("[yellow]Latest artifact is not Python.[/yellow]")
                continue
            write_generated_file(latest_path, session.artifacts[latest_path])
            proc = subprocess.run([sys.executable, str(latest_path)], capture_output=True, text=True)
            if proc.stdout:
                console.print(proc.stdout)
            if proc.returncode != 0 and proc.stderr:
                console.print(f"[red]{proc.stderr}[/red]")
            continue
        if user_input.startswith("/config"):
            parts = user_input.split()
            if len(parts) == 1:
                console.print(
                    f"Provider={session.provider_name or 'default'}, "
                    f"Model={session.model_name or 'default'}"
                )
            elif len(parts) >= 2:
                session.provider_name = parts[1]
                if len(parts) >= 3:
                    session.model_name = parts[2]
                console.print("[green]Config updated.[/green]")
            continue

        try:
            llm = ProviderResolver.resolve(
                provider_name=session.provider_name,
                model=session.model_name,
            )
        except Exception as exc:
            console.print(f"[red]模型配置错误:[/red] {exc}")
            continue
        _take_snapshot(session)
        user_input = _resolve_at_references(session, user_input)
        from agenticx.cli.agent_loop import run_agent_loop

        try:
            with console.status("[cyan]正在执行 agent loop...[/cyan]", spinner="dots"):
                reply = run_agent_loop(session, llm, user_input)
            if reply:
                console.print(reply)
        except Exception as exc:
            console.print(f"[red]执行失败:[/red] {exc}")
