#!/usr/bin/env python3
"""Regression: cc_bridge_send routes by session_id mode, not global cc_bridge.mode."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

from agenticx.cli import agent_tools as at
from agenticx.cli.studio import StudioSession


def _detail_json(mode: str, sid: str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -> str:
    return json.dumps(
        {
            "session_id": sid,
            "cwd": "/tmp",
            "pid": 1,
            "poll": None,
            "log_path": "",
            "mode": mode,
            "state": "running",
            "interactive_waiting": mode == "visible_tui",
        }
    )


@pytest.mark.asyncio
async def test_send_uses_message_for_headless_even_if_global_would_be_visible(monkeypatch: pytest.MonkeyPatch) -> None:
    """Authoritative GET /v1/sessions/{id} says headless -> POST /message, never /write."""
    calls: List[Tuple[str, str]] = []

    async def fake_http(
        session: StudioSession,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        *,
        timeout_sec: float = 300.0,
    ) -> str:
        _ = session, json_body, timeout_sec
        calls.append((method, path))
        if method == "GET" and path.startswith("/v1/sessions/"):
            return _detail_json("headless")
        if method == "POST" and path.endswith("/message"):
            return json.dumps({"ok": True, "tail": "done", "mode": "headless"})
        return "ERROR: unexpected"

    monkeypatch.setattr(at, "_tool_cc_bridge_http", fake_http)
    out = await at._tool_cc_bridge_send(
        {"session_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "prompt": "hi"},
        StudioSession(),
    )
    assert "done" in out or '"ok": true' in out.lower()
    paths = [p for _, p in calls]
    assert any(p.endswith("/message") for p in paths)
    assert all("/write" not in p for p in paths)


@pytest.mark.asyncio
async def test_send_visible_tui_uses_write(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[Tuple[str, str]] = []

    async def fake_http(
        session: StudioSession,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        *,
        timeout_sec: float = 300.0,
    ) -> str:
        _ = session, json_body, timeout_sec
        calls.append((method, path))
        if method == "GET" and path.startswith("/v1/sessions/"):
            return _detail_json("visible_tui")
        if method == "POST" and path.endswith("/write"):
            return json.dumps({"status": "ok"})
        return "ERROR: unexpected"

    monkeypatch.setattr(at, "_tool_cc_bridge_http", fake_http)
    out = await at._tool_cc_bridge_send(
        {"session_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "prompt": "hi"},
        StudioSession(),
    )
    assert "visible_tui" in out
    paths = [p for _, p in calls]
    assert any("/write" in p for p in paths)


@pytest.mark.asyncio
async def test_send_write_mismatch_falls_back_to_message_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """If /write returns headless-only error, retry /message once with mode_corrected."""

    async def fake_http(
        session: StudioSession,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        *,
        timeout_sec: float = 300.0,
    ) -> str:
        _ = session, json_body, timeout_sec
        if method == "GET" and path.startswith("/v1/sessions/"):
            return _detail_json("visible_tui")
        if method == "POST" and path.endswith("/write"):
            return 'ERROR: bridge 400: {"detail":"write is only for visible_tui sessions"}'
        if method == "POST" and path.endswith("/message"):
            return json.dumps({"ok": True, "tail": "recovered", "mode": "headless"})
        return "ERROR: unexpected"

    monkeypatch.setattr(at, "_tool_cc_bridge_http", fake_http)
    out = await at._tool_cc_bridge_send(
        {"session_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "prompt": "hi"},
        StudioSession(),
    )
    obj = json.loads(out)
    assert obj.get("mode_corrected") is True
    assert obj.get("ok") is True
