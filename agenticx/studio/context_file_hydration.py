#!/usr/bin/env python3
"""Hydrate document placeholders in chat context_files before model turns.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path

from agenticx.tools.document_text import DocumentTextError, read_document_text


logger = logging.getLogger(__name__)

PLACEHOLDER_PREFIXES = ("[附件] ", "[文件引用] ")
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"}
MAX_FILES_PER_TURN = 4
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_CONCURRENCY = 2
PARSE_TIMEOUT_SECONDS = 30.0
MAX_HYDRATED_CHARS = 8_000
TRUNCATION_MARKER = "\n...(document context truncated)"


@dataclass(frozen=True)
class ContextHydrationReport:
    attempted: int
    succeeded: int
    failed: int
    skipped: int


def _is_placeholder(value: str) -> bool:
    text = str(value or "")
    return any(text.startswith(prefix) for prefix in PLACEHOLDER_PREFIXES)


def _looks_like_absolute_path(raw: str) -> bool:
    path = Path(raw)
    if path.is_absolute():
        return True
    # Windows absolute path like C:\...
    return len(raw) >= 3 and raw[1] == ":" and raw[2] in {"\\", "/"}


def _already_hydrated(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if _is_placeholder(text):
        return False
    if text.startswith("[附件解析失败]"):
        return False
    if text.startswith("[图片") or text.startswith("[视频]"):
        return False
    return True


def _format_failure(
    *,
    basename: str,
    code: str,
    reason: str,
    hint: str | None = None,
) -> str:
    lines = [
        "[附件解析失败]",
        f"文件：{basename}",
        f"状态码：{code}",
        f"原因：{reason}",
    ]
    if hint:
        lines.append(f"处理建议：{hint}")
    else:
        lines.append("处理建议：请根据原因修复环境后重新发送该附件。")
    return "\n".join(lines)


def _truncate_text(text: str, limit: int | None = None) -> str:
    max_chars = MAX_HYDRATED_CHARS if limit is None else limit
    if len(text) <= max_chars:
        return text
    keep = max(0, max_chars - len(TRUNCATION_MARKER))
    return text[:keep] + TRUNCATION_MARKER


async def _hydrate_one(path: Path) -> tuple[str, str]:
    """Return (status, content) where status is succeeded/failed."""
    basename = path.name
    started = time.monotonic()
    try:
        if not path.exists():
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="path_missing",
                    reason="附件路径不存在，文件可能已被移动或删除。",
                ),
            )
        if not path.is_file():
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="path_not_file",
                    reason="附件路径不是普通文件。",
                ),
            )
        ext = path.suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="unsupported_extension",
                    reason=f"不支持的附件扩展名：{ext or '(none)'}",
                ),
            )
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="file_too_large",
                    reason=f"文件超过大小上限（{MAX_FILE_BYTES} 字节）。",
                    hint="请拆分文档或提供摘要文本后再试。",
                ),
            )
        try:
            text = await asyncio.wait_for(
                read_document_text(path),
                timeout=PARSE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="parse_timeout",
                    reason=f"解析超时（>{int(PARSE_TIMEOUT_SECONDS)} 秒）。",
                ),
            )
        except DocumentTextError as exc:
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code=exc.code,
                    reason=exc.user_message,
                    hint=exc.install_hint,
                ),
            )
        except Exception as exc:
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="parse_failed",
                    reason=f"解析失败：{exc}",
                ),
            )
        if not isinstance(text, str) or not text.strip():
            return (
                "failed",
                _format_failure(
                    basename=basename,
                    code="empty_content",
                    reason="解析结果为空。",
                ),
            )
        return ("succeeded", _truncate_text(text.strip()))
    finally:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "context_file_hydration path_ext=%s elapsed_ms=%s",
            path.suffix.lower() or "(none)",
            elapsed_ms,
        )


async def hydrate_turn_context_files(
    turn_context_files: dict[str, str],
    session_context_files: dict[str, str],
) -> ContextHydrationReport:
    """Hydrate document placeholders into ``session_context_files``.

    ``turn_context_files`` is treated as read-only input for history metadata.
    """
    attempted = 0
    succeeded = 0
    failed = 0
    skipped = 0

    candidates: list[tuple[str, Path]] = []
    for raw_key, raw_value in (turn_context_files or {}).items():
        key = str(raw_key or "").strip()
        value = str(raw_value or "")
        if not key or not _is_placeholder(value):
            skipped += 1
            continue
        if key.startswith("skill:"):
            skipped += 1
            continue
        if not _looks_like_absolute_path(key):
            skipped += 1
            continue

        existing = str(session_context_files.get(key) or "")
        if _already_hydrated(existing):
            skipped += 1
            continue

        path = Path(key).expanduser()
        candidates.append((key, path))

    overflow = candidates[MAX_FILES_PER_TURN:]
    selected = candidates[:MAX_FILES_PER_TURN]
    for key, path in overflow:
        failed += 1
        session_context_files[key] = _format_failure(
            basename=path.name,
            code="resource_limit",
            reason=f"本轮最多解析 {MAX_FILES_PER_TURN} 个文档附件。",
            hint="请分多轮发送其余附件。",
        )

    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _run(key: str, path: Path) -> None:
        nonlocal attempted, succeeded, failed
        async with semaphore:
            attempted += 1
            status, content = await _hydrate_one(path)
            session_context_files[key] = content
            if status == "succeeded":
                succeeded += 1
            else:
                failed += 1

    if selected:
        await asyncio.gather(*[_run(key, path) for key, path in selected])

    # Ensure non-selected placeholders still land in session for visibility.
    for key, value in (turn_context_files or {}).items():
        key = str(key or "").strip()
        if not key:
            continue
        if key in session_context_files:
            continue
        if _is_placeholder(str(value or "")) and _looks_like_absolute_path(key):
            session_context_files[key] = str(value)
        elif not _is_placeholder(str(value or "")):
            session_context_files[key] = str(value)

    return ContextHydrationReport(
        attempted=attempted,
        succeeded=succeeded,
        failed=failed,
        skipped=skipped,
    )
