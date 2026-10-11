"""Mock upstream for connector e2e: OpenAPI doc, bearer / HMAC / OAuth-protected
endpoints, an OAuth token endpoint (client_credentials + authorization_code PKCE
+ refresh_token) and an authorize endpoint that immediately redirects.

Usage in tests: ``srv = MockUpstream(); srv.start(); ...; srv.stop()``; or run
``python tests/fixtures/mock_rest_upstream.py <port>`` for manual e2e.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.parse import parse_qs, urlencode, urlsplit

BEARER = "tok-bearer-123"
AK, SK = "AK-demo", "SK-demo-secret"
CLIENT_ID, CLIENT_SECRET = "cid-demo", "csecret-demo"


class _State:
    def __init__(self) -> None:
        self.access_tokens: set = set()
        self.codes: Dict[str, Dict[str, str]] = {}
        self.refresh_tokens: set = set()
        self.calls: list = []


def _openapi(base: str) -> Dict[str, Any]:
    return {
        "openapi": "3.0.3",
        "info": {"title": "Mock Shop", "version": "1"},
        "servers": [{"url": base}],
        "components": {"securitySchemes": {"b": {"type": "http", "scheme": "bearer"}}},
        "security": [{"b": []}],
        "paths": {
            "/items": {"get": {"operationId": "listItems", "summary": "列出商品", "parameters": [{"name": "limit", "in": "query", "schema": {"type": "integer"}}]}},
            "/items/{id}": {"get": {"operationId": "getItem", "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}]}},
            "/orders": {"post": {"operationId": "createOrder", "requestBody": {"content": {"application/json": {"schema": {"type": "object"}}}}}},
        },
    }


def make_handler(state: _State):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            return

        def _json(self, code: int, payload: Any) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _base(self) -> str:
            return f"http://{self.headers.get('Host')}"

        def _body(self) -> bytes:
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _hmac_ok(self, body: bytes) -> bool:
            u = urlsplit(self.path)
            ts = self.headers.get("X-Timestamp", "")
            if self.headers.get("X-Access-Key") != AK or not ts or abs(time.time() - int(ts)) > 300:
                return False
            q = "&".join(sorted(f"{k}={v[0]}" for k, v in parse_qs(u.query).items()))
            sts = "\n".join([self.command, u.path, q, ts, hashlib.sha256(body).hexdigest()])
            want = hmac.new(SK.encode(), sts.encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(want, self.headers.get("X-Signature", ""))

        def _route(self) -> None:
            u = urlsplit(self.path)
            body = self._body()
            state.calls.append((self.command, u.path))
            auth = self.headers.get("Authorization", "")
            if u.path == "/openapi.json":
                return self._json(200, _openapi(self._base()))
            if u.path == "/authorize":
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                code = secrets.token_hex(8)
                state.codes[code] = {"challenge": q.get("code_challenge", ""), "redirect_uri": q.get("redirect_uri", "")}
                loc = q["redirect_uri"] + "?" + urlencode({"code": code, "state": q.get("state", "")})
                self.send_response(302)
                self.send_header("Location", loc)
                self.end_headers()
                return
            if u.path == "/token" and self.command == "POST":
                form = {k: v[0] for k, v in parse_qs(body.decode()).items()}
                if form.get("client_id") != CLIENT_ID:
                    return self._json(401, {"error": "invalid_client"})
                gt = form.get("grant_type")
                if gt == "client_credentials":
                    if form.get("client_secret") != CLIENT_SECRET:
                        return self._json(401, {"error": "invalid_client"})
                elif gt == "authorization_code":
                    rec = state.codes.pop(form.get("code", ""), None)
                    ver = form.get("code_verifier", "")
                    chal = base64.urlsafe_b64encode(hashlib.sha256(ver.encode()).digest()).rstrip(b"=").decode()
                    if not rec or rec["challenge"] != chal or rec["redirect_uri"] != form.get("redirect_uri"):
                        return self._json(400, {"error": "invalid_grant"})
                elif gt == "refresh_token":
                    if form.get("refresh_token") not in state.refresh_tokens:
                        return self._json(400, {"error": "invalid_grant"})
                else:
                    return self._json(400, {"error": "unsupported_grant_type"})
                at = "at-" + secrets.token_hex(8)
                state.access_tokens.add(at)
                out = {"access_token": at, "token_type": "Bearer", "expires_in": 3600}
                if gt in ("authorization_code", "refresh_token"):
                    rt = "rt-" + secrets.token_hex(8)
                    state.refresh_tokens.add(rt)
                    out["refresh_token"] = rt
                return self._json(200, out)
            if u.path.startswith("/signed/"):
                if not self._hmac_ok(body):
                    return self._json(401, {"error": "bad signature"})
                return self._json(200, {"ok": True, "signed": True, "path": u.path})
            if u.path.startswith("/oauth/"):
                if auth[7:] not in state.access_tokens:
                    return self._json(401, {"error": "bad token"})
                return self._json(200, {"ok": True, "oauth": True})
            if u.path.startswith("/items") or u.path.startswith("/orders"):
                if auth != f"Bearer {BEARER}":
                    return self._json(401, {"error": "unauthorized"})
                if u.path == "/orders":
                    return self._json(200, {"created": json.loads(body or b"{}")})
                return self._json(200, {"items": [{"id": "1"}, {"id": "2"}], "query": u.query})
            return self._json(404, {"error": "not found"})

        do_GET = _route
        do_POST = _route
        do_PUT = _route
        do_DELETE = _route

    return H


class MockUpstream:
    def __init__(self, port: int = 0) -> None:
        self.state = _State()
        self.server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(self.state))
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._t = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> "MockUpstream":
        self._t.start()
        return self

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


if __name__ == "__main__":
    srv = MockUpstream(int(sys.argv[1]) if len(sys.argv) > 1 else 0).start()
    print(srv.base, flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        srv.stop()
