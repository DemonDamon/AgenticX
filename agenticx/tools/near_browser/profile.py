#!/usr/bin/env python3
"""Session-stable browser profile id for near_browser_* tools.

Persists ``browser_profile_id`` under the Studio session directory so retries
and later turns reuse the same profile key instead of spawning unbounded ones.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger(__name__)

_PROFILE_FILENAME = "browser_profile.json"


def default_sessions_root() -> Path:
    """Return the default ``~/.agenticx/sessions`` root (overridable via env)."""
    env = os.environ.get("AGX_SESSIONS_ROOT", "").strip()
    if env:
        return Path(env).expanduser()
    return Path.home() / ".agenticx" / "sessions"


def browser_profile_path(
    session_id: str,
    *,
    sessions_root: Optional[Union[str, Path]] = None,
) -> Path:
    """Path to the session-scoped browser profile JSON file."""
    root = Path(sessions_root) if sessions_root is not None else default_sessions_root()
    sid = str(session_id or "").strip()
    if not sid:
        raise ValueError("session_id is required")
    return root / sid / _PROFILE_FILENAME


def get_or_create_browser_profile_id(
    session_id: str,
    *,
    sessions_root: Optional[Union[str, Path]] = None,
) -> str:
    """Return a stable profile UUID for *session_id*, creating it on first use.

    The id is written to ``<sessions_root>/<session_id>/browser_profile.json``
    before later open/snapshot calls so failed bridge requests still bind the
    same key on retry (same idea as OpenMuse observeForThread insert-if-absent).
    """
    path = browser_profile_path(session_id, sessions_root=sessions_root)
    path.parent.mkdir(parents=True, exist_ok=True)

    existing = _read_profile_id(path)
    if existing:
        return existing

    profile_id = str(uuid.uuid4())
    payload = {"profile_id": profile_id}
    # Exclusive create when possible to reduce lost-update races.
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        existing = _read_profile_id(path)
        if existing:
            return existing
        # Corrupt / empty file: fall through to overwrite.
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return profile_id
    else:
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        except Exception:
            logger.warning("failed writing browser profile %s", path, exc_info=True)
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        return profile_id


def _read_profile_id(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.debug("unreadable browser profile at %s", path, exc_info=True)
        return None
    if not isinstance(data, dict):
        return None
    raw = str(data.get("profile_id") or "").strip()
    return raw or None
