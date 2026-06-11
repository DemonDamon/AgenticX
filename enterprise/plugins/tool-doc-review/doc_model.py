#!/usr/bin/env python3
"""Document model and loaders for format checks.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Paragraph:
    index: int
    text: str
    style_name: str | None
    font_name: str | None
    font_size_pt: float | None
    alignment: str | None
    space_before_pt: float | None
    space_after_pt: float | None
    line_spacing: float | None
    outline_level: int | None


@dataclass
class DocModel:
    source_path: str
    paragraphs: list[Paragraph]


def _alignment_name(value: Any) -> str | None:
    if value is None:
        return None
    name = getattr(value, "name", None) or str(value)
    return str(name) if name else None


def _length_to_pt(length: Any) -> float | None:
    if length is None:
        return None
    raw = getattr(length, "pt", None)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _outline_level_from_style(style_name: str | None) -> int | None:
    if not style_name:
        return None
    lowered = style_name.lower()
    if lowered.startswith("heading"):
        suffix = lowered.replace("heading", "").strip()
        if suffix.isdigit():
            return int(suffix)
    if style_name.startswith("标题"):
        digits = "".join(ch for ch in style_name if ch.isdigit())
        if digits.isdigit():
            return int(digits)
    return None


def load_docx(path: Path) -> DocModel:
    from docx import Document
    from docx.text.paragraph import Paragraph as DocxParagraph

    document = Document(str(path))
    paragraphs: list[Paragraph] = []
    for index, paragraph in enumerate(document.paragraphs):
        paragraphs.append(_paragraph_from_docx(index, paragraph))
    return DocModel(source_path=str(path), paragraphs=paragraphs)


def _paragraph_from_docx(index: int, paragraph: Any) -> Paragraph:
    style_name = paragraph.style.name if paragraph.style is not None else None
    font_name: str | None = None
    font_size_pt: float | None = None
    if paragraph.runs:
        first_font = paragraph.runs[0].font
        font_name = first_font.name
        if first_font.size is not None:
            font_size_pt = _length_to_pt(first_font.size)

    pf = paragraph.paragraph_format
    outline_level = _outline_level_from_style(style_name)
    return Paragraph(
        index=index,
        text=paragraph.text or "",
        style_name=style_name,
        font_name=font_name,
        font_size_pt=font_size_pt,
        alignment=_alignment_name(paragraph.alignment),
        space_before_pt=_length_to_pt(pf.space_before),
        space_after_pt=_length_to_pt(pf.space_after),
        line_spacing=float(pf.line_spacing) if pf.line_spacing is not None else None,
        outline_level=outline_level,
    )


def load_pdf(path: Path) -> DocModel:
    import pdfplumber

    paragraphs: list[Paragraph] = []
    index = 0
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                paragraphs.append(
                    Paragraph(
                        index=index,
                        text=stripped,
                        style_name=None,
                        font_name=None,
                        font_size_pt=None,
                        alignment=None,
                        space_before_pt=None,
                        space_after_pt=None,
                        line_spacing=None,
                        outline_level=_outline_level_from_style(None),
                    )
                )
                index += 1
    return DocModel(source_path=str(path), paragraphs=paragraphs)


def load_document(path: Path) -> DocModel:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return load_docx(path)
    if suffix == ".pdf":
        return load_pdf(path)
    raise ValueError(f"unsupported document type for format check: {suffix}")
