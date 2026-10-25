#!/usr/bin/env python3
"""Shared fixtures for managed-agents tests.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import pytest
import uvicorn

from agenticx.cli.config_manager import ConfigManager
from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import (
    AgentDefinition,
    HostConfig,
    HostConfigError,
    Principal,
    default_environments,
    dev_principal,
)
from agenticx.managed.ids import utc_now_iso
from agenticx.managed.manifest import validate_manifest
from agenticx.managed.protocol import AgentRecord, AgentVersionRecord
from agenticx.managed.spec import compile_spec
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy


@pytest.fixture(autouse=True)
def _isolate_project_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project-config.yaml")
    ConfigManager._invalidate_yaml_cache(None)
    yield
    ConfigManager._invalidate_yaml_cache(None)


@pytest.fixture(autouse=True)
def _disable_effect_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep tool dispatch from writing an effect ledger under the real home."""
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")


@dataclass
class LiveServer:
    """One ``agx ma serve`` test process bound to a free localhost port."""

    base_url: str
    token: str
    app: Any
    loop: asyncio.AbstractEventLoop


def demo_manifest() -> dict[str, Any]:
    """W1 demo manifest with the scripted model substituted for live providers."""
    return {
        "schema": "agx.agent/v1",
        "model": "fake/scripted",
        "system": (
            "You are a test agent. First run bash_exec with the command `echo ma-w1-ok`. "
            'Then call lookup_order with order_id "A-1". '
            "Finally summarize both results in one sentence."
        ),
        "tools": [
            {
                "type": "agx_builtin",
                "default_policy": "always_allow",
                "configs": [{"name": "bash_exec", "policy": "always_ask"}],
            },
            {
                "type": "custom",
                "name": "lookup_order",
                "description": "Look up an order status in the caller's system.",
                "input_schema": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                    "required": ["order_id"],
                },
            },
        ],
        "runtime": {"max_tool_rounds": 8},
    }


def make_config(
    tmp_path: Path,
    *,
    manifest: dict[str, Any] | None = None,
    tokens: dict[str, Principal] | None = None,
    policy: EnterpriseAgentPolicy | None = None,
) -> HostConfig:
    """In-memory dev host config rooted at ``tmp_path``."""
    body = demo_manifest() if manifest is None else manifest
    result = validate_manifest(body)
    if not result.ok or result.normalized is None or result.manifest_hash is None:
        raise HostConfigError("; ".join(result.errors))
    compile_spec("demo", 1, result.normalized)
    now = utc_now_iso()
    record = AgentRecord(
        id="demo",
        tenant_id="dev",
        slug="demo",
        display_name="W1 Demo",
        description=None,
        latest_version=1,
        status="active",
        lifecycle="published",
        origin="enterprise",
        assignment_keys=[],
        worker_keys=[],
        default_environment_id="local",
    )
    version = AgentVersionRecord(
        agent_id="demo",
        version=1,
        manifest=result.normalized,
        manifest_hash=result.manifest_hash,
        created_by=None,
        created_at=now,
        note=None,
    )
    data_dir = Path(tmp_path) / "ma-host"
    data_dir.mkdir(parents=True, exist_ok=True)
    return HostConfig(
        data_dir=data_dir,
        tenant_id="dev",
        tokens={"test-token": dev_principal("dev")} if tokens is None else tokens,
        agents={"demo": AgentDefinition(record=record, versions={1: version})},
        environments=default_environments("dev"),
        enterprise_policy=policy if policy is not None else EnterpriseAgentPolicy(),
        dev=True,
    )


@pytest.fixture
def ma_live_server() -> Iterator[Callable[..., LiveServer]]:
    """Factory: start(config, llm_factory) -> LiveServer on a free port."""
    running: list[tuple[uvicorn.Server, threading.Thread]] = []

    def start(config: HostConfig, llm_factory: Any) -> LiveServer:
        app = create_ma_app(config, llm_factory=llm_factory)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = int(sock.getsockname()[1])
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=port,
                log_level="warning",
                lifespan="on",
            )
        )
        holder: dict[str, asyncio.AbstractEventLoop] = {}

        def _run() -> None:
            async def _serve() -> None:
                holder["loop"] = asyncio.get_running_loop()
                await server.serve()

            asyncio.run(_serve())

        thread = threading.Thread(target=_run, daemon=True, name=f"ma-test-{port}")
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started:
            if not thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError("managed host test server did not start")
            time.sleep(0.05)
        token = next(iter(config.tokens))
        running.append((server, thread))
        return LiveServer(
            base_url=f"http://127.0.0.1:{port}",
            token=token,
            app=app,
            loop=holder["loop"],
        )

    yield start
    for server, thread in running:
        server.should_exit = True
        thread.join(timeout=10)
