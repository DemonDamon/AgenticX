#!/usr/bin/env python3
"""W4 memory gate: a later read-only session can read what the writer saved.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from agenticx.managed.host.app import create_ma_app
from agenticx.managed.host.config import Principal
from agenticx.managed.memory import InMemoryMemoryStoreClient, MemoryServiceError
from agenticx.managed.memory_mount import install_memory_mounts
from agenticx.managed.testing import ScriptStep, ScriptedLLM, tool_call
from tests.managed.conftest import make_config

_MANIFEST = {
    "schema": "agx.agent/v1",
    "model": "fake/scripted",
    "system": "Use the tools, then answer.",
    "tools": [{"type": "agx_builtin", "default_policy": "always_allow"}],
    "runtime": {"max_tool_rounds": 8},
}
_NOTE = "周报用中文"


def _prepare(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    config = make_config(
        tmp_path,
        manifest=_MANIFEST,
        tokens={
            "tok-u1": Principal(
                "dev",
                "U1",
                frozenset({"ma:sessions:read", "ma:sessions:write", "ma:memory:write"}),
            ),
            "tok-u2": Principal(
                "dev",
                "U2",
                frozenset({"ma:sessions:read", "ma:sessions:write"}),
            ),
        },
    )
    config.data_dir = home / ".agenticx"
    config.data_dir.mkdir(parents=True, exist_ok=True)
    return home, config


async def _wait(
    client: httpx.AsyncClient, session_id: str, headers: dict[str, str]
) -> None:
    deadline = time.monotonic() + 20
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = await client.get(f"/ma/v1/sessions/{session_id}", headers=headers)
        last = response.json()
        reason = last.get("stop_reason") or {}
        if last.get("status") == "idle" and reason.get("type") == "end_turn":
            return
        await asyncio.sleep(0.05)
    events = await client.get(f"/ma/v1/sessions/{session_id}/events", headers=headers)
    raise AssertionError({"session": last, "events": events.text})


def _tool_text(rows: list[dict[str, Any]], name: str) -> tuple[dict[str, Any], str]:
    uses = {row["id"]: row for row in rows if row.get("type") == "agent.tool_use"}
    for row in rows:
        if row.get("type") != "agent.tool_result":
            continue
        use = uses.get(row.get("tool_use_id"))
        if not use or use.get("name") != name:
            continue
        text = "\n".join(
            block.get("text", "")
            for block in row.get("content") or []
            if isinstance(block, dict)
        )
        return row, text
    raise AssertionError(name)


def _error_text(rows: list[dict[str, Any]]) -> str:
    return "\n".join(
        str((row.get("error") or {}).get("message") or "")
        for row in rows
        if row.get("type") == "session.error"
    )


async def test_w4_memory_gate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home, config = _prepare(tmp_path, monkeypatch)
    memory = InMemoryMemoryStoreClient()
    memory.add_store("S", "Notes")
    scripts: dict[str, list[ScriptStep]] = {}

    class _Factory:
        def __init__(self) -> None:
            self.by_session: dict[str, ScriptedLLM] = {}

        def create(self, *, provider: str, model: str, context: Any) -> ScriptedLLM:
            del provider, model
            existing = self.by_session.get(context.session_id)
            if existing is not None:
                return existing
            llm = ScriptedLLM(scripts[context.session_id])
            self.by_session[context.session_id] = llm
            return llm

    app = create_ma_app(config, llm_factory=_Factory())
    install_memory_mounts(app.state.ma, memory)
    await app.state.ma.startup()
    headers_u1 = {"Authorization": "Bearer tok-u1"}
    headers_u2 = {"Authorization": "Bearer tok-u2"}
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            timeout=30,
            trust_env=False,
        ) as client:
            created_a = await client.post(
                "/ma/v1/sessions",
                headers=headers_u1,
                json={
                    "agent_id": "demo",
                    "resources": [
                        {
                            "type": "memory_store",
                            "memory_store_id": "S",
                            "access": "read_write",
                        }
                    ],
                },
            )
            assert created_a.status_code == 201, created_a.text
            session_a = created_a.json()["id"]
            mount_path = created_a.json()["resources"][0]["mount_path"]
            memory.mount("dev", session_a, "S", "read_write")
            note_path = f"{mount_path}/preferences/report.md"
            scripts[session_a] = [
                ScriptStep(
                    "1",
                    [
                        tool_call(
                            "file_write", {"path": note_path, "content": _NOTE}, "w1"
                        )
                    ],
                ),
                ScriptStep("已记录"),
            ]
            posted = await client.post(
                f"/ma/v1/sessions/{session_a}/events",
                headers=headers_u1,
                json={
                    "events": [
                        {
                            "type": "user.message",
                            "content": [{"type": "text", "text": "记一下"}],
                        }
                    ]
                },
            )
            assert posted.status_code == 200, posted.text
            await _wait(client, session_a, headers_u1)
            saved = memory.get("S", "/preferences/report.md")
            assert saved is not None
            assert saved.content == _NOTE
            owned = [
                row
                for row in memory.versions("S")
                if row["source_session_id"] == session_a
            ]
            assert owned[-1]["operation"] == "created"
            assert _NOTE not in _error_text(
                (
                    await client.get(
                        f"/ma/v1/sessions/{session_a}/events", headers=headers_u1
                    )
                ).json()["data"]
            )

            created_b = await client.post(
                "/ma/v1/sessions",
                headers=headers_u1,
                json={
                    "agent_id": "demo",
                    "resources": [
                        {
                            "type": "memory_store",
                            "memory_store_id": "S",
                            "access": "read_only",
                        }
                    ],
                },
            )
            assert created_b.status_code == 201, created_b.text
            session_b = created_b.json()["id"]
            mount_b = created_b.json()["resources"][0]["mount_path"]
            memory.mount("dev", session_b, "S", "read_only")
            scripts[session_b] = [
                ScriptStep(
                    "1",
                    [
                        tool_call(
                            "file_read",
                            {"path": f"{mount_b}/preferences/report.md"},
                            "r1",
                        )
                    ],
                ),
                ScriptStep("读到了"),
            ]
            posted_b = await client.post(
                f"/ma/v1/sessions/{session_b}/events",
                headers=headers_u1,
                json={
                    "events": [
                        {
                            "type": "user.message",
                            "content": [{"type": "text", "text": "偏好"}],
                        }
                    ]
                },
            )
            assert posted_b.status_code == 200, posted_b.text
            await _wait(client, session_b, headers_u1)
            rows_b = (
                await client.get(
                    f"/ma/v1/sessions/{session_b}/events", headers=headers_u1
                )
            ).json()["data"]
            _result_b, text_b = _tool_text(rows_b, "file_read")
            assert _NOTE in text_b

            created_c = await client.post(
                "/ma/v1/sessions",
                headers=headers_u2,
                json={"agent_id": "demo"},
            )
            assert created_c.status_code == 201, created_c.text
            session_c = created_c.json()["id"]
            absolute = (
                home
                / ".agenticx"
                / "sessions"
                / session_a
                / "work"
                / mount_path
                / "preferences"
                / "report.md"
            )
            scripts[session_c] = [
                ScriptStep(
                    "1", [tool_call("file_read", {"path": str(absolute)}, "r2")]
                ),
                ScriptStep("2", [tool_call("list_files", {"path": "memory"}, "l1")]),
                ScriptStep("done"),
            ]
            posted_c = await client.post(
                f"/ma/v1/sessions/{session_c}/events",
                headers=headers_u2,
                json={
                    "events": [
                        {
                            "type": "user.message",
                            "content": [{"type": "text", "text": "看看"}],
                        }
                    ]
                },
            )
            assert posted_c.status_code == 200, posted_c.text
            await _wait(client, session_c, headers_u2)
            rows_c = (
                await client.get(
                    f"/ma/v1/sessions/{session_c}/events", headers=headers_u2
                )
            ).json()["data"]
            read_c, text_c = _tool_text(rows_c, "file_read")
            assert read_c["is_error"] is True
            assert "another session work directory" in text_c
            _list_c, list_text = _tool_text(rows_c, "list_files")
            assert "report.md" not in list_text
            with pytest.raises(MemoryServiceError) as denied:
                await memory.snapshot("dev", session_c, "S")
            assert denied.value.status == 403
    finally:
        await app.state.ma.shutdown()
