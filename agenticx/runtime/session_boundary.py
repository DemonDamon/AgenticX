#!/usr/bin/env python3
"""Session private directories and outbound domain allow list.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse


def sessions_root() -> Path:
    return Path.home() / ".agenticx" / "sessions"


def session_id_of(session_id: str) -> str:
    text = str(session_id or "").strip()
    if not text or text in {".", ".."} or "/" in text or "\\" in text:
        return ""
    return text


def ensure_session_workdir(session_id: str, *, root: Path | None = None) -> Path | None:
    sid = session_id_of(session_id)
    if not sid:
        return None
    path = (root or sessions_root()) / sid / "work"
    path.mkdir(parents=True, exist_ok=True)
    return path


def foreign_session_denial(
    path: Path,
    session_id: str,
    *,
    root: Path | None = None,
) -> str | None:
    """Reject a path that lives in another session's private directory."""

    try:
        resolved = path.expanduser().resolve(strict=False)
        base = (root or sessions_root()).expanduser().resolve(strict=False)
        relative = resolved.relative_to(base)
    except (ValueError, OSError):
        return None
    if not relative.parts:
        return None
    owner = relative.parts[0]
    current = session_id_of(session_id)
    if current and owner == current:
        return None
    return f"path is another session work directory: {resolved}"


def egress_denial(url: str, allowlist: list[str] | None) -> str | None:
    """Reject a URL whose host is outside the allow list.

    An empty allow list means no extra restriction.
    """

    domains = []
    for item in allowlist or []:
        text = str(item or "").strip().lower().lstrip(".")
        if text:
            domains.append(text)
    if not domains:
        return None
    host = (urlparse(str(url or "")).hostname or "").lower().rstrip(".")
    if not host:
        return "egress blocked: missing host"
    for domain in domains:
        if host == domain or host.endswith("." + domain):
            return None
    return f"egress blocked: {host} is not in the allow list"


def configured_egress_allowlist() -> list[str]:
    try:
        from agenticx.cli.config_manager import ConfigManager

        raw = ConfigManager.get_value("runtime.egress_allow_domains")
    except Exception:
        return []
    if isinstance(raw, str):
        return [part.strip() for part in raw.split(",") if part.strip()]
    if isinstance(raw, list):
        return [str(part).strip() for part in raw if str(part).strip()]
    return []
