#!/usr/bin/env python3
"""Interactive AGX Studio REPL.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import subprocess
import sys
from typing import Dict, List, Optional, Tuple

from rich.console import Console

from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.llms.provider_resolver import ProviderResolver


console = Console()


@dataclass
class StudioSession:
    """State for an AGX studio session."""

    provider_name: Optional[str] = None
    model_name: Optional[str] = None
    artifacts: Dict[Path, str] = field(default_factory=dict)
    history: List[Tuple[str, str]] = field(default_factory=list)
    snapshots: List[Dict[Path, str]] = field(default_factory=list)


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
    console.print("\n[bold cyan]AgenticX Studio[/bold cyan]")
    console.print(
        f"Provider: {session.provider_name or 'default'} "
        f"Model: {session.model_name or 'default'}"
    )
    console.print("Commands: /run, /save, /show, /undo, /config, /exit\n")


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
                console.print(f"\n[bold]{path}[/bold]\n{code}\n")
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
            if not session.snapshots:
                console.print("[yellow]No undo snapshot.[/yellow]")
                continue
            session.artifacts = session.snapshots.pop()
            console.print("[green]Undo complete.[/green]")
            continue
        if user_input == "/run":
            if not session.artifacts:
                console.print("[yellow]No runnable artifact.[/yellow]")
                continue
            latest_path = list(session.artifacts.keys())[-1]
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
        session.snapshots.append(dict(session.artifacts))
        llm = ProviderResolver.resolve(
            provider_name=session.provider_name,
            model=session.model_name,
        )
        engine = CodeGenEngine(llm)
        generated = engine.generate(target=target, description=user_input, context={})
        out_path = infer_output_path(target=target, description=user_input)
        session.artifacts[out_path] = generated.code
        session.history.append((user_input, str(out_path)))
        console.print(f"[green]Generated[/green] {out_path}")
