#!/usr/bin/env python3
"""Shared fixtures for the robot bridge test suite.

Author: Hongyi Zhao
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agx_robot_bridge.app import create_app
from agx_robot_bridge.fake_backend import FakeBackend

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def make_client(tmp_path) -> Iterator[Callable[..., TestClient]]:
    """Build a TestClient around a fresh app; lifespan shutdown runs at teardown."""
    clients: list[TestClient] = []

    def _make(backend_factory: Callable[[], Any] = FakeBackend, *, headers: dict[str, str] | None = None) -> TestClient:
        app = create_app(token=TOKEN, backend_factory=backend_factory, snapshot_dir=tmp_path / "snapshots")
        client = TestClient(app, headers=AUTH if headers is None else headers)
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for client in reversed(clients):
        client.__exit__(None, None, None)


@pytest.fixture
def session_body() -> Callable[..., dict[str, Any]]:
    def _body(**overrides: Any) -> dict[str, Any]:
        robot = {"type": "fake_arm", "port": "/dev/fake0", "id": "arm1", "max_relative_target": 10.0}
        robot.update(overrides.pop("robot", {}))
        body: dict[str, Any] = {
            "robot": robot,
            "policy_path": "/tmp/fake-policy",
            "task": "pick the cube",
            "home_tolerance": 5.0,
        }
        body.update(overrides)
        return body

    return _body


@pytest.fixture
def wait_state() -> Callable[..., dict[str, Any]]:
    def _wait(client: TestClient, sid: str, states: str | Iterable[str], timeout: float = 3.0) -> dict[str, Any]:
        wanted = {states} if isinstance(states, str) else set(states)
        deadline = time.monotonic() + timeout
        last: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            resp = client.get(f"/session/{sid}")
            assert resp.status_code == 200, resp.text
            last = resp.json()
            if last["state"] in wanted:
                return last
            time.sleep(0.02)
        raise AssertionError(f"session {sid} never reached {sorted(wanted)}; last state={last and last['state']}")

    return _wait
