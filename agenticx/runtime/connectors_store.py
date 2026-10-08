"""Connector instances in ``~/.agenticx/mcp.json`` — Python mirror of the desktop dedupe model.

Mirrors ``desktop/src/components/settings/connectors/create-connector-model.ts`` and
``desktop/src/utils/mcp-remote-config.ts`` so chat-created connectors (``connector_manage``)
and UI-created ones share ONE source of truth:

- An entry is a *connector instance* when ``_agenticx.source == "connector"`` or it is an
  untagged http(s) remote (legacy). stdio / marketplace MCP entries are *foreign* and are
  never overwritten.
- Template instances are tagged ``_agenticx.templateId``; at most one instance per
  template + credential (``same_credential``), and re-creating the same template returns
  ``exists`` so the caller reuses / updates instead of duplicating.
- Server names default to the template slug (``stub:qingflow`` → ``qingflow``); display
  names and server names are unique across connector instances.
- Credential fingerprints are irreversible and byte-compatible with the TS
  ``mcpCredentialFingerprint`` so both sides detect the same duplicates.

Secrets never leave this module in return values: ``public_instance`` exposes only
``has_credential`` and a redacted URL.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

META_KEY = "_agenticx"
SOURCE_CONNECTOR = "connector"

AUTH_STYLES = ("none", "bearer", "header", "query")
DEFAULT_AUTH_HEADER = "X-API-Key"
DEFAULT_AUTH_QUERY = "api_key"

_TEMPLATES_PATH = Path(__file__).with_name("connector_templates.json")
_CRED_KEY_RE = re.compile(r"token|key|secret")
_INVALID_HEADER_RE = re.compile(r"[^A-Za-z0-9!#$%&'*+.^_`|~-]")
_INVALID_QUERY_RE = re.compile(r"[^A-Za-z0-9_.~-]")


# ---------------------------------------------------------------------------
# JS-compatible primitives
# ---------------------------------------------------------------------------


def _to_int32(n: int) -> int:
    n &= 0xFFFFFFFF
    return n - 0x100000000 if n & 0x80000000 else n


def _utf16_units(text: str) -> List[int]:
    data = text.encode("utf-16-le")
    return [int.from_bytes(data[i : i + 2], "little") for i in range(0, len(data), 2)]


def _to_base36(n: int) -> str:
    if n == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = []
    while n:
        n, r = divmod(n, 36)
        out.append(digits[r])
    return "".join(reversed(out))


def sanitize_server_name(raw: Any) -> str:
    """Port of TS ``sanitizeConnectorServerName``."""
    text = str(raw if raw is not None else "").strip()
    base = text.lower()
    base = re.sub(r"[\s_]+", "-", base)
    base = re.sub(r"[^a-z0-9.-]", "", base)
    base = re.sub(r"-+", "-", base)
    base = re.sub(r"^-|-$", "", base)
    if base:
        return base[:64]
    if not text:
        return ""
    h = 5381
    for c in _utf16_units(text):
        h = _to_int32((h << 5) + h + c)
    return f"connector-{_to_base36(abs(h))}"[:64]


def template_slug(template_id: Any) -> str:
    """``stub:qingflow`` → ``qingflow`` (TS ``connectorTemplateSlug``)."""
    raw = re.sub(r"^[a-z]+:", "", str(template_id or "").strip(), flags=re.I)
    return sanitize_server_name(raw) if raw else ""


def credential_fingerprint(headers: Any) -> str:
    """Byte-compatible port of TS ``mcpCredentialFingerprint`` (irreversible)."""
    if not isinstance(headers, dict):
        return ""
    parts: List[str] = []
    for k, v in headers.items():
        if not isinstance(v, str) or not v.strip():
            continue
        key = str(k).strip().lower()
        if key == "authorization" or _CRED_KEY_RE.search(key):
            parts.append(f"{key}={v.strip()}")
    if not parts:
        return ""
    parts.sort()
    h1, h2 = 5381, 52711
    for c in _utf16_units("\n".join(parts)):
        h1 = _to_int32((h1 << 5) + h1 + c)
        h2 = _to_int32((h2 << 5) + h2 + c * 31)
    return f"fp-{_to_base36(h1 & 0xFFFFFFFF)}{_to_base36(h2 & 0xFFFFFFFF)}"


def _with_scheme(url: str) -> str:
    return url if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url) else f"https://{url}"


def normalize_url_for_compare(url: Any) -> str:
    """Port of TS ``normalizeMcpUrlForCompare``."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(_with_scheme(raw))
        host = (parts.hostname or "").lower()
        if not host:
            raise ValueError("no host")
        port = parts.port
        scheme = parts.scheme.lower()
        if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
            host = f"{host}:{port}"
        path = re.sub(r"/+$", "", parts.path or "")
        search = f"?{parts.query}" if parts.query else ""
        return f"{scheme}://{host}{path}{search}"
    except ValueError:
        return re.sub(r"/+$", "", raw).lower()


