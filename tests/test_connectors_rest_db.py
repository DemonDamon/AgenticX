"""REST (OpenAPI → gateway spec), database connector and connector_manage flows."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from agenticx.connectors import manage as cm
from agenticx.connectors import rest_spec
from agenticx.connectors.database import Database, DbConfig, DbError, check_read_only_sql

SECRET = "sk-test-SECRET-value-123456"

OPENAPI = {
    "openapi": "3.0.0",
    "info": {"title": "Orders", "version": "1"},
    "servers": [{"url": "https://api.example.com/{ver}", "variables": {"ver": {"default": "v1"}}}],
    "components": {
        "securitySchemes": {"key": {"type": "apiKey", "in": "header", "name": "X-Token"}},
        "schemas": {"Order": {"type": "object", "properties": {"id": {"type": "string"}}}},
    },
    "paths": {
        "/orders": {
            "get": {"operationId": "listOrders", "summary": "列出订单", "parameters": [
                {"name": "page-size", "in": "query", "schema": {"type": "integer"}},
            ]},
            "post": {"operationId": "createOrder", "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Order"}}}}},
        },
        "/orders/{order-id}": {
            "parameters": [{"name": "order-id", "in": "path", "required": True, "schema": {"type": "string"}}],
            "delete": {"summary": "删除订单"},
        },
    },
}


# ---------------------------------------------------------------- spec


def test_openapi_to_actions_and_auth():
    actions, skipped = rest_spec.actions_from_openapi(OPENAPI, "orders")
    by_id = {a["id"]: a for a in actions}
    assert skipped == 0 and set(by_id) == {"orders.list_orders", "orders.create_order", "orders.delete_orders_order_id"}
    lst = by_id["orders.list_orders"]
    assert lst["operationType"] == "read" and lst["http"]["query"] == {"page-size": "{page_size}"}
    assert "page_size" in lst["inputSchema"]["properties"] and "required" not in lst["inputSchema"]
    create = by_id["orders.create_order"]
    assert create["http"]["bodyField"] == "body" and create["inputSchema"]["required"] == ["body"]
    assert create["inputSchema"]["properties"]["body"]["properties"]["id"]["type"] == "string"  # $ref inlined
    delete = by_id["orders.delete_orders_order_id"]
    assert delete["operationType"] == "destructive" and delete["http"]["path"] == "/orders/{order_id}"
    assert rest_spec._server_base(OPENAPI, None) == "https://api.example.com/v1"
    assert rest_spec.suggest_auth(OPENAPI) == {"type": "api_key", "apiKey": {"in": "header", "name": "X-Token"}}
    reads, skipped = rest_spec.actions_from_openapi(OPENAPI, "orders", include_writes=False)
    assert [a["id"] for a in reads] == ["orders.list_orders"] and skipped == 2


def test_swagger2_and_yaml_and_endpoint_list(tmp_path: Path):
    sw = {
        "swagger": "2.0", "host": "h.example.com", "basePath": "/api", "schemes": ["https"],
        "securityDefinitions": {"o": {"type": "oauth2", "flow": "application", "tokenUrl": "https://h.example.com/token", "scopes": {"read": ""}}},
        "paths": {"/u": {"post": {"parameters": [{"in": "body", "name": "payload", "required": True, "schema": {"type": "object"}}]}}},
    }
    f = tmp_path / "s.yaml"
    import yaml

    f.write_text(yaml.safe_dump(sw))
    doc, url = rest_spec.load_spec_text(str(f))
    assert url is None and rest_spec._server_base(doc, None) == "https://h.example.com/api"
    assert rest_spec.suggest_auth(doc)["oauth2"]["grant"] == "client_credentials"
    acts, _ = rest_spec.actions_from_openapi(doc, "h")
    assert acts[0]["http"]["bodyField"] == "body"
    eps = rest_spec.actions_from_endpoint_list("GET /users/{id} 查询用户\nPOST /users 新建\nGET /search?q&limit 搜索\nbad line", "u")
    assert [a["http"]["method"] for a in eps] == ["GET", "POST", "GET"]
    assert eps[0]["inputSchema"]["required"] == ["id"] and eps[0]["title"] == "查询用户"
    assert eps[2]["http"]["query"] == {"q": "{q}", "limit": "{limit}"}
    with pytest.raises(rest_spec.SpecError):
        rest_spec.parse_spec_text('{"hello": 1}')


def test_build_rest_auth_and_credential_fields():
    auth, err = cm.build_rest_auth({"auth_type": "hmac", "hmac_signature_encoding": "base64"})
    assert err is None and auth["hmac"]["signatureHeader"] == "X-Signature" and auth["hmac"]["signatureEncoding"] == "base64"
    assert [f["id"] for f in cm.credential_fields(auth)] == ["accessKeyId", "secretKey"]
    assert cm.credential_fields(auth)[0]["masked"] is False and cm.credential_fields(auth)[1]["masked"] is True
    auth, err = cm.build_rest_auth({"auth_type": "oauth2_client_credentials", "token_url": "https://t/x", "scopes": "a, b"})
    assert auth["oauth2"] == {"grant": "client_credentials", "tokenUrl": "https://t/x", "scopes": ["a", "b"]}
    assert cm.build_rest_auth({"auth_type": "oauth2_authorization_code", "token_url": "https://t"})[1]
    assert cm.build_rest_auth({"auth_type": "weird"})[1]
    auth, _ = cm.build_rest_auth({"auth_type": "api_key_query", "query_param": "k"})
    assert auth == {"type": "api_key", "apiKey": {"in": "query", "name": "k"}}


# ---------------------------------------------------------------- database


@pytest.fixture()
def sqlite_db(tmp_path: Path) -> Path:
    p = tmp_path / "shop.db"
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, item TEXT NOT NULL, qty INTEGER)")
    con.executemany("INSERT INTO orders (item, qty) VALUES (?, ?)", [(f"i{n}", n) for n in range(30)])
    con.execute("CREATE VIEW v_big AS SELECT * FROM orders WHERE qty > 10")
    con.commit()
    con.close()
    return p


def test_sqlite_read_only_tools(sqlite_db: Path):
    db = Database(DbConfig(db_type="sqlite", path=str(sqlite_db), row_limit=5))
    assert db.list_tables() == ["orders", "v_big"]
    desc = db.describe_table("orders")
    assert desc["columns"][0] == {"name": "id", "type": "INTEGER", "nullable": True, "default": None, "primary_key": True}
    res = db.query("SELECT id, item FROM orders ORDER BY id")
    assert res["row_count"] == 5 and res["truncated"] is True and res["columns"] == ["id", "item"]
    assert db.query("select count(*) from orders", limit=1)["rows"] == [[30]]
    for bad in ("DELETE FROM orders", "select 1; drop table orders", "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x"):
        with pytest.raises(DbError):
            db.query(bad)
    with pytest.raises(DbError):
        db.execute_write("DELETE FROM orders")
    with pytest.raises(DbError):
        db.describe_table("orders; drop")
    # connection-level read-only even if the gate were bypassed
    with pytest.raises(DbError):
        db._run("DELETE FROM orders")
    assert db.health()["table_count"] == 2


def test_sqlite_writes_only_when_enabled(sqlite_db: Path):
    db = Database(DbConfig(db_type="sqlite", path=str(sqlite_db), allow_writes=True))
    assert db.execute_write("DELETE FROM orders WHERE id = 1")["affected_rows"] == 1
    assert db.query("select count(*) from orders")["rows"] == [[29]]


def test_read_only_sql_gate_allows_strings_with_keywords():
    assert check_read_only_sql("select 'drop table x' as s") is None
    assert check_read_only_sql("SELECT replace(name,'a','b') FROM t") is None
    assert check_read_only_sql("select * into t2 from t")


def test_create_database_dedupe_and_password(tmp_path: Path, sqlite_db: Path):
    doc: Dict[str, Any] = {"mcpServers": {"shop": {"command": "npx", "args": ["foreign"]}}}
    new_doc, res = cm.create_database(doc, name="shop", db_type="sqlite", path=str(sqlite_db))
    assert res["ok"] and res["server_name"] == "shop-2" and res["needs_credential"] is False
    assert new_doc["mcpServers"]["shop"] == {"command": "npx", "args": ["foreign"]}  # never overwritten
    again_doc, again = cm.create_database(new_doc, name="other", db_type="sqlite", path=str(sqlite_db))
    assert again_doc is None and again["error"] == "exists" and again["reason"] == "same_database"
    _, dup = cm.create_database(new_doc, name="shop", db_type="sqlite", path=str(tmp_path / "nope.db"))
    assert dup["error"] == "invalid_form"
    my_doc, my = cm.create_database(new_doc, name="mysql 主库", db_type="mysql", host="10.0.0.5", database="shop", user="ro")
    assert my["ok"] and my["needs_credential"] is True and my["db_type"] == "mysql"
    srv = my["server_name"]
    assert my_doc["mcpServers"][srv]["env"]["AGX_DB_PORT"] == "3306"
    assert "AGX_DB_PASSWORD" not in my_doc["mcpServers"][srv]["env"]
    pw_doc, pw = cm.set_database_password(my_doc, server_name=srv, password=SECRET)
    assert pw["action"] == "credential_saved" and SECRET not in json.dumps(pw)
    from agenticx.runtime import connectors_store as cs

    rows = [cs.public_instance(i) for i in cs.list_instances(pw_doc)]
    mysql_row = next(r for r in rows if r["server_name"] == srv)
    assert mysql_row["kind"] == "database" and mysql_row["has_credential"] is True and mysql_row["read_only"] is True
    assert SECRET not in json.dumps(rows)
    # MCP credential path must refuse database entries (secret lives in env)
    _, wrong = cs.set_connector_credential(pw_doc, server_name=srv, secret="x")
    assert wrong["error"] == "wrong_kind"
    # overwrite keeps the stored password
    upd_doc, upd = cm.create_database(pw_doc, name="mysql 主库", db_type="mysql", host="10.0.0.5", database="shop", user="ro", row_limit=50, overwrite=True)
    assert upd["action"] == "updated" and upd_doc["mcpServers"][srv]["env"]["AGX_DB_PASSWORD"] == SECRET


# ---------------------------------------------------------------- tool flows


class _Gate:
    def __init__(self, values: Dict[str, str]):
        self.values = values
        self.prompts: List[Any] = []

    async def request_clarification(self, prompt, options=None, allow_free_text=True, context=None):
        self.prompts.append({"prompt": prompt, "context": context})
        return {"answer_text": "", "selected_options": [], "secret_values": dict(self.values)}

    def resolve(self, request_id, answer):  # pragma: no cover
        return True


@pytest.fixture()
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / ".agenticx").mkdir()
    (tmp_path / ".agenticx" / "mcp.json").write_text(json.dumps({"mcpServers": {}}))
    import agenticx.cli.agent_tools as at

    monkeypatch.setattr(at, "load_available_servers", lambda: {})
    return tmp_path


def _session():
    return SimpleNamespace(connected_servers=set(), mcp_configs={}, mcp_hub=None)


def _run(coro):
    return asyncio.run(coro)


def test_connector_manage_database_flow(home: Path, sqlite_db: Path):
    from agenticx.cli.agent_tools import _tool_connector_manage

    s = _session()
    out = json.loads(_run(_tool_connector_manage({"action": "create_database", "name": "商城库", "db_type": "sqlite", "db_path": str(sqlite_db)}, s)))
    assert out["ok"] and out["read_only"] is True
    name = out["server_name"]
    ver = json.loads(_run(_tool_connector_manage({"action": "verify", "server_name": name}, s)))
    assert ver["ok"] and ver["table_count"] == 2 and ver["tables_preview"] == ["orders", "v_big"]
    nocred = json.loads(_run(_tool_connector_manage({"action": "request_credential", "server_name": name}, s)))
    assert nocred["action"] == "no_credential_needed"
    my = json.loads(_run(_tool_connector_manage({"action": "create_database", "name": "pg", "db_type": "postgresql", "db_host": "127.0.0.1", "db_port": 1, "db_name": "x", "db_user": "u"}, s)))
    assert my["needs_credential"] is True
    gate = _Gate({"password": SECRET})
    events: List[Any] = []

    async def emit(e):
        events.append(e)

    saved = _run(_tool_connector_manage({"action": "request_credential", "server_name": my["server_name"]}, s, clarify_gate=gate, emit_event=emit))
    assert SECRET not in saved and json.loads(saved)["action"] == "credential_saved"
    assert SECRET not in json.dumps(events, ensure_ascii=False)
    failed = _run(_tool_connector_manage({"action": "verify", "server_name": my["server_name"]}, s))
    assert SECRET not in failed and json.loads(failed)["error"] == "connect_failed"
    listed = _run(_tool_connector_manage({"action": "list_instances"}, s))
    assert SECRET not in listed
    kinds = {r["server_name"]: r.get("kind") for r in json.loads(listed)["instances"]}
    assert kinds == {name: "database", my["server_name"]: "database"}
    gone = json.loads(_run(_tool_connector_manage({"action": "delete", "server_name": my["server_name"]}, s)))
    assert gone["action"] == "deleted"


def test_secret_decision_masked_flag_passthrough():
    from agenticx.cli.agent_tools import _normalize_clarification_decisions

    out = _normalize_clarification_decisions(
        [{"id": "ak", "question": "AK", "input_type": "secret", "masked": False}, {"id": "sk", "question": "SK", "input_type": "secret"}],
        allow_secret=True,
    )
    assert out[0]["masked"] is False and "masked" not in out[1]
    # model-provided decisions can never request secret inputs
    assert _normalize_clarification_decisions([{"id": "x", "question": "q", "input_type": "secret", "options": ["a"]}])[0].get("input_type") is None


def test_connector_manage_template_defaults_mcp_oauth_and_query(home: Path):
    """Templates with a verified official endpoint: url defaults to mcp_url; auth=mcp_oauth sets
    oauth=true with no secret; auth_query templates store the key style as query."""
    from agenticx.cli.agent_tools import _tool_connector_manage
    from agenticx.runtime import connectors_store as cs

    tpl = cs.find_template("stub:tencent-docs")
    assert tpl["auth"] == "mcp_oauth" and tpl["mcp_url"] == "https://docs.qq.com/openapi/mcp"

    s = _session()
    out = json.loads(_run(_tool_connector_manage({"action": "create", "name": "腾讯文档的连接器", "template_id": "stub:tencent-docs"}, s)))
    assert out["ok"], out
    assert out["needs_credential"] is False and out["oauth"] == "mcp_standard"
    doc = json.loads((home / ".agenticx" / "mcp.json").read_text())
    entry = doc["mcpServers"][out["server_name"]]
    assert entry["url"] == "https://docs.qq.com/openapi/mcp"
    assert entry["oauth"] is True and "headers" not in entry
    assert entry["_agenticx"]["templateId"] == "stub:tencent-docs"

    again = json.loads(_run(_tool_connector_manage({"action": "create", "name": "腾讯文档2", "template_id": "stub:tencent-docs"}, s)))
    assert again["ok"] is False and again["error"] == "exists"

    amap = json.loads(_run(_tool_connector_manage({"action": "create", "name": "高德", "template_id": "stub:amap"}, s)))
    assert amap["ok"], amap
    assert amap["needs_credential"] is True
    entry = json.loads((home / ".agenticx" / "mcp.json").read_text())["mcpServers"][amap["server_name"]]
    assert entry["url"] == "https://mcp.amap.com/mcp"
    assert entry["_agenticx"]["authStyle"] == "query" and entry["_agenticx"]["authQuery"] == "key"
    assert "oauth" not in entry

    listed = json.loads(_run(_tool_connector_manage({"action": "list_templates", "query": "notion"}, s)))
    notion = next(t for t in listed["templates"] if t["id"] == "native:notion")
    assert notion["create_via"] == "mcp_url" and notion["auth"] == "mcp_oauth"


def test_mcp_oauth_authorize_url_with_query_endpoint_is_repaired():
    """Tencent Docs' authorization_endpoint carries ?authType=2; the MCP SDK appends a second '?'."""
    from urllib.parse import parse_qs, urlsplit

    from agenticx.connectors.oauth import fix_authorize_url

    broken = (
        "https://docs.qq.com/scenario/open-claw.html?authType=2?response_type=code&client_id=abc"
        "&redirect_uri=http%3A%2F%2F127.0.0.1%3A5%2Fcallback&state=s%3Fx&code_challenge_method=S256"
    )
    fixed = fix_authorize_url(broken)
    q = parse_qs(urlsplit(fixed).query)
    assert q["authType"] == ["2"] and q["response_type"] == ["code"] and q["state"] == ["s?x"]
    plain = "https://mcp.notion.com/authorize?response_type=code&client_id=x"
    assert fix_authorize_url(plain) == plain
    assert fix_authorize_url("https://a.example/authorize") == "https://a.example/authorize"


