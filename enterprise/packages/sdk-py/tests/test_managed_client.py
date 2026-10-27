#!/usr/bin/env python3
"""Independent Python SDK client. Must not import the agenticx package.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from agenticx_sdk.managed import MAApiError, MAEndpoints, ManagedAgentsClient

_ROOT = Path(__file__).resolve().parents[4]
_CASES = json.loads(
    (_ROOT / "tests" / "fixtures" / "managed_agents" / "client_cases.json").read_text(encoding="utf-8")
)
Handler = Callable[[httpx.Request], httpx.Response]


def _client(
    handler: Handler,
    *,
    base: str = "https://ent.example.com",
    control: str | None = None,
    runtime: str | None = None,
    token: str = "agx-pat-t",
) -> ManagedAgentsClient:
    http = httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)
    return ManagedAgentsClient(MAEndpoints.resolve(base, control, runtime), token, http=http)


def test_routes_control_and_runtime() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/agents"):
            return httpx.Response(200, json={"data": []})
        return httpx.Response(200, json={"id": "S", "status": "idle"})

    client = _client(handler)
    assert client.list_agents() == []
    assert str(seen[0].url) == "https://ent.example.com/ma/v1/agents"
    assert seen[0].headers["authorization"] == "Bearer agx-pat-t"

    seen.clear()
    split = _client(
        handler,
        base="http://127.0.0.1",
        control="http://127.0.0.1:3001/api",
        runtime="http://127.0.0.1:8092",
    )
    split.list_agents()
    assert split.get_session("S")["id"] == "S"
    assert str(seen[0].url) == "http://127.0.0.1:3001/api/ma/v1/agents"
    assert str(seen[1].url) == "http://127.0.0.1:8092/ma/v1/sessions/S"


def test_create_version_and_conflict() -> None:
    client = _client(lambda _request: httpx.Response(201, json=_CASES["version_created"]))
    version, created = client.create_version(
        "01JAGENT0000000000000000AA",
        manifest={},
        expected_latest_version=2,
    )
    assert created is True
    assert version["version"] == 3

    conflict = _client(lambda _request: httpx.Response(409, json=_CASES["error_conflict"]))
    with pytest.raises(MAApiError) as caught:
        conflict.create_version(
            "01JAGENT0000000000000000AA",
            manifest={},
            expected_latest_version=2,
        )
    assert caught.value.status == 409
    assert caught.value.code == "agent_version_conflict"
    assert caught.value.details is not None
    assert caught.value.details["current_latest_version"] == 3


def test_iter_events_resumes_without_duplicates() -> None:
    parts = [_CASES["stream_part1"], _CASES["stream_part2"]]
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if len(seen) > len(parts):
            return httpx.Response(500, text="extra")
        return httpx.Response(200, text=parts[len(seen) - 1])

    client = _client(handler)
    events = list(client.iter_events("S", until_idle=True, sleep=lambda _delay: None))
    assert [event["seq"] for event in events] == [2, 3, 4]
    assert len(seen) == 2
    assert seen[1].headers["last-event-id"] == "3"


def test_import_does_not_load_agenticx() -> None:
    src = Path(__file__).resolve().parents[1] / "src"
    code = (
        "import sys\n"
        f"sys.path.insert(0, {str(src)!r})\n"
        "import agenticx_sdk.managed\n"
        "assert 'agenticx' not in sys.modules\n"
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = str(src)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(
        [sys.executable, "-I", "-c", code],
        cwd=src,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
