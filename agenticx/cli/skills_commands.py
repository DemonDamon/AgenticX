#!/usr/bin/env python3
"""Skill registry CLI commands.

Also hosts the Skills over MCP (SEP-2640) host-side commands:
``list --remote`` / ``show`` / ``approve`` / ``revoke`` / ``install skill://``.
They read MCP server entries from ``~/.agenticx/mcp.json`` (``mcpServers``
section, standard format) or ``--mcp-config <path>``.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Awaitable, Callable, List, Optional, TYPE_CHECKING

import typer
from rich.console import Console
from rich.table import Table

if TYPE_CHECKING:
    from agenticx.skills.registry import SkillRegistryClient
    from agenticx.skills.registry import SkillRegistryServer
    from agenticx.skills.remote_provider import RemoteSkillProvider
    from agenticx.tools.remote_v2 import MCPServerConfig

skills_app = typer.Typer(
    name="skills",
    help="Skill registry commands",
    no_args_is_help=True,
)

console = Console()


def _get_registry_client(registry_url: str) -> "SkillRegistryClient":
    from agenticx.skills.registry import SkillRegistryClient

    return SkillRegistryClient(registry_url=registry_url)


# ---------------------------------------------------------------------------
# Skills over MCP (SEP-2640) host-side helpers
# ---------------------------------------------------------------------------


def _load_mcp_server_configs(
    mcp_config: Optional[Path], server: Optional[str]
) -> "List[MCPServerConfig]":
    """Parse ``mcp.json`` (``mcpServers`` section) into server configs."""
    from agenticx.tools.remote_v2 import MCPServerConfig

    path = Path(mcp_config) if mcp_config else (Path.home() / ".agenticx" / "mcp.json")
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        console.print(f"[red]Failed to read MCP config {path}: {exc}[/red]")
        raise typer.Exit(1)
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return []
    configs: "List[MCPServerConfig]" = []
    for name, entry in servers.items():
        if not isinstance(entry, dict):
            continue
        if server and name != server:
            continue
        payload = dict(entry)
        payload["name"] = name
        try:
            configs.append(MCPServerConfig(**payload))
        except Exception as exc:
            console.print(
                f"[yellow]Skipping invalid MCP server entry '{name}': {exc}[/yellow]"
            )
    return configs


async def _run_with_providers(
    configs: "List[MCPServerConfig]",
    action: Callable[["List[RemoteSkillProvider]"], Awaitable[None]],
) -> None:
    """Connect all servers, keep skills-capable ones as providers, run action."""
    from agenticx.skills.remote_provider import RemoteSkillProvider
    from agenticx.tools.remote_v2 import MCPClientV2

    providers: "List[RemoteSkillProvider]" = []
    clients: List[MCPClientV2] = []
    try:
        for cfg in configs:
            client = MCPClientV2(cfg)
            try:
                await client.__aenter__()
            except Exception as exc:
                console.print(
                    f"[yellow]MCP server '{cfg.name}' unreachable: {exc}[/yellow]"
                )
                continue
            clients.append(client)
            if client.supports_skills():
                providers.append(RemoteSkillProvider(client, cfg.name))
            else:
                console.print(
                    f"[dim]MCP server '{cfg.name}' does not declare the skills "
                    "extension; skipped.[/dim]"
                )
        await action(providers)
    finally:
        for client in clients:
            try:
                await client.close()
            except Exception:
                pass


@skills_app.command("list")
def list_skills(
    registry_url: str = typer.Option(
        "http://127.0.0.1:8321",
        "--registry-url",
        help="Registry base URL",
    ),
    remote: bool = typer.Option(
        False,
        "--remote",
        help="Also list skills served by skills-capable MCP servers (Skills over MCP)",
    ),
    mcp_config: Optional[Path] = typer.Option(
        None, "--mcp-config", help="Path to mcp.json (default ~/.agenticx/mcp.json)"
    ),
    server: Optional[str] = typer.Option(
        None, "--server", help="Only use this MCP server from mcp.json"
    ),
) -> None:
    """List local skills and merge remote index if available."""
    from agenticx.tools.skill_bundle import SkillBundleLoader

    loader = SkillBundleLoader(registry_url=registry_url)
    skills = loader.scan()

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Name", style="cyan")
    table.add_column("Description", style="white")
    table.add_column("Location", style="yellow")
    for skill in skills:
        table.add_row(skill.name, skill.description, skill.location)
    console.print(table)
    console.print(f"Total: {len(skills)} skill(s)")

    if not remote:
        return

    async def _list_remote(
        providers: "List[RemoteSkillProvider]",
    ) -> None:
        if not providers:
            console.print(
                "[yellow]No skills-capable MCP server connected.[/yellow]"
            )
            return
        remote_table = Table(show_header=True, header_style="bold magenta")
        remote_table.add_column("Server", style="magenta")
        remote_table.add_column("Name", style="cyan")
        remote_table.add_column("Files", style="green")
        remote_table.add_column("Size", style="yellow")
        remote_table.add_column("Description", style="white")
        total = 0
        for provider in providers:
            try:
                manifests = await provider.list_skills()
            except Exception as exc:
                console.print(
                    f"[yellow]skills/list failed on '{provider.server_id}': {exc}[/yellow]"
                )
                continue
            for manifest in manifests:
                total += 1
                if manifest.is_dynamic:
                    files, size = "dynamic", "-"
                else:
                    files = str(len(manifest.resources or []))
                    size = f"{manifest.total_bytes() // 1024} KiB"
                remote_table.add_row(
                    provider.server_id,
                    manifest.name,
                    files,
                    size,
                    manifest.description,
                )
        console.print(remote_table)
        console.print(f"Remote total: {total} skill(s)")

    configs = _load_mcp_server_configs(mcp_config, server)
    if not configs:
        console.print(
            "No MCP servers configured. Add servers to ~/.agenticx/mcp.json "
            '({"mcpServers": {...}}) or pass --mcp-config.'
        )
        return
    asyncio.run(_run_with_providers(configs, _list_remote))


@skills_app.command("show")
def show_skill(
    uri: str = typer.Argument(..., help="Skill URI (e.g. skill://demo/SKILL.md)"),
    mcp_config: Optional[Path] = typer.Option(
        None, "--mcp-config", help="Path to mcp.json (default ~/.agenticx/mcp.json)"
    ),
    server: Optional[str] = typer.Option(
        None, "--server", help="Only use this MCP server from mcp.json"
    ),
) -> None:
    """Show one remote skill manifest (file list + digests)."""
    from agenticx.skills.manifest import SkillNotFoundError

    async def _show(providers: "List[RemoteSkillProvider]") -> None:
        for provider in providers:
            try:
                manifest = await provider.get_skill(uri)
            except SkillNotFoundError:
                continue
            except Exception as exc:
                console.print(
                    f"[yellow]skills/get failed on '{provider.server_id}': {exc}[/yellow]"
                )
                continue
            console.print(f"[bold]Skill[/bold]: {manifest.name}")
            console.print(f"[bold]Server[/bold]: {provider.server_id}")
            console.print(f"[bold]URI[/bold]: {manifest.uri}")
            console.print(f"[bold]Description[/bold]: {manifest.description}")
            for warning in manifest.check_limits():
                console.print(f"[yellow]{warning}[/yellow]")
            if manifest.is_dynamic:
                console.print("[dim]Manifest: dynamic (generated content)[/dim]")
                return
            table = Table(show_header=True, header_style="bold magenta")
            table.add_column("File", style="cyan")
            table.add_column("Size", style="green")
            table.add_column("Digest", style="white")
            for entry in manifest.resources or []:
                table.add_row(entry.uri, str(entry.size), entry.digest)
            console.print(table)
            console.print(f"Files: {len(manifest.resources or [])}")
            return
        console.print(f"[red]Skill not found on any connected MCP server: {uri}[/red]")
        raise typer.Exit(1)

    configs = _load_mcp_server_configs(mcp_config, server)
    if not configs:
        console.print("[red]No MCP servers configured.[/red]")
        raise typer.Exit(1)
    asyncio.run(_run_with_providers(configs, _show))


@skills_app.command("approve")
def approve_skill(
    uri: str = typer.Argument(..., help="Skill URI (e.g. skill://demo/SKILL.md)"),
    mcp_config: Optional[Path] = typer.Option(
        None, "--mcp-config", help="Path to mcp.json (default ~/.agenticx/mcp.json)"
    ),
    server: Optional[str] = typer.Option(
        None, "--server", help="Only use this MCP server from mcp.json"
    ),
) -> None:
    """Record user consent for a remote skill, bound to its digest set."""
    from agenticx.skills.approval import ApprovalStore
    from agenticx.skills.manifest import SkillNotFoundError

    async def _approve(providers: "List[RemoteSkillProvider]") -> None:
        for provider in providers:
            try:
                manifest = await provider.get_skill(uri)
            except SkillNotFoundError:
                continue
            except Exception as exc:
                console.print(
                    f"[yellow]skills/get failed on '{provider.server_id}': {exc}[/yellow]"
                )
                continue
            if manifest.is_dynamic:
                console.print(
                    "[red]Dynamic skills cannot be approved: their content is "
                    "generated per request and cannot be bound to digests.[/red]"
                )
                raise typer.Exit(1)
            store = ApprovalStore()
            approval = store.grant(provider.server_id, manifest)
            console.print(
                f"Approved skill '{uri}' from server '{provider.server_id}' "
                f"({len(approval.file_digests)} files bound to their digests)."
            )
            return
        console.print(f"[red]Skill not found on any connected MCP server: {uri}[/red]")
        raise typer.Exit(1)

    configs = _load_mcp_server_configs(mcp_config, server)
    if not configs:
        console.print("[red]No MCP servers configured.[/red]")
        raise typer.Exit(1)
    asyncio.run(_run_with_providers(configs, _approve))


@skills_app.command("revoke")
def revoke_skill(
    uri: str = typer.Argument(..., help="Skill URI (e.g. skill://demo/SKILL.md)"),
    server: Optional[str] = typer.Option(
        None, "--server", help="Only revoke the approval from this MCP server"
    ),
) -> None:
    """Remove the approval record(s) bound to a remote skill."""
    from agenticx.skills.approval import ApprovalStore

    store = ApprovalStore()
    approvals = [a for a in store.list_all() if a.skill_uri == uri]
    if server:
        approvals = [a for a in approvals if a.server_id == server]
    if not approvals:
        console.print(f"No approval record found for skill: {uri}")
        return
    for approval in approvals:
        store.revoke(approval.server_id, approval.skill_uri)
        console.print(
            f"Revoked approval for '{uri}' from server '{approval.server_id}'."
        )


@skills_app.command("search")
def search_skills(
    query: str = typer.Argument(..., help="Search query"),
    registry_url: str = typer.Option(
        "http://127.0.0.1:8321",
        "--registry-url",
        help="Registry base URL",
    ),
) -> None:
    """Search skills from remote registry."""
    client = _get_registry_client(registry_url=registry_url)
    entries = client.search(query)
    if not entries:
        console.print(f"No skills found for query: {query}")
        raise typer.Exit(0)

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Name", style="cyan")
    table.add_column("Version", style="green")
    table.add_column("Author", style="yellow")
    table.add_column("Description", style="white")
    for entry in entries:
        table.add_row(entry.name, entry.version, entry.author, entry.description)
    console.print(table)


@skills_app.command("install")
def install_skill(
    name: str = typer.Argument(
        ..., help="Skill name or skill:// URI (Skills over MCP)"
    ),
    registry_url: str = typer.Option(
        "http://127.0.0.1:8321",
        "--registry-url",
        help="Registry base URL",
    ),
    target_dir: Optional[Path] = typer.Option(
        None,
        "--target-dir",
        help="Install root directory",
    ),
    mcp_config: Optional[Path] = typer.Option(
        None, "--mcp-config", help="Path to mcp.json (default ~/.agenticx/mcp.json)"
    ),
    server: Optional[str] = typer.Option(
        None, "--server", help="Only use this MCP server from mcp.json"
    ),
) -> None:
    """Install a skill from remote registry (or a skill:// URI from an MCP server)."""
    if name.startswith("skill://"):
        _install_remote_skill(name, target_dir=target_dir, mcp_config=mcp_config, server=server)
        return
    client = _get_registry_client(registry_url=registry_url)
    installed_path = client.install(name=name, target_dir=target_dir)
    console.print(f"Installed skill '{name}' at: {installed_path}")


def _install_remote_skill(
    uri: str,
    *,
    target_dir: Optional[Path],
    mcp_config: Optional[Path],
    server: Optional[str],
) -> None:
    """Verify + materialize a remote skill, then record the approval."""
    from agenticx.skills.approval import ApprovalStore
    from agenticx.skills.manifest import SkillNotFoundError

    async def _install(providers: "List[RemoteSkillProvider]") -> None:
        for provider in providers:
            try:
                manifest = await provider.get_skill(uri)
            except SkillNotFoundError:
                continue
            except Exception as exc:
                console.print(
                    f"[yellow]skills/get failed on '{provider.server_id}': {exc}[/yellow]"
                )
                continue
            if manifest.is_dynamic:
                console.print(
                    "[red]Dynamic skills cannot be installed: their content is "
                    "generated per request.[/red]"
                )
                raise typer.Exit(1)

            root = target_dir or (Path.home() / ".agenticx" / "skills" / "registry")
            dest = root / manifest.name
            if dest.exists():
                # Same-name governance: never silently replace an existing skill.
                console.print(
                    f"[red]A skill named '{manifest.name}' already exists at "
                    f"{dest}; refusing to replace it. Remove it first or pass "
                    "--target-dir.[/red]"
                )
                raise typer.Exit(1)

            # Reading-point verification for every manifest file.
            root_uri = manifest.uri[: -len("SKILL.md")] if manifest.uri.endswith("SKILL.md") else manifest.uri
            count = 0
            try:
                for file_uri in manifest.file_uris():
                    fetched = await provider.read_file(file_uri, manifest=manifest)
                    relative = file_uri[len(root_uri):].lstrip("/")
                    if not relative or ".." in relative.split("/"):
                        raise ValueError(f"unsafe file URI: {file_uri}")
                    out_path = dest / relative
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_bytes(fetched.content)
                    count += 1
            except Exception as exc:
                console.print(f"[red]Verification failed, install aborted: {exc}[/red]")
                raise typer.Exit(1)

            ApprovalStore().grant(provider.server_id, manifest)
            console.print(
                f"Installed remote skill '{manifest.name}' at {dest} "
                f"({count} files verified, approval bound to digests)."
            )
            return
        console.print(f"[red]Skill not found on any connected MCP server: {uri}[/red]")
        raise typer.Exit(1)

    configs = _load_mcp_server_configs(mcp_config, server)
    if not configs:
        console.print("[red]No MCP servers configured.[/red]")
        raise typer.Exit(1)
    asyncio.run(_run_with_providers(configs, _install))


@skills_app.command("publish")
def publish_skill(
    path: Path = typer.Argument(..., help="Path to SKILL.md or skill directory"),
    registry_url: str = typer.Option(
        "http://127.0.0.1:8321",
        "--registry-url",
        help="Registry base URL",
    ),
    write_token: Optional[str] = typer.Option(
        None,
        "--write-token",
        help="Optional write token for publish/delete APIs",
    ),
) -> None:
    """Publish a skill to remote registry."""
    from agenticx.skills.registry import SkillRegistryClient

    client = SkillRegistryClient(registry_url=registry_url, write_token=write_token)
    entry = client.publish(path)
    console.print(
        f"Published skill '{entry.name}' version '{entry.version}' checksum={entry.checksum}"
    )


@skills_app.command("serve")
def serve_registry(
    port: int = typer.Option(8321, "--port", help="Registry listen port"),
    host: str = typer.Option("127.0.0.1", "--host", help="Registry listen host"),
    storage_path: Optional[Path] = typer.Option(
        None,
        "--storage-path",
        help="Registry JSON storage path",
    ),
    write_token: Optional[str] = typer.Option(
        None,
        "--write-token",
        help="Optional write token for publish/delete APIs",
    ),
) -> None:
    """Run local registry HTTP server."""
    from agenticx.skills.registry import SkillRegistryServer

    server = SkillRegistryServer(
        storage_path=storage_path,
        host=host,
        port=port,
        write_token=write_token,
    )
    console.print(f"Starting registry server on {host}:{port}")
    server.run()


@skills_app.command("uninstall")
def uninstall_skill(
    name: str = typer.Argument(..., help="Skill name"),
    target_dir: Optional[Path] = typer.Option(
        None,
        "--target-dir",
        help="Install root directory",
    ),
) -> None:
    """Uninstall a locally installed registry skill."""
    from agenticx.skills.registry import SkillRegistryClient

    client = SkillRegistryClient()
    removed = client.uninstall(name=name, target_dir=target_dir)
    if removed:
        console.print(f"Removed local skill: {name}")
        return
    console.print(f"Skill not removed (not found or directory not empty): {name}")
