#!/usr/bin/env python3
"""Skill registry CLI commands.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from agenticx.skills.registry import SkillRegistryClient
from agenticx.skills.registry import SkillRegistryServer
from agenticx.tools.skill_bundle import SkillBundleLoader

skills_app = typer.Typer(
    name="skills",
    help="Skill registry commands",
    no_args_is_help=True,
)

console = Console()


def _get_registry_client(registry_url: str) -> SkillRegistryClient:
    return SkillRegistryClient(registry_url=registry_url)


@skills_app.command("list")
def list_skills(
    registry_url: str = typer.Option(
        "http://127.0.0.1:8321",
        "--registry-url",
        help="Registry base URL",
    ),
) -> None:
    """List local skills and merge remote index if available."""
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
    name: str = typer.Argument(..., help="Skill name"),
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
) -> None:
    """Install a skill from remote registry."""
    client = _get_registry_client(registry_url=registry_url)
    installed_path = client.install(name=name, target_dir=target_dir)
    console.print(f"Installed skill '{name}' at: {installed_path}")


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
    client = SkillRegistryClient()
    removed = client.uninstall(name=name, target_dir=target_dir)
    if removed:
        console.print(f"Removed local skill: {name}")
        return
    console.print(f"Skill not removed (not found or directory not empty): {name}")
