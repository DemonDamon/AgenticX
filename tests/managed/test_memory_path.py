#!/usr/bin/env python3
"""Memory paths follow the control-plane rules and error text.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.managed.memory import MemoryPathError, validate_memory_path

_ACCEPTED = (
    "/a.md",
    "/偏好/报告.md",
    "/a/b/c.txt",
)
_REJECTED = (
    ("a.md", 'path: must start with "/"'),
    ("/", "path: must not be the root"),
    ("/a/", 'path: must not end with "/"'),
    ("/a//b", 'path: empty, "." or ".." segment'),
    ("/a/./b", 'path: empty, "." or ".." segment'),
    ("/a/../b", 'path: empty, "." or ".." segment'),
    ("/a\u0001", "path: contains control characters or backslash"),
    ("/a\\b", "path: contains control characters or backslash"),
    ("/" + ("a" * 1024), "path: exceeds 1024 bytes"),
    ("/a/" + ("b" * 256), "path: segment exceeds 255 bytes"),
)


def test_normalize_memory_path_matches_control_plane() -> None:
    for path in _ACCEPTED:
        assert validate_memory_path(path) == path
    assert validate_memory_path("/e\u0301.md") == "/\u00e9.md"
    for path, message in _REJECTED:
        with pytest.raises(MemoryPathError, match=message) as raised:
            validate_memory_path(path)
        assert str(raised.value) == message
    with pytest.raises(MemoryPathError, match="path: must be a string") as raised:
        validate_memory_path(1)  # type: ignore[arg-type]
    assert str(raised.value) == "path: must be a string"
