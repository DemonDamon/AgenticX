"""Orchestration for chat-created REST and database connectors.

Pure helpers + thin gateway calls, shared by ``connector_manage`` (agent tool)
and tests. Results never contain secrets.

Author: Damon Li
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from agenticx.connectors import rest_spec
from agenticx.connectors.database import DEFAULT_PORTS, DbConfig, driver_status, normalize_db_type
from agenticx.connectors.gateway_client import Gateway, GatewayError
from agenticx.runtime import connectors_store as cs
from agenticx.utils.proxy_policy import is_local_url

REST_PREFIX = "rest:"

REST_AUTH_TYPES = (
    "none",
    "api_key_header",
    "api_key_query",
    "bearer",
    "hmac",
    "oauth2_client_credentials",
    "oauth2_authorization_code",
)


# ---- auth ---------------------------------------------------------------------

def build_rest_auth(args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Map connector_manage arguments to a gateway ``auth`` spec."""
    t = str(args.get("auth_type") or "none").strip().lower()
    if t not in REST_AUTH_TYPES:
        return None, f"auth_type must be one of {', '.join(REST_AUTH_TYPES)}"
    if t == "none":
        return {"type": "none"}, None
    if t == "bearer":
        return {"type": "bearer"}, None
    if t in ("api_key_header", "api_key_query"):
        where = "header" if t == "api_key_header" else "query"
        name = str(args.get("header_name") if where == "header" else args.get("query_param") or "").strip()
        name = name or ("X-API-Key" if where == "header" else "api_key")
        return {"type": "api_key", "apiKey": {"in": where, "name": name}}, None
    if t == "hmac":
        h: Dict[str, Any] = {
            "accessKeyHeader": str(args.get("hmac_access_key_header") or "X-Access-Key").strip(),
            "signatureHeader": str(args.get("hmac_signature_header") or "X-Signature").strip(),
            "timestampHeader": str(args.get("hmac_timestamp_header") or "X-Timestamp").strip(),
        }
        for key, field in (
            ("stringToSign", "hmac_string_to_sign"),
            ("signatureEncoding", "hmac_signature_encoding"),
            ("timestampFormat", "hmac_timestamp_format"),
            ("nonceHeader", "hmac_nonce_header"),
            ("signaturePrefix", "hmac_signature_prefix"),
        ):
            val = str(args.get(field) or "")
            if val.strip():
                h[key] = val if key in ("stringToSign", "signaturePrefix") else val.strip()
        return {"type": "hmac", "hmac": h}, None
    grant = "client_credentials" if t == "oauth2_client_credentials" else "authorization_code"
    token_url = str(args.get("token_url") or "").strip()
    if not token_url:
        return None, "token_url is required for OAuth 2.0"
    o: Dict[str, Any] = {"grant": grant, "tokenUrl": token_url}
    if grant == "authorization_code":
        authorize_url = str(args.get("authorize_url") or "").strip()
        if not authorize_url:
            return None, "authorize_url is required for authorization_code"
        o["authorizeUrl"] = authorize_url
    scopes = args.get("scopes")
    if isinstance(scopes, str):
        scopes = [s for s in scopes.replace(",", " ").split() if s]
    if isinstance(scopes, list) and scopes:
        o["scopes"] = [str(s) for s in scopes][:30]
    if str(args.get("client_auth") or "").strip() == "basic":
        o["clientAuth"] = "basic"
    return {"type": "oauth2", "oauth2": o}, None


