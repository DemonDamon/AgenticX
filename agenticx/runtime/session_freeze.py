#!/usr/bin/env python3
"""Process-wide active agent run counter for skill write freeze.

Incremented on agent turn start, decremented on agent end. When non-zero and
``learning.freeze_during_session`` is enabled, skill_manage writes are queued.

Author: Damon Li
"""

from __future__ import annotations

_active_session_count = 0


def inc_active() -> None:
    global _active_session_count
    _active_session_count += 1


def dec_active() -> None:
    global _active_session_count
    _active_session_count = max(0, _active_session_count - 1)


def is_frozen() -> bool:
    return _active_session_count > 0


def reset_active_count_for_tests() -> None:
    """Test helper only."""
    global _active_session_count
    _active_session_count = 0
