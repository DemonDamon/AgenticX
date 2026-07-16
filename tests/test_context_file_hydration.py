#!/usr/bin/env python3
"""Tests for context_files document placeholder hydration.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agenticx.studio import context_file_hydration as hydration
from agenticx.tools.document_text import DocumentTextError


@pytest.mark.asyncio
async def test_hydrates_pdf_placeholder_from_absolute_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    turn = {str(pdf): "[附件] resume.pdf"}
    session: dict[str, str] = {}

    async def fake_read(path: Path) -> str:
        assert path == pdf
        return "简历正文"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.succeeded == 1
    assert session[str(pdf)] == "简历正文"
    assert turn[str(pdf)] == "[附件] resume.pdf"


@pytest.mark.asyncio
async def test_does_not_reparse_existing_text_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    turn = {str(pdf): "[附件] resume.pdf"}
    session = {str(pdf): "already hydrated"}
    calls: list[Path] = []

    async def fake_read(path: Path) -> str:
        calls.append(path)
        return "new"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.skipped >= 1
    assert calls == []
    assert session[str(pdf)] == "already hydrated"


@pytest.mark.asyncio
async def test_ignores_skill_virtual_key(monkeypatch: pytest.MonkeyPatch) -> None:
    turn = {"skill:demo": "[附件] demo"}
    session: dict[str, str] = {}
    calls: list[Path] = []

    async def fake_read(path: Path) -> str:
        calls.append(path)
        return "x"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.attempted == 0
    assert calls == []
    assert session == {}


@pytest.mark.asyncio
async def test_ignores_image_marker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    img = tmp_path / "pic.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    turn = {str(img): "[图片文件]"}
    session: dict[str, str] = {}
    calls: list[Path] = []

    async def fake_read(path: Path) -> str:
        calls.append(path)
        return "x"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.attempted == 0
    assert calls == []


@pytest.mark.asyncio
async def test_missing_path_becomes_structured_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing = tmp_path / "gone.pdf"
    turn = {str(missing): "[附件] gone.pdf"}
    session: dict[str, str] = {}

    async def fake_read(path: Path) -> str:
        raise AssertionError("should not parse missing path")

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.failed == 1
    body = session[str(missing)]
    assert body.startswith("[附件解析失败]")
    assert "状态码：path_missing" in body
    assert "gone.pdf" in body


@pytest.mark.asyncio
async def test_parser_failure_preserves_attachment_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "resume.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    turn = {str(pdf): "[附件] resume.pdf"}
    session: dict[str, str] = {}

    async def fake_read(path: Path) -> str:
        raise DocumentTextError(
            "liteparse_missing",
            "需要 LiteParse",
            install_hint="npm i -g @llamaindex/liteparse",
        )

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.failed == 1
    body = session[str(pdf)]
    assert body.startswith("[附件解析失败]")
    assert "状态码：liteparse_missing" in body
    assert "resume.pdf" in body
    assert "需要 LiteParse" in body
    assert turn[str(pdf)] == "[附件] resume.pdf"


@pytest.mark.asyncio
async def test_limits_files_per_turn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = []
    turn: dict[str, str] = {}
    for idx in range(5):
        path = tmp_path / f"doc{idx}.pdf"
        path.write_bytes(b"%PDF-1.4\n")
        files.append(path)
        turn[str(path)] = f"[附件] doc{idx}.pdf"
    session: dict[str, str] = {}
    parsed: list[str] = []

    async def fake_read(path: Path) -> str:
        parsed.append(path.name)
        return f"body-{path.name}"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert len(parsed) == 4
    assert report.attempted == 4
    fifth = session[str(files[4])]
    assert fifth.startswith("[附件解析失败]")
    assert "状态码：turn_limit" in fifth or "状态码：resource_limit" in fifth


@pytest.mark.asyncio
async def test_limits_concurrency_to_two(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    turn: dict[str, str] = {}
    for idx in range(4):
        path = tmp_path / f"doc{idx}.pdf"
        path.write_bytes(b"%PDF-1.4\n")
        turn[str(path)] = f"[附件] doc{idx}.pdf"
    session: dict[str, str] = {}
    current = 0
    max_seen = 0
    lock = asyncio.Lock()

    async def fake_read(path: Path) -> str:
        nonlocal current, max_seen
        async with lock:
            current += 1
            max_seen = max(max_seen, current)
        await asyncio.sleep(0.05)
        async with lock:
            current -= 1
        return f"body-{path.name}"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    await hydration.hydrate_turn_context_files(turn, session)
    assert max_seen <= 2


@pytest.mark.asyncio
async def test_times_out_one_file_without_failing_others(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    slow = tmp_path / "slow.pdf"
    fast = tmp_path / "fast.pdf"
    slow.write_bytes(b"%PDF-1.4\n")
    fast.write_bytes(b"%PDF-1.4\n")
    turn = {
        str(slow): "[附件] slow.pdf",
        str(fast): "[附件] fast.pdf",
    }
    session: dict[str, str] = {}

    async def fake_read(path: Path) -> str:
        if path.name == "slow.pdf":
            await asyncio.sleep(0.2)
            return "slow"
        return "fast body"

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    monkeypatch.setattr(hydration, "PARSE_TIMEOUT_SECONDS", 0.05)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.succeeded == 1
    assert report.failed == 1
    assert session[str(fast)] == "fast body"
    assert "状态码：parse_timeout" in session[str(slow)]


@pytest.mark.asyncio
async def test_truncates_each_document_to_context_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "long.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    turn = {str(pdf): "[附件] long.pdf"}
    session: dict[str, str] = {}

    async def fake_read(path: Path) -> str:
        return "x" * 12_000

    monkeypatch.setattr(hydration, "read_document_text", fake_read)
    monkeypatch.setattr(hydration, "MAX_HYDRATED_CHARS", 100)
    report = await hydration.hydrate_turn_context_files(turn, session)
    assert report.succeeded == 1
    body = session[str(pdf)]
    assert len(body) <= 100 + len("\n...(document context truncated)")
    assert body.endswith("...(document context truncated)")
