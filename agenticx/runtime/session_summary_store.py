#!/usr/bin/env python3
"""Filesystem session summary helpers for Trinity cross-session continuity.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

_SAFE_SESSION_KEY_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def is_session_summary_enabled() -> bool:
    flag = os.getenv("AGX_SESSION_SUMMARY", "false").strip().lower()
    return flag in {"1", "true", "on", "yes"}


def summary_root() -> Path:
    return Path.home() / ".agenticx" / "workspace" / "sessions"


def sanitize_session_key(session_key: str) -> str:
    text = str(session_key or "").strip()
    if not text:
        return ""
    safe = _SAFE_SESSION_KEY_RE.sub("_", text).strip("_")
    return safe or text


def resolve_session_key(session: Any) -> Optional[str]:
    """Resolve stable session id from runtime session objects."""
    for attr in ("_session_id", "_owner_session_id", "session_id", "id"):
        raw = getattr(session, attr, None)
        text = str(raw or "").strip()
        if text:
            return sanitize_session_key(text)
    return None


def summary_path(session_key: str) -> Path:
    safe = sanitize_session_key(session_key)
    return summary_root() / f"{safe}.md"


def delete_session_summary(session_key: str) -> bool:
    path = summary_path(session_key)
    if not path.exists():
        return False
    try:
        path.unlink()
        return True
    except OSError as exc:
        logger.warning("[session_summary] failed to delete %s: %s", path, exc)
        return False


def list_cross_session_summaries(
    *,
    exclude_session_key: Optional[str] = None,
    max_age_days: int = 7,
) -> List[Path]:
    root = summary_root()
    if not root.exists():
        return []
    exclude_name = ""
    if exclude_session_key:
        exclude_name = summary_path(exclude_session_key).name
    now = time.time()
    max_age_seconds = max(1, int(max_age_days)) * 86400
    candidates: List[Path] = []
    for file_path in root.glob("*.md"):
        if exclude_name and file_path.name == exclude_name:
            continue
        try:
            if now - file_path.stat().st_mtime > max_age_seconds:
                continue
        except OSError:
            continue
        try:
            if not file_path.read_text(encoding="utf-8").strip():
                continue
        except OSError:
            continue
        candidates.append(file_path)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates


def chat_history_ends_with_pending_user(session: Any) -> bool:
    """True when the last visible turn is a user message awaiting a new reply."""
    history = getattr(session, "chat_history", None) or []
    for item in reversed(history):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "") or "").strip().lower()
        content = str(item.get("content", "") or "").strip()
        if not content:
            continue
        return role == "user"
    return False
