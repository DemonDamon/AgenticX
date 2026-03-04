"""CLI commands for managing hooks.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from agenticx.hooks.config import load_hook_runtime_config, save_hook_runtime_config
from agenticx.hooks.loader import load_hooks
from agenticx.hooks.status import build_hook_status

hooks_app = typer.Typer(name="hooks", help="Manage AgenticX hooks", no_args_is_help=True)
console = Console()


def _workspace_dir(path: Optional[str]) -> Path:
    return Path(path).resolve() if path else Path.cwd()


@hooks_app.command("list")
def list_hooks(
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Workspace directory"),
    eligible: bool = typer.Option(False, "--eligible", help="Show eligible hooks only"),
    json_output: bool = typer.Option(False, "--json", help="Emit JSON-like output"),
) -> None:
    ws = _workspace_dir(workspace)
    status_items = build_hook_status(ws, config=load_hook_runtime_config())
    if eligible:
        status_items = [item for item in status_items if item.eligible]

    if json_output:
        for item in status_items:
            console.print(
                {
                    "name": item.name,
                    "source": item.source,
                    "events": item.events,
                    "eligible": item.eligible,
                    "missing_requirements": item.missing_requirements,
                }
            )
        return

    table = Table(title="AgenticX Hooks")
    table.add_column("Name")
    table.add_column("Source")
    table.add_column("Events")
    table.add_column("Eligible")
    for item in status_items:
        table.add_row(item.name, item.source, ", ".join(item.events), "yes" if item.eligible else "no")
    console.print(table)


@hooks_app.command("info")
def hook_info(
    name: str = typer.Argument(..., help="Hook name"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Workspace directory"),
) -> None:
    ws = _workspace_dir(workspace)
    items = build_hook_status(ws, config=load_hook_runtime_config())
    matched = [item for item in items if item.name == name]
    if not matched:
        raise typer.Exit(code=1)
    item = matched[0]
    console.print(
        {
            "name": item.name,
            "source": item.source,
            "description": item.description,
            "events": item.events,
            "eligible": item.eligible,
            "missing_requirements": item.missing_requirements,
            "metadata_path": item.metadata_path,
            "handler_path": item.handler_path,
        }
    )


@hooks_app.command("check")
def check_hooks(
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Workspace directory"),
) -> None:
    ws = _workspace_dir(workspace)
    items = build_hook_status(ws, config=load_hook_runtime_config())
    total = len(items)
    ok = len([item for item in items if item.eligible])
    console.print(f"Eligible hooks: {ok}/{total}")
    for item in items:
        if not item.eligible:
            console.print(f"- {item.name}: {item.missing_requirements}")


@hooks_app.command("enable")
def enable_hook(name: str = typer.Argument(..., help="Hook name")) -> None:
    config = load_hook_runtime_config()
    internal = config.setdefault("internal", {})
    entries = internal.setdefault("entries", {})
    entry = entries.setdefault(name, {})
    entry["enabled"] = True
    save_hook_runtime_config(config)
    console.print(f"Enabled hook: {name}")


@hooks_app.command("disable")
def disable_hook(name: str = typer.Argument(..., help="Hook name")) -> None:
    config = load_hook_runtime_config()
    internal = config.setdefault("internal", {})
    entries = internal.setdefault("entries", {})
    entry = entries.setdefault(name, {})
    entry["enabled"] = False
    save_hook_runtime_config(config)
    console.print(f"Disabled hook: {name}")


@hooks_app.command("load")
def load_hook_handlers(
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Workspace directory"),
) -> None:
    ws = _workspace_dir(workspace)
    count = load_hooks(ws, config=load_hook_runtime_config())
    console.print(f"Loaded hooks: {count}")

