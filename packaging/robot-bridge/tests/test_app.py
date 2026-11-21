#!/usr/bin/env python3
"""HTTP contract tests: auth, single session, safety limits, snapshots.

Author: Hongyi Zhao
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from agx_robot_bridge import __version__


def test_max_relative_target_required(make_client, session_body):
    client = make_client()
    resp = client.post("/session", json=session_body(robot={"max_relative_target": None}))
    assert resp.status_code == 400
    body = resp.json()
    assert body["ok"] is False and body["error_code"] == "max_relative_target_required"


def test_auth(make_client):
    anonymous = make_client(headers={})
    resp = anonymous.get("/health")
    assert resp.status_code == 401
    assert resp.json() == {
        "ok": False,
        "error_code": "unauthorized",
        "error": "invalid or missing bearer token",
        "hint": "",
    }
    assert anonymous.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert anonymous.get("/health", headers={"Authorization": "test-token"}).status_code == 401
    assert anonymous.post("/session", json={}).status_code == 401

    client = make_client()
    health = client.get("/health")
    assert health.status_code == 200
    data = health.json()
    assert data["ok"] is True and data["version"] == __version__ and data["backend"] == "fake"
    assert data["python"] and "lerobot_version" in data


def test_api_docs_are_disabled(make_client):
    client = make_client()
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_single_active_session(make_client, session_body, wait_state):
    client = make_client()
    first = client.post("/session", json=session_body()).json()["session_id"]
    wait_state(client, first, "idle")

    blocked = client.post("/session", json=session_body())
    assert blocked.status_code == 409
    assert blocked.json()["error_code"] == "session_active" and first in blocked.json()["hint"]

    assert client.post(f"/session/{first}/stop").status_code == 200
    again = client.post("/session", json=session_body())
    assert again.status_code == 202 and again.json()["session_id"] != first


def test_unknown_session_is_404(make_client, session_body, wait_state):
    client = make_client()
    assert client.get("/session/rs-nope").status_code == 404
    sid = client.post("/session", json=session_body()).json()["session_id"]
    wait_state(client, sid, "idle")
    resp = client.post("/session/rs-other/stop")
    assert resp.status_code == 404 and resp.json()["error_code"] == "not_found"


def test_blank_fields_rejected(make_client, session_body):
    client = make_client()
    assert client.post("/session", json=session_body(task="   ")).status_code == 422
    assert client.post("/session", json=session_body(policy_path="")).status_code == 422
    assert client.post("/session", json=session_body(robot={"type": " "})).status_code == 422


def test_snapshot_png(make_client, session_body, wait_state):
    client = make_client()
    sid = client.post("/session", json=session_body()).json()["session_id"]
    wait_state(client, sid, "idle")

    resp = client.get(f"/session/{sid}/snapshot")
    assert resp.status_code == 200, resp.text
    snap = resp.json()
    image = Image.open(io.BytesIO(base64.b64decode(snap["png_base64"])))
    assert image.format == "PNG" and image.size == (640, 480)
    assert snap["width"] == 640 and snap["height"] == 480 and snap["camera"] == "front"
    assert Path(snap["path"]).is_file()
    assert Path(snap["path"]).name.startswith(f"{sid}_")

    missing = client.get(f"/session/{sid}/snapshot", params={"camera": "nope"})
    assert missing.status_code == 404 and missing.json()["error_code"] == "no_camera"

    client.post(f"/session/{sid}/stop")
    after = client.get(f"/session/{sid}/snapshot")
    assert after.status_code == 409 and after.json()["error_code"] == "invalid_state"


def test_lifespan_shutdown_stops_active_session(make_client, session_body, wait_state):
    client = make_client()
    sid = client.post("/session", json=session_body()).json()["session_id"]
    wait_state(client, sid, "idle")
    session = client.app.state.manager.current
    client.__exit__(None, None, None)
    assert session.torn_down is True
    assert session.status()["state"] == "stopped"
