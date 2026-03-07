#!/usr/bin/env python3
"""AGX generate command group.

Author: Damon Li
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Optional

from rich.console import Console
import typer

from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.llms.provider_resolver import ProviderResolver


console = Console()
generate_app = typer.Typer(name="generate", help="AI 代码生成命令", no_args_is_help=True)


def _run_generation(
    target: str,
    description: str,
    provider: Optional[str],
    model: Optional[str],
    output: Optional[str],
    dry_run: bool,
    run: bool,
) -> None:
    try:
        llm = ProviderResolver.resolve(provider_name=provider, model=model)
    except Exception as exc:
        console.print(f"[red]Provider resolve failed:[/red] {exc}")
        raise typer.Exit(1) from exc
    engine = CodeGenEngine(provider=llm)

    console.print(f"[bold cyan]Generating {target}[/bold cyan]")
    console.print(f"Provider: {llm.__class__.__name__} ({llm.model})")
    try:
        generated = engine.generate(target=target, description=description, context={})
    except Exception as exc:
        console.print(f"[red]Generation failed:[/red] {exc}")
        raise typer.Exit(1) from exc
    out_path = infer_output_path(target=target, description=description, explicit_output=output)

    if dry_run:
        console.print(generated.code)
        return

    write_generated_file(out_path, generated.code)
    console.print(f"[green]Written[/green] {out_path}")

    if run and out_path.suffix == ".py":
        console.print(f"[bold]Running[/bold] python {out_path}")
        proc = subprocess.run(
            [sys.executable, str(out_path)],
            capture_output=True,
            text=True,
        )
        if proc.stdout:
            console.print(proc.stdout)
        if proc.returncode != 0:
            if proc.stderr:
                console.print(f"[red]{proc.stderr}[/red]")
            raise typer.Exit(proc.returncode)


@generate_app.command("agent")
def generate_agent(
    description: str = typer.Argument(..., help="Agent requirement in natural language"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    run: bool = typer.Option(False, "--run"),
) -> None:
    """Generate agent Python code."""
    _run_generation("agent", description, provider, model, output, dry_run, run)


@generate_app.command("workflow")
def generate_workflow(
    description: str = typer.Argument(..., help="Workflow requirement"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    run: bool = typer.Option(False, "--run"),
) -> None:
    """Generate workflow Python code."""
    _run_generation("workflow", description, provider, model, output, dry_run, run)


@generate_app.command("skill")
def generate_skill(
    description: str = typer.Argument(..., help="Skill requirement"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
) -> None:
    """Generate SKILL.md content."""
    _run_generation("skill", description, provider, model, output, dry_run, run=False)


@generate_app.command("tool")
def generate_tool(
    description: str = typer.Argument(..., help="Tool requirement"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    run: bool = typer.Option(False, "--run"),
) -> None:
    """Generate custom tool Python code."""
    _run_generation("tool", description, provider, model, output, dry_run, run)
