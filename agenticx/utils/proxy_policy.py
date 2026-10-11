"""Central outbound-proxy policy: "proxy on or off, nothing breaks".

Rules (single source of truth for connector / MCP / gateway / OAuth traffic):

1. Local targets always go direct: ``localhost``/``*.localhost``, ``*.local``,
   loopback (127.0.0.0/8, ::1), RFC1918 private ranges, link-local and
   unspecified addresses. A system proxy (e.g. Clash on 127.0.0.1:7897) must
   never sit between the app and a local server.
2. Remote targets honour the configured proxy (env ``HTTP(S)_PROXY`` first,
   then the OS proxy settings via :func:`urllib.request.getproxies`) and the
   ``NO_PROXY`` / OS bypass list.
3. If a proxy is configured but unreachable (TCP connect fails), traffic falls
   back to a direct connection instead of failing. Probe results are cached
   briefly so a dead proxy costs one short probe, not one per request.

Use :func:`make_async_client` / :func:`make_client` (or
:func:`mcp_httpx_client_factory` for the MCP SDK) instead of constructing
``httpx`` clients with ``trust_env=True``.

Author: Damon Li
"""

from __future__ import annotations

import ipaddress
import os
import socket
import threading
import time
import urllib.request
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit

import httpx

_PROBE_TTL_SECONDS = 30.0
_PROBE_TIMEOUT_SECONDS = 0.5
_probe_cache: Dict[Tuple[str, int], Tuple[float, bool]] = {}
_probe_lock = threading.Lock()

LOCAL_NO_PROXY_HOSTS = ("localhost", "127.0.0.1", "::1", ".local", ".localhost")


def _strip_host(host: str) -> str:
    h = (host or "").strip().lower()
    if h.startswith("[") and h.endswith("]"):
        h = h[1:-1]
    if "%" in h:  # IPv6 zone id
        h = h.split("%", 1)[0]
    return h.rstrip(".")


def is_local_host(host: str) -> bool:
    """True for hosts that must never be proxied (loopback, private, *.local)."""
    h = _strip_host(host)
    if not h:
        return False
    if h == "localhost" or h.endswith(".localhost") or h.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return bool(ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified)


def is_local_url(url: str) -> bool:
    try:
        return is_local_host(urlsplit(str(url)).hostname or "")
    except ValueError:
        return False


def _env_proxies() -> Dict[str, str]:
    out: Dict[str, str] = {}
    for key in ("http", "https", "all", "no"):
        val = os.environ.get(f"{key}_proxy") or os.environ.get(f"{key.upper()}_PROXY")
        if val:
            out[key] = val
    return out


def configured_proxies() -> Dict[str, str]:
    """Env proxies when any are set, else OS proxy settings (macOS/Windows)."""
    env = _env_proxies()
    if any(k in env for k in ("http", "https", "all")):
        return env
    try:
        return dict(urllib.request.getproxies())
    except Exception:  # pragma: no cover - platform specific
        return env


def _bypassed(host: str, proxies: Dict[str, str]) -> bool:
    no_proxy = proxies.get("no") or os.environ.get("no_proxy") or os.environ.get("NO_PROXY") or ""
    if no_proxy:
        for raw in no_proxy.split(","):
            item = raw.strip().lower()
            if not item:
                continue
            if item == "*":
                return True
            if "/" in item:
                try:
                    if ipaddress.ip_address(host) in ipaddress.ip_network(item, strict=False):
                        return True
                except ValueError:
                    pass
                continue
            item = item.lstrip("*")
            if host == item.lstrip(".") or (item.startswith(".") and host.endswith(item)) or host.endswith("." + item):
                return True
    if not _env_proxies():
        try:  # OS bypass list (macOS "Bypass proxy settings for these hosts")
            return bool(urllib.request.proxy_bypass(host))
        except Exception:  # pragma: no cover
            return False
    return False


def proxy_reachable(proxy_url: str) -> bool:
    """Cached TCP probe of the proxy endpoint itself."""
    try:
        parts = urlsplit(proxy_url if "://" in proxy_url else f"http://{proxy_url}")
        host = parts.hostname or ""
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        return False
    if not host:
        return False
    key = (host, int(port))
    now = time.monotonic()
    with _probe_lock:
        hit = _probe_cache.get(key)
        if hit and now - hit[0] < _PROBE_TTL_SECONDS:
            return hit[1]
    ok = False
    try:
        with socket.create_connection(key, timeout=_PROBE_TIMEOUT_SECONDS):
            ok = True
    except OSError:
        ok = False
    with _probe_lock:
        _probe_cache[key] = (now, ok)
    return ok


def mark_proxy_dead(proxy_url: str) -> None:
    try:
        parts = urlsplit(proxy_url if "://" in proxy_url else f"http://{proxy_url}")
        key = (parts.hostname or "", int(parts.port or 80))
    except ValueError:
        return
    with _probe_lock:
        _probe_cache[key] = (time.monotonic(), False)


def reset_probe_cache() -> None:
    with _probe_lock:
        _probe_cache.clear()


def resolve_proxy(url: str) -> Optional[str]:
    """Proxy URL to use for *url*, or ``None`` for a direct connection."""
    try:
        parts = urlsplit(str(url))
    except ValueError:
        return None
    host = _strip_host(parts.hostname or "")
    if not host or is_local_host(host):
        return None
    proxies = configured_proxies()
    scheme = (parts.scheme or "http").lower()
    proxy = proxies.get(scheme) or proxies.get("all")
    if not proxy and scheme == "https":
        proxy = proxies.get("http")
    if not proxy:
        return None
    if not proxy.lower().startswith(("http://", "https://", "socks5://", "socks5h://")):
        proxy = f"http://{proxy}"
    if proxy.lower().startswith("socks") and not _socks_supported():
        return None
    if _bypassed(host, proxies):
        return None
    if not proxy_reachable(proxy):
        return None
    return proxy


