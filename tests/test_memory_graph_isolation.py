#!/usr/bin/env python3
"""Group isolation tests for memory graph access control.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.memory.graph.group_id import derive_group_id, validate_group_access


def test_meta_sessions_isolated_by_session_group():
    a = derive_group_id("session", session_id="sess-a")
    b = derive_group_id("session", session_id="sess-b")
    assert a != b
    assert validate_group_access(a, avatar_id=None, session_id="sess-a")
    assert not validate_group_access(a, avatar_id=None, session_id="sess-b")


def test_avatar_groups_isolated():
    a = derive_group_id("avatar", avatar_id="avatar-1")
    b = derive_group_id("avatar", avatar_id="avatar-2")
    assert validate_group_access(a, avatar_id="avatar-1", session_id="any")
    assert not validate_group_access(a, avatar_id="avatar-2", session_id="any")
    assert a != b
