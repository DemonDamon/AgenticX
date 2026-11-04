#!/usr/bin/env python3
"""CLI: unified harness control surface commands.

``agx harness-surface serve`` runs the unified HTTP control plane;
``agx harness-surface list`` inspects the local registry without a server.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Optional

import typer
import uvicorn
from rich.console import Console
from rich.table import Table

harness_surface_app = typer.Typer(
    name="harness-surface",
    help="Unified agent-harness control surface (one API over Claude Code / CodeBuddy / ...)",
    no_args_is_help=True,
)
console = Console()


@harness_surface_app.command("serve")
def harness_surface_serve(
    host: str = typer.Option("127.0.0.1", "--host", help="Bind address (use 127.0.0.1 only unless tunneled)."),
    port: int = typer.Option(9744, "--port", help="Listen port."),
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="Bearer token for HTTP clients. Else HARNESS_SURFACE_TOKEN / AGX_HARNESS_SURFACE_TOKEN / ~/.agenticx/config.yaml harness_surface.token / auto-generate.",
    ),
) -> None:
    """Start the unified harness control surface (FastAPI)."""
    if token and token.strip():
        os.environ["HARNESS_SURFACE_TOKEN"] = token.strip()
    elif not os.environ.get("HARNESS_SURFACE_TOKEN", "").strip():
        agx = os.environ.get("AGX_HARNESS_SURFACE_TOKEN", "").strip()
        if agx:
            os.environ["HARNESS_SURFACE_TOKEN"] = agx
        else:
            from agenticx.harness.settings import (
                ensure_harness_surface_token_persisted,
            )

            resolved = ensure_harness_surface_token_persisted()
            os.environ["HARNESS_SURFACE_TOKEN"] = resolved
            console.print(
                "[dim]Using token from ~/.agenticx/config.yaml (harness_surface.token) "
                "or newly generated.[/dim]"
            )
    console.print(f"[green]Harness control surface listening[/green] http://{host}:{port}")
    console.print(
        "[dim]HTTP clients send Authorization: Bearer <token>. "
        "GET /v1/harnesses lists adapters + capabilities.[/dim]"
    )
    uvicorn.run(
        "agenticx.harness.http_app:app",
        host=host,
        port=port,
        log_level="info",
    )


@harness_surface_app.command("list")
def harness_surface_list(
    as_json: bool = typer.Option(False, "--json", help="Emit machine-readable JSON."),
) -> None:
    """List registered harness adapters, capabilities and availability."""
    import json

    from agenticx.harness.registry import default_registry

    descriptors = default_registry().descriptors()
    if as_json:
        console.print_json(
            json.dumps(
                [
                    {
                        "harness_id": d.harness_id,
                        "display_name": d.display_name,
                        "description": d.description,
                        "available": d.available,
                        "capabilities": d.capabilities.as_dict(),
                    }
                    for d in descriptors
                ],
                ensure_ascii=False,
            )
        )
        return
    table = Table(title="Harness adapters")
    table.add_column("id", style="cyan")
    table.add_column("name")
    table.add_column("available")
    table.add_column("capabilities")
    for d in descriptors:
        caps = ", ".join(k for k, v in d.capabilities.as_dict().items() if v)
        table.add_row(
            d.harness_id,
            d.display_name,
            "[green]yes[/green]" if d.available else "[red]no[/red]",
            caps or "-",
        )
    console.print(table)
