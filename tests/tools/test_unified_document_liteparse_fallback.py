#!/usr/bin/env python3
"""Tests for UnifiedDocumentTool document fallback chain.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.tools.unified_document import UnifiedDocumentTool


def test_process_document_prefers_liteparse(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When LiteParse succeeds, MinerU should not be used."""
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_text("pdf", encoding="utf-8")

    class FakeLiteParseAdapter:
        @staticmethod
        def is_available() -> bool:
            return True

        def __init__(self, *args, **kwargs):
            pass

        async def parse_to_text(self, file_path: Path) -> str:
            return "liteparse result"

    class FakeMinerUAdapter:
        def __init__(self, *args, **kwargs):
            pass

        async def parse_document(self, *args, **kwargs):
            raise AssertionError("MinerU should not be called when LiteParse succeeds")

    monkeypatch.setattr("agenticx.tools.unified_document.LiteParseAdapter", FakeLiteParseAdapter)
    monkeypatch.setattr("agenticx.tools.unified_document.MinerUAdapter", FakeMinerUAdapter)

    tool = UnifiedDocumentTool(cache_dir=str(tmp_path / "cache"))
    success, content = tool._process_document(str(pdf_path))

    assert success is True
    assert content == "liteparse result"


def test_process_document_falls_back_to_mineru(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When LiteParse is unavailable, MinerU output should be returned."""
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_text("pdf", encoding="utf-8")

    class FakeLiteParseAdapter:
        @staticmethod
        def is_available() -> bool:
            return False

    class FakeParseResult:
        def __init__(self):
            self.artifacts = {"markdown_files": ["mineru.md"]}

    class FakeMinerUAdapter:
        def __init__(self, *args, **kwargs):
            pass

        async def parse_document(self, *, input_path: str, output_dir: str, **kwargs):
            md_path = Path(output_dir) / "mineru.md"
            md_path.write_text("mineru result", encoding="utf-8")
            return FakeParseResult()

    monkeypatch.setattr("agenticx.tools.unified_document.LiteParseAdapter", FakeLiteParseAdapter)
    monkeypatch.setattr("agenticx.tools.unified_document.MinerUAdapter", FakeMinerUAdapter)

    tool = UnifiedDocumentTool(cache_dir=str(tmp_path / "cache"))
    success, content = tool._process_document(str(pdf_path))

    assert success is True
    assert content == "mineru result"


def test_process_document_falls_back_to_generic_reader(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When both LiteParse and MinerU fail, generic reader should be used."""
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_text("generic fallback content", encoding="utf-8")

    class FakeLiteParseAdapter:
        @staticmethod
        def is_available() -> bool:
            return True

        def __init__(self, *args, **kwargs):
            pass

        async def parse_to_text(self, file_path: Path) -> str:
            raise RuntimeError("liteparse failed")

    class FakeMinerUAdapter:
        def __init__(self, *args, **kwargs):
            pass

        async def parse_document(self, *args, **kwargs):
            raise RuntimeError("mineru failed")

    monkeypatch.setattr("agenticx.tools.unified_document.LiteParseAdapter", FakeLiteParseAdapter)
    monkeypatch.setattr("agenticx.tools.unified_document.MinerUAdapter", FakeMinerUAdapter)

    tool = UnifiedDocumentTool(cache_dir=str(tmp_path / "cache"))
    success, content = tool._process_document(str(pdf_path))

    assert success is True
    assert "generic fallback content" in content