def _socks_supported() -> bool:
    try:
        import socksio  # noqa: F401
        return True
    except Exception:
        return False


def requests_proxies(url: str) -> Dict[str, Optional[str]]:
    """``proxies=`` mapping for ``requests`` honouring the same policy."""
    proxy = resolve_proxy(url)
    return {"http": proxy, "https": proxy} if proxy else {"http": None, "https": None}


class _PolicyAsyncTransport(httpx.AsyncBaseTransport):
    def __init__(self, **transport_kwargs: Any) -> None:
        self._kwargs = transport_kwargs
        self._direct = httpx.AsyncHTTPTransport(trust_env=False, **transport_kwargs)
        self._proxied: Dict[str, httpx.AsyncHTTPTransport] = {}

    def _for_proxy(self, proxy: str) -> httpx.AsyncHTTPTransport:
        tr = self._proxied.get(proxy)
        if tr is None:
            tr = httpx.AsyncHTTPTransport(trust_env=False, proxy=proxy, **self._kwargs)
            self._proxied[proxy] = tr
        return tr

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        proxy = resolve_proxy(str(request.url))
        if not proxy:
            return await self._direct.handle_async_request(request)
        try:
            return await self._for_proxy(proxy).handle_async_request(request)
        except (httpx.ProxyError, httpx.ConnectError):
            # The proxy itself refused/vanished: nothing reached the target, so
            # a direct retry is safe. Mark it dead for the probe TTL.
            if proxy_reachable_now(proxy):
                raise
            mark_proxy_dead(proxy)
            return await self._direct.handle_async_request(request)

    async def aclose(self) -> None:
        await self._direct.aclose()
        for tr in self._proxied.values():
            await tr.aclose()


class _PolicySyncTransport(httpx.BaseTransport):
    def __init__(self, **transport_kwargs: Any) -> None:
        self._kwargs = transport_kwargs
        self._direct = httpx.HTTPTransport(trust_env=False, **transport_kwargs)
        self._proxied: Dict[str, httpx.HTTPTransport] = {}

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        proxy = resolve_proxy(str(request.url))
        if not proxy:
            return self._direct.handle_request(request)
        tr = self._proxied.get(proxy)
        if tr is None:
            tr = httpx.HTTPTransport(trust_env=False, proxy=proxy, **self._kwargs)
            self._proxied[proxy] = tr
        try:
            return tr.handle_request(request)
        except (httpx.ProxyError, httpx.ConnectError):
            if proxy_reachable_now(proxy):
                raise
            mark_proxy_dead(proxy)
            return self._direct.handle_request(request)

    def close(self) -> None:
        self._direct.close()
        for tr in self._proxied.values():
            tr.close()


def proxy_reachable_now(proxy_url: str) -> bool:
    """Uncached probe (used after a failure to tell proxy vs target errors apart)."""
    try:
        parts = urlsplit(proxy_url)
        with socket.create_connection((parts.hostname or "", int(parts.port or 80)), timeout=_PROBE_TIMEOUT_SECONDS):
            return True
    except (OSError, ValueError):
        return False


def make_async_client(**kwargs: Any) -> httpx.AsyncClient:
    """``httpx.AsyncClient`` that applies the proxy policy per request."""
    verify = kwargs.pop("verify", True)
    kwargs.pop("trust_env", None)
    kwargs.pop("proxy", None)
    return httpx.AsyncClient(transport=_PolicyAsyncTransport(verify=verify), trust_env=False, **kwargs)


def make_client(**kwargs: Any) -> httpx.Client:
    verify = kwargs.pop("verify", True)
    kwargs.pop("trust_env", None)
    kwargs.pop("proxy", None)
    return httpx.Client(transport=_PolicySyncTransport(verify=verify), trust_env=False, **kwargs)


def mcp_httpx_client_factory(
    headers: Optional[Dict[str, str]] = None,
    timeout: Optional[httpx.Timeout] = None,
    auth: Optional[httpx.Auth] = None,
) -> httpx.AsyncClient:
    """Drop-in for ``mcp.shared._httpx_utils.create_mcp_http_client``."""
    kwargs: Dict[str, Any] = {
        "follow_redirects": True,
        "timeout": timeout if timeout is not None else httpx.Timeout(30.0),
    }
    if headers is not None:
        kwargs["headers"] = headers
    if auth is not None:
        kwargs["auth"] = auth
    return make_async_client(**kwargs)


def ensure_local_no_proxy_env() -> None:
    """Append loopback names to NO_PROXY so third-party clients that use
    ``trust_env`` (httpx/requests/aiohttp) never route localhost via a proxy."""
    for key in ("NO_PROXY", "no_proxy"):
        current = [p.strip() for p in (os.environ.get(key) or "").split(",") if p.strip()]
        missing = [h for h in LOCAL_NO_PROXY_HOSTS if h not in current]
        if missing or key not in os.environ:
            os.environ[key] = ",".join(current + missing)


__all__ = [
    "is_local_host",
    "is_local_url",
    "configured_proxies",
    "resolve_proxy",
    "proxy_reachable",
    "reset_probe_cache",
    "requests_proxies",
    "make_async_client",
    "make_client",
    "mcp_httpx_client_factory",
    "ensure_local_no_proxy_env",
]
