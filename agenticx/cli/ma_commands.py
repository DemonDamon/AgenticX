#!/usr/bin/env python3
"""Managed Agents CLI commands.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path
from typing import Any, Optional

import typer

from agenticx.utils.agx_home import agx_home
from agenticx.cli.ma_client_commands import register_client_commands

ma_app = typer.Typer(name="ma", help="Managed Agents host commands", no_args_is_help=True)
register_client_commands(ma_app)
_DEVICE_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def load_fake_llm_script(path: Path) -> tuple[list[Any], str]:
    """Load a scripted-LLM JSON file. Returns steps and the fallback text."""
    # Deferred: keeps `agx --help` from importing the agent runtime (same convention as `agx serve`).
    from agenticx.managed.host.config import HostConfigError
    from agenticx.managed.testing import ScriptStep, tool_call

    file_path = Path(path)
    try:
        raw = json.loads(file_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("script must be an object")
        steps_raw = raw.get("steps")
        if not isinstance(steps_raw, list):
            raise ValueError("steps must be a list")
        steps: list[ScriptStep] = []
        for item in steps_raw:
            if not isinstance(item, dict) or not isinstance(item.get("content"), str):
                raise ValueError("each step needs string content")
            calls = []
            tool_calls = item.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                raise ValueError("tool_calls must be a list")
            for call in tool_calls:
                if not isinstance(call, dict):
                    raise ValueError("tool call must be an object")
                name = call.get("name")
                call_id = call.get("id")
                arguments = call.get("arguments")
                if not isinstance(name, str) or not isinstance(call_id, str):
                    raise ValueError("tool call needs name and id")
                if not isinstance(arguments, dict):
                    raise ValueError("tool call arguments must be an object")
                calls.append(tool_call(name, arguments, call_id))
            steps.append(ScriptStep(content=item["content"], tool_calls=calls))
        fallback = raw.get("fallback_text", "done")
        if not isinstance(fallback, str):
            raise ValueError("fallback_text must be a string")
    except (OSError, json.JSONDecodeError, ValueError, KeyError, TypeError) as exc:
        raise HostConfigError(f"{file_path}: invalid fake llm script") from exc
    return steps, fallback


@ma_app.command("serve")
def serve(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8092, "--port", "-p"),
    dev: bool = typer.Option(False, "--dev", help="Run the single-tenant development host"),
    agents_file: Path = typer.Option(Path("agents.yaml"), "--agents-file"),
    data_dir: Optional[Path] = typer.Option(None, "--data-dir", help="Default: ~/.agenticx/ma"),
    token: str = typer.Option(
        "",
        "--token",
        help="Static bearer token; default $AGX_MA_DEV_TOKEN or random",
    ),
    fake_llm: Optional[Path] = typer.Option(
        None,
        "--fake-llm",
        help="JSON script for a scripted LLM (demo/testing)",
    ),
    log_level: str = typer.Option("info", "--log-level"),
    enable_tasks: bool = typer.Option(
        False,
        "--enable-tasks",
        help="Enable background tool tasks (MA-A09)",
    ),
    enable_threads: bool = typer.Option(
        False,
        "--enable-threads",
        help="Enable multi-agent member threads (MA-A08)",
    ),
) -> None:
    """Run the Managed Agents host."""
    if not dev:
        print("Only --dev mode is available in this version.")
        raise typer.Exit(2)
    resolved_token = token or os.environ.get("AGX_MA_DEV_TOKEN", "").strip() or secrets.token_urlsafe(24)
    print(f"MA dev token: {resolved_token}")
    # Deferred: keeps `agx --help` from importing the agent runtime (same convention as `agx serve`).
    import uvicorn

    from agenticx.managed.host.app import create_ma_app
    from agenticx.managed.host.config import HostConfigError, build_dev_config
    from agenticx.managed.llm import LocalConfigLLMFactory
    from agenticx.managed.testing import PerSessionScriptFactory

    resolved_dir = data_dir if data_dir is not None else agx_home() / "ma"
    try:
        config = build_dev_config(
            agents_file=agents_file,
            data_dir=resolved_dir,
            token=resolved_token,
        )
        config.tasks_enabled = enable_tasks
        config.threads_enabled = enable_threads
        if fake_llm is not None:
            steps, fallback = load_fake_llm_script(fake_llm)
            llm_factory: Any = PerSessionScriptFactory(steps, fallback_text=fallback)
        else:
            llm_factory = LocalConfigLLMFactory()
    except HostConfigError as exc:
        print(str(exc))
        raise typer.Exit(2) from None
    uvicorn.run(
        create_ma_app(config, llm_factory=llm_factory),
        host=host,
        port=port,
        log_level=log_level,
    )


@ma_app.command("worker")
def worker(
    base_url: str = typer.Option("http://127.0.0.1:8092", "--base-url"),
    token: str = typer.Option(
        "",
        "--token",
        help="Bearer token with ma:worker scope; default $AGX_MA_DEV_TOKEN",
    ),
    environment: list[str] = typer.Option(["worker"], "--environment", "-e"),
    device_id: str = typer.Option(
        "",
        "--device-id",
        help="Default: ma-dev-<random hex>",
    ),
    once: bool = typer.Option(
        False,
        "--once",
        help="Handle at most one work item, then exit",
    ),
    data_dir: Optional[Path] = typer.Option(
        None,
        "--data-dir",
        help="Default: ~/.agenticx/ma-worker",
    ),
    fake_llm: Optional[Path] = typer.Option(None, "--fake-llm"),
) -> None:
    """Run a desktop worker against an ``agx ma serve`` host."""
    resolved_token = token or os.environ.get("AGX_MA_DEV_TOKEN", "").strip()
    if not resolved_token:
        print("missing token: pass --token or set AGX_MA_DEV_TOKEN")
        raise typer.Exit(2)
    resolved_device = device_id or f"ma-dev-{secrets.token_hex(8)}"
    if _DEVICE_RE.fullmatch(resolved_device) is None:
        print("invalid device id")
        raise typer.Exit(2)
    # Deferred: keeps `agx --help` from importing the agent runtime (same convention as `agx serve`).
    import asyncio

    from agenticx.managed.llm import LocalConfigLLMFactory
    from agenticx.managed.protocol import WORK_POLL_MAX_WAIT_SECONDS
    from agenticx.managed.testing import PerSessionScriptFactory
    from agenticx.managed.worker.client import MAWorkerClient
    from agenticx.managed.worker.runner import MAWorker, WorkItemRunner

    if fake_llm is not None:
        steps, fallback = load_fake_llm_script(fake_llm)
        llm_factory: Any = PerSessionScriptFactory(steps, fallback_text=fallback)
    else:
        llm_factory = LocalConfigLLMFactory()
    root = data_dir if data_dir is not None else agx_home() / "ma-worker"
    http_client = MAWorkerClient(base_url, resolved_token)
    item_runner = WorkItemRunner(
        client=http_client,
        device_id=resolved_device,
        llm_factory=llm_factory,
        workdir_root=root / "sessions",
    )
    desktop = MAWorker(
        client=http_client,
        environment_ids=environment,
        device_id=resolved_device,
        runner=item_runner,
    )

    async def _main() -> None:
        try:
            if once:
                await desktop.run_once(max_wait_seconds=WORK_POLL_MAX_WAIT_SECONDS)
            else:
                await desktop.run_forever()
        finally:
            await http_client.aclose()

    asyncio.run(_main())


__all__ = [
    "load_fake_llm_script",
    "ma_app",
    "serve",
    "worker",
]
