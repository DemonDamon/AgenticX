"""文档类附件不能被当成纯文本直接读进上下文。

rehydrate_session_text_context_files 原来会把「能按 utf-8 读出来的绝对路径文件」直接
当正文替换掉 `[附件] xxx` 占位符。PDF 只要内容流没压缩，整份文件就是可解码的 ASCII，
于是：

    占位符 → PDF 源码 → hydrate_turn_context_files 一看已经不是占位符就跳过
    → 模型读到的是 %PDF-1.4 / /MediaBox / endobj，而不是正文

实测过：模型能一字不差地复述只存在于原始字节里的注释和 trailer 字段。

Word/Chrome 导出的 PDF 多数带压缩流（二进制，解码失败）所以侥幸没事——也就是说这条
路走不走得通，取决于「这份文件的字节碰巧能不能解码」。不能靠这个。

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.studio.chat_attachments import rehydrate_session_text_context_files
from agenticx.studio.context_file_hydration import ALLOWED_EXTENSIONS


def _ascii_pdf(path: Path) -> None:
    """一份内容流未压缩、整体可按 utf-8 解码的合法 PDF —— 正是会踩坑的那一类。"""
    path.write_bytes(
        b"%PDF-1.4\n%RAWONLY_MARKER this comment only exists in the raw file\n"
        b"1 0 obj\n<< /Type /Catalog >>\nendobj\n"
        b"trailer\n<< /Producer (RAWONLY_MARKER) >>\n%%EOF\n"
    )


def test_pdf_placeholder_survives_rehydrate(tmp_path: Path) -> None:
    pdf = tmp_path / "resume.pdf"
    _ascii_pdf(pdf)
    assert pdf.read_bytes().decode("utf-8")  # 前提：这份文件确实能解码

    out = rehydrate_session_text_context_files("sid-1", {str(pdf): "[附件] resume.pdf"})

    assert out[str(pdf)] == "[附件] resume.pdf", "占位符被替换成了文件原始字节"
    assert "RAWONLY_MARKER" not in out[str(pdf)]
    assert "%PDF" not in out[str(pdf)]


@pytest.mark.parametrize("ext", sorted(ALLOWED_EXTENSIONS))
def test_every_document_extension_keeps_its_placeholder(tmp_path: Path, ext: str) -> None:
    """凡是交给文档抽取器的扩展名，都不能走纯文本这条路。"""
    doc = tmp_path / f"file{ext}"
    doc.write_text("这看起来像文本，但它是一份文档，必须走抽取器。", encoding="utf-8")

    out = rehydrate_session_text_context_files("sid-2", {str(doc): f"[附件] file{ext}"})

    assert out[str(doc)] == f"[附件] file{ext}"


def test_plain_text_attachment_still_gets_inlined(tmp_path: Path) -> None:
    """反向确认没有把正常能力一起关掉：.txt/.md 该内联还是要内联。

    否则「别把 PDF 当文本读」会滑成「什么都不读」，重试时附件内容就全丢了。
    """
    note = tmp_path / "notes.txt"
    note.write_text("纯文本正文", encoding="utf-8")

    out = rehydrate_session_text_context_files("sid-3", {str(note): "[附件] notes.txt"})

    assert out[str(note)] == "纯文本正文"
