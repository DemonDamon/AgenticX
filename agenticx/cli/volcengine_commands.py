#!/usr/bin/env python3
"""Volcengine AgentKit CLI commands for AgenticX.

Provides sub-commands for initializing, configuring, deploying, invoking,
and managing AgenticX agents on the Volcengine AgentKit platform.

Author: Damon Li
"""

import os
import sys
import shutil
import subprocess
import asyncio
from pathlib import Path
from typing import Optional, List

import typer # type: ignore
from rich.console import Console # type: ignore
from rich.panel import Panel # type: ignore
from rich.table import Table # type: ignore

console = Console()

volcengine_app = typer.Typer(
    name="volcengine",
    help="Volcengine AgentKit deployment commands",
    no_args_is_help=True,
)


@volcengine_app.callback(invoke_without_command=True)
def volcengine_callback(ctx: typer.Context) -> None:
    """Volcengine AgentKit deployment commands."""
    if ctx.invoked_subcommand is None:
        console.print(ctx.get_help())
        raise typer.Exit()


def _check_agentkit_installed() -> bool:
    """Check if agentkit CLI is installed and available."""
    return shutil.which("agentkit") is not None


def _run_agentkit_command(
    args: List[str],
    cwd: Optional[str] = None,
    capture: bool = False,
) -> subprocess.CompletedProcess:
    """Run an agentkit CLI command.

    Args:
        args: Command arguments (e.g., ["init", "my-agent"]).
        cwd: Working directory.
        capture: Whether to capture output.

    Returns:
        CompletedProcess result.

    Raises:
        typer.Exit: If agentkit is not installed.
    """
    if not _check_agentkit_installed():
        console.print(
            "[bold red]Error:[/bold red] agentkit CLI is not installed.\n"
            "Install with: [cyan]pip install agentkit-sdk-python[/cyan]"
        )
        raise typer.Exit(1)

    cmd = ["agentkit"] + args
    console.print(f"[dim]Running: {' '.join(cmd)}[/dim]")

    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=capture,
        text=True,
    )


@volcengine_app.command("init")
def volcengine_init(
    project_name: str = typer.Option(..., "--name", "-n", help="Project name"),
    template: str = typer.Option("basic", "--template", "-t", help="Template: basic, basic_stream, a2a"),
    directory: str = typer.Option(".", "--dir", "-d", help="Project directory"),
) -> None:
    """Initialize a new AgentKit project from AgenticX agent."""
    console.print(Panel(
        f"Initializing AgentKit project: [bold]{project_name}[/bold]",
        title="AgenticX -> AgentKit",
    ))

    project_dir = Path(directory) / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    # Generate deployment artifacts using AgenticX deploy component
    try:
        from agenticx.deploy.components.volcengine.component import VolcEngineComponent
        from agenticx.deploy.types import DeploymentConfig

        config = DeploymentConfig(
            name=project_name,
            component="volcengine",
            props={
                "agent_name": project_name,
                "agent_module": project_name.replace("-", "_"),
                "agent_var": "agent",
                "streaming": template == "basic_stream",
                "output_dir": str(project_dir),
            },
        )

        component = VolcEngineComponent()
        result = asyncio.run(component.deploy(config))

        if result.success:
            console.print(
                f"[green]Project initialized at:[/green] {project_dir}"
            )
            console.print(
                f"[dim]Generated files: "
                f"{', '.join(result.metadata.get('generated_files', []))}[/dim]"
            )
        else:
            console.print(
                f"[red]Initialization failed:[/red] {result.message}"
            )
            raise typer.Exit(1)

    except ImportError as e:
        console.print(f"[red]Import error:[/red] {e}")
        raise typer.Exit(1)

    # Also run agentkit init if available
    if _check_agentkit_installed():
        _run_agentkit_command(
            ["init", project_name, "--template", template],
            cwd=str(project_dir),
        )


@volcengine_app.command("config")
def volcengine_config(
    model_name: Optional[str] = typer.Option(
        None, "--model", "-m",
        help="Model endpoint ID (e.g., ep-xxxxx)"
    ),
    api_key: Optional[str] = typer.Option(
        None, "--api-key", "-k",
        help="Model API key"
    ),
    ak: Optional[str] = typer.Option(
        None, "--ak",
        help="Volcengine Access Key"
    ),
    sk: Optional[str] = typer.Option(
        None, "--sk",
        help="Volcengine Secret Key"
    ),
) -> None:
    """Configure AgentKit deployment credentials."""
    console.print(Panel(
        "Configuring AgentKit deployment",
        title="AgenticX -> AgentKit Config",
    ))

    args = ["config"]

    if model_name:
        args.extend(["-e", f"MODEL_AGENT_NAME={model_name}"])
    if api_key:
        args.extend(["-e", f"MODEL_AGENT_API_KEY={api_key}"])
    if ak:
        args.extend(["-e", f"VOLCENGINE_ACCESS_KEY={ak}"])
    if sk:
        args.extend(["-e", f"VOLCENGINE_SECRET_KEY={sk}"])

    if len(args) == 1:
        # Interactive config
        _run_agentkit_command(args)
    else:
        _run_agentkit_command(args)

    console.print("[green]Configuration updated.[/green]")


