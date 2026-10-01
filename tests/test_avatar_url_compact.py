#!/usr/bin/env python3
"""Tests for compact_stored_avatar_url.

Author: Damon Li
"""

from agenticx.studio.avatar_url_compact import compact_stored_avatar_url


def test_drops_data_url():
    assert compact_stored_avatar_url("data:image/png;base64,AAAA") == ""


def test_keeps_https():
    assert (
        compact_stored_avatar_url("https://cdn.example/a.png")
        == "https://cdn.example/a.png"
    )


def test_drops_overlong():
    assert compact_stored_avatar_url("x" * 3000) == ""


def test_empty_and_whitespace():
    assert compact_stored_avatar_url("") == ""
    assert compact_stored_avatar_url("   ") == ""
