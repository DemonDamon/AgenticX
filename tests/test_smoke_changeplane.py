"""Smoke tests for the read-only ChangePlane adapter (S4).

Author: Damon Li
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from tests.test_smoke_telemetry_query import _write_failed_session

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "changeplane_deployments.json"
_WEBHOOK_OK = {
    "event": "deployment.succeeded",
    "deployment_id": "dep_wh",
    "projectId": "proj_a",
    "status": "ready",
    "summary": "ok",
}


def _load_fixture() -> dict:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _isolate_ops(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTICX_UMODEL_PATH", str(tmp_path / "umodel.json"))
    monkeypatch.setenv("AGENTICX_OPS_CHANGES_PATH", str(tmp_path / "changes.jsonl"))
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))


def _ready_snapshot():
    from agenticx.ops.changeplane.openship import parse_deployment_list

    snaps = parse_deployment_list(_load_fixture())
    assert len(snaps) == 1
    return snaps[0]


class _MemProvider:
    def __init__(self, snapshots) -> None:
        self._snapshots = list(snapshots)

    def list_deployments(self, *, project_id: str = "", limit: int = 50):
        return list(self._snapshots)[:limit]

    def get_deployment(self, deployment_id: str):
        want = str(deployment_id or "").strip()
        for snap in self._snapshots:
            if snap.deployment_id == want:
                return snap
        return None

    def restart(self, deployment_id: str):
        from agenticx.ops.changeplane.types import ACTION_DISABLED, ChangePlaneResult

        return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)

    def rollback(self, deployment_id: str):
        from agenticx.ops.changeplane.types import ACTION_DISABLED, ChangePlaneResult

        return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)

    def redeploy(self, deployment_id: str):
        from agenticx.ops.changeplane.types import ACTION_DISABLED, ChangePlaneResult

        return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)


class _JsonResp:
    def __init__(self, payload, status: int = 200) -> None:
        self.status = status
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> bool:
        return False


def test_null_provider_lists_empty():
    from agenticx.ops.changeplane.provider import NullChangePlaneProvider

    provider = NullChangePlaneProvider()
    assert provider.list_deployments() == []
    assert provider.get_deployment("x") is None


def test_actions_are_disabled_and_do_not_http():
    from agenticx.ops.changeplane.openship import OpenshipProvider
    from agenticx.ops.changeplane.types import ACTION_DISABLED

    provider = OpenshipProvider(base_url="http://127.0.0.1:9", token="t")
    mock_open = MagicMock()
    with patch("agenticx.ops.changeplane.openship.urlopen", mock_open):
        restart = provider.restart("dep_ready")
        rollback = provider.rollback("dep_ready")
        redeploy = provider.redeploy("dep_ready")
    assert restart.ok is False and restart.reason == ACTION_DISABLED
    assert rollback.ok is False and rollback.reason == ACTION_DISABLED
    assert redeploy.ok is False and redeploy.reason == ACTION_DISABLED
    assert mock_open.call_count == 0


def test_parse_deployments_fixture_drops_blank_id():
    from agenticx.ops.changeplane.openship import parse_deployment_list

    snaps = parse_deployment_list(_load_fixture())
    assert len(snaps) == 1
    snap = snaps[0]
    assert snap.deployment_id == "dep_ready"
    assert snap.project_id == "proj_web"
    assert snap.attrs["branch"] == "main"
    assert snap.attrs["previous_deployment_id"] == "dep_old"
    blob = json.dumps(snap.attrs) + snap.summary
    assert "do-not-copy" not in blob
    assert "SECRET" not in blob


def test_openship_list_uses_get_only():
    from agenticx.ops.changeplane.openship import OpenshipProvider

    captured: list = []

    def fake_urlopen(req, timeout=10):
        captured.append(req)
        return _JsonResp(_load_fixture())

    provider = OpenshipProvider(base_url="http://127.0.0.1:9", token="t")
    with patch("agenticx.ops.changeplane.openship.urlopen", fake_urlopen):
        snaps = provider.list_deployments(project_id="proj_web")
    assert len(snaps) == 1
    assert snaps[0].deployment_id == "dep_ready"
    assert len(captured) == 1
    req = captured[0]
    assert req.get_method() == "GET"
    url = req.full_url
    assert "/api/deployments" in url
    assert "projectId=proj_web" in url
    assert req.get_header("Authorization") == "Bearer t"


def test_openship_http_error_is_empty():
    from agenticx.ops.changeplane.openship import OpenshipProvider

    def boom(req, timeout=10):
        raise URLError("down")

    provider = OpenshipProvider(base_url="http://127.0.0.1:9", token="t")
    with patch("agenticx.ops.changeplane.openship.urlopen", boom):
        assert provider.list_deployments() == []
    assert provider.last_reason == "openship_network"


def test_sync_upserts_service_and_deployment(tmp_path, monkeypatch):
    from agenticx.ops.changeplane.sync import sync_deployments
    from agenticx.ops.umodel.store import FileObjectStore

    _isolate_ops(tmp_path, monkeypatch)
    store = FileObjectStore(tmp_path / "umodel.json")
    sync_deployments(_MemProvider([_ready_snapshot()]), store)
    service = store.get("service", "proj_web")
    assert service is not None
    deployment = store.get("deployment", "dep_ready")
    assert deployment is not None
    assert deployment.deployment_id == "dep_ready"
    assert deployment.attrs["source"] == "openship"


def test_sync_empty_provider_writes_nothing(tmp_path, monkeypatch):
    from agenticx.ops.changeplane.provider import NullChangePlaneProvider
    from agenticx.ops.changeplane.sync import sync_deployments
    from agenticx.ops.umodel.store import FileObjectStore

    _isolate_ops(tmp_path, monkeypatch)
    path = tmp_path / "umodel.json"
    store = FileObjectStore(path)
    sync_deployments(NullChangePlaneProvider(), store)
    if not path.is_file():
        return
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw.get("objects") == []


def test_apply_webhook_requires_deployment_id(tmp_path, monkeypatch):
    from agenticx.ops.change_log import default_ops_changes_path
    from agenticx.ops.changeplane.webhook import apply_webhook_payload

    _isolate_ops(tmp_path, monkeypatch)
    assert apply_webhook_payload({}) is None
    path = default_ops_changes_path()
    if path.is_file():
        lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
        assert lines == []
    else:
        assert not path.exists()


def test_apply_webhook_writes_ops_log_and_umodel(tmp_path, monkeypatch):
    from agenticx.ops.change_log import read_ops_change_events
    from agenticx.ops.changeplane.webhook import apply_webhook_payload
    from agenticx.ops.umodel.store import FileObjectStore

    _isolate_ops(tmp_path, monkeypatch)
    event = apply_webhook_payload(dict(_WEBHOOK_OK), store=FileObjectStore(tmp_path / "umodel.json"))
    assert event is not None
    assert event.deployment_id == "dep_wh"
    store = FileObjectStore(tmp_path / "umodel.json")
    assert store.get("deployment", "dep_wh") is not None
    rows = read_ops_change_events(deployment_id="dep_wh")
    assert len(rows) == 1
    assert "deployment.succeeded" in rows[0].action
    assert rows[0].source == "changeplane"


def test_apply_webhook_with_session_id_appends_session_log(tmp_path, monkeypatch):
    from agenticx.ops.changeplane.webhook import apply_webhook_payload
    from agenticx.ops.umodel.store import FileObjectStore

    _isolate_ops(tmp_path, monkeypatch)
    session_dir = _write_failed_session(tmp_path)
    payload = dict(_WEBHOOK_OK)
    payload["session_id"] = "sess-fail"
    apply_webhook_payload(
        payload,
        store=FileObjectStore(tmp_path / "umodel.json"),
        sessions_root=tmp_path / "sessions",
    )
    log = (session_dir / "changes.jsonl").read_text(encoding="utf-8")
    assert "dep_wh" in log


def test_get_recent_changes_by_deployment_id(tmp_path, monkeypatch):
    from agenticx.ops.change_log import record_ops_change_event
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import ChangeEvent, QueryScope

    _isolate_ops(tmp_path, monkeypatch)
    record_ops_change_event(
        ChangeEvent(
            ts=datetime.now(timezone.utc),
            deployment_id="dep_q",
            action="deployment.succeeded",
            summary="ok",
            source="changeplane",
        )
    )
    provider = FirstPartyProvider(sessions_root=tmp_path / "sessions")
    hit = provider.get_recent_changes(QueryScope(deployment_id="dep_q"))
    assert hit.items
    assert hit.reason == ""
    miss = provider.get_recent_changes(QueryScope(deployment_id="other"))
    assert miss.items == []
    assert miss.reason == "no_change_events"


def test_get_recent_changes_session_path_unchanged(tmp_path, monkeypatch):
    from agenticx.ops.first_party import FirstPartyProvider
    from agenticx.ops.query import QueryScope

    _isolate_ops(tmp_path, monkeypatch)
    _write_failed_session(tmp_path)
    result = FirstPartyProvider(sessions_root=tmp_path / "sessions").get_recent_changes(
        QueryScope(session_id="sess-fail")
    )
    assert result.reason == "no_change_events"
    assert result.items == []


def test_webhook_http_disabled_without_secret(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from agenticx.studio.changeplane_routes import mount_changeplane_routes

    _isolate_ops(tmp_path, monkeypatch)
    monkeypatch.delenv("AGENTICX_CHANGEPLANE_WEBHOOK_SECRET", raising=False)
    app = FastAPI()
    mount_changeplane_routes(app)
    resp = TestClient(app).post("/api/ops/changeplane/webhook", json=_WEBHOOK_OK)
    assert resp.status_code == 403
    assert "webhook_disabled" in resp.json().get("reason", "")


def test_webhook_http_accepts_matching_secret(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from agenticx.studio.changeplane_routes import mount_changeplane_routes

    _isolate_ops(tmp_path, monkeypatch)
    monkeypatch.setenv("AGENTICX_CHANGEPLANE_WEBHOOK_SECRET", "s")
    app = FastAPI()
    mount_changeplane_routes(app)
    client = TestClient(app)
    ok = client.post(
        "/api/ops/changeplane/webhook",
        json=_WEBHOOK_OK,
        headers={"X-AgenticX-Webhook-Secret": "s"},
    )
    assert ok.status_code == 200
    assert ok.json().get("deployment_id") == "dep_wh"
    bad = client.post(
        "/api/ops/changeplane/webhook",
        json=_WEBHOOK_OK,
        headers={"X-AgenticX-Webhook-Secret": "nope"},
    )
    assert bad.status_code == 403


def test_sync_changeplane_not_configured(monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    monkeypatch.delenv("AGENTICX_CHANGEPLANE_BASE_URL", raising=False)
    body = json.loads(dispatch_ops_tool("sync_changeplane", {}, session=None))
    assert body["reason"] == "not_configured"
    assert body["items"] == []
    assert body["source"] == "changeplane"


def test_sync_changeplane_description_and_schema():
    from agenticx.ops.tools import OPS_TOOLS

    spec = next(t for t in OPS_TOOLS if t["function"]["name"] == "sync_changeplane")
    desc = spec["function"]["description"]
    assert "Read-only remote" in desc
    assert "Never invent" in desc
    assert "Never restart" in desc
    assert "upsert local umodel" in desc
    params = spec["function"]["parameters"]
    assert params["additionalProperties"] is False
    assert set(params["properties"]) == {"project_id", "session_id", "limit"}


def test_sync_changeplane_omits_token(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _isolate_ops(tmp_path, monkeypatch)
    monkeypatch.setenv("AGENTICX_CHANGEPLANE_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("AGENTICX_CHANGEPLANE_TOKEN", "super-secret-token")

    def fake_urlopen(req, timeout=10):
        return _JsonResp(_load_fixture())

    with patch("agenticx.ops.changeplane.openship.urlopen", fake_urlopen):
        raw = dispatch_ops_tool("sync_changeplane", {"project_id": "proj_web"}, session=None)
    assert "super-secret-token" not in raw
    body = json.loads(raw)
    assert body["items"]
    assert body["items"][0]["deployment_id"] == "dep_ready"
