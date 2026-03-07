#!/usr/bin/env python3
"""Safety tests for CLI helpers.

Author: Damon Li
"""

from agenticx.cli.main import _safe_python_filename


def test_safe_python_filename_sanitizes_path_chars():
    assert _safe_python_filename("../My Agent") == "my_agent"


def test_safe_python_filename_rejects_empty():
    try:
        _safe_python_filename("...///___")
    except ValueError:
        assert True
        return
    assert False, "Expected ValueError for empty/invalid name"