def test_mcp_oauth_token_storage_is_owner_only(home: Path):
    from agenticx.connectors.oauth import FileTokenStorage

    st = FileTokenStorage("tencent-docs")
    port = st.redirect_port()
    assert port > 0 and st.redirect_port() == port
    assert st.path == home / ".agenticx" / "connectors" / "oauth" / "tencent-docs.json"
    assert (st.path.stat().st_mode & 0o777) == 0o600


def test_connector_manage_gildata_template_query_token_and_help_link(home: Path, monkeypatch: pytest.MonkeyPatch):
    """恒生聚源 (Comate query_param token): official Streamable HTTP + ?token=, label/placeholder/help link."""
    from agenticx.cli.agent_tools import _tool_connector_manage

    help_url = "https://vcn7e7nesi3s.feishu.cn/docx/MeCmd4q0Yo7nmkx9D8IcMYbknob"
    s = _session()
    listed = json.loads(_run(_tool_connector_manage({"action": "list_templates", "query": "恒生聚源"}, s)))
    tpl = next(t for t in listed["templates"] if t["id"] == "stub:gildata")
    assert tpl["mcp_url"] == "https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool"
    assert tpl.get("auth_query") == "token"
    assert tpl["credential_label"] == "Access Token" and tpl["credential_help_url"] == help_url

    out = json.loads(_run(_tool_connector_manage({"action": "create", "name": "恒生聚源MCP的连接器", "template_id": "stub:gildata"}, s)))
    assert out["ok"], out
    assert out["needs_credential"] is True
    assert out["credential_label"] == "Access Token" and out["credential_help_url"] == help_url
    name = out["server_name"]
    entry = json.loads((home / ".agenticx" / "mcp.json").read_text())["mcpServers"][name]
    assert entry["url"] == tpl["mcp_url"] and entry["_agenticx"].get("authStyle") in ("query", "bearer", None)

    import agenticx.cli.agent_tools as at

    seen: List[Any] = []
    real_await = at._await_clarification_answer

    async def spy(prompt, **kwargs):
        seen.append({"prompt": prompt, "decisions": kwargs.get("decisions")})
        return await real_await(prompt, **kwargs)

    monkeypatch.setattr(at, "_await_clarification_answer", spy)
    gate = _Gate({"credential": SECRET})
    saved = _run(_tool_connector_manage({"action": "request_credential", "server_name": name}, s, clarify_gate=gate))
    assert SECRET not in saved and json.loads(saved)["action"] == "credential_saved"
    card = json.dumps(seen, ensure_ascii=False)
    assert help_url in card and "Access Token" in card and "请填写恒生聚源下发的Access Token" in card
    assert SECRET not in card
    entry = json.loads((home / ".agenticx" / "mcp.json").read_text())["mcpServers"][name]
    # Comate: query_param name=token
    assert f"token={SECRET}" in entry["url"]
    assert "Authorization" not in (entry.get("headers") or {})


def test_connector_manage_template_custom_header_and_query_defaults(home: Path):
    """盈米 → raw x-api-key header; 快递100 → ?key= query; 法律之星 → Bearer (all from template defaults)."""
    from agenticx.cli.agent_tools import _tool_connector_manage

    s = _session()
    expect = {
        "stub:yingmi": ("header", {"authHeader": "x-api-key"}),
        "stub:kuaidi100": ("query", {"authQuery": "key"}),
        "stub:lawstar": ("bearer", {}),
    }
    for tid, (style, extra) in expect.items():
        out = json.loads(_run(_tool_connector_manage({"action": "create", "name": f"{tid}-conn", "template_id": tid}, s)))
        assert out["ok"] and out["needs_credential"] is True, out
        meta = json.loads((home / ".agenticx" / "mcp.json").read_text())["mcpServers"][out["server_name"]]["_agenticx"]
        assert meta["authStyle"] == style, (tid, meta)
        for k, v in extra.items():
            assert meta[k] == v
