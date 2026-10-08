"""OAuth 2.0 helpers for chat-created connectors.

* :func:`run_pkce_authorization` — authorization_code + PKCE (S256) through the
  system browser and a one-shot loopback redirect (``http://127.0.0.1:<port>/callback``,
  RFC 8252). Returns tokens to the caller only (never to the model / logs).
* :func:`exchange_client_credentials` — one-off client_credentials probe (the
  gateway itself performs and refreshes this grant at execution time).
* :func:`build_mcp_oauth_provider` — standard MCP authorization flow for remote
  MCP servers (``mcp.client.auth.OAuthClientProvider``) with a 0600 file token
  store under ``~/.agenticx/connectors/oauth/``.

All HTTP goes through :mod:`agenticx.utils.proxy_policy`.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import socket
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlsplit

from agenticx.utils.proxy_policy import make_async_client

_SUCCESS_HTML = (
    "<html><head><meta charset='utf-8'><title>AgenticX</title></head>"
    "<body style='font-family:sans-serif;padding:40px'><h3>授权完成，可以关闭此页面并回到 Near。</h3></body></html>"
)
_FAIL_HTML = (
    "<html><head><meta charset='utf-8'><title>AgenticX</title></head>"
    "<body style='font-family:sans-serif;padding:40px'><h3>授权未完成：{msg}</h3></body></html>"
)


class OAuthFlowError(RuntimeError):
    pass


def pkce_pair() -> Tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class LoopbackReceiver:
    """One-shot HTTP server on 127.0.0.1 capturing ``?code=&state=``."""

    def __init__(self, port: int = 0, path: str = "/callback") -> None:
        self.path = path
        self._result: Dict[str, str] = {}
        self._event = threading.Event()
        receiver = self

        class _Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                parts = urlsplit(self.path)
                if parts.path != receiver.path:
                    self.send_response(404)
                    self.end_headers()
                    return
                q = {k: v[0] for k, v in parse_qs(parts.query).items()}
                receiver._result = q
                ok = "code" in q and "error" not in q
                body = (_SUCCESS_HTML if ok else _FAIL_HTML.format(msg=str(q.get("error", "unknown"))[:80])).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                receiver._event.set()

            def log_message(self, *_a: Any) -> None:  # keep codes out of logs
                return

        self._server = HTTPServer(("127.0.0.1", port), _Handler)
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def redirect_uri(self) -> str:
        return f"http://127.0.0.1:{self.port}{self.path}"

    async def wait(self, timeout: float) -> Dict[str, str]:
        loop = asyncio.get_running_loop()
        got = await loop.run_in_executor(None, self._event.wait, timeout)
        if not got:
            raise OAuthFlowError("等待浏览器授权超时")
        return dict(self._result)

    def close(self) -> None:
        try:
            self._server.shutdown()
            self._server.server_close()
        except Exception:
            pass


async def _post_token(token_url: str, form: Dict[str, str], client_id: str, client_secret: str, client_auth: str) -> Dict[str, Any]:
    data = dict(form)
    auth = None
    if client_auth == "basic" and client_secret:
        auth = (client_id, client_secret)
    else:
        data["client_id"] = client_id
        if client_secret:
            data["client_secret"] = client_secret
    async with make_async_client(timeout=20.0) as c:
        resp = await c.post(token_url, data=data, auth=auth, headers={"Accept": "application/json"})
    try:
        payload = resp.json()
    except ValueError:
        payload = dict(parse_qsl_safe(resp.text))
    if resp.status_code >= 400 or not payload.get("access_token"):
        err = str(payload.get("error") or f"HTTP {resp.status_code}")
        desc = str(payload.get("error_description") or "")[:200]
        raise OAuthFlowError(f"token 端点拒绝: {err} {desc}".strip())
    return payload


def parse_qsl_safe(text: str) -> List[Tuple[str, str]]:
    from urllib.parse import parse_qsl

    try:
        return parse_qsl(text or "")
    except ValueError:
        return []


async def exchange_client_credentials(token_url: str, client_id: str, client_secret: str, scopes: Optional[List[str]] = None, client_auth: str = "body") -> Dict[str, Any]:
    form = {"grant_type": "client_credentials"}
    if scopes:
        form["scope"] = " ".join(scopes)
    return await _post_token(token_url, form, client_id, client_secret, client_auth)


async def run_pkce_authorization(
    *,
    authorize_url: str,
    token_url: str,
    client_id: str,
    client_secret: str = "",
    scopes: Optional[List[str]] = None,
    client_auth: str = "body",
    redirect_port: int = 0,
    timeout: float = 300.0,
    open_url: Optional[Callable[[str], Any]] = None,
    extra_params: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Browser-based authorization_code + PKCE. Returns the token payload
    (``access_token`` / ``refresh_token`` / ``expires_in``)."""
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(24)
    receiver = LoopbackReceiver(port=redirect_port)
    try:
        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": receiver.redirect_uri,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        if scopes:
            params["scope"] = " ".join(scopes)
        params.update(extra_params or {})
        sep = "&" if urlsplit(authorize_url).query else "?"
        opener = open_url or webbrowser.open
        await asyncio.get_running_loop().run_in_executor(None, opener, f"{authorize_url}{sep}{urlencode(params)}")
        result = await receiver.wait(timeout)
    finally:
        receiver.close()
    if result.get("error"):
        raise OAuthFlowError(f"授权被拒绝: {str(result.get('error'))[:80]}")
    if not secrets.compare_digest(str(result.get("state") or ""), state):
        raise OAuthFlowError("state 不匹配，已中止（可能是 CSRF）")
    code = str(result.get("code") or "")
    if not code:
        raise OAuthFlowError("回调缺少 code")
    return await _post_token(
        token_url,
        {"grant_type": "authorization_code", "code": code, "redirect_uri": receiver.redirect_uri, "code_verifier": verifier},
        client_id,
        client_secret,
        client_auth,
    )


