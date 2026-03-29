#!/usr/bin/env python3
"""Tests for LiteParseAdapter.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.tools.adapters.liteparse import LiteParseAdapter


def test_liteparse_is_available_with_liteparse_binary(monkeypatch: pytest.MonkeyPatch) -> None:
    """Adapter should be available when liteparse binary exists."""
    monkeypatch.setattr("agenticx.tools.adapters.liteparse.shutil.which", lambda name: "/usr/bin/liteparse" if name == "liteparse" else None)
    assert LiteParseAdapter.is_available() is True


def test_liteparse_is_available_with_npx(monkeypatch: pytest.MonkeyPatch) -> None:
    """Adapter should be available when npx exists."""
    def fake_which(name: str):
        if name == "liteparse":
            return None
        if name == "npx":
            return "/usr/bin/npx"
        return None

    monkeypatch.setattr("agenticx.tools.adapters.liteparse.shutil.which", fake_which)
    assert LiteParseAdapter.is_available() is True


@pytest.mark.asyncio
async def test_parse_maps_to_parsed_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """parse() should map LiteParse JSON to ParsedArtifacts fields."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy pdf payload", encoding="utf-8")

    adapter = LiteParseAdapter()

    async def fake_run(_file_path: Path):
        return {
            "text": "hello liteparse",
            "pages": [{"page": 1}, {"page": 2}],
        }

    monkeypatch.setattr(adapter, "_run_liteparse_parse", fake_run)

    artifacts = await adapter.parse(file_path=source, output_dir=tmp_path / "out")

    assert artifacts.backend_type == "liteparse"
    assert artifacts.page_count == 2
    assert artifacts.markdown_file is not None
    assert artifacts.content_list_json is not None
    assert artifacts.markdown_file.exists()
    assert artifacts.content_list_json.exists()
    assert "hello liteparse" in artifacts.markdown_file.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_parse_to_text_returns_markdown_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """parse_to_text() should return markdown content from artifacts."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")
    adapter = LiteParseAdapter()

    async def fake_parse(*, file_path: Path, output_dir: Path, **kwargs):
        markdown_file = output_dir / "task123" / "sample.md"
        markdown_file.parent.mkdir(parents=True, exist_ok=True)
        markdown_file.write_text("parsed content", encoding="utf-8")
        return type(
            "FakeArtifacts",
            (),
            {"markdown_file": markdown_file},
        )()

    monkeypatch.setattr(adapter, "parse", fake_parse)
    text = await adapter.parse_to_text(source)
    assert text == "parsed content"


@pytest.mark.asyncio
async def test_parse_extracts_text_from_pages_when_top_text_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """parse() should merge page texts when top-level text is absent."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")

    adapter = LiteParseAdapter()

    async def fake_run(_file_path: Path):
        return {
            "pages": [
                {"page": 1, "text": "page one"},
                {"page": 2, "text": "page two"},
            ]
        }

    monkeypatch.setattr(adapter, "_run_liteparse_parse", fake_run)

    artifacts = await adapter.parse(file_path=source, output_dir=tmp_path / "out")
    assert artifacts.markdown_file is not None
    merged = artifacts.markdown_file.read_text(encoding="utf-8")
    assert "page one" in merged
    assert "page two" in merged