@volcengine_app.command("deploy")
def volcengine_deploy(
    agent_module: str = typer.Option(
        ..., "--module", "-m",
        help="Agent Python module path"
    ),
    agent_var: str = typer.Option(
        "agent", "--var", "-v",
        help="Agent variable name in module"
    ),
    strategy: str = typer.Option(
        "hybrid", "--strategy", "-s",
        help="Strategy: local, hybrid, cloud"
    ),
    streaming: bool = typer.Option(
        False, "--stream",
        help="Enable streaming mode"
    ),
    app_mode: str = typer.Option(
        "simple", "--mode",
        help="App mode: simple, mcp, a2a"
    ),
) -> None:
    """Deploy AgenticX agent to Volcengine AgentKit."""
    agent_name = agent_module.replace("_", "-").replace(".", "-")

    console.print(Panel(
        f"Deploying [bold]{agent_name}[/bold] to AgentKit\n"
        f"Module: {agent_module}, Strategy: {strategy}, Mode: {app_mode}",
        title="AgenticX -> AgentKit Deploy",
    ))

    # Step 1: Generate artifacts
    try:
        from agenticx.deploy.components.volcengine.component import VolcEngineComponent
        from agenticx.deploy.types import DeploymentConfig

        config = DeploymentConfig(
            name=agent_name,
            component="volcengine",
            props={
                "agent_name": agent_name,
                "agent_module": agent_module,
                "agent_var": agent_var,
                "strategy": strategy,
                "streaming": streaming,
                "output_dir": "./deploy_output",
            },
        )

        component = VolcEngineComponent()
        result = asyncio.run(component.deploy(config))

        if result.success:
            console.print(
                "[green]Artifacts generated successfully[/green]"
            )
        else:
            console.print(f"[red]Failed:[/red] {result.message}")
            raise typer.Exit(1)

    except Exception as e:
        console.print(f"[red]Artifact generation failed:[/red] {e}")
        raise typer.Exit(1)

    # Step 2: Launch via agentkit CLI if available
    if _check_agentkit_installed():
        console.print("[cyan]Launching via agentkit...[/cyan]")
        _run_agentkit_command(["launch"], cwd="./deploy_output")
    else:
        console.print(
            "[yellow]agentkit CLI not installed.[/yellow]\n"
            "Artifacts are in ./deploy_output/\n"
            "Install agentkit-sdk-python and run 'agentkit launch' manually."
        )


@volcengine_app.command("invoke")
def volcengine_invoke(
    message: str = typer.Argument(..., help="Message to send to agent"),
) -> None:
    """Invoke a deployed agent."""
    _run_agentkit_command(["invoke", message])


@volcengine_app.command("status")
def volcengine_status() -> None:
    """Check deployment status."""
    _run_agentkit_command(["status"])


@volcengine_app.command("destroy")
def volcengine_destroy(
    confirm: bool = typer.Option(
        False, "--yes", "-y",
        help="Skip confirmation"
    ),
) -> None:
    """Destroy deployed agent and clean up resources."""
    if not confirm:
        proceed = typer.confirm("Are you sure you want to destroy the deployment?")
        if not proceed:
            raise typer.Abort()

    _run_agentkit_command(["destroy"])
    console.print("[green]Deployment destroyed.[/green]")


@volcengine_app.command("info")
def volcengine_info() -> None:
    """Show AgentKit integration information."""
    table = Table(title="AgenticX -> AgentKit Integration")
    table.add_column("Component", style="cyan")
    table.add_column("Status", style="green")

    # Check agentkit CLI
    agentkit_installed = _check_agentkit_installed()
    table.add_row(
        "agentkit CLI",
        "Installed" if agentkit_installed else "[red]Not installed[/red]"
    )

    # Check veadk
    try:
        import veadk
        table.add_row("veadk", f"v{veadk.__version__}")
    except ImportError:
        table.add_row("veadk", "[yellow]Not installed[/yellow]")

    # Check ArkProvider
    try:
        from agenticx.llms import ArkLLMProvider
        table.add_row("ArkLLMProvider", "Available")
    except ImportError:
        table.add_row("ArkLLMProvider", "[red]Not available[/red]")

    # Check env vars
    model_name = os.getenv("MODEL_AGENT_NAME", "")
    table.add_row(
        "MODEL_AGENT_NAME",
        model_name or "[dim]Not set[/dim]"
    )
    table.add_row(
        "MODEL_AGENT_API_KEY",
        "Set" if os.getenv("MODEL_AGENT_API_KEY") else "[dim]Not set[/dim]"
    )
    table.add_row(
        "VOLCENGINE_ACCESS_KEY",
        "Set" if os.getenv("VOLCENGINE_ACCESS_KEY") else "[dim]Not set[/dim]"
    )

    console.print(table)
