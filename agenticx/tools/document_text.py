#!/usr/bin/env python3
"""Shared document text extraction for chat and knowledge base.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import platform
import shutil
from pathlib import Path
from typing import Any, Iterable, List, Optional

from agenticx.knowledge.readers import get_reader
from agenticx.tools.adapters.liteparse import LiteParseAdapter


logger = logging.getLogger(__name__)

NATIVE_READER_EXTS = {".pdf", ".docx", ".pptx"}
LITEPARSE_REQUIRED_EXTS = {
    ".doc",
    ".ppt",
    ".xls",
    ".xlsx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
}
LIBREOFFICE_REQUIRED_EXTS = {".doc", ".ppt", ".xls", ".xlsx"}
PLAIN_TEXT_EXTS = {".md", ".txt", ".markdown", ".rst", ".log"}
LITEPARSE_INSTALL_HINT = "npm i -g @llamaindex/liteparse"


class DocumentTextError(RuntimeError):
    """Structured document parse failure with a stable status code."""

    def __init__(
        self,
        code: str,
        user_message: str,
        *,
        install_hint: str | None = None,
    ) -> None:
        super().__init__(user_message)
        self.code = code
        self.user_message = user_message
        self.install_hint = install_hint


def libreoffice_install_hint() -> str:
    """Return platform-specific LibreOffice install command."""
    system = platform.system().strip().lower()
    if system == "darwin":
        return "brew install --cask libreoffice"
    if system == "windows":
        return "choco install libreoffice-fresh"
    return "apt-get install libreoffice"


def libreoffice_available() -> bool:
    """Return True when soffice/libreoffice is on PATH."""
    return bool(shutil.which("soffice") or shutil.which("libreoffice"))


def _extract_contents(docs: Any) -> List[str]:
    texts: List[str] = []
    if docs is None:
        return texts
    iterable: Iterable[Any]
    if isinstance(docs, (list, tuple)):
        iterable = docs
    else:
        iterable = [docs]
    for item in iterable:
        content = getattr(item, "content", None)
        if content is None and isinstance(item, dict):
            content = item.get("content")
        if isinstance(content, str) and content.strip():
            texts.append(content)
    return texts


async def _read_with_native_reader(path: Path) -> str:
    try:
        reader = get_reader(path)
    except Exception as exc:
        raise DocumentTextError(
            "parse_failed",
            f"无法初始化文档读取器以解析 {path.suffix or path.name}：{exc}",
        ) from exc

    try:
        raw = reader.read(path)
        if asyncio.iscoroutine(raw):
            docs = await raw
        else:
            docs = raw
    except Exception as exc:
        raise DocumentTextError(
            "parse_failed",
            f"解析 {path.name} 失败：{exc}",
        ) from exc

    texts = _extract_contents(docs)
    if not texts:
        raise DocumentTextError(
            "empty_content",
            f"未能从 {path.name} 提取到可用文本内容。",
        )
    return "\n\n".join(texts)


async def _read_with_liteparse(path: Path, *, require_libreoffice: bool) -> str:
    if not LiteParseAdapter.is_available():
        raise DocumentTextError(
            "liteparse_missing",
            (
                f"解析 {path.suffix or path.name} 需要 LiteParse。"
                f" 请安装：`{LITEPARSE_INSTALL_HINT}`。"
            ),
            install_hint=LITEPARSE_INSTALL_HINT,
        )

    if require_libreoffice and not libreoffice_available():
        hint = libreoffice_install_hint()
        raise DocumentTextError(
            "libreoffice_missing",
            (
                f"解析 {path.suffix} 需要 LibreOffice（LiteParse 内部用 soffice 做格式转换）。"
                f" 未检测到本机已安装。\n建议安装命令：{hint}"
            ),
            install_hint=hint,
        )

    adapter = LiteParseAdapter(config={"debug": False})
    try:
        text = await adapter.parse_to_text(path)
    except Exception as exc:
        msg = str(exc)
        if "LibreOffice is not installed" in msg or "soffice" in msg.lower():
            hint = libreoffice_install_hint()
            raise DocumentTextError(
                "libreoffice_missing",
                (
                    f"解析 {path.suffix} 需要 LibreOffice 做格式转换。\n"
                    f"建议安装命令：{hint}"
                ),
                install_hint=hint,
            ) from exc
        raise DocumentTextError(
            "parse_failed",
            f"LiteParse 解析 {path.name} 失败：{exc}",
        ) from exc

    if not isinstance(text, str) or not text.strip():
        raise DocumentTextError(
            "empty_content",
            f"LiteParse 未能从 {path.name} 提取到可用文本内容。",
        )
    return text


async def read_document_text(path: Path) -> str:
    """Extract plain text from a document using the lowest-dependency route.

    Routing:
      - plain text / markdown -> direct read
      - PDF / DOCX / PPTX -> native Python readers, LiteParse fallback if installed
      - DOC / PPT / XLS / XLSX / images -> LiteParse (+ LibreOffice when required)
    """
    resolved = Path(path).expanduser()
    ext = resolved.suffix.lower()

    if ext in PLAIN_TEXT_EXTS:
        return resolved.read_text(encoding="utf-8", errors="replace")

    if ext in LITEPARSE_REQUIRED_EXTS:
        return await _read_with_liteparse(
            resolved,
            require_libreoffice=ext in LIBREOFFICE_REQUIRED_EXTS,
        )

    if ext in NATIVE_READER_EXTS:
        try:
            return await _read_with_native_reader(resolved)
        except DocumentTextError as native_exc:
            if LiteParseAdapter.is_available():
                try:
                    return await _read_with_liteparse(
                        resolved,
                        require_libreoffice=False,
                    )
                except DocumentTextError:
                    raise native_exc from None
            raise

    # Remaining formats (html/json/csv/...) also go through native readers.
    return await _read_with_native_reader(resolved)


def read_document_text_sync(path: Path) -> str:
    """Synchronous wrapper for KB worker threads.

    Must not be called from a running asyncio event loop. Prefer
    ``await read_document_text(path)`` inside FastAPI / SSE handlers.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(read_document_text(path))
    raise RuntimeError(
        "read_document_text_sync() cannot be called from a running event loop; "
        "use await read_document_text(path) instead."
    )
