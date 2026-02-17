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
import yaml
from pathlib import Path
from typing import Optional, List, Dict

import typer # type: ignore
from rich.console import Console # type: ignore
from rich.panel import Panel # type: ignore
from rich.table import Table # type: ignore

console = Console()
TEMPLATE_ROOT = Path(__file__).resolve().parent / "templates" / "volcengine"
COMMON_TEMPLATE_DIR = TEMPLATE_ROOT / "common"
TEMPLATE_APP_MODE = {
    "basic": "simple",
    "basic_stream": "simple",
    "a2a": "a2a",
    "mcp": "mcp",
    "knowledge": "simple",
}

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


def _render_template(content: str, values: Dict[str, str]) -> str:
    """Render a simple {{key}} template."""
    rendered = content
    for key, value in values.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered


def _write_template(
    template_path: Path,
    output_path: Path,
    values: Dict[str, str],
    overwrite: bool = True,
) -> None:
    """Write one rendered template file."""
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    if output_path.exists() and not overwrite:
        return
    content = template_path.read_text(encoding="utf-8")
    output_path.write_text(_render_template(content, values), encoding="utf-8")


def _scaffold_from_template(
    project_dir: Path,
    template: str,
    project_name: str,
    streaming: bool,
    launch_type: str = "hybrid",
) -> None:
    """Scaffold project files from volcengine templates."""
    template_dir = TEMPLATE_ROOT / template
    if not template_dir.exists():
        raise ValueError(f"Template '{template}' not found in {TEMPLATE_ROOT}")

    values = {
        "agent_name": project_name,
        "agent_module": "agent",
        "agent_var": "agent",
        "app_mode": TEMPLATE_APP_MODE.get(template, "simple"),
        "launch_type": launch_type,
        "python_version": "3.12",
        "dependencies_file": "requirements.txt",
        "model_agent_name": "",
        "model_agent_api_key": "",
    }

    for name in ["agent.py", "README.md", "requirements.txt"]:
        src = template_dir / name
        if src.exists():
            dst = project_dir / name
            if not dst.exists():
                dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    wrapper_template = (
        COMMON_TEMPLATE_DIR / "wrapper_stream.py.tmpl"
        if streaming else
        COMMON_TEMPLATE_DIR / "wrapper_basic.py.tmpl"
    )
    _write_template(wrapper_template, project_dir / "wrapper.py", values, overwrite=False)
    _write_template(
        COMMON_TEMPLATE_DIR / "agentkit.yaml.tmpl",
        project_dir / "agentkit.yaml",
        values,
        overwrite=False,
    )
    _write_template(
        COMMON_TEMPLATE_DIR / "Dockerfile.tmpl",
        project_dir / "Dockerfile",
        values,
        overwrite=False,
    )


@volcengine_app.command("init")
def volcengine_init(
    project_name: str = typer.Option(..., "--name", "-n", help="Project name"),
    template: str = typer.Option(
        "basic",
        "--template",
        "-t",
        help="Template: basic, basic_stream, a2a, mcp, knowledge",
    ),
    directory: str = typer.Option(".", "--dir", "-d", help="Project directory"),
) -> None:
    """Initialize a new AgentKit project from templates."""
    console.print(Panel(
        f"Initializing AgentKit project: [bold]{project_name}[/bold]",
        title="AgenticX -> AgentKit",
    ))

    project_dir = Path(directory) / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    try:
        _scaffold_from_template(
            project_dir=project_dir,
            template=template,
            project_name=project_name,
            streaming=template == "basic_stream",
            launch_type="hybrid",
        )
        console.print(f"[green]Project initialized at:[/green] {project_dir}")
    except Exception as e:
        console.print(f"[red]Initialization failed:[/red] {e}")
        raise typer.Exit(1)


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
    show: bool = typer.Option(
        False, "--show",
        help="Show current configuration"
    ),
) -> None:
    """Configure AgentKit deployment credentials."""
    if show:
        # Display current configuration
        console.print(Panel(
            "Current AgentKit Configuration",
            title="AgenticX -> AgentKit Config",
        ))
        
        table = Table()
        table.add_column("Configuration", style="cyan")
        table.add_column("Value", style="green")
        
        table.add_row(
            "MODEL_AGENT_NAME",
            os.getenv("MODEL_AGENT_NAME") or "[dim]Not set[/dim]"
        )
        table.add_row(
            "MODEL_AGENT_API_KEY",
            "Set" if os.getenv("MODEL_AGENT_API_KEY") else "[dim]Not set[/dim]"
        )
        table.add_row(
            "VOLCENGINE_ACCESS_KEY",
            "Set" if os.getenv("VOLCENGINE_ACCESS_KEY") else "[dim]Not set[/dim]"
        )
        table.add_row(
            "VOLCENGINE_SECRET_KEY",
            "Set" if os.getenv("VOLCENGINE_SECRET_KEY") else "[dim]Not set[/dim]"
        )
        
        console.print(table)
        return
    
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

    # Prefer launch_type from agentkit.yaml in cwd if present (cloud = no local Docker)
    agentkit_yaml = Path.cwd() / "agentkit.yaml"
    if agentkit_yaml.exists():
        try:
            with open(agentkit_yaml, encoding="utf-8") as f:
                cfg = yaml.safe_load(f)
            if cfg and isinstance(cfg.get("common"), dict):
                configured_agent_name = cfg["common"].get("agent_name")
                if isinstance(configured_agent_name, str) and configured_agent_name.strip():
                    agent_name = configured_agent_name.strip()

                launch_type = cfg["common"].get("launch_type")
                if launch_type in ("local", "hybrid", "cloud"):
                    strategy = launch_type
        except Exception:
            pass

    console.print(Panel(
        f"Deploying [bold]{agent_name}[/bold] to AgentKit\n"
        f"Module: {agent_module}, Strategy: {strategy}, Mode: {app_mode}",
        title="AgenticX -> AgentKit Deploy",
    ))

    # Step 1: Prepare project files in-place (no deploy_output)
    try:
        project_dir = Path.cwd()
        if app_mode == "a2a":
            template_key = "a2a"
        elif app_mode == "mcp":
            template_key = "mcp"
        elif app_mode == "knowledge":
            template_key = "knowledge"
        else:
            template_key = "basic_stream" if streaming else "basic"

        _scaffold_from_template(
            project_dir=project_dir,
            template=template_key,
            project_name=agent_name,
            streaming=streaming,
            launch_type=strategy,
        )

        # Ensure module file exists in current directory.
        module_file = project_dir / f"{agent_module}.py"
        if not module_file.exists():
            console.print(
                f"[red]Missing module file:[/red] {module_file}\n"
                "Please run deploy from your agent project directory."
            )
            raise typer.Exit(1)

        console.print("[green]Project files are ready for launch[/green]")

    except Exception as e:
        console.print(f"[red]Project preparation failed:[/red] {e}")
        raise typer.Exit(1)

    # Step 2: Launch via agentkit CLI if available
    if _check_agentkit_installed():
        console.print("[cyan]Launching via agentkit...[/cyan]")
        _run_agentkit_command(["launch"], cwd=".")
    else:
        console.print(
            "[yellow]agentkit CLI not installed.[/yellow]\n"
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
        version = getattr(veadk, "__version__", None) or getattr(veadk, "VERSION", "installed")
        table.add_row("veadk", f"v{version}" if version != "installed" else "Installed")
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
