"""connector_manage → local connector gateway (real Go binary) end to end:
REST via OpenAPI + bearer, HMAC AK/SK, OAuth client_credentials, OAuth
authorization_code (PKCE, simulated browser), dedupe, secrets never echoed,
dead proxy env does not matter for local targets."""

from __future__ import annotations

import asyncio
import json
import socket
import sys
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent / "fixtures"))
from mock_rest_upstream import AK, BEARER, CLIENT_ID, CLIENT_SECRET, SK, MockUpstream  # noqa: E402

from agenticx.connectors import gateway_client as gc  # noqa: E402

BIN = gc.binary_path()
pytestmark = pytest.mark.skipif(BIN is None, reason="connector-runtime binary not built")


class _Gate:
    def __init__(self, values: Dict[str, str]):
        self.values = values
        self.contexts: List[Any] = []

    async def request_clarification(self, prompt, options=None, allow_free_text=True, context=None):
        self.contexts.append(context)
        return {"answer_text": "", "selected_options": [], "secret_values": dict(self.values)}

    def resolve(self, *a):  # pragma: no cover
        return True


def _dead_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture(params=["proxy_on_dead", "proxy_off"])
def env(request, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from agenticx.utils import proxy_policy

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("AGX_CONNECTOR_RUNTIME_DIR", str(tmp_path / "gw"))
    monkeypatch.setenv("AGX_CONNECTOR_RUNTIME_BIN", str(BIN))
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        monkeypatch.delenv(k, raising=False)
    if request.param == "proxy_on_dead":
        dead = f"http://127.0.0.1:{_dead_port()}"
        monkeypatch.setenv("HTTP_PROXY", dead)
        monkeypatch.setenv("HTTPS_PROXY", dead)
        monkeypatch.setattr(urllib.request, "getproxies", lambda: {"http": dead, "https": dead})
    else:
        monkeypatch.setattr(urllib.request, "getproxies", lambda: {})
    proxy_policy.reset_probe_cache()
    (tmp_path / ".agenticx").mkdir()
    (tmp_path / ".agenticx" / "mcp.json").write_text(json.dumps({"mcpServers": {"connector-runtime": {"url": "https://gw.corp.example/mcp"}}}))
    import agenticx.cli.agent_tools as at

    monkeypatch.setattr(at, "load_available_servers", lambda: {})
    up = MockUpstream().start()
    yield SimpleNamespace(home=tmp_path, up=up)
    up.stop()
    gc.stop_spawned_gateway()


def _run(coro):
    return asyncio.run(coro)


def _tool(args, gate=None, events=None):
    from agenticx.cli.agent_tools import _tool_connector_manage

    async def emit(e):
        if events is not None:
            events.append(e)

    s = SimpleNamespace(connected_servers=set(), mcp_configs={}, mcp_hub=None)
    return _run(_tool_connector_manage(args, s, clarify_gate=gate, emit_event=emit))


def _mcp_call(home: Path, tool: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    doc = json.loads((home / ".agenticx" / "mcp.json").read_text())
    entry = doc["mcpServers"]["connector-runtime-local"]
    r = httpx.post(entry["url"], headers=entry["headers"], json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}}, trust_env=False)
    res = r.json()["result"]
    return {"isError": res.get("isError", False), "data": json.loads(res["content"][0]["text"])}


