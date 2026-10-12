"""Build connector-runtime REST connector definitions from OpenAPI/Swagger or a
short endpoint list.

Output matches ``connector-runtime/internal/model`` (the JSON format the gateway
loads at startup): ``{id, displayName, baseUrl, auth, actions[{id, title,
operationType, inputSchema, http{method, path, query, headers, bodyField}}]}``.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlsplit

from agenticx.utils.proxy_policy import make_client

MAX_ACTIONS = 120
_ID_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$")
_HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head")
_SKIP_HEADERS = {"authorization", "content-type", "accept", "user-agent", "cookie"}


class SpecError(ValueError):
    pass


def connector_id_from_name(name: str, fallback: str = "rest-api") -> str:
    """Slug valid for the gateway id regex; non-ASCII names fall back to a hash suffix."""
    raw = str(name or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")[:48].strip("-")
    if not slug:
        import hashlib

        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:8] if raw else ""
        slug = f"{fallback}-{digest}" if digest else fallback
    if not _ID_RE.match(slug):
        slug = fallback
    return slug


def _safe_key(name: str) -> str:
    key = re.sub(r"[^A-Za-z0-9_]", "_", str(name or "")).strip("_")
    if not key:
        key = "param"
    if key[0].isdigit():
        key = f"p_{key}"
    return key


def _snake(text: str) -> str:
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(text or ""))
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").lower()
    return s[:60].strip("_")


def load_spec_text(source: str, *, timeout: float = 20.0) -> Tuple[Dict[str, Any], Optional[str]]:
    """Load an OpenAPI/Swagger document from an http(s) URL or local file path.

    Returns ``(spec, spec_url)``; ``spec_url`` is set for URL sources (used to
    resolve relative ``servers[].url``)."""
    src = str(source or "").strip()
    if not src:
        raise SpecError("empty spec source")
    spec_url: Optional[str] = None
    if re.match(r"^https?://", src, re.I):
        with make_client(timeout=timeout, follow_redirects=True) as c:
            resp = c.get(src, headers={"Accept": "application/json, application/yaml, text/yaml, */*"})
        if resp.status_code >= 400:
            raise SpecError(f"fetch spec failed: HTTP {resp.status_code}")
        text = resp.text
        spec_url = str(resp.url)
    else:
        path = Path(src).expanduser()
        if not path.is_file():
            raise SpecError(f"spec file not found: {path}")
        if path.stat().st_size > 8 * 1024 * 1024:
            raise SpecError("spec file too large (>8MB)")
        text = path.read_text(encoding="utf-8")
    return parse_spec_text(text), spec_url


def parse_spec_text(text: str) -> Dict[str, Any]:
    try:
        doc = json.loads(text)
    except ValueError:
        try:
            import yaml  # type: ignore

            doc = yaml.safe_load(text)
        except Exception as exc:  # pragma: no cover - yaml errors vary
            raise SpecError(f"spec is neither JSON nor YAML: {type(exc).__name__}") from None
    if not isinstance(doc, dict) or not (doc.get("openapi") or doc.get("swagger")):
        raise SpecError("not an OpenAPI/Swagger document (missing openapi/swagger field)")
    if not isinstance(doc.get("paths"), dict):
        raise SpecError("spec has no paths")
    return doc


def _resolve(doc: Dict[str, Any], node: Any, refs: int = 0, nest: int = 0) -> Any:
    """Inline local ``$ref`` (ref hops and nesting depth-limited; cycles collapse to a plain object)."""
    if refs > 8 or nest > 40:
        return {"type": "object"}
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/"):
            target: Any = doc
            for part in ref[2:].split("/"):
                part = part.replace("~1", "/").replace("~0", "~")
                target = target.get(part) if isinstance(target, dict) else None
                if target is None:
                    return {"type": "object"}
            return _resolve(doc, target, refs + 1, nest + 1)
        return {k: _resolve(doc, v, refs, nest + 1) for k, v in node.items() if k not in ("example", "examples", "xml")}
    if isinstance(node, list):
        return [_resolve(doc, v, refs, nest + 1) for v in node]
    return node


def _server_base(doc: Dict[str, Any], spec_url: Optional[str]) -> Optional[str]:
    if doc.get("swagger"):
        host = str(doc.get("host") or "").strip()
        base_path = str(doc.get("basePath") or "").strip()
        schemes = doc.get("schemes") or []
        scheme = "https" if "https" in schemes or not schemes else str(schemes[0])
        if host:
            return f"{scheme}://{host}{base_path}".rstrip("/")
        if spec_url:
            parts = urlsplit(spec_url)
            return f"{parts.scheme}://{parts.netloc}{base_path}".rstrip("/")
        return None
    servers = doc.get("servers") or []
    if servers and isinstance(servers[0], dict):
        url = str(servers[0].get("url") or "").strip()
        for var, spec in (servers[0].get("variables") or {}).items():
            if isinstance(spec, dict) and "default" in spec:
                url = url.replace("{" + str(var) + "}", str(spec["default"]))
        if url and not re.match(r"^https?://", url, re.I):
            if not spec_url:
                return None
            url = urljoin(spec_url, url)
        return url.rstrip("/") or None
    if spec_url:
        parts = urlsplit(spec_url)
        return f"{parts.scheme}://{parts.netloc}"
    return None


def suggest_auth(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map the first security scheme to a gateway auth spec (best effort)."""
    schemes = (doc.get("components") or {}).get("securitySchemes") or doc.get("securityDefinitions") or {}
    for _name, raw in schemes.items():
        sch = _resolve(doc, raw)
        if not isinstance(sch, dict):
            continue
        typ = str(sch.get("type") or "").lower()
        if typ == "apikey" and sch.get("in") in ("header", "query") and sch.get("name"):
            return {"type": "api_key", "apiKey": {"in": sch["in"], "name": sch["name"]}}
        if typ == "http" and str(sch.get("scheme") or "").lower() == "bearer":
            return {"type": "bearer"}
        if typ == "oauth2":
            flows = sch.get("flows") or {}
            if "clientCredentials" in flows:
                f = flows["clientCredentials"]
                return {"type": "oauth2", "oauth2": {"grant": "client_credentials", "tokenUrl": f.get("tokenUrl", ""), "scopes": sorted((f.get("scopes") or {}).keys())}}
            if "authorizationCode" in flows:
                f = flows["authorizationCode"]
                return {"type": "oauth2", "oauth2": {"grant": "authorization_code", "tokenUrl": f.get("tokenUrl", ""), "authorizeUrl": f.get("authorizationUrl", ""), "scopes": sorted((f.get("scopes") or {}).keys())}}
            if sch.get("flow") == "application":  # swagger 2
                return {"type": "oauth2", "oauth2": {"grant": "client_credentials", "tokenUrl": sch.get("tokenUrl", ""), "scopes": sorted((sch.get("scopes") or {}).keys())}}
            if sch.get("flow") == "accessCode":
                return {"type": "oauth2", "oauth2": {"grant": "authorization_code", "tokenUrl": sch.get("tokenUrl", ""), "authorizeUrl": sch.get("authorizationUrl", ""), "scopes": sorted((sch.get("scopes") or {}).keys())}}
    return None


