#!/usr/bin/env python3
"""AGX generate command group.

Author: Damon Li
"""

from __future__ import annotations

import base64
import mimetypes
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from rich.console import Console
import typer

from agenticx.cli.codegen_engine import CodeGenEngine, infer_output_path, write_generated_file
from agenticx.cli.log_config import configure_cli_logging
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
    interactive: bool = False,
    context: Optional[Dict[str, Any]] = None,
) -> None:
    configure_cli_logging(debug=False)
    try:
        llm = ProviderResolver.resolve(provider_name=provider, model=model)
    except Exception as exc:
        console.print(f"[red]Provider resolve failed:[/red] {exc}")
        raise typer.Exit(1) from exc
    engine = CodeGenEngine(provider=llm)

    console.print(f"[bold cyan]Generating {target}[/bold cyan]")
    console.print(f"Provider: {llm.__class__.__name__} ({llm.model})")
    generation_context: Dict[str, Any] = dict(context or {})
    try:
        generated = engine.generate(target=target, description=description, context=generation_context)
    except Exception as exc:
        console.print(f"[red]Generation failed:[/red] {exc}")
        raise typer.Exit(1) from exc
    out_path = infer_output_path(target=target, description=description, explicit_output=output)

    if dry_run:
        console.print(generated.code)
    else:
        write_generated_file(out_path, generated.code)
        console.print(f"[green]Written[/green] {out_path}")

    current_code = generated.code
    while interactive:
        answer = typer.prompt("是否继续修改？[y/n]", default="n").strip().lower()
        if answer in {"n", "no"}:
            break
        if answer not in {"y", "yes"}:
            console.print("[yellow]请输入 y 或 n。[/yellow]")
            continue

        revision_requirement = typer.prompt("请描述本轮修改需求").strip()
        if not revision_requirement:
            console.print("[yellow]修改需求不能为空。[/yellow]")
            continue

        round_context: Dict[str, Any] = dict(context or {})
        round_context["previous_code"] = current_code
        try:
            revised = engine.generate(
                target=target,
                description=revision_requirement,
                context=round_context,
            )
        except Exception as exc:
            console.print(f"[red]增量生成失败:[/red] {exc}")
            raise typer.Exit(1) from exc

        current_code = revised.code
        if dry_run:
            console.print(revised.code)
            continue

        write_generated_file(out_path, revised.code)
        console.print(f"[green]Updated[/green] {out_path}")

    if not dry_run and run and out_path.suffix == ".py":
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


def _resolve_description(description: Optional[str]) -> str:
    text = (description or "").strip()
    if text:
        return text
    if not sys.stdin.isatty():
        raise typer.BadParameter("当前环境不可交互，请显式传入 DESCRIPTION 参数。")
    prompted = typer.prompt("请描述你想构建的 Agent / Workflow / Skill / Tool：").strip()
    if not prompted:
        raise typer.BadParameter("描述不能为空，请输入生成需求。")
    return prompted


def _encode_images(
    paths: Optional[List[Path]],
) -> Optional[Union[Dict[str, str], List[Dict[str, str]]]]:
    if not paths:
        return None
    encoded_images: List[Dict[str, str]] = []
    for path in paths:
        try:
            data = path.read_bytes()
        except FileNotFoundError as exc:
            raise typer.BadParameter(f"图片不存在: {path}") from exc
        except OSError as exc:
            raise typer.BadParameter(f"读取图片失败: {path} ({exc})") from exc
        guessed_mime, _ = mimetypes.guess_type(str(path))
        mime = guessed_mime if guessed_mime and guessed_mime.startswith("image/") else "image/png"
        encoded_images.append({"data": base64.b64encode(data).decode("ascii"), "mime": mime})
    if len(encoded_images) == 1:
        return encoded_images[0]
    return encoded_images


def _build_context(images: Optional[List[Path]]) -> Dict[str, Any]:
    context: Dict[str, Any] = {}
    image_b64 = _encode_images(images)
    if image_b64 is not None:
        context["image_b64"] = image_b64
    return context


@generate_app.command("agent")
def generate_agent(
    description: Optional[str] = typer.Argument(None, help="Agent requirement in natural language"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    run: bool = typer.Option(False, "--run"),
    interactive: bool = typer.Option(False, "--interactive", "-i"),
    image: Optional[List[Path]] = typer.Option(None, "--image"),
) -> None:
    """Generate agent Python code."""
    _run_generation(
        "agent",
        _resolve_description(description),
        provider,
        model,
        output,
        dry_run,
        run,
        interactive=interactive,
        context=_build_context(image),
    )


@generate_app.command("workflow")
def generate_workflow(
    description: Optional[str] = typer.Argument(None, help="Workflow requirement"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    run: bool = typer.Option(False, "--run"),
    interactive: bool = typer.Option(False, "--interactive", "-i"),
    image: Optional[List[Path]] = typer.Option(None, "--image"),
) -> None:
    """Generate workflow Python code."""
    _run_generation(
        "workflow",
        _resolve_description(description),
        provider,
        model,
        output,
        dry_run,
        run,
        interactive=interactive,
        context=_build_context(image),
    )


@generate_app.command("skill")
def generate_skill(
    description: Optional[str] = typer.Argument(None, help="Skill requirement"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    interactive: bool = typer.Option(False, "--interactive", "-i"),
    image: Optional[List[Path]] = typer.Option(None, "--image"),
) -> None:
    """Generate SKILL.md content."""
    _run_generation(
        "skill",
        _resolve_description(description),
        provider,
        model,
        output,
        dry_run,
        run=False,
        interactive=interactive,
        context=_build_context(image),
    )


@generate_app.command("tool")
def generate_tool(
    description: Optional[str] = typer.Argument(None, help="Tool requirement"),
    provider: Optional[str] = typer.Option(None, "--provider", "-p"),
    model: Optional[str] = typer.Option(None, "--model", "-m"),
    output: Optional[str] = typer.Option(None, "--output", "-o"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    run: bool = typer.Option(False, "--run"),
    interactive: bool = typer.Option(False, "--interactive", "-i"),
    image: Optional[List[Path]] = typer.Option(None, "--image"),
) -> None:
    """Generate custom tool Python code."""
    _run_generation(
        "tool",
        _resolve_description(description),
        provider,
        model,
        output,
        dry_run,
        run,
        interactive=interactive,
        context=_build_context(image),
    )
