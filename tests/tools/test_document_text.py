#!/usr/bin/env python3
"""Tests for shared document text extraction.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from agenticx.tools import document_text as dt


class _FakeDoc:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeReader:
    def __init__(self, content: str = "native text", fail: bool = False) -> None:
        self.content = content
        self.fail = fail
        self.calls: list[Path] = []

    async def read(self, path: Path):
        self.calls.append(path)
        if self.fail:
            raise RuntimeError("native reader failed")
        return [_FakeDoc(self.content)]


class _FakeLiteParseAdapter:
    available = True
    text = "liteparse text"
    raise_exc: Exception | None = None
    calls: list[Path] = []

    @staticmethod
    def is_available() -> bool:
        return _FakeLiteParseAdapter.available

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def parse_to_text(self, file_path: Path) -> str:
        _FakeLiteParseAdapter.calls.append(file_path)
        if _FakeLiteParseAdapter.raise_exc is not None:
            raise _FakeLiteParseAdapter.raise_exc
        return _FakeLiteParseAdapter.text


@pytest.fixture(autouse=True)
def _reset_fake_liteparse() -> None:
    _FakeLiteParseAdapter.available = True
    _FakeLiteParseAdapter.text = "liteparse text"
    _FakeLiteParseAdapter.raise_exc = None
    _FakeLiteParseAdapter.calls = []


@pytest.mark.asyncio
async def test_pdf_uses_native_reader_without_liteparse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    reader = _FakeReader("pdf body")
    _FakeLiteParseAdapter.available = False

    monkeypatch.setattr(dt, "get_reader", lambda path: reader)
    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: False)

    text = await dt.read_document_text(pdf)
    assert text == "pdf body"
    assert reader.calls == [pdf]
    assert _FakeLiteParseAdapter.calls == []


@pytest.mark.asyncio
async def test_docx_uses_native_reader_without_libreoffice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    docx = tmp_path / "note.docx"
    docx.write_bytes(b"PK\x03\x04")
    reader = _FakeReader("docx body")
    _FakeLiteParseAdapter.available = False

    monkeypatch.setattr(dt, "get_reader", lambda path: reader)
    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: False)

    text = await dt.read_document_text(docx)
    assert text == "docx body"
    assert _FakeLiteParseAdapter.calls == []


@pytest.mark.asyncio
async def test_pptx_uses_native_reader_without_libreoffice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(b"PK\x03\x04")
    reader = _FakeReader("pptx body")
    _FakeLiteParseAdapter.available = False

    monkeypatch.setattr(dt, "get_reader", lambda path: reader)
    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: False)

    text = await dt.read_document_text(pptx)
    assert text == "pptx body"
    assert _FakeLiteParseAdapter.calls == []


@pytest.mark.asyncio
async def test_xlsx_requires_liteparse_before_libreoffice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    xlsx = tmp_path / "sheet.xlsx"
    xlsx.write_bytes(b"PK\x03\x04")
    _FakeLiteParseAdapter.available = False

    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: True)

    with pytest.raises(dt.DocumentTextError) as excinfo:
        await dt.read_document_text(xlsx)
    assert excinfo.value.code == "liteparse_missing"
    assert "@llamaindex/liteparse" in excinfo.value.user_message
    assert "LibreOffice 已足够" not in excinfo.value.user_message


@pytest.mark.asyncio
async def test_xlsx_requires_libreoffice_after_liteparse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    xlsx = tmp_path / "sheet.xlsx"
    xlsx.write_bytes(b"PK\x03\x04")
    _FakeLiteParseAdapter.available = True

    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: False)
    monkeypatch.setattr(dt, "libreoffice_install_hint", lambda: "brew install --cask libreoffice")

    with pytest.raises(dt.DocumentTextError) as excinfo:
        await dt.read_document_text(xlsx)
    assert excinfo.value.code == "libreoffice_missing"
    assert "LibreOffice" in excinfo.value.user_message
    assert "brew install --cask libreoffice" in (excinfo.value.install_hint or "")


@pytest.mark.asyncio
async def test_xlsx_uses_liteparse_when_dependencies_exist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    xlsx = tmp_path / "sheet.xlsx"
    xlsx.write_bytes(b"PK\x03\x04")
    _FakeLiteParseAdapter.available = True
    _FakeLiteParseAdapter.text = "xlsx body"

    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: True)

    text = await dt.read_document_text(xlsx)
    assert text == "xlsx body"
    assert _FakeLiteParseAdapter.calls == [xlsx]


@pytest.mark.asyncio
async def test_native_reader_can_fallback_to_liteparse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    reader = _FakeReader(fail=True)
    _FakeLiteParseAdapter.available = True
    _FakeLiteParseAdapter.text = "fallback body"

    monkeypatch.setattr(dt, "get_reader", lambda path: reader)
    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: False)

    text = await dt.read_document_text(pdf)
    assert text == "fallback body"
    assert _FakeLiteParseAdapter.calls == [pdf]


@pytest.mark.asyncio
async def test_parser_returns_empty_content_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "empty.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    reader = _FakeReader("   ")
    _FakeLiteParseAdapter.available = False

    monkeypatch.setattr(dt, "get_reader", lambda path: reader)
    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)

    with pytest.raises(dt.DocumentTextError) as excinfo:
        await dt.read_document_text(pdf)
    assert excinfo.value.code == "empty_content"


@pytest.mark.asyncio
async def test_parser_translates_raw_libreoffice_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    xlsx = tmp_path / "sheet.xlsx"
    xlsx.write_bytes(b"PK\x03\x04")
    _FakeLiteParseAdapter.available = True
    _FakeLiteParseAdapter.raise_exc = RuntimeError(
        "liteparse parse failed: Error: Conversion failed: LibreOffice is not installed."
    )

    monkeypatch.setattr(dt, "LiteParseAdapter", _FakeLiteParseAdapter)
    monkeypatch.setattr(dt, "libreoffice_available", lambda: True)
    monkeypatch.setattr(dt, "libreoffice_install_hint", lambda: "brew install --cask libreoffice")

    with pytest.raises(dt.DocumentTextError) as excinfo:
        await dt.read_document_text(xlsx)
    assert excinfo.value.code == "libreoffice_missing"
    assert "LibreOffice" in excinfo.value.user_message
    assert "stack" not in excinfo.value.user_message.lower()
