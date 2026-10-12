#!/usr/bin/env python3
"""Tests for chat-side connector management (connectors_store + connector_manage).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from agenticx.runtime import connectors_store as cs

SECRET = "sk-live-SUPERSECRET-123456"


# ---------------------------------------------------------------- primitives


def test_fingerprint_and_sanitize_match_desktop_ts() -> None:
    # Expected values computed with the TS implementations (mcp-remote-config.ts /
    # create-connector-model.ts) so both sides dedupe identically.
    assert cs.credential_fingerprint({"Authorization": "Bearer sk-test-123"}) == "fp-qc4lqqw2nb0a"
    assert cs.credential_fingerprint({"X-API-Key": "密钥😀abc", "Accept": "json"}) == "fp-52qtphnxn43r"
    assert cs.credential_fingerprint({"Accept": "json"}) == ""
    assert cs.sanitize_server_name("我的连接器") == "connector-g3fnph"
    assert cs.sanitize_server_name("My_Conn  X") == "my-conn-x"
    assert cs.sanitize_server_name("😀") == "connector-4lyxu"
    assert cs.template_slug("stub:qingflow") == "qingflow"


def test_normalize_url_for_compare() -> None:
    assert cs.normalize_url_for_compare("Example.COM/mcp/") == "https://example.com/mcp"
    assert cs.normalize_url_for_compare("https://example.com:443/mcp") == "https://example.com/mcp"
    assert cs.normalize_url_for_compare("http://h:8080/x?a=1") == "http://h:8080/x?a=1"


def test_templates_catalog_loads() -> None:
    rows = cs.load_connector_templates()
    ids = {r["id"] for r in rows}
    assert "stub:qingflow" in ids and "native:github" in ids
    assert cs.find_template("stub:qingflow")["create_via"] == "mcp_url"
    assert cs.find_template("native:github")["create_via"] == "ui_native"
    assert cs.find_template("stub:zoom")["create_via"] == "unavailable"


# ---------------------------------------------------------------- dedupe


def _doc_with_foreign() -> Dict[str, Any]:
    return {"mcpServers": {"abc": {"command": "npx", "args": ["x"]}}, "other": 1}


def test_create_custom_never_overwrites_foreign_entry() -> None:
    doc = _doc_with_foreign()
    new_doc, res = cs.upsert_connector(doc, name="abc", url="https://example.com/mcp", auth_style="bearer")
    assert res["ok"] and res["action"] == "created"
    assert res["server_name"] == "abc-2"
    assert new_doc["mcpServers"]["abc"] == {"command": "npx", "args": ["x"]}
    entry = new_doc["mcpServers"]["abc-2"]
    assert entry["_agenticx"]["source"] == "connector"
    assert entry["_agenticx"]["displayName"] == "abc"
    assert entry["_agenticx"]["authStyle"] == "bearer"
    assert "headers" not in entry
    assert new_doc["other"] == 1


def test_create_same_template_returns_exists_then_overwrite_updates_in_place() -> None:
    doc, res = cs.upsert_connector({}, name="轻流", url="https://q.example.com/mcp", template_id="stub:qingflow", auth_style="bearer")
    assert res["server_name"] == "qingflow"
    again_doc, again = cs.upsert_connector(doc, name="轻流2", url="https://q2.example.com/mcp", template_id="stub:qingflow", auth_style="bearer")
    assert again_doc is None and again["error"] == "exists" and again["reason"] == "same_template"
    assert again["existing"]["server_name"] == "qingflow"
    upd_doc, upd = cs.upsert_connector(doc, name="轻流", url="https://q2.example.com/mcp", template_id="stub:qingflow", auth_style="bearer", overwrite=True)
    assert upd["action"] == "updated" and upd["server_name"] == "qingflow"
    assert list(upd_doc["mcpServers"]) == ["qingflow"]
    assert upd_doc["mcpServers"]["qingflow"]["url"] == "https://q2.example.com/mcp"


def test_same_endpoint_dedupes_custom_and_unchanged_is_noop() -> None:
    doc, _ = cs.upsert_connector({}, name="abc", url="https://example.com/mcp/")
    dup_doc, dup = cs.upsert_connector(doc, name="xyz", url="https://EXAMPLE.com/mcp")
    assert dup_doc is None and dup["error"] == "exists" and dup["reason"] == "same_endpoint"
    same_doc, same = cs.upsert_connector(doc, name="abc", url="https://example.com/mcp/", overwrite=True)
    assert same_doc is None and same["action"] == "unchanged"


def test_duplicate_display_name_rejected() -> None:
    doc, _ = cs.upsert_connector({}, name="abc", url="https://a.example.com/mcp")
    _, res = cs.upsert_connector(doc, name="ABC", url="https://b.example.com/mcp")
    assert res == {"ok": False, "error": "duplicate", "name": "ABC"}


def test_invalid_form_and_unknown_template() -> None:
    assert cs.upsert_connector({}, name="", url="https://x")[1]["error"] == "invalid_form"
    assert cs.upsert_connector({}, name="a", url="ftp://x")[1]["field"] == "url"
    assert cs.upsert_connector({}, name="a", url="https://x", template_id="stub:nope")[1]["error"] == "unknown_template"


def test_set_credential_styles_and_public_view_hides_secret() -> None:
    doc, res = cs.upsert_connector({}, name="hdr", url="https://h.example.com/mcp", auth_style="header", header_name="X-Token")
    doc2, res2 = cs.set_connector_credential(doc, server_name=res["server_name"], secret=SECRET)
    assert res2["action"] == "credential_saved"
    assert doc2["mcpServers"]["hdr"]["headers"] == {"X-Token": SECRET}
    doc3, r3 = cs.upsert_connector(doc2, name="q", url="https://q.example.com/mcp", auth_style="query", query_param="key")
    doc4, _ = cs.set_connector_credential(doc3, server_name=r3["server_name"], secret=SECRET)
    assert SECRET in doc4["mcpServers"]["q"]["url"]
    public = [cs.public_instance(i) for i in cs.list_instances(doc4)]
    dumped = json.dumps(public, ensure_ascii=False)
    assert SECRET not in dumped
    assert all(p["has_credential"] for p in public)
    assert "credential_fingerprint" not in dumped


def test_set_credential_same_template_same_credential_clash() -> None:
    doc = {
        "mcpServers": {
            "qingflow": {
                "url": "https://a/mcp",
                "headers": {"Authorization": f"Bearer {SECRET}"},
                "_agenticx": {"source": "connector", "templateId": "stub:qingflow", "displayName": "轻流"},
            },
            "qingflow-b": {
                "url": "https://b/mcp",
                "_agenticx": {"source": "connector", "templateId": "stub:qingflow", "displayName": "轻流B", "authStyle": "bearer"},
            },
        }
    }
    new_doc, res = cs.set_connector_credential(doc, server_name="qingflow-b", secret=SECRET)
    assert new_doc is None and res["error"] == "exists" and res["existing"]["server_name"] == "qingflow"


def test_set_credential_refuses_foreign_entry() -> None:
    _, res = cs.set_connector_credential(_doc_with_foreign(), server_name="abc", secret=SECRET)
    assert res["error"] == "not_found"


def test_write_mcp_doc_atomic_and_private(tmp_path: Path) -> None:
    p = tmp_path / "mcp.json"
    cs.write_mcp_doc({"mcpServers": {}}, p)
    assert json.loads(p.read_text()) == {"mcpServers": {}}
    assert (p.stat().st_mode & 0o777) == 0o600


# ---------------------------------------------------------------- tool


class _FakeGate:
    """Clarify gate double: records the prompt and answers with secret_values."""

    def __init__(self, answer: Dict[str, Any]) -> None:
        self.answer = answer
        self.calls: List[Dict[str, Any]] = []

    async def request_clarification(self, prompt, options=None, allow_free_text=True, context=None):
        self.calls.append({"prompt": prompt, "context": context})
        return dict(self.answer)

    def resolve(self, request_id, answer):  # pragma: no cover - unused
        return True


@pytest.fixture()
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / ".agenticx").mkdir()
    (tmp_path / ".agenticx" / "mcp.json").write_text(json.dumps(_doc_with_foreign()))
    import agenticx.cli.agent_tools as at

    monkeypatch.setattr(at, "load_available_servers", lambda: {})
    return tmp_path


def _session() -> Any:
    return SimpleNamespace(connected_servers=set(), mcp_configs={}, mcp_hub=None)


def _run(coro):
    return asyncio.run(coro)


def test_connector_manage_full_chat_flow_never_echoes_secret(home: Path) -> None:
    from agenticx.cli.agent_tools import _tool_connector_manage

    session = _session()
    tpl = json.loads(_run(_tool_connector_manage({"action": "list_templates", "query": "轻流"}, session)))
    assert tpl["ok"] and tpl["templates"][0]["id"] == "stub:qingflow"

    created = json.loads(
        _run(
            _tool_connector_manage(
                {"action": "create", "name": "abc", "url": "https://example.com/mcp", "auth_style": "bearer"},
                session,
            )
        )
    )
    assert created["ok"] and created["action"] == "created"
    assert created["server_name"] == "abc-2" and created["needs_credential"] is True

    again = json.loads(
        _run(
            _tool_connector_manage(
                {"action": "create", "name": "abc2", "url": "https://example.com/mcp/", "auth_style": "bearer"},
                session,
            )
        )
    )
    assert again["error"] == "exists"

    events: List[Dict[str, Any]] = []

    async def emit(evt):
        events.append(evt)

    from agenticx.runtime.clarify import AsyncClarifyGate

    class Gate(AsyncClarifyGate):
        async def request_clarification(self, prompt, options=None, allow_free_text=True, context=None):
            return {"answer_text": "", "selected_options": ["请输入：已填写（已隐藏）"], "secret_values": {"credential": SECRET}}

    out = _run(
        _tool_connector_manage(
            {"action": "request_credential", "server_name": "abc-2", "credential_label": "Token"},
            session,
            clarify_gate=Gate(),
            emit_event=emit,
        )
    )
    assert SECRET not in out
    assert json.loads(out)["action"] == "credential_saved"
    assert SECRET not in json.dumps(events, ensure_ascii=False)
    req = next(e for e in events if e["type"] == "clarification_required")
    dec = req["data"]["decisions"][0]
    assert dec["input_type"] == "secret" and dec["options"] == []
    assert req["data"]["context"]["kind"] == "connector_credential"
    resp = next(e for e in events if e["type"] == "clarification_response")
    assert resp["data"]["answer"]["secret_fields"] == ["credential"]

    saved = json.loads((home / ".agenticx" / "mcp.json").read_text())
    assert saved["mcpServers"]["abc-2"]["headers"] == {"Authorization": f"Bearer {SECRET}"}
    assert saved["mcpServers"]["abc"] == {"command": "npx", "args": ["x"]}

    listed = _run(_tool_connector_manage({"action": "list_instances"}, session))
    assert SECRET not in listed
    row = json.loads(listed)["instances"][0]
    assert row["server_name"] == "abc-2" and row["has_credential"] is True


def test_connector_manage_credential_skip_and_native_template(home: Path) -> None:
    from agenticx.cli.agent_tools import _tool_connector_manage
    from agenticx.runtime.clarify import AsyncClarifyGate

    session = _session()
    native = json.loads(
        _run(
            _tool_connector_manage(
                {"action": "create", "name": "gh", "url": "https://x/mcp", "template_id": "native:github"}, session
            )
        )
    )
    assert native["error"] == "template_not_creatable_here"

    _run(_tool_connector_manage({"action": "create", "name": "n", "url": "https://n.example.com/mcp", "auth_style": "bearer"}, session))

    class Skip(AsyncClarifyGate):
        async def request_clarification(self, *a, **k):
            return {"answer_text": "", "selected_options": []}

    out = json.loads(
        _run(_tool_connector_manage({"action": "request_credential", "server_name": "n"}, session, clarify_gate=Skip()))
    )
    assert out["error"] == "skipped"
    missing = json.loads(_run(_tool_connector_manage({"action": "verify", "server_name": "zzz"}, session)))
    assert missing["error"] == "not_found"


def test_connector_manage_registered_in_studio_tools() -> None:
    from agenticx.cli.agent_tools import STUDIO_TOOLS

    names = [t["function"]["name"] for t in STUDIO_TOOLS]
    assert "connector_manage" in names
