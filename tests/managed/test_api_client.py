#!/usr/bin/env python3
"""Framework /ma/v1 client against recorded HTTP fixtures.

Author: Damon Li
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import httpx
import pytest

from agenticx.managed.api_client import MAApiClient, MAApiError, MAEndpoints
from agenticx.managed.sse import SseMessage, aiter_sse, iter_sse

_CASES = json.loads(
    (
        Path(__file__).resolve().parents[2] / "tests/fixtures/managed_agents/client_cases.json"
    ).read_text(encoding="utf-8")
)
Handler = Callable[[httpx.Request], httpx.Response]


def _client(
    handler: Handler,
    *,
    base: str = "https://ent.example.com",
    control: str | None = None,
    runtime: str | None = None,
    token: str = "agx-pat-t",
) -> MAApiClient:
    http = httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)
    return MAApiClient(MAEndpoints.resolve(base, control, runtime), token, http=http)


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
    assert all(item.headers["authorization"] == "Bearer agx-pat-t" for item in seen)


def test_invalid_token() -> None:
    with pytest.raises(MAApiError) as caught:
        MAApiClient(MAEndpoints.resolve("https://ent.example.com"), "abc")
    assert caught.value.status == 0
    assert caught.value.code == "invalid_token"


def test_create_version_and_conflict() -> None:
    client = _client(lambda _request: httpx.Response(201, json=_CASES["version_created"]))
    version, created = client.create_version(
        "01JAGENT0000000000000000AA",
        manifest={},
        expected_latest_version=2,
        note=None,
    )
    assert created is True
    assert version["version"] == 3

    conflict = _client(lambda _request: httpx.Response(409, json=_CASES["error_conflict"]))
    with pytest.raises(MAApiError) as caught:
        conflict.create_version(
            "01JAGENT0000000000000000AA",
            manifest={},
            expected_latest_version=2,
            note=None,
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
    assert "last-event-id" not in seen[0].headers
    assert seen[1].headers["last-event-id"] == "3"


def test_repr_omits_token() -> None:
    token = "agx-pat-super-secret" # gitleaks:allow
    client = _client(lambda _request: httpx.Response(200, json={"data": []}), token=token)
    assert token not in repr(client)


async def _iterate(raw: str) -> list[SseMessage]:
    async def lines() -> AsyncIterator[str]:
        for line in raw.splitlines(keepends=True):
            yield line

    return [item async for item in aiter_sse(lines())]


async def test_iter_sse_matches_aiter_sse() -> None:
    samples = [
        _CASES["stream_part1"],
        "data: hello\ndata: world\n\n",
        _CASES["stream_part1"].replace("\n", "\r\n"),
    ]
    for raw in samples:
        lines = raw.splitlines(keepends=True)
        assert list(iter_sse(iter(lines))) == await _iterate(raw)
    parsed = list(iter_sse(iter(_CASES["stream_part1"].splitlines(keepends=True))))
    assert [item.id for item in parsed] == ["2", None, "3"]
