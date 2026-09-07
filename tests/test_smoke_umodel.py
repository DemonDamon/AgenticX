"""Smoke tests for UModel v0 schema, file store, ingest, and get_umodel.

Author: Damon Li
"""

from __future__ import annotations

import json

import pytest

from tests.test_smoke_telemetry_query import _write_failed_session, _write_obs_only_session


def test_validate_rejects_unknown_kind():
    from agenticx.ops.umodel.schema import UModelObject, validate_object

    with pytest.raises(ValueError, match="unknown kind"):
        validate_object(UModelObject(kind="gpu_node", id="x"))


def test_validate_session_id_must_match():
    from agenticx.ops.umodel.schema import UModelObject, validate_object

    with pytest.raises(ValueError):
        validate_object(UModelObject(kind="session", id="a", session_id="b"))
    with pytest.raises(ValueError):
        validate_object(
            UModelObject(kind="tool_call", id="c1", tool_call_id="c1", session_id="")
        )
    validate_object(UModelObject(kind="session", id="s1", session_id="s1"))
    validate_object(
        UModelObject(kind="tool_call", id="c1", tool_call_id="c1", session_id="s1")
    )
    validate_object(UModelObject(kind="deployment", id="d1", deployment_id="d1"))


def test_validate_forbids_chat_attr_keys():
    from agenticx.ops.umodel.schema import UModelObject, validate_object

    with pytest.raises(ValueError, match="forbidden attr key"):
        validate_object(
            UModelObject(kind="service", id="svc", attrs={"content": "hello"})
        )


def test_file_store_upsert_get_roundtrip(tmp_path):
    from agenticx.ops.umodel.schema import UModelObject
    from agenticx.ops.umodel.store import FileObjectStore

    store = FileObjectStore(tmp_path / "umodel.json")
    store.upsert(UModelObject(kind="service", id="svc-web", name="web"))
    got = store.get("service", "svc-web")
    assert got is not None
    assert got.id == "svc-web"
    assert got.name == "web"
    store.upsert(UModelObject(kind="service", id="svc-web", name="web-v2"))
    got2 = store.get("service", "svc-web")
    assert got2 is not None
    assert got2.name == "web-v2"
    raw = json.loads((tmp_path / "umodel.json").read_text(encoding="utf-8"))
    assert len(raw["objects"]) == 1


def test_list_does_not_leak_other_tenant(tmp_path):
    from agenticx.ops.query import QueryScope
    from agenticx.ops.umodel.schema import UModelObject
    from agenticx.ops.umodel.store import FileObjectStore

    store = FileObjectStore(tmp_path / "umodel.json")
    store.upsert(
        UModelObject(kind="session", id="s1", session_id="s1", tenant_id="t1")
    )
    store.upsert(
        UModelObject(kind="session", id="s2", session_id="s2", tenant_id="t2")
    )
    items = store.list(QueryScope(session_id="s1", tenant_id="t1"))
    assert [o.id for o in items] == ["s1"]
    leaked = store.list(QueryScope(session_id="s2", tenant_id="t1"))
    assert leaked == []


def test_get_missing_returns_none(tmp_path):
    from agenticx.ops.umodel.store import FileObjectStore

    store = FileObjectStore(tmp_path / "umodel.json")
    assert store.get("session", "nope") is None


def test_ingest_failed_session_writes_session_and_tool_call(tmp_path):
    from agenticx.ops.query import QueryScope
    from agenticx.ops.umodel.ingest import ingest_session
    from agenticx.ops.umodel.store import FileObjectStore

    _write_failed_session(tmp_path)
    store = FileObjectStore(tmp_path / "umodel.json")
    ingest_session("sess-fail", store=store, sessions_root=tmp_path / "sessions")
    items = store.list(QueryScope(session_id="sess-fail"))
    kinds = {o.kind for o in items}
    assert "session" in kinds
    assert any(o.kind == "tool_call" and o.name == "bash_exec" for o in items)
    dumped = json.dumps([o.summary for o in items], ensure_ascii=False)
    assert "deploy please" not in dumped
    for obj in items:
        assert obj.kind != "deployment"
        if obj.kind != "deployment":
            assert obj.summary == ""


