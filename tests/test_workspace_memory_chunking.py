#!/usr/bin/env python3
"""Tests for WorkspaceMemoryStore markdown heading-aware chunking."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.memory.workspace_memory import WorkspaceMemoryStore


@pytest.fixture
def store(tmp_path: Path) -> WorkspaceMemoryStore:
    return WorkspaceMemoryStore(db_path=tmp_path / "wm.sqlite")


def test_heading_aware_chunks_split_on_headings(store: WorkspaceMemoryStore) -> None:
    content = """# Title

## Section A
alpha content

## Section B
beta content
"""
    chunks = list(store._chunk_text(content))
    texts = [c[2] for c in chunks]
    assert any("Section A" in t and "alpha" in t for t in texts)
    assert any("Section B" in t and "beta" in t for t in texts)
    assert not any("Section A" in t and "Section B" in t for t in texts)


def test_heading_chunk_preserves_preamble(store: WorkspaceMemoryStore) -> None:
    content = """Intro line before any heading.

## First Real Section
body
"""
    chunks = list(store._chunk_text(content))
    texts = [c[2] for c in chunks]
    assert any("Intro line before" in t for t in texts)
    assert any("First Real Section" in t for t in texts)


def test_large_section_gets_subsplit(store: WorkspaceMemoryStore) -> None:
    body_lines = [f"paragraph line {i}" for i in range(65)]
    content = "## Huge\n" + "\n".join(body_lines)
    chunks = list(store._chunk_text(content))
    assert len(chunks) >= 2
    starts = [c[0] for c in chunks]
    ends = [c[1] for c in chunks]
    assert starts[0] == 1
    assert ends[-1] == len(content.splitlines())


def test_no_heading_falls_back_to_fixed(store: WorkspaceMemoryStore) -> None:
    lines = [f"line-{i}" for i in range(100)]
    content = "\n".join(lines)
    chunks = list(store._chunk_text(content))
    assert len(chunks) == 3
    assert chunks[0][0] == 1 and chunks[0][1] == 40
    assert chunks[1][0] == 41 and chunks[1][1] == 80
    assert chunks[2][0] == 81 and chunks[2][1] == 100


def test_empty_content_returns_empty(store: WorkspaceMemoryStore) -> None:
    assert list(store._chunk_text("")) == []