def is_valid_http_url(url: Any) -> bool:
    raw = str(url or "").strip()
    if not raw:
        return False
    try:
        parts = urlsplit(_with_scheme(raw))
        return parts.scheme.lower() in ("http", "https") and bool(parts.hostname)
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def load_connector_templates() -> List[Dict[str, Any]]:
    try:
        payload = json.loads(_TEMPLATES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rows = payload.get("templates") if isinstance(payload, dict) else None
    return [r for r in rows or [] if isinstance(r, dict) and r.get("id")]


def find_template(template_id: str) -> Optional[Dict[str, Any]]:
    tid = str(template_id or "").strip()
    if not tid:
        return None
    for tpl in load_connector_templates():
        if tpl.get("id") == tid:
            return tpl
    return None


def filter_templates(templates: List[Dict[str, Any]], query: str) -> List[Dict[str, Any]]:
    q = str(query or "").strip().lower()
    if not q:
        return list(templates)
    return [
        t
        for t in templates
        if any(q in str(t.get(f, "")).lower() for f in ("name", "id", "category"))
        or str(t.get("name", "")).lower() in q
    ]


# ---------------------------------------------------------------------------
# mcp.json document
# ---------------------------------------------------------------------------


def default_mcp_path() -> Path:
    return Path.home() / ".agenticx" / "mcp.json"


class McpDocError(ValueError):
    pass


def read_mcp_doc(path: Optional[Path] = None) -> Dict[str, Any]:
    p = path or default_mcp_path()
    if not p.exists():
        return {"mcpServers": {}}
    try:
        doc = json.loads(p.read_text(encoding="utf-8") or "{}")
    except ValueError as exc:
        raise McpDocError(f"invalid JSON in {p}") from exc
    if not isinstance(doc, dict):
        raise McpDocError(f"{p} must contain a JSON object")
    return doc


def write_mcp_doc(doc: Dict[str, Any], path: Optional[Path] = None) -> None:
    """Atomic write; keeps existing file mode (new files are 0600 — they hold secrets)."""
    p = path or default_mcp_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    mode = 0o600
    try:
        mode = p.stat().st_mode & 0o777
    except OSError:
        pass
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=".mcp.", suffix=".json", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def servers_map(doc: Dict[str, Any]) -> Dict[str, Any]:
    nested = doc.get("mcpServers")
    return dict(nested) if isinstance(nested, dict) else {}


def _meta(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    meta = raw.get(META_KEY)
    return dict(meta) if isinstance(meta, dict) else {}


# Mirrors desktop gateway-model GATEWAY_DEFAULT_SERVER_NAME / GATEWAY_LOCAL_SERVER_NAME.
GATEWAY_SERVER_NAMES = frozenset({"connector-runtime", "connector-runtime-local"})


def is_connector_entry(raw: Any) -> bool:
    """Port of TS ``isCustomConnectorMcpConfig``."""
    if not isinstance(raw, dict):
        return False
    if str(_meta(raw).get("source") or "").strip() == SOURCE_CONNECTOR:
        return True
    if str(raw.get("command") or "").strip():
        return False
    url = str(raw.get("url") or "").strip()
    return bool(url and re.match(r"^https?://", url, re.I))


def _headers(raw: Dict[str, Any]) -> Dict[str, str]:
    h = raw.get("headers")
    if not isinstance(h, dict):
        return {}
    return {str(k).strip(): v for k, v in h.items() if isinstance(v, str) and str(k).strip()}


def list_instances(doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Internal view (includes fingerprint; never return directly to the model)."""
    out: List[Dict[str, Any]] = []
    for name, raw in servers_map(doc).items():
        server = str(name).strip()
        # The connector gateway entries are infrastructure (REST connectors are
        # listed via the gateway itself), not user connector instances.
        if not server or server in GATEWAY_SERVER_NAMES or not is_connector_entry(raw):
            continue
        meta = _meta(raw)
        headers = _headers(raw)
        url = str(raw.get("url") or "").strip()
        style = str(meta.get("authStyle") or "").strip()
        query_key = str(meta.get("authQuery") or "").strip()
        has_query_secret = bool(
            style == "query"
            and query_key
            and any(k == query_key and v for k, v in parse_qsl(urlsplit(url).query))
        ) if url else False
        kind = str(meta.get("kind") or "").strip() or "mcp"
        row = {
            "server_name": server,
            "display_name": str(meta.get("displayName") or "").strip() or server,
            "template_id": str(meta.get("templateId") or "").strip() or None,
            "url": url or None,
            "credential_fingerprint": credential_fingerprint(headers),
            "has_credential": bool(credential_fingerprint(headers)) or has_query_secret,
            "auth_style": style or None,
            "kind": kind,
        }
        if kind == "database":
            env = raw.get("env") if isinstance(raw.get("env"), dict) else {}
            db_type = str(meta.get("dbType") or env.get("AGX_DB_TYPE") or "").strip()
            row["db_type"] = db_type or None
            row["db_identity"] = str(meta.get("dbIdentity") or "").strip() or None
            row["has_credential"] = db_type == "sqlite" or bool(str(env.get("AGX_DB_PASSWORD") or "").strip())
            row["auth_style"] = "none" if db_type == "sqlite" else "password"
            row["read_only"] = str(env.get("AGX_DB_ALLOW_WRITES") or "").strip().lower() not in ("1", "true", "yes")
        out.append(row)
    return out


def redact_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    if not parts.query:
        return url
    q = [(k, "***" if v else v) for k, v in parse_qsl(parts.query, keep_blank_values=True)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q, safe="*"), parts.fragment))


def public_instance(inst: Dict[str, Any], connected: Optional[set] = None) -> Dict[str, Any]:
    row = {
        "server_name": inst["server_name"],
        "display_name": inst["display_name"],
        "template_id": inst.get("template_id"),
        "url": redact_url(inst.get("url")),
        "has_credential": bool(inst.get("has_credential")),
        "auth_style": inst.get("auth_style"),
    }
    if inst.get("kind") and inst.get("kind") != "mcp":
        row["kind"] = inst["kind"]
    for key in ("db_type", "read_only"):
        if key in inst:
            row[key] = inst[key]
    if connected is not None:
        row["connected"] = inst["server_name"] in connected
    return row


def find_existing(
    instances: List[Dict[str, Any]],
    *,
    template_id: Optional[str] = None,
    fingerprint: str = "",
    url: Optional[str] = None,
) -> Optional[Tuple[Dict[str, Any], str]]:
    """Port of TS ``findExistingConnectorInstance``."""
    tid = str(template_id or "").strip()
    if tid:
        same = [i for i in instances if i.get("template_id") == tid]
        if fingerprint:
            hit = next((i for i in same if i["credential_fingerprint"] == fingerprint), None)
            if hit:
                return hit, "same_credential"
        if same:
            return same[0], "same_template"
        slug = template_slug(tid)
        legacy = next(
            (i for i in instances if not i.get("template_id") and i["server_name"] == slug), None
        ) if slug else None
        if legacy:
            return legacy, "same_server_name"
    norm = normalize_url_for_compare(url)
    if norm:
        hit = next(
            (
                i
                for i in instances
                if normalize_url_for_compare(i.get("url")) == norm
                and i["credential_fingerprint"] == fingerprint
            ),
            None,
        )
        if hit:
            return hit, "same_endpoint"
    return None


def is_name_taken(instances: List[Dict[str, Any]], name: str, except_server: Optional[str] = None) -> bool:
    """Port of TS ``isConnectorNameTaken``."""
    want = str(name or "").strip().lower()
    if not want:
        return False
    server = sanitize_server_name(name)
    return any(
        i["server_name"] != except_server
        and (i["display_name"].strip().lower() == want or (server != "" and i["server_name"] == server))
        for i in instances
    )


# ---------------------------------------------------------------------------
# Mutations (pure: doc in → (doc out, result))
# ---------------------------------------------------------------------------


def _normalize_url(raw: str) -> str:
    t = str(raw or "").strip()
    return _with_scheme(t) if t else t


def _clean_header_name(name: Any) -> str:
    return _INVALID_HEADER_RE.sub("", str(name or "").strip())[:64]


def _clean_query_name(name: Any) -> str:
    return _INVALID_QUERY_RE.sub("", str(name or "").strip())[:64]


def _apply_secret(
    url: str,
    headers: Dict[str, str],
    *,
    auth_style: str,
    secret: str,
    header_name: str,
    query_param: str,
) -> Tuple[str, Dict[str, str]]:
    headers = dict(headers)
    if auth_style == "bearer":
        headers["Authorization"] = f"Bearer {secret}"
    elif auth_style == "header":
        headers[header_name or DEFAULT_AUTH_HEADER] = secret
    elif auth_style == "query":
        parts = urlsplit(url)
        key = query_param or DEFAULT_AUTH_QUERY
        q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != key]
        q.append((key, secret))
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))
    return url, headers


def _build_entry(
    *,
    url: str,
    headers: Dict[str, str],
    prev: Optional[Dict[str, Any]],
    template_id: Optional[str],
    display_name: str,
    auth_style: str,
    header_name: str,
    query_param: str,
) -> Dict[str, Any]:
    entry: Dict[str, Any] = {}
    if isinstance(prev, dict):
        # Keep unrelated fields (timeout, transport…) of an instance we own.
        entry.update({k: v for k, v in prev.items() if k not in ("url", "headers", META_KEY)})
    entry["url"] = url
    clean = {k: v for k, v in headers.items() if k and v}
    if clean:
        entry["headers"] = clean
    meta = _meta(prev)
    if template_id:
        meta["templateId"] = template_id
    if display_name:
        meta["displayName"] = display_name
    meta["authStyle"] = auth_style
    meta.pop("authHeader", None)
    meta.pop("authQuery", None)
    if auth_style == "header":
        meta["authHeader"] = header_name or DEFAULT_AUTH_HEADER
    if auth_style == "query":
        meta["authQuery"] = query_param or DEFAULT_AUTH_QUERY
    meta.setdefault("createdVia", "chat")
    meta["source"] = SOURCE_CONNECTOR
    entry[META_KEY] = meta
    return entry


def upsert_connector(
    doc: Dict[str, Any],
    *,
    name: str,
    url: str,
    template_id: Optional[str] = None,
    auth_style: str = "none",
    header_name: str = "",
    query_param: str = "",
    secret: Optional[str] = None,
    overwrite: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """Mirror of TS ``applyCreateConnectorToMcpJson``.

    Returns ``(new_doc_or_None, result)``; ``new_doc`` is None when nothing must be written.
    ``result`` never contains secrets.
    """
    display = str(name or "").strip()
    if not display:
        return None, {"ok": False, "error": "invalid_form", "field": "name"}
    if not sanitize_server_name(display):
        return None, {"ok": False, "error": "invalid_form", "field": "name"}
    if not is_valid_http_url(url):
        return None, {"ok": False, "error": "invalid_form", "field": "url"}
    style = auth_style if auth_style in AUTH_STYLES else "none"
    hname = _clean_header_name(header_name) if style == "header" else ""
    qname = _clean_query_name(query_param) if style == "query" else ""
    tid = str(template_id or "").strip() or None
    if tid and find_template(tid) is None:
        return None, {"ok": False, "error": "unknown_template", "template_id": tid}

    servers = servers_map(doc)
    instances = list_instances(doc)
    base_url = _normalize_url(url)
    draft_url, draft_headers = base_url, {}
    if secret:
        draft_url, draft_headers = _apply_secret(
            base_url, {}, auth_style=style, secret=secret, header_name=hname, query_param=qname
        )
    draft_fp = credential_fingerprint(draft_headers)

    found = find_existing(instances, template_id=tid, fingerprint=draft_fp, url=draft_url)
    if found:
        target, reason = found
        if not overwrite:
            return None, {
                "ok": False,
                "error": "exists",
                "reason": reason,
                "existing": public_instance(target),
            }
        if is_name_taken(instances, display, target["server_name"]):
            return None, {"ok": False, "error": "duplicate", "name": display}
        prev = servers.get(target["server_name"])
        prev_headers = _headers(prev) if isinstance(prev, dict) else {}
        prev_meta = _meta(prev)
        style_changed = str(prev_meta.get("authStyle") or "") not in ("", style)
        if secret:
            new_url, new_headers = draft_url, draft_headers
        elif style_changed:
            # Auth style changed and no new secret: drop stale credential, ask again later.
            new_url, new_headers = base_url, {}
        else:
            new_url = base_url
            if style == "query" and target.get("url"):
                key = qname or DEFAULT_AUTH_QUERY
                old_q = dict(parse_qsl(urlsplit(target["url"]).query))
                if old_q.get(key):
                    new_url, _ = _apply_secret(
                        base_url, {}, auth_style="query", secret=old_q[key],
                        header_name="", query_param=key,
                    )
            new_headers = prev_headers
        entry = _build_entry(
            url=new_url,
            headers=new_headers,
            prev=prev if isinstance(prev, dict) else None,
            template_id=tid,
            display_name=display,
            auth_style=style,
            header_name=hname,
            query_param=qname,
        )
        if entry == prev:
            return None, {
                "ok": True,
                "action": "unchanged",
                "server_name": target["server_name"],
                "display_name": target["display_name"],
            }
        servers[target["server_name"]] = entry
        new_doc = {**doc, "mcpServers": servers}
        return new_doc, {
            "ok": True,
            "action": "updated",
            "server_name": target["server_name"],
            "display_name": display,
        }

    if is_name_taken(instances, display):
        return None, {"ok": False, "error": "duplicate", "name": display}
    server = template_slug(tid) or sanitize_server_name(display)
    if server in servers:
        # Occupied by a non-connector (stdio / marketplace) entry: never overwrite — suffix.
        base = sanitize_server_name(display) or server
        candidate, n = base, 2
        while candidate in servers:
            candidate = f"{base}-{n}"
            n += 1
        server = candidate
    servers[server] = _build_entry(
        url=draft_url,
        headers=draft_headers,
        prev=None,
        template_id=tid,
        display_name=display,
        auth_style=style,
        header_name=hname,
        query_param=qname,
    )
    return {**doc, "mcpServers": servers}, {
        "ok": True,
        "action": "created",
        "server_name": server,
        "display_name": display,
    }


def set_connector_credential(
    doc: Dict[str, Any], *, server_name: str, secret: str
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """Store ``secret`` on an existing connector instance per its ``authStyle``."""
    servers = servers_map(doc)
    raw = servers.get(server_name)
    if not isinstance(raw, dict) or not is_connector_entry(raw):
        return None, {"ok": False, "error": "not_found", "server_name": server_name}
    if str(_meta(raw).get("kind") or "") == "database" or str(raw.get("command") or "").strip():
        # stdio entries (database connectors) keep secrets in env, not url/headers.
        return None, {"ok": False, "error": "wrong_kind", "server_name": server_name}
    secret = str(secret or "").strip()
    if not secret:
        return None, {"ok": False, "error": "empty_secret"}
    meta = _meta(raw)
    style = str(meta.get("authStyle") or "bearer")
    if style == "none":
        style = "bearer"
    hname = str(meta.get("authHeader") or "")
    qname = str(meta.get("authQuery") or "")
    url = str(raw.get("url") or "")
    headers = _headers(raw)
    if style == "bearer":
        headers = {k: v for k, v in headers.items() if k.lower() != "authorization"}
    new_url, new_headers = _apply_secret(
        url, headers, auth_style=style, secret=secret, header_name=hname, query_param=qname
    )
    fp = credential_fingerprint(new_headers)
    tid = str(meta.get("templateId") or "").strip()
    if tid and fp:
        clash = next(
            (
                i
                for i in list_instances(doc)
                if i["server_name"] != server_name
                and i.get("template_id") == tid
                and i["credential_fingerprint"] == fp
            ),
            None,
        )
        if clash:
            return None, {"ok": False, "error": "exists", "reason": "same_credential", "existing": public_instance(clash)}
    entry = dict(raw)
    entry["url"] = new_url
    if new_headers:
        entry["headers"] = new_headers
    else:
        entry.pop("headers", None)
    meta["authStyle"] = style
    meta["source"] = SOURCE_CONNECTOR
    entry[META_KEY] = meta
    if entry == raw:
        return None, {"ok": True, "action": "unchanged", "server_name": server_name}
    servers[server_name] = entry
    return {**doc, "mcpServers": servers}, {"ok": True, "action": "credential_saved", "server_name": server_name}


def scrub_secret(text: str, secret: Optional[str]) -> str:
    """Remove a secret (and its Bearer form) from arbitrary text before it reaches the model."""
    out = str(text or "")
    s = str(secret or "").strip()
    if s and len(s) >= 4:
        out = out.replace(s, "***")
    return out
