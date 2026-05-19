#!/usr/bin/env python3
"""Smoke tests for code_dev file_read budget.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cli.agent_tools import MAX_READ_CHARS, MAX_READ_CHARS_CODE_DEV, _max_read_chars_for_session
from agenticx.cli.studio import StudioSession


def test_max_read_chars_code_dev():
    daily = StudioSession(session_mode="daily_office")
    code = StudioSession(session_mode="code_dev")
    assert _max_read_chars_for_session(daily) == MAX_READ_CHARS
    assert _max_read_chars_for_session(code) == MAX_READ_CHARS_CODE_DEV
    assert MAX_READ_CHARS_CODE_DEV < MAX_READ_CHARS
