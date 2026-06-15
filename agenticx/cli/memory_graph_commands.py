#!/usr/bin/env python3
"""CLI commands for memory graph operations.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from agenticx.memory.graph.config import load_memory_graph_config
from agenticx.memory.graph.group_id import resolve_scope_group_id
from agenticx.memory.graph.store import (
    MemoryGraphStore,
    extract_last_turn_messages,
    graphiti_available,
    load_session_messages,
)

console = Console()
memory_graph_app = typer.Typer(name="memory-graph", help="记忆图谱 (Graphiti) 管理", no_args_is_help=True)


def _run(coro):
    return asyncio.run(coro)


@memory_graph_app.command("status")
def memory_graph_status() -> None:
    """Show memory graph ingest status and config."""
    cfg = load_memory_graph_config()
    store = MemoryGraphStore.singleton()
    status = store.get_status()
    table = Table(title="Memory Graph Status")
    table.add_column("Key")
    table.add_column("Value")
    for key in (
        "enabled",
        "graphiti_installed",
        "backend",
        "db_path",
        "pending_jobs",
        "completed_jobs",
        "last_success_at",
        "last_error",
        "node_count",
        "edge_count",
    ):
        table.add_row(key, str(status.get(key, "")))
    console.print(table)
    console.print(f"[dim]default_scope={cfg.default_scope} ingest.auto={cfg.ingest.auto}[/dim]")


@memory_graph_app.command("overview")
def memory_graph_overview(
    scope: Optional[str] = typer.Option(None, help="session | avatar | meta"),
    avatar_id: Optional[str] = typer.Option(None, help="Avatar id for avatar scope"),
    session_id: Optional[str] = typer.Option(None, help="Session id for session scope"),
    group_id: Optional[str] = typer.Option(None, help="Explicit group_id override"),
) -> None:
    """Print overview subgraph JSON."""
    cfg = load_memory_graph_config()
    if not cfg.enabled:
        console.print("[yellow]memory_graph.enabled is false[/yellow]")
        raise typer.Exit(1)
    gid = group_id or resolve_scope_group_id(
        scope=scope,
        avatar_id=avatar_id,
        session_id=session_id,
        default_scope=cfg.default_scope,
    )

    async def _go() -> dict:
        store = MemoryGraphStore.singleton()
        return await store.get_overview(gid)

    data = _run(_go())
    console.print_json(json.dumps(data, ensure_ascii=False))


@memory_graph_app.command("ingest")
def memory_graph_ingest(
    session_id: str = typer.Option(..., help="Session id to ingest"),
    scope: Optional[str] = typer.Option(None, help="Group scope"),
    avatar_id: Optional[str] = typer.Option(None, help="Avatar id"),
    dry_run: bool = typer.Option(False, help="Only print episode body without ingest"),
) -> None:
    """Ingest latest user+assistant turn from session messages.json."""
    cfg = load_memory_graph_config()
    if not cfg.enabled and not dry_run:
        console.print("[yellow]Enable memory_graph.enabled in ~/.agenticx/config.yaml first[/yellow]")
        raise typer.Exit(1)
    if not graphiti_available() and not dry_run:
        console.print("[red]graphiti-core not installed. pip install 'agenticx[graphiti]'[/red]")
        raise typer.Exit(1)

    history = load_session_messages(session_id)
    messages = extract_last_turn_messages(history)
    if not messages:
        console.print("[yellow]No user+assistant pair found in session history[/yellow]")
        raise typer.Exit(1)

    gid = resolve_scope_group_id(
        scope=scope,
        avatar_id=avatar_id,
        session_id=session_id,
        default_scope=cfg.default_scope,
    )

    preview_module = __import__("agenticx.memory.graph.store", fromlist=["_format_episode_body"])
    preview = preview_module._format_episode_body(messages, max_chars=cfg.ingest.max_chars_per_episode)
    console.print(f"[bold]group_id[/bold]: {gid}")
    console.print("[bold]episode preview[/bold]:")
    console.print(preview)
    if dry_run:
        return

    async def _go() -> None:
        store = MemoryGraphStore.singleton()
        try:
            await store.ingest_turn(
                group_id=gid,
                session_id=session_id,
                messages=messages,
            )
        except RuntimeError as exc:
            msg = str(exc)
            if "Could not set lock on file" in msg or "lock on file" in msg.lower():
                console.print(
                    "[red]Kuzu 数据库已被 agx serve 占用。[/red]\n"
                    "请在 Desktop 对话后自动 ingest，或调用 POST /api/memory/graph/ingest；"
                    "不要在与 serve 并行时单独运行 CLI ingest。"
                )
                raise typer.Exit(1) from exc
            raise

    _run(_go())
    console.print("[green]Ingest completed (see memory-graph status)[/green]")


@memory_graph_app.command("rebuild")
def memory_graph_rebuild(
    exclude: list[str] = typer.Option(
        [], "--exclude", "-e", help="Episode uuid(s) to drop while rebuilding"
    ),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation"),
) -> None:
    """Rebuild the Kuzu graph DB, dropping given episodes (Kuzu DELETE SIGSEGV workaround).

    Must be run while no agx serve / Near holds the DB lock (⌘Q Near first).
    A timestamped backup is created automatically.
    """
    cfg = load_memory_graph_config()
    if not cfg.enabled:
        console.print("[yellow]memory_graph.enabled is false[/yellow]")
        raise typer.Exit(1)
    if not graphiti_available():
        console.print("[red]graphiti-core not installed. pip install 'agenticx[graphiti]'[/red]")
        raise typer.Exit(1)
    targets = [str(x).strip() for x in exclude if str(x).strip()]
    if not targets:
        console.print("[yellow]--exclude <uuid> is required[/yellow]")
        raise typer.Exit(1)
    if not yes:
        console.print(
            f"[bold]将重建图谱库并删除 {len(targets)} 条 episode[/bold]：{', '.join(t[:8] + '…' for t in targets)}"
        )
        console.print("[dim]请确认已完全退出 Near（⌘Q）且无 agx serve 在运行。[/dim]")
        if not typer.confirm("继续？"):
            raise typer.Exit(0)

    from agenticx.memory.graph.graph_rebuild import rebuild_graph_excluding_episodes

    async def _go() -> dict:
        return await rebuild_graph_excluding_episodes(targets, cfg=cfg)

    try:
        result = _run(_go())
    except Exception as exc:
        msg = str(exc)
        if "lock on file" in msg.lower():
            console.print(
                "[red]Kuzu 库被占用：请先完全退出 Near（⌘Q）并 pkill -f 'agx serve' 后重试。[/red]"
            )
            raise typer.Exit(1) from exc
        console.print(f"[red]重建失败：{exc}[/red]")
        raise typer.Exit(1) from exc
    console.print(
        f"[green]重建完成[/green] 删除 {len(result.get('deleted') or [])} 条，"
        f"剩余 episode {result.get('remaining')}；备份：{result.get('backup')}"
    )
