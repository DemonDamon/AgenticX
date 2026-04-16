#!/usr/bin/env python3
"""Smoke tests for fuzzy find-and-replace in skill patches.

Validates hermes-agent proposal v2 Phase 2 — fuzzy match patch.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.skills.fuzzy_patch import fuzzy_find_and_replace


class TestExactStrategy:
    def test_simple_replace(self) -> None:
        content = "def foo():\n    pass"
        new, count, strategy, err = fuzzy_find_and_replace(content, "def foo():", "def bar():")
        assert err is None
        assert count == 1
        assert strategy == "exact"
        assert "def bar():" in new

    def test_no_match(self) -> None:
        new, count, strategy, err = fuzzy_find_and_replace("hello world", "xyz", "abc")
        assert err is not None
        assert count == 0

    def test_multiple_matches_blocked(self) -> None:
        content = "aaa bbb aaa"
        new, count, strategy, err = fuzzy_find_and_replace(content, "aaa", "ccc")
        assert err is not None
        assert "2 matches" in err

    def test_replace_all(self) -> None:
        content = "aaa bbb aaa"
        new, count, strategy, err = fuzzy_find_and_replace(content, "aaa", "ccc", replace_all=True)
        assert err is None
        assert count == 2
        assert new == "ccc bbb ccc"

    def test_empty_old_string(self) -> None:
        _, _, _, err = fuzzy_find_and_replace("content", "", "new")
        assert err is not None

    def test_identical_strings(self) -> None:
        _, _, _, err = fuzzy_find_and_replace("content", "same", "same")
        assert err is not None


class TestLineTrimmedStrategy:
    def test_trailing_whitespace(self) -> None:
        content = "def foo():  \n    pass  "
        new, count, strategy, err = fuzzy_find_and_replace(content, "def foo():\n    pass", "REPLACED")
        assert err is None
        assert strategy in ("line_trimmed", "exact")

    def test_leading_whitespace_per_line(self) -> None:
        content = "  step 1\n  step 2\n  step 3"
        old = "step 1\nstep 2\nstep 3"
        new, count, strategy, err = fuzzy_find_and_replace(content, old, "REPLACED")
        assert err is None
        assert "REPLACED" in new


class TestWhitespaceNormalizedStrategy:
    def test_extra_spaces(self) -> None:
        content = "def   foo(  x,   y  ):"
        old = "def foo( x, y ):"
        new, count, strategy, err = fuzzy_find_and_replace(content, old, "def bar(x, y):")
        assert err is None
        assert strategy == "whitespace_normalized"
        assert "bar" in new


class TestIndentationFlexibleStrategy:
    def test_different_indentation(self) -> None:
        content = "    def foo():\n        pass"
        old = "def foo():\n    pass"
        new, count, strategy, err = fuzzy_find_and_replace(content, old, "def bar():\n    return 42")
        assert err is None
        assert strategy in ("line_trimmed", "indentation_flexible")


class TestEscapeNormalizedStrategy:
    def test_escaped_newlines(self) -> None:
        content = "line1\nline2\nline3"
        old = "line1\\nline2"
        new, count, strategy, err = fuzzy_find_and_replace(content, old, "REPLACED")
        assert err is None
        assert strategy == "escape_normalized"
        assert "REPLACED" in new

    def test_no_escapes_skipped(self) -> None:
        content = "hello world"
        new, count, strategy, err = fuzzy_find_and_replace(content, "hello world", "bye")
        assert strategy == "exact"


class TestStrategyPriority:
    def test_exact_preferred_over_fuzzy(self) -> None:
        content = "def foo():\n    pass"
        new, count, strategy, err = fuzzy_find_and_replace(content, "def foo():\n    pass", "REPLACED")
        assert strategy == "exact"
