#!/usr/bin/env python3
"""CLI: run the local Claude Code bridge HTTP server.

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
from typing import Optional

import typer
import uvicorn
from rich.console import Console

cc_bridge_app = typer.Typer(name="cc-bridge", help="Local Claude Code bridge (stdio + HTTP)", no_args_is_help=True)
console = Console()


@cc_bridge_app.command("serve")
def cc_bridge_serve(
    host: str = typer.Option("127.0.0.1", "--host", help="Bind address (use 127.0.0.1 only unless tunneled)."),
    port: int = typer.Option(9742, "--port", help="Listen port."),
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="Bearer token for HTTP clients. Defaults to env CC_BRIDGE_TOKEN or a generated secret.",
    ),
) -> None:
    """Start FastAPI bridge: spawns `claude` children with stream-json stdio."""
    if token and token.strip():
        os.environ["CC_BRIDGE_TOKEN"] = token.strip()
    if not os.environ.get("CC_BRIDGE_TOKEN", "").strip():
        generated = secrets.token_urlsafe(32)
        os.environ["CC_BRIDGE_TOKEN"] = generated
        console.print(
            "[yellow]CC_BRIDGE_TOKEN was unset; generated ephemeral token (set env to reuse across restarts):[/yellow]"
        )
        console.print(generated)
    console.print(f"[green]CC bridge listening[/green] http://{host}:{port}")
    console.print("Export the same value as AGX_CC_BRIDGE_TOKEN for Studio tools.")
    uvicorn.run(
        "agenticx.cc_bridge.http_app:app",
        host=host,
        port=port,
        log_level="info",
    )