def test_ingest_obs_only_writes_tool_calls_from_observations(tmp_path):
    from agenticx.ops.query import QueryScope
    from agenticx.ops.umodel.ingest import ingest_session
    from agenticx.ops.umodel.store import FileObjectStore

    _write_obs_only_session(tmp_path)
    store = FileObjectStore(tmp_path / "umodel.json")
    ingest_session("sess-obs", store=store, sessions_root=tmp_path / "sessions")
    items = store.list(QueryScope(session_id="sess-obs"))
    names = {o.name for o in items if o.kind == "tool_call"}
    assert names & {"file_read", "bash_exec"}


def test_ingest_missing_session_writes_nothing(tmp_path):
    from agenticx.ops.query import QueryScope
    from agenticx.ops.umodel.ingest import ingest_session
    from agenticx.ops.umodel.store import FileObjectStore

    store = FileObjectStore(tmp_path / "umodel.json")
    written = ingest_session("nope", store=store, sessions_root=tmp_path / "sessions")
    assert written == []
    assert store.list(QueryScope(session_id="nope")) == []


def test_ingest_change_event_upserts_deployment(tmp_path):
    from datetime import datetime, timezone

    from agenticx.ops.change_log import record_change_event
    from agenticx.ops.query import ChangeEvent, QueryScope
    from agenticx.ops.umodel.ingest import ingest_session
    from agenticx.ops.umodel.store import FileObjectStore

    session_dir = _write_failed_session(tmp_path)
    record_change_event(
        session_dir,
        ChangeEvent(
            ts=datetime(2026, 9, 7, tzinfo=timezone.utc),
            deployment_id="dep-1",
            action="register",
            summary="manual",
            source="first_party",
        ),
    )
    store = FileObjectStore(tmp_path / "umodel.json")
    ingest_session("sess-fail", store=store, sessions_root=tmp_path / "sessions")
    items = store.list(QueryScope(session_id="sess-fail"))
    session = next(o for o in items if o.kind == "session")
    assert session.deployment_id == "dep-1"
    dep = store.get("deployment", "dep-1")
    assert dep is not None
    assert dep.id == "dep-1"
    assert dep.summary == "manual"


def test_register_deployment_and_optional_service(tmp_path):
    from agenticx.ops.query import QueryScope
    from agenticx.ops.umodel.ingest import register_deployment
    from agenticx.ops.umodel.store import FileObjectStore

    store = FileObjectStore(tmp_path / "umodel.json")
    register_deployment("dep-9", store=store)
    assert store.get("deployment", "dep-9") is not None
    assert store.get("service", "svc-web") is None
    register_deployment("dep-9", store=store, service_id="svc-web")
    svc = store.get("service", "svc-web")
    assert svc is not None
    assert svc.name == "svc-web"
    dep = store.get("deployment", "dep-9")
    assert dep is not None
    assert dep.attrs.get("service_id") == "svc-web"
    # register_deployment does not attach session_id; list by deployment_id.
    listed = store.list(QueryScope(deployment_id="dep-9"), kind="deployment")
    assert [o.id for o in listed] == ["dep-9"]


def test_dispatch_get_umodel_failed_session(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _write_failed_session(tmp_path)
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))
    monkeypatch.setenv("AGENTICX_UMODEL_PATH", str(tmp_path / "umodel.json"))
    monkeypatch.delenv("SIGNOZ_API_URL", raising=False)
    monkeypatch.setenv("AGENTICX_TELEMETRY_BACKEND", "first_party")
    body = json.loads(
        dispatch_ops_tool("get_umodel", {"session_id": "sess-fail"}, session=None)
    )
    assert body["reason"] == ""
    assert body["source"] == "umodel"
    kinds = {it.get("kind") for it in body["items"]}
    assert "session" in kinds
    assert any(it.get("kind") == "tool_call" and it.get("name") == "bash_exec" for it in body["items"])
    raw = json.dumps(body, ensure_ascii=False)
    assert "deploy please" not in raw


def test_dispatch_get_umodel_empty_scope():
    from agenticx.ops.tools import dispatch_ops_tool

    body = json.loads(dispatch_ops_tool("get_umodel", {}, session=None))
    assert body["reason"] == "invalid_scope"
    assert body["items"] == []


def test_dispatch_get_umodel_unknown_kind(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _write_failed_session(tmp_path)
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))
    monkeypatch.setenv("AGENTICX_UMODEL_PATH", str(tmp_path / "umodel.json"))
    body = json.loads(
        dispatch_ops_tool(
            "get_umodel",
            {"session_id": "sess-fail", "kind": "gpu_node"},
            session=None,
        )
    )
    assert body["reason"] == "unknown_kind"
    assert body["items"] == []
