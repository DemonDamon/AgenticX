#!/usr/bin/env python3
"""Session-level sticky allow for low-risk tool confirmations.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

from agenticx.cli.agent_tools import _confirm
from agenticx.studio.server import create_studio_app


def _new_session(client: TestClient, app: Any):
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id)
    assert managed is not None
    return session_id, managed


async def _confirm_with_ui(
    client: TestClient,
    managed: Any,
    session_id: str,
    context: Dict[str, Any],
    *,
    approved: bool = True,
    remember: Optional[str] = None,
    prompts: List[str],
) -> bool:
    """Run ``_confirm``; the fake UI answers via the real /api/confirm route."""

    async def emit(event: Dict[str, Any]) -> None:
        if event["type"] != "confirm_required":
            return
        data = event["data"]
        prompts.append(data["id"])
        body: Dict[str, Any] = {
            "session_id": session_id,
            "request_id": data["id"],
            "approved": approved,
        }
        if remember:
            body["remember"] = remember
        resp = client.post("/api/confirm", json=body)
        assert resp.status_code == 200, resp.text

    return await _confirm(
        "ok?",
        confirm_gate=managed.confirm_gate,
        context=context,
        emit_event=emit,
        session=managed.studio_session,
    )


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setattr(
        "agenticx.cli.agent_tools.tool_allowed_without_confirm", lambda *_a, **_k: False
    )
    app = create_studio_app()
    return app, TestClient(app)


def test_sticky_low_risk_skips_prompt(env) -> None:
    app, client = env
    session_id, managed = _new_session(client, app)
    prompts: List[str] = []
    ctx = {"tool": "file_write", "risk": "low"}

    async def run():
        first = await _confirm_with_ui(
            client, managed, session_id, dict(ctx), remember="session", prompts=prompts
        )
        second = await _confirm_with_ui(client, managed, session_id, dict(ctx), prompts=prompts)
        return first, second

    first, second = asyncio.run(run())
    assert first is True and second is True
    assert len(prompts) == 1
    assert "file_write" in managed.studio_session.sticky_allowed_tools


@pytest.mark.parametrize("risk", ["high", "destructive", "computer_use", None])
def test_protected_never_sticky(env, risk) -> None:
    app, client = env
    session_id, managed = _new_session(client, app)
    prompts: List[str] = []
    ctx: Dict[str, Any] = {"tool": "bash_exec"}
    if risk is not None:
        ctx["risk"] = risk

    async def run():
        await _confirm_with_ui(
            client, managed, session_id, dict(ctx), remember="session", prompts=prompts
        )
        await _confirm_with_ui(client, managed, session_id, dict(ctx), prompts=prompts)

    asyncio.run(run())
    assert managed.studio_session.sticky_allowed_tools == set()
    assert len(prompts) == 2


def test_sticky_is_per_session(env) -> None:
    app, client = env
    sid_a, managed_a = _new_session(client, app)
    sid_b, managed_b = _new_session(client, app)
    assert sid_a != sid_b or managed_a is not managed_b
    prompts: List[str] = []
    ctx = {"tool": "file_edit", "risk": "low"}

    async def run():
        await _confirm_with_ui(
            client, managed_a, sid_a, dict(ctx), remember="session", prompts=prompts
        )
        await _confirm_with_ui(client, managed_b, sid_b, dict(ctx), prompts=prompts)

    asyncio.run(run())
    assert managed_b.studio_session.sticky_allowed_tools == set()
    assert len(prompts) == 2


def test_sticky_only_referenced_in_confirm_paths() -> None:
    root = Path(__file__).resolve().parents[1] / "agenticx"
    hits = set()
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"sticky_allowed_tools", text):
            hits.add(path.relative_to(root).as_posix())
    assert hits == {"cli/agent_tools.py", "cli/studio.py", "studio/server.py"}
