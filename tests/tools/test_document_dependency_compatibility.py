"""Real document operations across parser dependency upgrades."""

import asyncio

import pytest

fitz = pytest.importorskip("fitz")
pypdf = pytest.importorskip("pypdf")
Image = pytest.importorskip("PIL.Image")
pptx = pytest.importorskip("pptx")

from agenticx.knowledge.readers.pdf_reader import PDFReader
from agenticx.knowledge.readers.powerpoint_reader import PowerPointReader


def _make_pdf(path):
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Budget summary 2026")
    document.set_metadata({"title": "Example report"})
    document.save(path)
    document.close()


def test_pdf_fallback_reads_text_and_handles_password(tmp_path):
    pytest.importorskip("cryptography")
    path = tmp_path / "report.pdf"
    _make_pdf(path)
    encrypted = tmp_path / "encrypted.pdf"
    writer = pypdf.PdfWriter()
    writer.append(str(path))
    writer.encrypt("synthetic-password", algorithm="AES-256")
    writer.write(str(encrypted))

    reader = PDFReader(use_ocr=False)
    content, _ = asyncio.run(reader._read_with_pypdf(path))
    assert "Budget summary 2026" in content
    with pytest.raises(ValueError, match="PDF requires password"):
        asyncio.run(reader._read_with_pypdf(encrypted))
    with pytest.raises(ValueError, match="Invalid PDF password"):
        asyncio.run(PDFReader(password="wrong")._read_with_pypdf(encrypted))
    content, _ = asyncio.run(PDFReader(password="synthetic-password")._read_with_pypdf(encrypted))
    assert "Budget summary 2026" in content


def test_pdf_reader_extracts_content_page_range_and_metadata(tmp_path):
    path = tmp_path / "report.pdf"
    _make_pdf(path)
    reader = PDFReader(use_ocr=False, page_range=(0, 1))
    content, metadata = asyncio.run(reader._read_with_pypdf(path))
    assert "Budget summary 2026" in content
    assert metadata["pdf_pages"] == 1
    assert metadata["pdf_title"] == "Example report"


def test_office_image_round_trip_with_parser(tmp_path):
    image_path = tmp_path / "illustration.png"
    Image.new("RGB", (40, 25), "blue").save(image_path)
    path = tmp_path / "slides.pptx"
    presentation = pptx.Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = "Budget summary"
    slide.shapes.add_picture(str(image_path), 0, 1000000)
    presentation.save(str(path))

    reader = PowerPointReader(extract_notes=False)
    content, metadata = asyncio.run(reader._read_with_python_pptx(path))
    assert "Budget summary" in content
    assert metadata["slides_count"] == 1
    with Image.open(image_path) as image:
        assert image.size == (40, 25)
