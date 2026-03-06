#!/usr/bin/env python3
"""Smoke tests for the evolved hooks system.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenticx.hooks import HookEvent
from agenticx.hooks import clear_hooks
from agenticx.hooks import register_after_llm_call_hook
from agenticx.hooks import register_before_llm_call_hook
from agenticx.hooks import register_after_tool_call_hook
from agenticx.hooks import register_before_tool_call_hook
from agenticx.hooks import trigger_hook_event
from agenticx.hooks.config import load_hook_runtime_config
from agenticx.hooks.config import save_hook_runtime_config
from agenticx.hooks.llm_hooks import LLMCallHookContext
from agenticx.hooks.llm_hooks import execute_after_llm_call_hooks
from agenticx.hooks.llm_hooks import execute_before_llm_call_hooks
from agenticx.hooks.llm_hooks import unregister_after_llm_call_hook
from agenticx.hooks.llm_hooks import unregister_before_llm_call_hook
from agenticx.hooks.loader import discover_hooks
from agenticx.hooks.loader import load_hooks
from agenticx.hooks.status import build_hook_status
from agenticx.hooks.tool_hooks import ToolCallHookContext
from agenticx.hooks.tool_hooks import execute_after_tool_call_hooks
from agenticx.hooks.tool_hooks import execute_before_tool_call_hooks
from agenticx.hooks.tool_hooks import unregister_after_tool_call_hook
from agenticx.hooks.tool_hooks import unregister_before_tool_call_hook
from agenticx.server.webhook import register_webhook_routes


def test_hooks_loader_discovers_workspace_and_bundled(tmp_path: Path):
    workspace_hooks = tmp_path / "hooks" / "demo-hook"
    workspace_hooks.mkdir(parents=True, exist_ok=True)
    (workspace_hooks / "HOOK.yaml").write_text(
        (
            "name: demo-hook\n"
            "description: Demo workspace hook\n"
            "events:\n"
            "  - command:new\n"
            "export: handle\n"
            "enabled: true\n"
        ),
        encoding="utf-8",
    )
    (workspace_hooks / "handler.py").write_text(
        (
            "from agenticx.hooks.types import HookEvent\n\n"
            "async def handle(event: HookEvent):\n"
            "    event.messages.append('workspace-hook-fired')\n"
            "    return True\n"
        ),
        encoding="utf-8",
    )

    entries = discover_hooks(tmp_path)
    names = {entry.name for entry in entries}
    assert "demo-hook" in names
    # Bundled hooks should always be discoverable.
    assert "session-memory" in names
    assert "command-logger" in names
    assert "agent-metrics" in names

    clear_hooks()
    loaded_count = load_hooks(tmp_path)
    assert loaded_count >= 1

    event = HookEvent(type="command", action="new", agent_id="agent-demo")
    result = asyncio.run(trigger_hook_event(event))
    assert result is True
    assert "workspace-hook-fired" in event.messages


def test_legacy_llm_and_tool_hooks_still_work():
    clear_hooks()

    def block_llm(_: LLMCallHookContext) -> bool | None:
        return False

    def rewrite_llm(ctx: LLMCallHookContext) -> str | None:
        if ctx.response:
            return ctx.response + " [rewritten]"
        return None

    def block_tool(_: ToolCallHookContext) -> bool | None:
        return False

    def rewrite_tool(ctx: ToolCallHookContext) -> str | None:
        if ctx.tool_result:
            return ctx.tool_result + " [rewritten]"
        return None

    register_before_llm_call_hook(block_llm)
    register_after_llm_call_hook(rewrite_llm)
    register_before_tool_call_hook(block_tool)
    register_after_tool_call_hook(rewrite_tool)

    llm_ctx = LLMCallHookContext(messages=[{"role": "user", "content": "hi"}], agent_id="a1")
    assert execute_before_llm_call_hooks(llm_ctx) is False
    llm_ctx.response = "base"
    assert execute_after_llm_call_hooks(llm_ctx) == "base [rewritten]"

    tool_ctx = ToolCallHookContext(tool_name="echo", tool_input={"x": 1}, agent_id="a1")
    assert execute_before_tool_call_hooks(tool_ctx) is False
    tool_ctx.tool_result = "result"
    assert execute_after_tool_call_hooks(tool_ctx) == "result [rewritten]"

    assert unregister_before_llm_call_hook(block_llm) is True
    assert unregister_after_llm_call_hook(rewrite_llm) is True
    assert unregister_before_tool_call_hook(block_tool) is True
    assert unregister_after_tool_call_hook(rewrite_tool) is True


def test_webhook_routes_auth_and_execution():
    app = FastAPI()
    wake_payloads: list[dict] = []
    agent_payloads: list[dict] = []

    async def wake_handler(payload: dict) -> None:
        wake_payloads.append(payload)

    async def agent_handler(payload: dict) -> None:
        agent_payloads.append(payload)

    register_webhook_routes(
        app=app,
        token="secret-token",
        wake_handler=wake_handler,
        agent_handler=agent_handler,
    )

    client = TestClient(app)

    bad_resp = client.post("/hooks/wake", json={"text": "hello"})
    assert bad_resp.status_code == 401

    wake_resp = client.post(
        "/hooks/wake",
        headers={"Authorization": "Bearer secret-token"},
        json={"text": "hello"},
    )
    assert wake_resp.status_code == 200
    assert len(wake_payloads) == 1

    agent_resp = client.post(
        "/hooks/agent",
        headers={"x-agenticx-token": "secret-token"},
        json={"message": "run"},
    )
    assert agent_resp.status_code == 200
    assert len(agent_payloads) == 1


def test_hooks_runtime_config_and_status(tmp_path: Path):
    config_path = tmp_path / "hooks-config.yaml"
    saved = save_hook_runtime_config(
        {
            "internal": {
                "enabled": True,
                "entries": {
                    "command-logger": {"enabled": False},
                },
            }
        },
        path=config_path,
    )
    assert saved.exists()
    loaded = load_hook_runtime_config(path=config_path)
    assert loaded["internal"]["entries"]["command-logger"]["enabled"] is False

    status = build_hook_status(tmp_path, config=loaded)
    assert isinstance(status, list)

