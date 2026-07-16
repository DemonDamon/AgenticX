#!/usr/bin/env python3
"""Shared context_files serialization and prompt budget.

Author: Damon Li
"""

from __future__ import annotations

from typing import Mapping

MAX_CONTEXT_FILE_CHARS = 8_000
MAX_CONTEXT_FILES_TOTAL_CHARS = 16_000
TRUNCATION_MARKER = "\n...(document context truncated)"

CONTEXT_FILES_USAGE_HINT = (
    "提示：若 context 条目已包含正文，请直接使用正文回答，不要再搜索工作区或声称文件不存在。"
    "若条目以 `[附件解析失败]` 开头，表示附件真实存在但当前环境无法解析；"
    "请承认附件已收到并说明失败原因，不得声称未找到文件，也不得在 workspace 中盲搜同名文件；"
    "失败块已给出依赖原因时，不要重复调用同一解析工具。"
    "仅当条目仍是未水合的文档占位符（如 `[附件] ...`）且路径为绝对路径时，才可对该路径调用 `liteparse`；"
    "PDF/Office 不得使用 `file_read`。"
    "若条目以 `skill:` 开头（如 `skill:tech-daily-news`），它是技能内容的虚拟键，不是磁盘路径；"
    "请直接使用其内容，不要用 bash/file_read 去猜测或拼接 SKILL.md 文件路径。"
    "若用户在消息中 @某文件名，请优先使用此处列出的完整路径。"
)


def serialize_context_files(context_files: Mapping[str, str]) -> str:
    """Serialize context_files with per-file and total character budgets."""
    if not context_files:
        return ""

    parts: list[str] = []
    remaining_total = MAX_CONTEXT_FILES_TOTAL_CHARS
    for fpath, content in context_files.items():
        if remaining_total <= 0:
            parts.append(f"--- {fpath} ---\n{TRUNCATION_MARKER.strip()}")
            continue
        preview = str(content or "")
        file_limit = min(MAX_CONTEXT_FILE_CHARS, remaining_total)
        if len(preview) > file_limit:
            keep = max(0, file_limit - len(TRUNCATION_MARKER))
            preview = preview[:keep] + TRUNCATION_MARKER
        parts.append(f"--- {fpath} ---\n{preview}")
        remaining_total -= len(preview)
    return "\n\n".join(parts)
