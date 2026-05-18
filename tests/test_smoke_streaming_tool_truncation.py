#!/usr/bin/env python3
"""Smoke tests for streamed tool-call truncation handling (FR-C).

Author: Damon Li
"""

from __future__ import annotations

import sys

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])

from agenticx.runtime.agent_runtime import (
    _build_streamed_tool_truncation_hint,
    _streamed_tool_call_truncated,
)


class TestStreamedToolCallTruncated:
    """FR-C: required-param tools with empty parsed args must be flagged truncated."""

    def test_file_write_with_empty_args_is_truncated(self):
        assert _streamed_tool_call_truncated("file_write", {}) is True

    def test_file_write_with_path_only_not_truncated(self):
        # Has at least one key → don't drop. Downstream dispatch will surface a
        # missing-content error which still routes through FR-B guidance.
        assert (
            _streamed_tool_call_truncated("file_write", {"path": "/tmp/x"}) is False
        )

    def test_tool_without_required_params_is_never_truncated(self):
        # bash_exec has required params; pick a known no-required tool instead.
        # `list_skills` typically has no required parameters.
        from agenticx.cli.agent_tools import _TOOL_REQUIRED_PARAMS

        for tname, required in _TOOL_REQUIRED_PARAMS.items():
            if not required:
                assert _streamed_tool_call_truncated(tname, {}) is False
                return
        # If every tool has required params, fall back to an unknown tool name.
        assert _streamed_tool_call_truncated("__no_such_tool__", {}) is False

    def test_empty_name_is_not_truncated(self):
        assert _streamed_tool_call_truncated("", {}) is False

    def test_non_dict_args_are_not_truncated(self):
        # Defensive: only empty dict triggers; other shapes are ignored.
        assert _streamed_tool_call_truncated("file_write", []) is False  # type: ignore[arg-type]


class TestBuildTruncationHint:
    """FR-C: retry hint must be directive and mention required-field guidance."""

    def test_hint_mentions_dropped_tool_names_unique_sorted(self):
        text = _build_streamed_tool_truncation_hint(
            ["file_write", "file_write", "file_edit"]
        )
        # Names appear once, alphabetically sorted
        assert "file_edit, file_write" in text

    def test_hint_uses_directive_language(self):
        text = _build_streamed_tool_truncation_hint(["file_write"])
        assert "立即重新调用" in text
        assert "required" in text
        # Must explicitly mention path/content to nudge the model
        assert "path" in text
        assert "content" in text

    def test_hint_handles_empty_list(self):
        text = _build_streamed_tool_truncation_hint([])
        assert "立即重新调用" in text