def test_rest_openapi_bearer_end_to_end(env):
    events: List[Any] = []
    out = json.loads(_tool({"action": "create_rest", "name": "Mock Shop", "spec_source": env.up.base + "/openapi.json"}))
    assert out["ok"] and out["action"] == "created" and out["auth_type"] == "bearer" and out["auth_from_spec"]
    assert out["action_count"] == 3 and out["needs_credential"] and out["private_network"]
    # self-hosted gateway entry under the default name is never overwritten
    doc = json.loads((env.home / ".agenticx" / "mcp.json").read_text())
    assert doc["mcpServers"]["connector-runtime"]["url"] == "https://gw.corp.example/mcp"
    assert out["gateway_server"] == "connector-runtime-local"
    iid = out["instance_id"]
    # dedupe: same base URL
    dup = json.loads(_tool({"action": "create_rest", "name": "Again", "base_url": env.up.base, "endpoints": "GET /items 列表"}))
    assert dup["error"] == "exists" and dup["existing"]["instance_id"] == iid
    saved = _tool({"action": "request_credential", "instance_id": iid}, _Gate({"apiKey": BEARER}), events)
    assert BEARER not in saved and json.loads(saved)["action"] == "credential_saved"
    assert BEARER not in json.dumps(events, ensure_ascii=False)
    ver = json.loads(_tool({"action": "verify", "instance_id": iid}))
    assert ver["ok"] is True and ver["actionId"].endswith("list_items")
    # agent path: gateway MCP tools
    res = _mcp_call(env.home, "execute_action", {"actionId": "mock-shop.get_item", "input": {"id": "1"}})
    assert not res["isError"] and res["data"]["statusCode"] == 200
    res = _mcp_call(env.home, "execute_action", {"actionId": "mock-shop.create_order", "input": {"body": {"sku": "A"}}})
    assert res["data"]["body"] == {"created": {"sku": "A"}}
    listed = _tool({"action": "list_instances"})
    assert BEARER not in listed
    rest = json.loads(listed)["rest_instances"]
    assert [r["instance_id"] for r in rest] == [iid] and rest[0]["has_credential"]
    # same credential again → gateway dedupe (merge-update of the single connection)
    again = json.loads(_tool({"action": "request_credential", "instance_id": iid}, _Gate({"apiKey": BEARER})))
    assert again["action"] == "credential_updated"
    gone = json.loads(_tool({"action": "delete", "instance_id": iid}))
    assert gone["ok"] and gone["connections_deleted"] == 1


def test_rest_hmac_end_to_end(env):
    out = json.loads(_tool({"action": "create_rest", "name": "Signed", "base_url": env.up.base + "/signed", "endpoints": "GET /ping?x 探活", "auth_type": "hmac"}))
    assert out["ok"] and out["credential_fields"] == ["Access Key ID (AK)", "Secret Key (SK)"]
    gate = _Gate({"accessKeyId": AK, "secretKey": SK})
    saved = _tool({"action": "request_credential", "instance_id": out["instance_id"]}, gate)
    assert SK not in saved and json.loads(saved)["ok"]
    decisions_ctx = gate.contexts[0]
    assert decisions_ctx["kind"] == "connector_credential"
    ver = json.loads(_tool({"action": "verify", "instance_id": out["instance_id"]}))
    assert ver["ok"] is True, ver
    res = _mcp_call(env.home, "execute_action", {"actionId": "signed.get_ping", "input": {"x": "1"}})
    assert res["data"]["body"]["signed"] is True
    bad = json.loads(_tool({"action": "request_credential", "instance_id": out["instance_id"]}, _Gate({"accessKeyId": AK, "secretKey": "wrong"})))
    assert bad["ok"]
    ver = json.loads(_tool({"action": "verify", "instance_id": out["instance_id"]}))
    assert ver["ok"] is False and "401" in ver["message"] and "wrong" not in json.dumps(ver)


def test_rest_oauth_client_credentials(env):
    out = json.loads(_tool({"action": "create_rest", "name": "OAuth Svc", "base_url": env.up.base + "/oauth", "endpoints": "GET /me 我的信息", "auth_type": "oauth2_client_credentials", "token_url": env.up.base + "/token", "scopes": "read"}))
    assert out["ok"] and out["auth_type"] == "oauth2"
    saved = _tool({"action": "request_credential", "instance_id": out["instance_id"]}, _Gate({"clientId": CLIENT_ID, "clientSecret": CLIENT_SECRET}))
    assert CLIENT_SECRET not in saved
    ver = json.loads(_tool({"action": "verify", "instance_id": out["instance_id"]}))
    assert ver["ok"] is True, ver
    assert len(env.up.state.access_tokens) == 1
    _mcp_call(env.home, "execute_action", {"actionId": "oauth-svc.get_me", "input": {}})
    assert len(env.up.state.access_tokens) == 1  # cached, not re-fetched


