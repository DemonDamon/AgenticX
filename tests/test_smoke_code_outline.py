#!/usr/bin/env python3
"""Smoke tests for code_outline.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.runtime.code_outline import build_outline, outline_file


FIXTURES = Path(__file__).resolve().parent / "fixtures" / "code_outline"


def test_outline_python_symbols():
    payload = outline_file(FIXTURES / "sample_py.py")
    names = {s["name"] for s in payload["symbols"]}
    assert "SampleClass" in names
    assert "standalone_fn" in names
    assert payload["language"] == "python"


def test_outline_ts_symbols():
    payload = outline_file(FIXTURES / "sample_ts.ts")
    names = {s["name"] for s in payload["symbols"]}
    assert "TsSample" in names or "tsFn" in names


def test_outline_directory_truncated():
    payload = build_outline(FIXTURES, max_files=1)
    assert len(payload["files"]) == 1
    assert payload["truncated"] is True


def test_tool_code_outline_via_agent_tools():
    from agenticx.cli.agent_tools import _tool_code_outline
    from agenticx.cli.studio import StudioSession

    session = StudioSession(workspace_dir=str(FIXTURES.parent.parent.parent))
    out = _tool_code_outline({"path": str(FIXTURES / "sample_py.py")}, session)
    assert "SampleClass" in out
    assert "function" in out.lower() or "class" in out.lower()
