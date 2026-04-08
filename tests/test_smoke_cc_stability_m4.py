#!/usr/bin/env python3
"""Smoke tests: file read/edit staleness guard (module 4).

Author: Damon Li
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from agenticx.runtime.file_state import FileStateTracker


def test_tracker_detects_mtime_change() -> None:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "f.txt"
        p.write_text("hello", encoding="utf-8")
        tr = FileStateTracker()
        tr.record_read(str(p), "hello")
        p.write_text("world", encoding="utf-8")
        err = tr.check_staleness(str(p))
        assert err is not None
        assert "file_read" in err