def _op_type(method: str) -> str:
    m = method.upper()
    if m in ("GET", "HEAD"):
        return "read"
    if m == "DELETE":
        return "destructive"
    return "write"


def _param_schema(p: Dict[str, Any]) -> Dict[str, Any]:
    sch = p.get("schema") if isinstance(p.get("schema"), dict) else {k: p[k] for k in ("type", "format", "enum", "items") if k in p}
    out = dict(sch or {"type": "string"})
    if p.get("description"):
        out["description"] = str(p["description"])[:300]
    return out


def actions_from_openapi(doc: Dict[str, Any], connector_id: str, *, include_writes: bool = True, max_actions: int = MAX_ACTIONS) -> Tuple[List[Dict[str, Any]], int]:
    """Returns ``(actions, skipped_count)``."""
    actions: List[Dict[str, Any]] = []
    seen_ids: set = set()
    skipped = 0
    for raw_path, item in (doc.get("paths") or {}).items():
        item = _resolve(doc, item)
        if not isinstance(item, dict):
            continue
        shared = item.get("parameters") or []
        for method in _HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            if not include_writes and method not in ("get", "head"):
                skipped += 1
                continue
            if len(actions) >= max_actions:
                skipped += 1
                continue
            params = [p for p in (list(shared) + list(op.get("parameters") or [])) if isinstance(p, dict)]
            # later (operation-level) params override path-level ones
            by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
            for p in params:
                by_key[(str(p.get("in")), str(p.get("name")))] = p
            props: Dict[str, Any] = {}
            required: List[str] = []
            path = str(raw_path)
            query: Dict[str, str] = {}
            headers: Dict[str, str] = {}
            body_field: Optional[str] = None
            for (where, name), p in by_key.items():
                key = _safe_key(name)
                if where == "path":
                    path = path.replace("{" + name + "}", "{" + key + "}")
                    required.append(key)
                elif where == "query":
                    query[name] = "{" + key + "}"
                    if p.get("required"):
                        required.append(key)
                elif where == "header":
                    if name.lower() in _SKIP_HEADERS:
                        continue
                    if not p.get("required"):
                        continue  # optional headers would fail templating; skip
                    headers[name] = "{" + key + "}"
                    required.append(key)
                elif where == "body":  # swagger 2
                    props["body"] = _param_schema(p)
                    body_field = "body"
                    if p.get("required"):
                        required.append("body")
                    continue
                else:
                    continue
                props[key] = _param_schema(p)
            rb = op.get("requestBody")
            if isinstance(rb, dict):
                content = rb.get("content") or {}
                media = content.get("application/json") or next(iter(content.values()), None) if content else None
                schema = (media or {}).get("schema") if isinstance(media, dict) else None
                props["body"] = dict(schema or {"type": "object"})
                if rb.get("description"):
                    props["body"]["description"] = str(rb["description"])[:300]
                body_field = "body"
                if rb.get("required"):
                    required.append("body")
            op_id = _snake(op.get("operationId") or "") or _snake(f"{method}_{raw_path}")
            aid = f"{connector_id}.{op_id}"
            n = 2
            while aid in seen_ids:
                aid = f"{connector_id}.{op_id}_{n}"
                n += 1
            seen_ids.add(aid)
            title = str(op.get("summary") or op.get("operationId") or f"{method.upper()} {raw_path}").strip()[:120]
            http: Dict[str, Any] = {"method": method.upper(), "path": path if path.startswith("/") else "/" + path}
            if query:
                http["query"] = query
            if headers:
                http["headers"] = headers
            if body_field:
                http["bodyField"] = body_field
            schema_obj: Dict[str, Any] = {"type": "object", "properties": props}
            if required:
                schema_obj["required"] = sorted(set(required))
            act: Dict[str, Any] = {
                "id": aid,
                "title": title or aid,
                "operationType": _op_type(method),
                "inputSchema": schema_obj,
                "http": http,
            }
            desc = str(op.get("description") or "").strip()
            if desc:
                act["description"] = desc[:400]
            actions.append(act)
    return actions, skipped


