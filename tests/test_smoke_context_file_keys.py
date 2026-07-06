"""Smoke tests for composer context_files upload dedupe keys.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.studio.context_file_keys import (
    is_composer_upload_dedupe_key,
    strip_composer_upload_dedupe_key,
    upload_dedupe_size_from_key,
)


def test_upload_dedupe_key_detected() -> None:
    key = "notes.txt:32506:1783310868057"
    assert is_composer_upload_dedupe_key(key)
    assert strip_composer_upload_dedupe_key(key) == "notes.txt"
    assert upload_dedupe_size_from_key(key) == 32506


def test_workspace_line_range_not_upload_dedupe() -> None:
    assert not is_composer_upload_dedupe_key("/tmp/README.md:224-224")
    assert not is_composer_upload_dedupe_key("/Users/demo/a.txt:10-20")
