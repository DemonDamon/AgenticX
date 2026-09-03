#!/usr/bin/env python3
"""CLI: run the local CodeBuddy (WB) bridge HTTP server.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Optional

import typer
import uvicorn
from rich.console import Console

wb_bridge_app = typer.Typer(
    name="wb-bridge",
    help="Local CodeBuddy session bridge (stdio + HTTP)",
    no_args_is_help=True,
)
console = Console()


@wb_bridge_app.command("serve")
def wb_bridge_serve(
    host: str = typer.Option("127.0.0.1", "--host", help="Bind address (use 127.0.0.1 only unless tunneled)."),
    port: int = typer.Option(9743, "--port", help="Listen port."),
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="Bearer token for HTTP clients. Else WB_BRIDGE_TOKEN / AGX_WB_BRIDGE_TOKEN / ~/.agenticx/config.yaml wb_bridge.token / auto-generate.",
    ),
) -> None:
    """Start FastAPI bridge: spawns `codebuddy` children with stream-json stdio."""
    token_source = "flag --token"
    if token and token.strip():
        os.environ["WB_BRIDGE_TOKEN"] = token.strip()
    elif not os.environ.get("WB_BRIDGE_TOKEN", "").strip():
        agx = os.environ.get("AGX_WB_BRIDGE_TOKEN", "").strip()
        if agx:
            os.environ["WB_BRIDGE_TOKEN"] = agx
            token_source = "AGX_WB_BRIDGE_TOKEN"
        else:
            from agenticx.wb_bridge.settings import ensure_wb_bridge_token_persisted

            resolved = ensure_wb_bridge_token_persisted()
            os.environ["WB_BRIDGE_TOKEN"] = resolved
            token_source = "config wb_bridge.token (or newly generated)"
            console.print(
                "[dim]Using token from ~/.agenticx/config.yaml (wb_bridge.token) or newly generated; "
                "wb_bridge_* tools use the same value.[/dim]"
            )
    else:
        token_source = "WB_BRIDGE_TOKEN"
    console.print(f"[green]WB bridge listening[/green] http://{host}:{port}")
    console.print(
        f"[dim]HTTP clients send Authorization: Bearer <token>. Source: {token_source}. "
        "Match AGX_WB_BRIDGE_TOKEN or wb_bridge.token in config.[/dim]"
    )
    uvicorn.run(
        "agenticx.wb_bridge.http_app:app",
        host=host,
        port=port,
        log_level="info",
    )