def credential_fields(auth: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fields the masked credential card must collect for an auth spec."""
    t = auth.get("type")
    if t in ("api_key", "bearer"):
        label = "Bearer Token" if t == "bearer" else f"API Key（{(auth.get('apiKey') or {}).get('name', 'key')}）"
        return [{"id": "apiKey", "label": label, "masked": True, "required": True}]
    if t == "hmac":
        return [
            {"id": "accessKeyId", "label": "Access Key ID (AK)", "masked": False, "required": True},
            {"id": "secretKey", "label": "Secret Key (SK)", "masked": True, "required": True},
        ]
    if t == "oauth2":
        cc = (auth.get("oauth2") or {}).get("grant") == "client_credentials"
        return [
            {"id": "clientId", "label": "Client ID", "masked": False, "required": True},
            {"id": "clientSecret", "label": "Client Secret", "masked": True, "required": cc},
        ]
    return []


# ---- REST via gateway -----------------------------------------------------------

def _norm_base(url: str) -> str:
    return cs.normalize_url_for_compare(str(url or "").rstrip("/"))


def gateway_user_apps(gw: Gateway) -> List[Dict[str, Any]]:
    code, body = gw.admin("GET", "/admin/apps")
    if code != 200:
        raise GatewayError(f"list apps failed: HTTP {code}")
    return [a for a in (body.get("apps") or []) if a.get("origin") == "user"]


def gateway_connections(gw: Gateway) -> List[Dict[str, Any]]:
    code, body = gw.admin("GET", "/admin/connections")
    if code != 200:
        raise GatewayError(f"list connections failed: HTTP {code}")
    return list(body.get("connections") or [])


def rest_instances(gw: Gateway) -> List[Dict[str, Any]]:
    conns = gateway_connections(gw)
    out = []
    for app in gateway_user_apps(gw):
        mine = [c for c in conns if c.get("connectorId") == app["id"]]
        needs = app.get("authType") not in ("none", None)
        out.append({
            "instance_id": REST_PREFIX + app["id"],
            "kind": "rest",
            "connector_id": app["id"],
            "display_name": app.get("displayName") or app["id"],
            "base_url": app.get("baseUrl"),
            "auth_type": app.get("authType"),
            "action_count": app.get("actionCount"),
            "has_credential": bool(mine) or not needs,
            "connection_count": len(mine),
        })
    return out


def register_rest(
    gw: Gateway,
    *,
    name: str,
    base_url: str = "",
    spec_source: str = "",
    endpoints: Any = None,
    auth: Optional[Dict[str, Any]] = None,
    include_writes: bool = True,
    overwrite: bool = False,
    description: str = "",
) -> Dict[str, Any]:
    display = str(name or "").strip()
    if not display:
        return {"ok": False, "error": "invalid_form", "field": "name"}
    cid_base = rest_spec.connector_id_from_name(display)
    spec_doc: Optional[Dict[str, Any]] = None
    spec_url: Optional[str] = None
    if spec_source:
        try:
            spec_doc, spec_url = rest_spec.load_spec_text(spec_source)
        except rest_spec.SpecError as exc:
            return {"ok": False, "error": "spec_invalid", "detail": str(exc)}
        except Exception as exc:
            return {"ok": False, "error": "spec_fetch_failed", "detail": type(exc).__name__}
    base = str(base_url or "").strip()
    if not base and spec_doc is not None:
        base = rest_spec._server_base(spec_doc, spec_url) or ""
    if not base or not cs.is_valid_http_url(base):
        return {"ok": False, "error": "invalid_form", "field": "base_url", "hint": "需要 http(s) 基础地址（OpenAPI 中无 servers 时请提供 base_url）"}
    suggested = rest_spec.suggest_auth(spec_doc) if spec_doc is not None else None
    auth_spec = auth or suggested or {"type": "none"}

    # dedupe: one REST connector per base URL; unique display names
    apps = gateway_user_apps(gw)
    same_base = next((a for a in apps if a.get("baseUrl") and _norm_base(a["baseUrl"]) == _norm_base(base)), None)
    if same_base and not overwrite:
        return {
            "ok": False, "error": "exists", "reason": "same_endpoint",
            "existing": {"instance_id": REST_PREFIX + same_base["id"], "display_name": same_base.get("displayName"), "base_url": same_base.get("baseUrl")},
        }
    if same_base:
        cid = same_base["id"]
    else:
        if any(str(a.get("displayName") or "").strip().lower() == display.lower() for a in apps):
            return {"ok": False, "error": "duplicate", "name": display}
        taken = {a["id"] for a in apps}
        code, body = gw.admin("GET", "/admin/apps")
        taken |= {a["id"] for a in (body.get("apps") or [])}
        cid, n = cid_base, 2
        while cid in taken:
            cid = f"{cid_base}-{n}"
            n += 1
    try:
        if spec_doc is not None:
            actions, skipped = rest_spec.actions_from_openapi(spec_doc, cid, include_writes=include_writes)
        else:
            actions, skipped = rest_spec.actions_from_endpoint_list(endpoints or [], cid), 0
            if not include_writes:
                before = len(actions)
                actions = [a for a in actions if a["operationType"] == "read"]
                skipped = before - len(actions)
        oauth = auth_spec.get("oauth2") or {}
        private = is_local_url(base) or any(is_local_url(u) for u in (oauth.get("tokenUrl"), oauth.get("authorizeUrl")) if u)
        definition = rest_spec.build_connector(
            connector_id=cid, display_name=display, base_url=base, auth=auth_spec,
            actions=actions, description=description, allow_private_network=private,
        )
    except rest_spec.SpecError as exc:
        return {"ok": False, "error": "spec_invalid", "detail": str(exc)}
    code, body = gw.admin("PUT", f"/admin/connectors/{cid}", definition)
    if code != 200:
        return {"ok": False, "error": "register_failed", "detail": str(body.get("error") or body)[:300]}
    conns = [c for c in gateway_connections(gw) if c.get("connectorId") == cid]
    needs = auth_spec.get("type") != "none"
    return {
        "ok": True,
        "action": body.get("action"),
        "instance_id": REST_PREFIX + cid,
        "connector_id": cid,
        "display_name": display,
        "base_url": definition["baseUrl"],
        "auth_type": auth_spec.get("type"),
        "auth_from_spec": auth is None and suggested is not None,
        "action_count": len(actions),
        "skipped_operations": skipped,
        "private_network": private,
        "needs_credential": needs and not conns,
        "credential_fields": [f["label"] for f in credential_fields(auth_spec)],
        "oauth_browser_authorization": (auth_spec.get("oauth2") or {}).get("grant") == "authorization_code",
    }


def get_rest_definition(gw: Gateway, connector_id: str) -> Optional[Dict[str, Any]]:
    code, body = gw.admin("GET", f"/admin/connectors/{connector_id}")
    if code != 200 or body.get("origin") != "user":
        return None
    return body.get("connector")


def save_rest_credential(gw: Gateway, connector_id: str, display_name: str, values: Dict[str, str]) -> Dict[str, Any]:
    """Create the connection (or merge-update the single existing one)."""
    payload = {k: v for k, v in values.items() if v}
    mine = [c for c in gateway_connections(gw) if c.get("connectorId") == connector_id]
    if mine:
        code, body = gw.admin("PUT", f"/admin/connections/{mine[0]['id']}/secret", payload)
        if code == 200:
            return {"ok": True, "action": "credential_updated", "connection_id": mine[0]["id"]}
        return {"ok": False, "error": "credential_rejected", "detail": str(body.get("error") or "")[:200]}
    code, body = gw.admin("POST", "/admin/connections", {"connectorId": connector_id, "name": display_name or connector_id, **payload})
    if code == 201:
        return {"ok": True, "action": "credential_saved", "connection_id": body.get("id")}
    if code == 409:
        ex = body.get("existing") or {}
        return {"ok": False, "error": "exists", "reason": body.get("reason"), "existing": {"connection_id": ex.get("id"), "name": ex.get("name")}}
    return {"ok": False, "error": "credential_rejected", "detail": str(body.get("error") or "")[:200]}


def check_rest(gw: Gateway, connector_id: str) -> Dict[str, Any]:
    code, body = gw.admin("POST", f"/admin/connectors/{connector_id}/check", {})
    if code != 200:
        return {"ok": False, "error": "check_failed", "detail": str(body.get("error") or "")[:200]}
    return body


def unregister_rest(gw: Gateway, connector_id: str) -> Dict[str, Any]:
    code, body = gw.admin("DELETE", f"/admin/connectors/{connector_id}")
    if code == 200:
        return {"ok": True, "action": "deleted", "connections_deleted": body.get("connectionsDeleted", 0)}
    return {"ok": False, "error": "delete_failed", "detail": str(body.get("error") or "")[:200]}


# ---- database (built-in MCP server in mcp.json) -----------------------------------

def database_entry_command() -> Tuple[str, List[str]]:
    return sys.executable, ["-m", "agenticx.connectors.db_mcp"]


def create_database(
    doc: Dict[str, Any],
    *,
    name: str,
    db_type: str,
    path: str = "",
    host: str = "",
    port: Any = None,
    database: str = "",
    user: str = "",
    ssl: bool = False,
    allow_writes: bool = False,
    row_limit: Any = None,
    overwrite: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    display = str(name or "").strip()
    if not display or not cs.sanitize_server_name(display):
        return None, {"ok": False, "error": "invalid_form", "field": "name"}
    t = normalize_db_type(db_type)
    try:
        port_i = int(port) if port not in (None, "") else DEFAULT_PORTS.get(t, 0)
    except (TypeError, ValueError):
        return None, {"ok": False, "error": "invalid_form", "field": "port"}
    try:
        limit_i = int(row_limit) if row_limit not in (None, "") else 200
    except (TypeError, ValueError):
        limit_i = 200
    cfg = DbConfig(
        db_type=t, path=str(path or "").strip(), host=str(host or "").strip(), port=port_i,
        database=str(database or "").strip(), user=str(user or "").strip(),
        allow_writes=bool(allow_writes), row_limit=max(1, min(limit_i, 5000)), ssl=bool(ssl),
    )
    err = cfg.validate()
    if err:
        return None, {"ok": False, "error": "invalid_form", "detail": err}
    ok, driver = driver_status(t)
    if not ok:
        return None, {"ok": False, "error": "driver_missing", "detail": driver}
    identity = cfg.identity()
    servers = cs.servers_map(doc)
    instances = cs.list_instances(doc)
    same = next((i for i in instances if i.get("kind") == "database" and i.get("db_identity") == identity), None)
    if same and not overwrite:
        return None, {"ok": False, "error": "exists", "reason": "same_database", "existing": cs.public_instance(same)}
    if same:
        server = same["server_name"]
        if cs.is_name_taken(instances, display, server):
            return None, {"ok": False, "error": "duplicate", "name": display}
        prev_env = (servers.get(server) or {}).get("env") or {}
        if prev_env.get("AGX_DB_PASSWORD"):
            cfg.password = str(prev_env["AGX_DB_PASSWORD"])  # keep the stored password
        action = "updated"
    else:
        if cs.is_name_taken(instances, display):
            return None, {"ok": False, "error": "duplicate", "name": display}
        base = cs.sanitize_server_name(display)
        server, n = base, 2
        while server in servers:  # never overwrite foreign entries
            server = f"{base}-{n}"
            n += 1
        action = "created"
    command, args = database_entry_command()
    entry = {
        "command": command,
        "args": args,
        "env": cfg.to_env(),
        cs.META_KEY: {
            "source": cs.SOURCE_CONNECTOR,
            "kind": "database",
            "dbType": t,
            "dbIdentity": identity,
            "displayName": display,
            "templateId": f"db:{t}",
            "createdVia": "chat",
        },
    }
    if same and servers.get(server) == entry:
        return None, {"ok": True, "action": "unchanged", "server_name": server, "display_name": display}
    servers[server] = entry
    needs = t != "sqlite" and not cfg.password
    return {**doc, "mcpServers": servers}, {
        "ok": True,
        "action": action,
        "server_name": server,
        "display_name": display,
        "kind": "database",
        "db_type": t,
        "read_only": not cfg.allow_writes,
        "row_limit": cfg.row_limit,
        "driver": driver,
        "needs_credential": needs,
    }


def set_database_password(doc: Dict[str, Any], *, server_name: str, password: str) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    servers = cs.servers_map(doc)
    raw = servers.get(server_name)
    meta = raw.get(cs.META_KEY) if isinstance(raw, dict) else None
    if not isinstance(meta, dict) or meta.get("kind") != "database":
        return None, {"ok": False, "error": "not_found", "server_name": server_name}
    if not str(password or ""):
        return None, {"ok": False, "error": "empty_secret"}
    entry = dict(raw)
    env = dict(entry.get("env") or {})
    if env.get("AGX_DB_PASSWORD") == password:
        return None, {"ok": True, "action": "unchanged", "server_name": server_name}
    env["AGX_DB_PASSWORD"] = password
    entry["env"] = env
    servers[server_name] = entry
    return {**doc, "mcpServers": servers}, {"ok": True, "action": "credential_saved", "server_name": server_name}


def describe_target(url: str) -> str:
    try:
        return urlsplit(url).netloc
    except ValueError:
        return ""
