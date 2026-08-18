#!/usr/bin/env python3
"""Request-scoped metadata shared by Studio producers and LLM providers."""

from __future__ import annotations

import re
from contextvars import ContextVar, Token
from typing import Any


_llm_turn_id: ContextVar[str] = ContextVar("agenticx_llm_turn_id", default="")
_TURN_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def normalize_llm_turn_id(value: Any) -> str:
    """Return a header-safe request id, or an empty string when invalid."""
    if not isinstance(value, str):
        return ""
    turn_id = value.strip()
    # Keep this contract identical to the managed Gateway and portal proxy.
    # Reject instead of mutating identity so every model call in a task either
    # shares one exact id or consistently receives a request-local fallback.
    return turn_id if _TURN_ID_RE.fullmatch(turn_id) else ""


def current_llm_turn_id() -> str:
    """Return the task id bound to the current async/thread context."""
    return _llm_turn_id.get()


def set_current_llm_turn_id(turn_id: str) -> Token[str]:
    """Bind one stable task id and return the token required for reset."""
    return _llm_turn_id.set(normalize_llm_turn_id(turn_id))


def reset_current_llm_turn_id(token: Token[str]) -> None:
    """Restore the previous task id without touching any session object."""
    _llm_turn_id.reset(token)
