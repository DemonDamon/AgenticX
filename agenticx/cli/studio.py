#!/usr/bin/env python3
"""Interactive AGX Studio REPL.

Author: Damon Li
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
import mimetypes
from pathlib import Path
import re as _re
import subprocess
import sys
from typing import Dict, List, Optional

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.cli.intent_classifier import IntentClassifier, IntentType
from agenticx.llms.provider_resolver import ProviderResolver
from agenticx.tools.skill_bundle import SkillBundleLoader


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
    context_files: Dict[str, str] = field(default_factory=dict)


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


def _detect_target(text: str) -> str:
    lowered = text.lower()
    if "workflow" in lowered or "工作流" in lowered or "pipeline" in lowered:
        return "workflow"
    if "tool" in lowered or "工具" in lowered:
        return "tool"
    if "skill" in lowered or "技能" in lowered:
        return "skill"
    return "agent"


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
    command_table.add_row("/config [provider] [model]", "查看或修改模型配置")
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
    console.print("[cyan]直接描述需求生成代码，或提问了解 AgenticX 用法。[/cyan]")
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

        file_path = Path(file_path_str).expanduser()
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


def _chat_reply(session: StudioSession, llm, user_input: str) -> str:
    """Generate a chat-mode response with streaming output."""
    quickstart_context = ""
    try:
        loader = SkillBundleLoader()
        quickstart_context = loader.get_skill_content("agenticx-quickstart") or ""
    except Exception:
        quickstart_context = ""

    system_parts = [
        "你是 AgenticX 助手，用中文回答用户关于 AgenticX 的问题。不要生成代码，除非用户明确要求。",
    ]
    if quickstart_context:
        system_parts.append("\n以下是 AgenticX 参考资料：\n" + quickstart_context)

    context_block = _build_context_block(session)
    if context_block:
        system_parts.append("\n\n" + context_block)

    messages: List[Dict[str, str]] = [{"role": "system", "content": "".join(system_parts)}]
    messages.extend(session.chat_history[-6:])
    messages.append({"role": "user", "content": user_input})
    full_reply = ""
    try:
        for chunk in llm.stream(messages, temperature=0.3, max_tokens=1024):
            print(chunk, end="", flush=True)
            full_reply += chunk
        print()
    except Exception:
        response = llm.invoke(messages, temperature=0.3, max_tokens=1024)
        full_reply = response.content.strip()
        print(full_reply)
    return full_reply.strip()


def run_studio(provider: Optional[str] = None, model: Optional[str] = None) -> None:
    """Start interactive studio REPL."""
    session = StudioSession(provider_name=provider, model_name=model)
    _print_header(session)

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
                fpath = Path(fpath_str).expanduser()
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
        user_input = _resolve_at_references(session, user_input)
        classifier = IntentClassifier(provider=llm)
        intent = classifier.classify_intent(user_input)
        if intent in {IntentType.CHAT, IntentType.QUESTION}:
            try:
                reply = _chat_reply(session, llm, user_input)
            except Exception as exc:
                console.print(f"[red]对话失败:[/red] {exc}")
                continue
            session.chat_history.append({"role": "user", "content": user_input})
            session.chat_history.append({"role": "assistant", "content": reply})
            continue
        if intent == IntentType.UNCLEAR:
            console.print("你是想让我生成代码，还是有问题要问？输入需求描述开始生成，或直接提问。")
            continue

        target = _detect_target(user_input)
        _take_snapshot(session)
        engine = CodeGenEngine(llm)
        latest_record = session.history[-1] if session.history else None
        latest_path = latest_record.file_path if latest_record is not None else _latest_artifact_path(session)
        context: Dict[str, object] = {}
        can_incremental_edit = (
            latest_record is not None
            and latest_record.target == target
            and latest_path is not None
            and latest_path in session.artifacts
        )
        if can_incremental_edit:
            previous_code = session.artifacts.get(latest_path)
            if previous_code:
                context["previous_code"] = previous_code
        if session.image_b64:
            context["image_b64"] = [dict(image) for image in session.image_b64]
        if session.context_files:
            context["reference_files"] = dict(session.context_files)
        try:
            with console.status("[cyan]正在生成代码...[/cyan]", spinner="dots"):
                generated = engine.generate(target=target, description=user_input, context=context)
        except Exception as exc:
            console.print(f"[red]生成失败:[/red] {exc}")
            continue
        if can_incremental_edit:
            out_path = latest_path
        else:
            out_path = infer_output_path(target=target, description=user_input)
        session.artifacts[out_path] = generated.code
        session.history.append(HistoryRecord(description=user_input, file_path=out_path, target=target))
        # Write to disk immediately (relative to current working directory)
        try:
            write_generated_file(out_path, generated.code)
            abs_path = out_path.resolve()
            console.print(f"[green]Generated & Saved[/green] {abs_path}")
        except Exception as write_exc:
            console.print(f"[green]Generated[/green] {out_path} [yellow](写入失败: {write_exc}，使用 /save 手动保存)[/yellow]")
        _print_artifact(out_path, generated.code)
        console.print("[cyan]继续输入需求即可迭代，或使用 /history 查看记录。[/cyan]")
