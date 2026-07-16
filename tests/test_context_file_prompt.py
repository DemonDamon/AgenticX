#!/usr/bin/env python3
"""Tests for context_files prompt budget and failure semantics.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.agent_runtime import _serialize_context_files
from agenticx.runtime.context_file_budget import (
    MAX_CONTEXT_FILE_CHARS,
    MAX_CONTEXT_FILES_TOTAL_CHARS,
    TRUNCATION_MARKER,
    serialize_context_files,
)
from agenticx.runtime.prompts.meta_agent import _build_context_files_block


def test_context_prompt_includes_hydrated_document_text() -> None:
    session = SimpleNamespace(
        context_files={
            "/tmp/resume.pdf": "李岳临，十年 Java 经验",
        }
    )
    block = _build_context_files_block(session)
    assert "李岳临，十年 Java 经验" in block
    assert "--- /tmp/resume.pdf ---" in block
    assert "[附件] resume.pdf" not in block


def test_context_prompt_does_not_claim_failed_attachment_is_missing() -> None:
    session = SimpleNamespace(
        context_files={
            "/tmp/resume.pdf": (
                "[附件解析失败]\n"
                "文件：resume.pdf\n"
                "状态码：liteparse_missing\n"
                "原因：需要 LiteParse\n"
                "处理建议：npm i -g @llamaindex/liteparse"
            )
        }
    )
    block = _build_context_files_block(session)
    assert "[附件解析失败]" in block
    assert "不得声称未找到文件" in block
    assert "file_read" in block
    assert "普通文件路径通常为绝对路径，可直接用于 file_read" not in block


def test_context_prompt_limits_one_file_to_8000_chars() -> None:
    body = "a" * 12_000
    rendered = serialize_context_files({"/tmp/a.pdf": body})
    content = rendered.split("--- /tmp/a.pdf ---\n", 1)[1]
    assert len(content) <= MAX_CONTEXT_FILE_CHARS
    assert content.endswith(TRUNCATION_MARKER.strip()) or TRUNCATION_MARKER in content


def test_context_prompt_limits_all_files_to_16000_chars() -> None:
    files = {
        f"/tmp/f{i}.pdf": ("x" * 6_000)
        for i in range(4)
    }
    rendered = serialize_context_files(files)
    # Strip path headers roughly and ensure body budget is respected.
    bodies = []
    for chunk in rendered.split("--- "):
        if not chunk.strip():
            continue
        if "\n" in chunk:
            bodies.append(chunk.split("\n", 1)[1])
    assert sum(len(b) for b in bodies) <= MAX_CONTEXT_FILES_TOTAL_CHARS + len(TRUNCATION_MARKER) * 4


def test_runtime_context_serialization_uses_same_budget() -> None:
    session = SimpleNamespace(context_files={"/tmp/a.pdf": "y" * 12_000})
    meta = _build_context_files_block(session)
    runtime = _serialize_context_files(session)
    assert "y" * 100 in meta
    assert "y" * 100 in runtime
    assert TRUNCATION_MARKER.strip() in meta or "...(document context truncated)" in meta
    assert TRUNCATION_MARKER.strip() in runtime or "...(document context truncated)" in runtime
