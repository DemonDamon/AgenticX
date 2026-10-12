"""Proxy policy: loopback always direct; remote via proxy when alive; dead proxy → direct."""

from __future__ import annotations

import asyncio
import socket
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from agenticx.utils import proxy_policy as pp


def _dead_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class _Ok(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        return


@pytest.fixture()
def local_server():
    srv = HTTPServer(("127.0.0.1", 0), _Ok)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        monkeypatch.delenv(k, raising=False)
    # neutralise the developer machine's OS proxy (e.g. Clash on 127.0.0.1:7897)
    monkeypatch.setattr(urllib.request, "getproxies", lambda: {})
    monkeypatch.setattr(urllib.request, "proxy_bypass", lambda host: False)
    pp.reset_probe_cache()
    yield
    pp.reset_probe_cache()


@pytest.mark.parametrize(
    "host,expected",
    [
        ("localhost", True), ("127.0.0.1", True), ("127.9.9.9", True), ("::1", True), ("[::1]", True),
        ("10.2.3.4", True), ("172.16.5.5", True), ("192.168.1.10", True), ("printer.local", True),
        ("api.localhost", True), ("example.com", False), ("8.8.8.8", False), ("localhost.evil.com", False),
    ],
)
def test_is_local_host(host, expected):
    assert pp.is_local_host(host) is expected


def test_dead_proxy_env_local_server_succeeds(monkeypatch, local_server):
    dead = f"http://127.0.0.1:{_dead_port()}"
    monkeypatch.setenv("HTTP_PROXY", dead)
    monkeypatch.setenv("HTTPS_PROXY", dead)
    with pp.make_client(timeout=5) as c:
        assert c.get(local_server).json() == {"ok": True}


def test_no_proxy_local_server_succeeds(local_server):
    with pp.make_client(timeout=5) as c:
        assert c.get(local_server).status_code == 200


def test_async_mcp_factory_with_dead_proxy(monkeypatch, local_server):
    monkeypatch.setenv("HTTP_PROXY", f"http://127.0.0.1:{_dead_port()}")

    async def go():
        async with pp.mcp_httpx_client_factory(headers={"X": "1"}) as c:
            return (await c.get(local_server)).status_code

    assert asyncio.run(go()) == 200


def test_remote_dead_proxy_falls_back_to_direct(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{_dead_port()}")
    assert pp.resolve_proxy("https://example.com/x") is None


def test_remote_live_proxy_used_and_no_proxy_respected(monkeypatch, local_server):
    monkeypatch.setenv("HTTPS_PROXY", local_server)  # anything listening counts as alive
    assert pp.resolve_proxy("https://example.com/x") == local_server
    assert pp.resolve_proxy("http://127.0.0.1:1/x") is None  # loopback never proxied
    monkeypatch.setenv("NO_PROXY", ".example.com")
    assert pp.resolve_proxy("https://api.example.com/x") is None


def test_os_proxy_used_when_env_empty(monkeypatch, local_server):
    monkeypatch.setattr(urllib.request, "getproxies", lambda: {"https": local_server, "socks": "socks5://127.0.0.1:1"})
    assert pp.resolve_proxy("https://example.com") == local_server
    assert pp.resolve_proxy("http://192.168.0.2:8080") is None


def test_proxied_request_falls_back_when_proxy_dies(monkeypatch, local_server):
    # Probe cache says the proxy is alive, but it is not: request must still succeed via direct.
    dead = f"http://127.0.0.1:{_dead_port()}"
    monkeypatch.setattr(pp, "resolve_proxy", lambda url: dead)
    with pp.make_client(timeout=5) as c:
        assert c.get(local_server).status_code == 200


def test_ensure_local_no_proxy_env(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "corp.internal")
    pp.ensure_local_no_proxy_env()
    import os

    vals = os.environ["NO_PROXY"].split(",")
    assert vals[0] == "corp.internal" and "localhost" in vals and "127.0.0.1" in vals