_ENDPOINT_LINE = re.compile(r"^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(/\S*)\s*(.*)$", re.I)


def actions_from_endpoint_list(lines: List[str] | str, connector_id: str) -> List[Dict[str, Any]]:
    """Parse ``METHOD /path[?q1&q2] 描述`` lines (one per endpoint)."""
    if isinstance(lines, str):
        lines = [x for x in re.split(r"[\n;]+", lines)]
    actions: List[Dict[str, Any]] = []
    seen: set = set()
    for line in lines:
        m = _ENDPOINT_LINE.match(str(line or ""))
        if not m:
            continue
        method, full_path, desc = m.group(1).upper(), m.group(2), m.group(3).strip(" -:：")
        path, _, qs = full_path.partition("?")
        props: Dict[str, Any] = {}
        required: List[str] = []
        new_path = path
        for name in re.findall(r"\{([^}/]+)\}", path):
            key = _safe_key(name)
            new_path = new_path.replace("{" + name + "}", "{" + key + "}")
            props[key] = {"type": "string"}
            required.append(key)
        query: Dict[str, str] = {}
        for q in [x for x in qs.split("&") if x]:
            qn = q.split("=", 1)[0]
            key = _safe_key(qn)
            query[qn] = "{" + key + "}"
            props[key] = {"type": "string"}
        http: Dict[str, Any] = {"method": method, "path": new_path or "/"}
        if query:
            http["query"] = query
        if method in ("POST", "PUT", "PATCH"):
            props["body"] = {"type": "object", "description": "JSON 请求体"}
            http["bodyField"] = "body"
        base_id = _snake(f"{method}_{path}") or method.lower()
        aid = f"{connector_id}.{base_id}"
        n = 2
        while aid in seen:
            aid = f"{connector_id}.{base_id}_{n}"
            n += 1
        seen.add(aid)
        schema: Dict[str, Any] = {"type": "object", "properties": props}
        if required:
            schema["required"] = required
        actions.append({
            "id": aid,
            "title": (desc or f"{method} {path}")[:120],
            "operationType": _op_type(method),
            "inputSchema": schema,
            "http": http,
        })
    return actions


def build_connector(
    *,
    connector_id: str,
    display_name: str,
    base_url: str,
    auth: Dict[str, Any],
    actions: List[Dict[str, Any]],
    description: str = "",
    allow_private_network: bool = False,
) -> Dict[str, Any]:
    if not _ID_RE.match(connector_id):
        raise SpecError(f"invalid connector id: {connector_id}")
    if not actions:
        raise SpecError("no endpoints/actions found")
    parts = urlsplit(base_url)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment or "@" in parts.netloc:
        raise SpecError("base_url must be http(s) without query/fragment/userinfo")
    out: Dict[str, Any] = {
        "id": connector_id,
        "displayName": display_name or connector_id,
        "baseUrl": base_url.rstrip("/"),
        "auth": auth,
        "actions": actions,
        "categories": ["custom", "rest"],
    }
    if description:
        out["description"] = description[:400]
    if allow_private_network:
        out["allowPrivateNetwork"] = True
    return out
