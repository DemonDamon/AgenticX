#!/usr/bin/env python3
"""Smoke tests: large tool result persistence (module 3).

Author: Damon Li
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from agenticx.runtime.agent_runtime import _maybe_persist_large_tool_result


def test_persist_writes_file_when_threshold_exceeded() -> None:
    class _Sess:
        _session_id = "test-smoke-m3"

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        with patch("agenticx.runtime.agent_runtime._session_disk_dir", return_value=root):
            huge = "Z" * 9000
            out = _maybe_persist_large_tool_result(_Sess(), "call-1", "file_read", huge)
        assert "persisted to disk" in out
        tr = root / "tool-results"
        assert tr.is_dir()
        files = list(tr.glob("*.txt"))
        assert len(files) == 1
        assert len(files[0].read_text()) == len(huge)