def test_rest_oauth_authorization_code_pkce(env, monkeypatch):
    import agenticx.connectors.oauth as oauth_mod

    def fake_browser(url: str) -> bool:
        # the "user" approves: follow the authorize redirect to the loopback callback
        httpx.get(url, follow_redirects=True, trust_env=False, timeout=10)
        return True

    monkeypatch.setattr(oauth_mod.webbrowser, "open", fake_browser)
    out = json.loads(_tool({"action": "create_rest", "name": "User OAuth", "base_url": env.up.base + "/oauth", "endpoints": "GET /me 我", "auth_type": "oauth2_authorization_code", "token_url": env.up.base + "/token", "authorize_url": env.up.base + "/authorize", "scopes": "offline_access"}))
    assert out["ok"] and out["oauth_browser_authorization"] is True
    saved = _tool({"action": "authorize_oauth", "instance_id": out["instance_id"]}, _Gate({"clientId": CLIENT_ID}))
    payload = json.loads(saved)
    assert payload["ok"] and payload["action"] == "credential_saved", payload
    assert "rt-" not in saved and "at-" not in saved
    ver = json.loads(_tool({"action": "verify", "instance_id": out["instance_id"]}))
    assert ver["ok"] is True, ver
    # the gateway refreshed with the stored refresh token and persisted the rotated one
    assert len(env.up.state.refresh_tokens) == 2


def test_gateway_reused_not_respawned(env):
    gw1 = gc.ensure_gateway()
    gw2 = gc.ensure_gateway()
    assert gw1.port == gw2.port and gw2.spawned is False
    info = json.loads((Path(env.home) / "gw" / "sidecar.json").read_text())
    assert info["addr"].endswith(str(gw1.port)) and "token" not in json.dumps(info).lower()
    assert oct((Path(env.home) / "gw" / "admin.token").stat().st_mode & 0o777) == "0o600"


def test_gateway_mcp_via_python_client(env):
    """The agent's own MCP client (streamable-http, proxy policy factory) reaches the gateway."""
    from agenticx.tools.remote_v2 import MCPClientV2

    out = json.loads(_tool({"action": "create_rest", "name": "Mock Shop", "spec_source": env.up.base + "/openapi.json"}))
    _tool({"action": "request_credential", "instance_id": out["instance_id"]}, _Gate({"apiKey": BEARER}))
    entry = json.loads((env.home / ".agenticx" / "mcp.json").read_text())["mcpServers"]["connector-runtime-local"]

    async def go():
        c = MCPClientV2({"name": "connector-runtime-local", **entry})
        try:
            names = {t.name for t in await c.discover_tools()}
            res = await c.call_tool("execute_action", {"actionId": "mock-shop.list_items", "input": {"limit": 5}})
            return names, json.loads(res.content[0].text)
        finally:
            await c.close()

    names, data = _run(go())
    assert {"list_apps", "execute_action"} <= names
    assert data["statusCode"] == 200 and data["body"]["query"] == "limit=5"


def test_sqlite_via_db_mcp_stdio(env):
    import sqlite3

    from agenticx.tools.remote_v2 import MCPClientV2

    db = env.home / "shop.db"
    con = sqlite3.connect(db)
    con.execute("create table users(id integer primary key, name text)")
    con.executemany("insert into users(name) values (?)", [("a",), ("b",), ("c",)])
    con.commit()
    con.close()
    out = json.loads(_tool({"action": "create_database", "name": "Shop DB", "db_type": "sqlite", "db_path": str(db), "row_limit": 2}))
    assert out["ok"] and out["needs_credential"] is False
    ver = json.loads(_tool({"action": "verify", "instance_id": out["server_name"]}))
    assert ver["ok"] and ver["table_count"] == 1 and ver["read_only"]
    entry = json.loads((env.home / ".agenticx" / "mcp.json").read_text())["mcpServers"][out["server_name"]]

    async def go():
        c = MCPClientV2({"name": out["server_name"], **{k: v for k, v in entry.items() if k != "_agenticx"}})
        try:
            names = {t.name for t in await c.discover_tools()}
            q = await c.call_tool("query", {"sql": "select name from users order by id"})
            w = await c.call_tool("query", {"sql": "delete from users"})
            return names, json.loads(q.content[0].text), w
        finally:
            await c.close()

    names, q, w = _run(go())
    assert names == {"list_tables", "describe_table", "query"}  # no execute_write by default
    assert q["columns"] == ["name"] and q["rows"] == [["a"], ["b"]] and q["truncated"] is True
    assert w.isError or "read-only" in w.content[0].text.lower() or "只读" in w.content[0].text
    con = sqlite3.connect(db)
    assert con.execute("select count(*) from users").fetchone()[0] == 3
    con.close()
