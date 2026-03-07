#!/usr/bin/env python3
"""AGX configuration CLI commands.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Optional

from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.table import Table
import typer

from agenticx.cli.config_manager import (
    AgxConfig,
    ConfigManager,
    SUPPORTED_PROVIDERS,
)
from agenticx.llms.provider_resolver import ProviderResolver


console = Console()
config_app = typer.Typer(name="config", help="AGX 统一配置命令", no_args_is_help=True)


def _parse_value(raw: str) -> Any:
    lowered = raw.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if raw.isdigit():
        return int(raw)
    try:
        return float(raw)
    except ValueError:
        return raw


@config_app.command("providers")
def list_providers() -> None:
    """List supported providers and required fields."""
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Provider", style="cyan")
    table.add_column("Required")
    table.add_column("Optional")
    table.add_column("Default model", style="green")

    for name, spec in SUPPORTED_PROVIDERS.items():
        required = ", ".join(spec.get("required", [])) or "-"
        optional = ", ".join(spec.get("optional", [])) or "-"
        default_model = spec.get("default_model", "-")
        table.add_row(name, required, optional, default_model)
    console.print(table)


@config_app.command("show")
def show_config() -> None:
    """Show merged config with masked secrets."""
    masked = ConfigManager.masked_config()
    console.print(masked)


@config_app.command("get")
def get_config_value(key: str = typer.Argument(..., help="Dot path key")) -> None:
    """Get a config value by dotted key."""
    value = ConfigManager.get_value(key)
    if value is None:
        console.print(f"[yellow]Not found:[/yellow] {key}")
        raise typer.Exit(1)
    console.print(value)


@config_app.command("set")
def set_config_value(
    key: str = typer.Argument(..., help="Dot path key"),
    value: str = typer.Argument(..., help="Value"),
    scope: str = typer.Option("global", "--scope", help="global | project"),
) -> None:
    """Set a config value by dotted key."""
    if scope not in {"global", "project"}:
        console.print("[red]scope must be 'global' or 'project'[/red]")
        raise typer.Exit(1)
    path = ConfigManager.set_value(key, _parse_value(value), scope=scope)
    console.print(f"[green]Saved[/green] {key} -> {value} ({path})")


@config_app.command("test")
def test_provider(
    provider: Optional[str] = typer.Argument(None, help="Provider name"),
) -> None:
    """Test provider connectivity with a simple hello request."""
    try:
        llm = ProviderResolver.resolve(provider_name=provider)
    except Exception as exc:
        console.print(f"[red]Resolve failed:[/red] {exc}")
        raise typer.Exit(1)

    try:
        response = llm.invoke("Reply with: hello")
        text = (response.content or "").strip()
        console.print("[green]Connectivity OK[/green]")
        console.print(f"Provider response: {text[:120]}")
    except Exception as exc:
        console.print(f"[red]Connectivity failed:[/red] {exc}")
        raise typer.Exit(1)


@config_app.command("init")
def init_config(
    scope: str = typer.Option("global", "--scope", help="global | project"),
) -> None:
    """Interactive AGX config wizard."""
    if scope not in {"global", "project"}:
        console.print("[red]scope must be 'global' or 'project'[/red]")
        raise typer.Exit(1)

    console.print("\n[bold cyan]AGX configuration wizard[/bold cyan]\n")
    providers = list(SUPPORTED_PROVIDERS.keys())
    for index, name in enumerate(providers, start=1):
        console.print(f"{index}. {name}")
    selected = Prompt.ask("Primary provider", default="openai").strip().lower()
    if selected not in SUPPORTED_PROVIDERS:
        console.print(f"[red]Unsupported provider:[/red] {selected}")
        raise typer.Exit(1)

    spec = SUPPORTED_PROVIDERS[selected]
    cfg: dict[str, Any] = {
        "model": Prompt.ask(
            f"Model for {selected}",
            default=str(spec.get("default_model", "")),
        )
    }
    for field in spec.get("required", []):
        cfg[field] = Prompt.ask(f"{selected}.{field}", password="key" in field)
    for field in spec.get("optional", []):
        if Confirm.ask(f"Set optional field {selected}.{field}?", default=False):
            cfg[field] = Prompt.ask(f"{selected}.{field}")

    config = ConfigManager.load_scope(scope=scope)
    providers_map = dict(config.providers)
    providers_map[selected] = cfg
    config.default_provider = selected
    config.providers = providers_map

    while Confirm.ask("Add another provider?", default=False):
        other = Prompt.ask("Provider name").strip().lower()
        if other not in SUPPORTED_PROVIDERS:
            console.print(f"[yellow]Skip unsupported provider:[/yellow] {other}")
            continue
        other_spec = SUPPORTED_PROVIDERS[other]
        other_cfg: dict[str, Any] = {
            "model": Prompt.ask(
                f"Model for {other}",
                default=str(other_spec.get("default_model", "")),
            )
        }
        for field in other_spec.get("required", []):
            other_cfg[field] = Prompt.ask(f"{other}.{field}", password="key" in field)
        for field in other_spec.get("optional", []):
            if Confirm.ask(f"Set optional field {other}.{field}?", default=False):
                other_cfg[field] = Prompt.ask(f"{other}.{field}")
        providers_map[other] = other_cfg
        config.providers = providers_map

    saved_path = ConfigManager.save(config, scope=scope)
    console.print(f"\n[green]Config saved:[/green] {saved_path}")
    console.print(
        f"Default provider: {config.default_provider} "
        f"({config.get_provider(config.default_provider).model})"
    )

