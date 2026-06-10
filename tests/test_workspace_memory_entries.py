#!/usr/bin/env python3
"""Tests for structured MEMORY.md entry read/update/delete helpers.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.workspace.loader import (
    MEMORY_TEMPLATE,
    delete_memory_entries_batch,
    delete_memory_entry,
    read_memory_entries,
    update_memory_entry,
)


SAMPLE_MEMORY = """# MEMORY.md - Long-Term Anchors

## User Anchors
- Name: Alice
- Name: Alice

## Agent Notes
- Keep this file short and curated.
- Move transient details into daily memory files.
"""


def test_read_memory_entries_empty_when_missing(tmp_path):
    assert read_memory_entries(tmp_path) == []


def test_read_memory_entries_parses_sections_and_indexes(tmp_path):
    memory_file = tmp_path / "MEMORY.md"
    memory_file.write_text(SAMPLE_MEMORY, encoding="utf-8")
    entries = read_memory_entries(tmp_path)
    assert len(entries) == 4
    assert entries[0] == {
        "section": "User Anchors",
        "index": 0,
        "text": "Name: Alice",
        "line": 4,
    }
    assert entries[1] == {
        "section": "User Anchors",
        "index": 1,
        "text": "Name: Alice",
        "line": 5,
    }
    assert entries[2]["section"] == "Agent Notes"
    assert entries[2]["index"] == 0


def test_update_memory_entry_only_changes_target(tmp_path):
    memory_file = tmp_path / "MEMORY.md"
    memory_file.write_text(SAMPLE_MEMORY, encoding="utf-8")
    update_memory_entry(tmp_path, "User Anchors", 1, "Name: Bob")
    raw = memory_file.read_text(encoding="utf-8")
    assert "- Name: Alice" in raw
    assert "- Name: Bob" in raw
    assert raw.count("- Name: Alice") == 1
    assert "## Agent Notes" in raw


def test_delete_memory_entry_keeps_section_heading(tmp_path):
    memory_file = tmp_path / "MEMORY.md"
    memory_file.write_text(SAMPLE_MEMORY, encoding="utf-8")
    delete_memory_entry(tmp_path, "Agent Notes", 0)
    raw = memory_file.read_text(encoding="utf-8")
    assert "## Agent Notes" in raw
    assert "- Keep this file short and curated." not in raw
    assert "- Move transient details into daily memory files." in raw


def test_update_memory_entry_missing_section_raises(tmp_path):
    memory_file = tmp_path / "MEMORY.md"
    memory_file.write_text(MEMORY_TEMPLATE, encoding="utf-8")
    with pytest.raises(ValueError, match="memory entry not found"):
        update_memory_entry(tmp_path, "Missing Section", 0, "x")


def test_delete_memory_entry_out_of_range_raises(tmp_path):
    memory_file = tmp_path / "MEMORY.md"
    memory_file.write_text(SAMPLE_MEMORY, encoding="utf-8")
    with pytest.raises(ValueError, match="memory entry not found"):
        delete_memory_entry(tmp_path, "User Anchors", 9)


def test_delete_memory_entries_batch_removes_multiple_entries(tmp_path):
    memory_file = tmp_path / "MEMORY.md"
    memory_file.write_text(SAMPLE_MEMORY, encoding="utf-8")
    deleted = delete_memory_entries_batch(
        tmp_path,
        [
            ("User Anchors", 0),
            ("User Anchors", 1),
            ("Agent Notes", 0),
        ],
    )
    assert deleted == 3
    raw = memory_file.read_text(encoding="utf-8")
    assert "- Name: Alice" not in raw
    assert "- Keep this file short and curated." not in raw
    assert "- Move transient details into daily memory files." in raw
    assert read_memory_entries(tmp_path) == [
        {
            "section": "Agent Notes",
            "index": 0,
            "text": "Move transient details into daily memory files.",
            "line": 6,
        }
    ]
