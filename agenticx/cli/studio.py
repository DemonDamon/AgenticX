#!/usr/bin/env python3
"""Interactive AGX Studio REPL.

Author: Damon Li
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
import mimetypes
from pathlib import Path
import subprocess
import sys
from typing import Dict, List, Optional

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.llms.provider_resolver import ProviderResolver


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
    return True


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
        if user_input == "/save":
            if not session.artifacts:
                console.print("[yellow]Nothing to save.[/yellow]")
                continue
            for path, code in session.artifacts.items():
                write_generated_file(path, code)
                console.print(f"[green]Saved[/green] {path}")
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

        target = _detect_target(user_input)
        _take_snapshot(session)
        try:
            llm = ProviderResolver.resolve(
                provider_name=session.provider_name,
                model=session.model_name,
            )
        except Exception as exc:
            console.print(f"[red]模型配置错误:[/red] {exc}")
            continue
        engine = CodeGenEngine(llm)
        latest_record = session.history[-1] if session.history else None
        latest_path = latest_record.file_path if latest_record is not None else _latest_artifact_path(session)
        context: Dict[str, object] = {}
        if latest_record is not None and latest_record.target == target and latest_path is not None:
            previous_code = session.artifacts.get(latest_path)
            if previous_code:
                context["previous_code"] = previous_code
        if session.image_b64:
            context["image_b64"] = [dict(image) for image in session.image_b64]
        try:
            generated = engine.generate(target=target, description=user_input, context=context)
        except Exception as exc:
            console.print(f"[red]生成失败:[/red] {exc}")
            continue
        if latest_record is not None and latest_record.target == target and latest_path is not None:
            out_path = latest_path
        else:
            out_path = infer_output_path(target=target, description=user_input)
        session.artifacts[out_path] = generated.code
        session.history.append(HistoryRecord(description=user_input, file_path=out_path, target=target))
        console.print(f"[green]Generated[/green] {out_path}")
        _print_artifact(out_path, generated.code)
        console.print("[cyan]继续输入需求即可迭代，或使用 /history 查看记录。[/cyan]")
