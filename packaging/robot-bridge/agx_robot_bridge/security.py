#!/usr/bin/env python3
"""Bearer token file handling and the process-wide interactive input guard.

Author: Hongyi Zhao
"""

from __future__ import annotations

import builtins
import os
import secrets
import sys
from pathlib import Path

from .errors import InteractiveInputBlocked

DEFAULT_TOKEN_FILE = Path("~/.agenticx/robot_bridge.token").expanduser()


def load_or_create_token(path: Path) -> str:
    """Read token; create 0600 file with secrets.token_urlsafe(32) when missing/empty."""
    path = Path(path).expanduser()
    try:
        existing = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        existing = ""
    if existing:
        return existing
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(token + "\n")
    # O_CREAT keeps the mode of a pre-existing (empty) file.
    os.chmod(path, 0o600)
    return token


def _blocked_input(prompt: object = "") -> str:
    raise InteractiveInputBlocked(f"interactive input requested: {prompt!r}")


def install_input_guard() -> None:
    """Make any input() in this process fail fast instead of blocking or eating a line."""
    if builtins.input is not _blocked_input:
        builtins.input = _blocked_input
    if getattr(sys.stdin, "name", None) != os.devnull:
        sys.stdin = open(os.devnull, encoding="utf-8")
