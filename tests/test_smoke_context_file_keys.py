"""Smoke tests for composer context_files upload dedupe keys.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.studio.context_file_keys import (
    disk_path_from_context_file_key,
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


def test_disk_path_from_absolute_key() -> None:
    assert disk_path_from_context_file_key("/tmp/readme.md") is not None
    assert disk_path_from_context_file_key("/tmp/readme.md").endswith("readme.md")


def test_disk_path_skips_virtual_and_dedupe_keys() -> None:
    assert disk_path_from_context_file_key("skill:tech-daily-news") is None
    assert disk_path_from_context_file_key("@dir:/tmp/ws") is None
    assert disk_path_from_context_file_key("notes.txt:32506:1783310868057") is None
    assert disk_path_from_context_file_key("relative/notes.md") is None


def test_disk_path_strips_el_snippet_and_line_range() -> None:
    snippet = disk_path_from_context_file_key("/tmp/charts/index.html:el-snippet-204e5c8a")
    assert snippet is not None
    assert snippet.endswith("index.html")
    lined = disk_path_from_context_file_key("/tmp/README.md:224-224")
    assert lined is not None
    assert lined.endswith("README.md")
