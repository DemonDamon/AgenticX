#!/usr/bin/env python3
"""Public HTTP(S) URL guard for near_browser_open (SSRF baseline).

Best-effort validation only: DNS answers can change between check and connect
(TOCTOU). Independent implementation; do not treat as a perfect egress lock.

Author: Damon Li
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from typing import Callable, Iterable, List, Optional, Sequence
from urllib.parse import urlparse


class UrlGuardError(ValueError):
    """Raised when a URL is blocked by the public-destination policy."""

    def __init__(self, message: str, *, code: str = "BLOCKED_URL") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ValidatedPublicUrl:
    """Result of a successful public URL validation."""

    url: str
    hostname: str
    address: str
    family: int


Resolver = Callable[[str], Sequence[str]]

_BLOCKED_HOST_SUFFIX = re.compile(
    r"(^|\.)(localhost|local|internal|home|lan)$",
    re.IGNORECASE,
)

_USER_BLOCKED = "不允许访问内网地址或非公网目标"
_USER_DNS = "无法解析目标主机名，请检查网址后重试"
_USER_INVALID = "仅允许公网 HTTP(S) 地址（端口 80/443，禁止内网与凭据）"


def is_public_ip(address: str) -> bool:
    """Return True if *address* is a global unicast IP suitable for browsing.

    Rejects private, loopback, link-local, multicast, reserved, unspecified,
    documentation, and IPv4-mapped non-global addresses.
    """
    raw = (address or "").strip()
    if not raw:
        return False
    # Zone id (fe80::1%eth0) is never a browser destination.
    if "%" in raw:
        return False
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return is_public_ip(str(ip.ipv4_mapped))
    return bool(ip.is_global)


def _normalize_hostname(hostname: str) -> str:
    host = (hostname or "").strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    if host.endswith("."):
        host = host[:-1]
    return host


def _parse_ipv4_component(part: str) -> int:
    """Parse one IPv4 dotted component; leading-zero octal (0177) supported."""
    if not part:
        raise ValueError("empty IPv4 component")
    if part.startswith("0") and len(part) > 1 and all(c in "01234567" for c in part):
        return int(part, 8)
    if part.lower().startswith("0x"):
        return int(part, 16)
    return int(part, 10)


def _pack_ipv4_parts(parts: List[int]) -> Optional[str]:
    """Pack 1–4 IPv4 components the way many URL parsers accept (e.g. 127.1)."""
    if not parts or len(parts) > 4:
        return None
    try:
        if len(parts) == 1:
            n = parts[0]
            if 0 <= n <= 0xFFFFFFFF:
                return str(ipaddress.IPv4Address(n))
            return None
        if len(parts) == 2:
            a, b = parts
            if not (0 <= a <= 255 and 0 <= b <= 0xFFFFFF):
                return None
            return str(ipaddress.IPv4Address((a << 24) | b))
        if len(parts) == 3:
            a, b, c = parts
            if not (0 <= a <= 255 and 0 <= b <= 255 and 0 <= c <= 0xFFFF):
                return None
            return str(ipaddress.IPv4Address((a << 24) | (b << 16) | c))
        a, b, c, d = parts
        if not all(0 <= x <= 255 for x in (a, b, c, d)):
            return None
        return str(ipaddress.IPv4Address((a << 24) | (b << 16) | (c << 8) | d))
    except (ValueError, ipaddress.AddressValueError, OverflowError):
        return None


def _coerce_ip_literal(hostname: str) -> Optional[str]:
    """Parse hostname as an IP literal, including decimal/hex/short IPv4 forms."""
    host = _normalize_hostname(hostname)
    if not host:
        return None
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        pass

    if host.isdigit():
        return _pack_ipv4_parts([int(host)])

    if host.startswith("0x"):
        try:
            return _pack_ipv4_parts([int(host, 16)])
        except ValueError:
            return None

    # Dotted / octal-ish forms: 0177.0.0.1, 127.1
    if re.fullmatch(r"[0-9.]+", host) and "." in host:
        try:
            parts = [_parse_ipv4_component(p) for p in host.split(".") if p != ""]
        except ValueError:
            return None
        return _pack_ipv4_parts(parts)

    # Platform-tolerant abbreviated IPv4 (e.g. 127.1 via inet_aton).
    try:
        packed = socket.inet_aton(host)
        return str(ipaddress.IPv4Address(packed))
    except OSError:
        return None


def _default_resolve(hostname: str) -> List[str]:
    infos = socket.getaddrinfo(hostname, None)
    addresses: List[str] = []
    seen = set()
    for info in infos:
        addr = info[4][0]
        if addr not in seen:
            seen.add(addr)
            addresses.append(addr)
    return addresses


def _blocked(message: str = _USER_BLOCKED, *, code: str = "BLOCKED_URL") -> UrlGuardError:
    return UrlGuardError(message, code=code)


def validate_public_http_url(
    value: str,
    resolve: Optional[Resolver] = None,
) -> ValidatedPublicUrl:
    """Validate that *value* is a public http(s) URL on port 80/443.

    Args:
        value: Absolute URL string.
        resolve: Optional hostname → IP list resolver (for tests / DNS mock).

    Returns:
        ValidatedPublicUrl with the selected public address.

    Raises:
        UrlGuardError: When the URL is not allowed.
    """
    raw = (value or "").strip()
    if not raw:
        raise _blocked(_USER_INVALID)

    try:
        parsed = urlparse(raw)
    except Exception as exc:
        raise _blocked(_USER_INVALID) from exc

    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise _blocked(_USER_INVALID)

    if parsed.username is not None or parsed.password is not None:
        raise _blocked("不允许在 URL 中携带用户名或密码")

    port = parsed.port
    if port is not None and port not in (80, 443):
        raise _blocked("仅允许端口 80 或 443")

    hostname = _normalize_hostname(parsed.hostname or "")
    if not hostname:
        raise _blocked(_USER_INVALID)

    if _BLOCKED_HOST_SUFFIX.search(hostname):
        raise _blocked(_USER_BLOCKED)

    literal = _coerce_ip_literal(hostname)
    if literal is not None:
        addresses = [literal]
    else:
        resolver = resolve or _default_resolve
        try:
            resolved = list(resolver(hostname) or [])
        except Exception as exc:
            raise UrlGuardError(_USER_DNS, code="DNS_UNAVAILABLE") from exc
        addresses = [str(a).strip() for a in resolved if str(a).strip()]

    if not addresses:
        raise UrlGuardError(_USER_DNS, code="DNS_UNAVAILABLE")

    if any(not is_public_ip(addr) for addr in addresses):
        raise _blocked(_USER_BLOCKED)

    selected = next((a for a in addresses if ":" not in a), addresses[0])
    try:
        family = ipaddress.ip_address(selected).version
    except ValueError:
        family = 4 if ":" not in selected else 6

    host_for_netloc = parsed.hostname or hostname
    if ":" in hostname and not str(host_for_netloc).startswith("["):
        host_for_netloc = f"[{hostname}]"
    if parsed.port:
        netloc = f"{host_for_netloc}:{parsed.port}"
    else:
        netloc = str(host_for_netloc)

    clean = f"{scheme}://{netloc}{parsed.path or ''}"
    if parsed.query:
        clean = f"{clean}?{parsed.query}"
    if parsed.fragment:
        clean = f"{clean}#{parsed.fragment}"

    return ValidatedPublicUrl(
        url=clean,
        hostname=hostname,
        address=selected,
        family=family,
    )


def assert_public_http_urls(urls: Iterable[str], resolve: Optional[Resolver] = None) -> None:
    """Validate each URL; raise on the first failure."""
    for url in urls:
        validate_public_http_url(url, resolve=resolve)
