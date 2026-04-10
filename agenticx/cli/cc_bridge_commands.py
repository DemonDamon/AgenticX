#!/usr/bin/env python3
"""CLI: run the local Claude Code bridge HTTP server.

Author: Damon Li
"""

from __future__ import annotations

import os
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
        help="Bearer token for HTTP clients. Else CC_BRIDGE_TOKEN / AGX_CC_BRIDGE_TOKEN / ~/.agenticx/config.yaml cc_bridge.token / auto-generate.",
    ),
) -> None:
    """Start FastAPI bridge: spawns `claude` children with stream-json stdio."""
    if token and token.strip():
        os.environ["CC_BRIDGE_TOKEN"] = token.strip()
    elif not os.environ.get("CC_BRIDGE_TOKEN", "").strip():
        agx = os.environ.get("AGX_CC_BRIDGE_TOKEN", "").strip()
        if agx:
            os.environ["CC_BRIDGE_TOKEN"] = agx
        else:
            from agenticx.cc_bridge.settings import ensure_cc_bridge_token_persisted

            resolved = ensure_cc_bridge_token_persisted()
            os.environ["CC_BRIDGE_TOKEN"] = resolved
            console.print(
                "[dim]Using token from ~/.agenticx/config.yaml (cc_bridge.token) or newly generated; "
                "Machi cc_bridge_* tools use the same value.[/dim]"
            )
    console.print(f"[green]CC bridge listening[/green] http://{host}:{port}")
    console.print(
        "[dim]HTTP clients send Authorization: Bearer <token>. "
        "Match AGX_CC_BRIDGE_TOKEN or cc_bridge.token in config.[/dim]"
    )
    uvicorn.run(
        "agenticx.cc_bridge.http_app:app",
        host=host,
        port=port,
        log_level="info",
    )