# ---- MCP OAuth (remote MCP servers) -------------------------------------------

def _oauth_store_dir() -> Path:
    return Path.home() / ".agenticx" / "connectors" / "oauth"


def _safe_name(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)[:80] or "server"


class FileTokenStorage:
    """0600 JSON file per MCP server: tokens + dynamic client registration + redirect port."""

    def __init__(self, server_name: str) -> None:
        self.path = _oauth_store_dir() / f"{_safe_name(server_name)}.json"

    def _load(self) -> Dict[str, Any]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, self.path)

    def redirect_port(self) -> int:
        data = self._load()
        port = int(data.get("redirect_port") or 0)
        if not port:
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = int(s.getsockname()[1])
            data["redirect_port"] = port
            self._save(data)
        return port

    async def get_tokens(self):  # -> OAuthToken | None
        from mcp.shared.auth import OAuthToken

        raw = self._load().get("tokens")
        return OAuthToken.model_validate(raw) if raw else None

    async def set_tokens(self, tokens) -> None:
        data = self._load()
        data["tokens"] = tokens.model_dump(mode="json", exclude_none=True)
        self._save(data)

    async def get_client_info(self):
        from mcp.shared.auth import OAuthClientInformationFull

        raw = self._load().get("client_info")
        return OAuthClientInformationFull.model_validate(raw) if raw else None

    async def set_client_info(self, client_info) -> None:
        data = self._load()
        data["client_info"] = client_info.model_dump(mode="json", exclude_none=True)
        self._save(data)

    def has_tokens(self) -> bool:
        return bool(self._load().get("tokens"))


def fix_authorize_url(url: str) -> str:
    """Repair the MCP SDK authorize URL when the server's ``authorization_endpoint`` already has
    a query string (e.g. Tencent Docs ``…/open-claw.html?authType=2``): the SDK joins with a second
    ``?``, which would swallow ``response_type`` into ``authType``. Encoded values never contain a
    raw ``?``, so every raw ``?`` after the first is a separator."""
    base, sep, rest = str(url or "").partition("?")
    if not sep or "?" not in rest:
        return url
    return f"{base}?{rest.replace('?', '&')}"


def build_mcp_oauth_provider(server_name: str, server_url: str, *, open_url: Optional[Callable[[str], Any]] = None, timeout: float = 300.0):
    """``httpx.Auth`` implementing the MCP authorization spec (discovery, dynamic
    client registration, PKCE, refresh) with browser + loopback callback."""
    from mcp.client.auth import OAuthClientProvider
    from mcp.shared.auth import OAuthClientMetadata

    storage = FileTokenStorage(server_name)
    port = storage.redirect_port()
    holder: Dict[str, LoopbackReceiver] = {}

    async def _redirect(url: str) -> None:
        holder["rx"] = LoopbackReceiver(port=port)
        await asyncio.get_running_loop().run_in_executor(None, open_url or webbrowser.open, fix_authorize_url(url))

    async def _callback() -> Tuple[str, Optional[str]]:
        rx = holder.get("rx") or LoopbackReceiver(port=port)
        try:
            q = await rx.wait(timeout)
        finally:
            rx.close()
            holder.pop("rx", None)
        if q.get("error") or not q.get("code"):
            raise OAuthFlowError(f"MCP OAuth 授权未完成: {str(q.get('error') or 'missing code')[:80]}")
        return q["code"], q.get("state")

    metadata = OAuthClientMetadata(
        client_name="AgenticX Near",
        redirect_uris=[f"http://127.0.0.1:{port}/callback"],
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
        token_endpoint_auth_method="none",
    )
    return OAuthClientProvider(
        server_url=server_url,
        client_metadata=metadata,
        storage=storage,
        redirect_handler=_redirect,
        callback_handler=_callback,
        timeout=timeout,
    )
