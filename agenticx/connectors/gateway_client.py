"""Client for the local connector gateway (``connector-runtime`` sidecar).

Target runtime: the **desktop-local** Go sidecar (same binary and data dir the
Electron app uses: ``~/.agenticx/connector-runtime``). Discovery order:

1. ``<data-dir>/sidecar.json`` (written by the gateway on listen) + live pid +
   ``/healthz`` → reuse the running instance (Electron- or Python-spawned).
2. Otherwise spawn the binary (``$AGX_CONNECTOR_RUNTIME_BIN`` or the dev
   ``desktop/bundled-sidecar/<arch>/connector-runtime``) on the previous port
   when free, so the ``mcp.json`` gateway entry stays valid.

Tokens live in ``<data-dir>/runtime.token`` / ``admin.token`` (0600, same trust
level as ``master.key``); the admin token is only used here, never returned to
the model. All HTTP goes through :mod:`agenticx.utils.proxy_policy` (loopback is
always direct).

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from agenticx.utils.proxy_policy import configured_proxies, make_client, proxy_reachable

GATEWAY_SERVER_NAME = "connector-runtime"
GATEWAY_FALLBACK_SERVER_NAME = "connector-runtime-local"


class GatewayError(RuntimeError):
    """Gateway unavailable or admin call failed (message never contains secrets)."""


def data_dir() -> Path:
    raw = os.environ.get("AGX_CONNECTOR_RUNTIME_DIR", "").strip()
    return Path(raw).expanduser() if raw else Path.home() / ".agenticx" / "connector-runtime"


def _repo_dev_binary() -> Optional[Path]:
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    exe = "connector-runtime.exe" if sys.platform == "win32" else "connector-runtime"
    if sys.platform == "win32":
        arch = "win-amd64"
    here = Path(__file__).resolve()
    for parent in here.parents:
        cand = parent / "desktop" / "bundled-sidecar" / arch / exe
        if cand.is_file():
            return cand
    return None


def binary_path() -> Optional[Path]:
    raw = os.environ.get("AGX_CONNECTOR_RUNTIME_BIN", "").strip()
    if raw and Path(raw).is_file():
        return Path(raw)
    found = shutil.which("connector-runtime")
    if found:
        return Path(found)
    return _repo_dev_binary()


def _read_token(name: str) -> str:
    try:
        return (data_dir() / name).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _ensure_token_file(name: str) -> None:
    path = data_dir() / name
    if path.is_file() and path.read_text(encoding="utf-8").strip():
        return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(secrets.token_hex(24))


def _read_sidecar_info() -> Optional[Dict[str, Any]]:
    try:
        raw = json.loads((data_dir() / "sidecar.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    try:
        port = int(str(raw.get("addr", "")).rsplit(":", 1)[-1])
    except ValueError:
        return None
    return {"pid": int(raw.get("pid") or 0), "port": port}


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _healthy(port: int, timeout: float = 1.5) -> bool:
    try:
        with make_client(timeout=timeout) as c:
            return c.get(f"http://127.0.0.1:{port}/healthz").status_code == 200
    except Exception:
        return False


def _child_env() -> Dict[str, str]:
    """Hand the OS/env proxy to the Go gateway explicitly (Go only reads env);
    the gateway itself bypasses local targets and falls back to direct when the
    proxy is down."""
    env = dict(os.environ)
    if not any(env.get(k) for k in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")):
        proxies = configured_proxies()
        for scheme, key in (("https", "HTTPS_PROXY"), ("http", "HTTP_PROXY")):
            val = proxies.get(scheme)
            if val and not val.lower().startswith("socks"):
                env[key] = val if "://" in val else f"http://{val}"
    no_proxy = [p for p in (env.get("NO_PROXY") or env.get("no_proxy") or "").split(",") if p.strip()]
    for item in ("localhost", "127.0.0.1", "::1", ".local"):
        if item not in no_proxy:
            no_proxy.append(item)
    env["NO_PROXY"] = ",".join(no_proxy)
    return env


@dataclass
class Gateway:
    port: int
    spawned: bool = False

    @property
    def mcp_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/mcp"

    def runtime_token(self) -> str:
        return _read_token("runtime.token")

    def admin(self, method: str, path: str, body: Any = None, timeout: float = 30.0) -> Tuple[int, Any]:
        if not path.startswith("/admin/"):
            raise GatewayError("invalid admin path")
        token = _read_token("admin.token")
        if not token:
            raise GatewayError("gateway admin token missing")
        headers = {"Authorization": f"Bearer {token}"}
        kwargs: Dict[str, Any] = {"headers": headers}
        if body is not None:
            if isinstance(body, (bytes, str)):
                kwargs["content"] = body
                headers["Content-Type"] = "application/json"
            else:
                kwargs["json"] = body
        try:
            with make_client(timeout=timeout) as c:
                resp = c.request(method, f"http://127.0.0.1:{self.port}{path}", **kwargs)
        except Exception as exc:
            raise GatewayError(f"gateway request failed: {type(exc).__name__}") from None
        try:
            payload = resp.json()
        except ValueError:
            payload = {"raw": resp.text[:500]}
        return resp.status_code, payload


_spawned: Optional[subprocess.Popen] = None


def ensure_gateway(spawn: bool = True, wait_s: float = 10.0) -> Gateway:
    """Reuse the running local gateway or start one."""
    global _spawned
    info = _read_sidecar_info()
    if info and _pid_alive(info["pid"]) and _read_token("admin.token") and _healthy(info["port"]):
        return Gateway(port=info["port"])
    if not spawn:
        raise GatewayError("connector gateway is not running")
    binary = binary_path()
    if binary is None:
        raise GatewayError(
            "connector-runtime binary not found (set AGX_CONNECTOR_RUNTIME_BIN or build desktop/bundled-sidecar)"
        )
    ddir = data_dir()
    ddir.mkdir(parents=True, exist_ok=True, mode=0o700)
    _ensure_token_file("runtime.token")
    _ensure_token_file("admin.token")
    port = info["port"] if info and _port_free(info["port"]) else _free_port()
    log_path = ddir / "gateway.log"
    log_fh = open(log_path, "ab")  # noqa: SIM115 - handed to the child
    try:
        _spawned = subprocess.Popen(
            [str(binary), "serve", "--addr", f"127.0.0.1:{port}", "--data-dir", str(ddir)],
            stdin=subprocess.DEVNULL,
            stdout=log_fh,
            stderr=log_fh,
            env=_child_env(),
            cwd=str(ddir),
        )
    finally:
        log_fh.close()
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if _spawned.poll() is not None:
            raise GatewayError(f"connector gateway exited (code={_spawned.returncode}); see {log_path}")
        if _healthy(port, timeout=0.5):
            return Gateway(port=port, spawned=True)
        time.sleep(0.15)
    raise GatewayError("connector gateway health check timed out")


def stop_spawned_gateway() -> None:
    global _spawned
    if _spawned is not None and _spawned.poll() is None:
        _spawned.terminate()
        try:
            _spawned.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _spawned.kill()
    _spawned = None


# ---- mcp.json gateway entry --------------------------------------------------

def _is_loopback_url(url: str) -> bool:
    from urllib.parse import urlsplit

    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return False
    return host in ("127.0.0.1", "localhost", "::1")


def ensure_gateway_mcp_entry(doc: Dict[str, Any], gw: Gateway) -> Tuple[Optional[Dict[str, Any]], str]:
    """Make mcp.json point at the local gateway (same shape the desktop writes).

    Returns ``(new_doc or None if unchanged, server_name)``. A self-hosted
    gateway entry under the default name (non-loopback URL) is never
    overwritten — the local one is added as ``connector-runtime-local``.
    """
    servers = doc.get("mcpServers") if isinstance(doc.get("mcpServers"), dict) else {}
    token = gw.runtime_token()
    want = {"url": gw.mcp_url, "headers": {"Authorization": f"Bearer {token}"} if token else {}}
    name = GATEWAY_SERVER_NAME
    existing = servers.get(name)
    if isinstance(existing, dict) and not _is_loopback_url(str(existing.get("url") or "")):
        name = GATEWAY_FALLBACK_SERVER_NAME
        existing = servers.get(name)
    if isinstance(existing, dict):
        if existing.get("url") == want["url"] and (existing.get("headers") or {}) == want["headers"]:
            return None, name
        entry = dict(existing)
        entry.update(want)
    else:
        entry = dict(want)  # same shape as desktop buildGatewayServerConfig
    if not entry.get("headers"):
        entry.pop("headers", None)
    new_doc = dict(doc)
    new_servers = dict(servers)
    new_servers[name] = entry
    new_doc["mcpServers"] = new_servers
    return new_doc, name


def gateway_proxy_status() -> Dict[str, Any]:
    proxies = configured_proxies()
    p = proxies.get("https") or proxies.get("http")
    return {"proxy_configured": bool(p), "proxy_reachable": bool(p and proxy_reachable(p if "://" in p else f"http://{p}"))}


import atexit as _atexit

_atexit.register(stop_spawned_gateway)
