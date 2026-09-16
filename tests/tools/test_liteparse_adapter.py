#!/usr/bin/env python3
"""Tests for LiteParseAdapter.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sys
import threading
from pathlib import Path
from typing import Any, Optional

import pytest

import agenticx.tools.adapters.liteparse as liteparse_module
from agenticx.tools.adapters.liteparse import LiteParseAdapter, LiteParseCancelled


def test_liteparse_is_available_with_liteparse_binary(monkeypatch: pytest.MonkeyPatch) -> None:
    """Adapter should be available when liteparse binary exists."""
    monkeypatch.setattr("agenticx.tools.adapters.liteparse.shutil.which", lambda name: "/usr/bin/liteparse" if name == "liteparse" else None)
    assert LiteParseAdapter.is_available() is True


def test_liteparse_is_available_with_npx(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bare npx alone must not count as LiteParse installed."""
    def fake_which(name: str):
        if name == "liteparse":
            return None
        if name == "npx":
            return "/usr/bin/npx"
        return None

    monkeypatch.setattr("agenticx.tools.adapters.liteparse.shutil.which", fake_which)
    monkeypatch.setattr(
        "agenticx.tools.adapters.liteparse.Path.exists",
        lambda self: False,
    )
    assert LiteParseAdapter.is_available() is False


@pytest.mark.asyncio
async def test_parse_maps_to_parsed_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """parse() should map LiteParse JSON to ParsedArtifacts fields."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy pdf payload", encoding="utf-8")

    adapter = LiteParseAdapter()

    async def fake_run(_file_path: Path, **_kwargs: Any):
        return {
            "text": "hello liteparse",
            "pages": [{"page": 1}, {"page": 2}],
        }

    monkeypatch.setattr(adapter, "_run_liteparse_parse", fake_run)

    artifacts = await adapter.parse(file_path=source, output_dir=tmp_path / "out")

    assert artifacts.backend_type == "liteparse"
    assert artifacts.page_count == 2
    assert artifacts.markdown_file is not None
    assert artifacts.content_list_json is not None
    assert artifacts.markdown_file.exists()
    assert artifacts.content_list_json.exists()
    assert "hello liteparse" in artifacts.markdown_file.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_parse_to_text_returns_markdown_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """parse_to_text() should return markdown content from artifacts."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")
    adapter = LiteParseAdapter()

    async def fake_parse(*, file_path: Path, output_dir: Path, **kwargs):
        markdown_file = output_dir / "task123" / "sample.md"
        markdown_file.parent.mkdir(parents=True, exist_ok=True)
        markdown_file.write_text("parsed content", encoding="utf-8")
        return type(
            "FakeArtifacts",
            (),
            {"markdown_file": markdown_file},
        )()

    monkeypatch.setattr(adapter, "parse", fake_parse)
    text = await adapter.parse_to_text(source)
    assert text == "parsed content"


@pytest.mark.asyncio
async def test_parse_extracts_text_from_pages_when_top_text_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """parse() should merge page texts when top-level text is absent."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")

    adapter = LiteParseAdapter()

    async def fake_run(_file_path: Path, **_kwargs: Any):
        return {
            "pages": [
                {"page": 1, "text": "page one"},
                {"page": 2, "text": "page two"},
            ]
        }

    monkeypatch.setattr(adapter, "_run_liteparse_parse", fake_run)

    artifacts = await adapter.parse(file_path=source, output_dir=tmp_path / "out")
    assert artifacts.markdown_file is not None
    merged = artifacts.markdown_file.read_text(encoding="utf-8")
    assert "page one" in merged
    assert "page two" in merged


class FakeProcess:
    """Minimal subprocess-like object for adapter kill/cancel tests."""

    def __init__(
        self,
        *,
        pid: int = 4242,
        communicate_result: tuple[bytes, bytes] = (b'{"text":"ok"}', b""),
        communicate_delay: Optional[float] = None,
    ) -> None:
        self.pid = pid
        self.returncode: Optional[int] = None
        self.stdout = None
        self.stderr = None
        self.kill_called = False
        self._communicate_result = communicate_result
        self._communicate_delay = communicate_delay

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._communicate_delay is not None:
            await asyncio.sleep(self._communicate_delay)
        self.returncode = 0
        return self._communicate_result

    def kill(self) -> None:
        self.kill_called = True
        self.returncode = -9

    async def wait(self) -> int:
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


def _write_hang_script(tmp_path: Path) -> Path:
    hang_py = tmp_path / "hang.py"
    hang_py.write_text("import time; time.sleep(120)\n", encoding="utf-8")
    return hang_py


@pytest.mark.asyncio
async def test_run_liteparse_timeout_kills_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Timeout must kill the child process and raise TimeoutError."""
    hang_py = _write_hang_script(tmp_path)
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")

    adapter = LiteParseAdapter(timeout=0.4)
    monkeypatch.setattr(adapter, "_find_cli", lambda: [sys.executable, str(hang_py)])

    kill_calls: list[int] = []
    original_kill = liteparse_module._kill_liteparse_process

    async def spy_kill(process: Any) -> None:
        kill_calls.append(process.pid)
        await original_kill(process)

    monkeypatch.setattr(liteparse_module, "_kill_liteparse_process", spy_kill)

    with pytest.raises(TimeoutError, match="timed out"):
        await adapter._run_liteparse_parse(source)

    assert kill_calls, "expected kill helper to be invoked on timeout"


@pytest.mark.asyncio
async def test_run_liteparse_cancel_event_kills_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """cancel_event must kill the child process and raise LiteParseCancelled."""
    hang_py = _write_hang_script(tmp_path)
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")

    adapter = LiteParseAdapter(timeout=30.0)
    monkeypatch.setattr(adapter, "_find_cli", lambda: [sys.executable, str(hang_py)])

    cancel_event = threading.Event()
    kill_calls: list[int] = []
    original_kill = liteparse_module._kill_liteparse_process

    async def spy_kill(process: Any) -> None:
        kill_calls.append(process.pid)
        await original_kill(process)

    monkeypatch.setattr(liteparse_module, "_kill_liteparse_process", spy_kill)

    async def set_cancel_after_delay() -> None:
        await asyncio.sleep(0.2)
        cancel_event.set()

    cancel_task = asyncio.create_task(set_cancel_after_delay())
    try:
        with pytest.raises(LiteParseCancelled, match="cancelled"):
            await adapter._run_liteparse_parse(source, cancel_event=cancel_event)
    finally:
        await cancel_task

    assert kill_calls, "expected kill helper to be invoked on cancel_event"


@pytest.mark.asyncio
async def test_run_liteparse_cancelled_error_kills_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """asyncio.CancelledError must kill the child process before propagating."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")

    fake_process = FakeProcess(communicate_delay=3600.0)

    async def fake_create_subprocess_exec(*_args: Any, **_kwargs: Any) -> FakeProcess:
        return fake_process

    monkeypatch.setattr(
        "agenticx.tools.adapters.liteparse.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    adapter = LiteParseAdapter(timeout=30.0)
    monkeypatch.setattr(adapter, "_find_cli", lambda: ["liteparse"])

    task = asyncio.create_task(adapter._run_liteparse_parse(source))
    await asyncio.sleep(0.05)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert fake_process.kill_called, "expected FakeProcess.kill on CancelledError"


@pytest.mark.asyncio
async def test_run_liteparse_success_does_not_kill_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Successful communicate must not invoke process kill helpers."""
    source = tmp_path / "sample.pdf"
    source.write_text("dummy", encoding="utf-8")

    fake_process = FakeProcess(communicate_result=(b'{"text":"ok"}', b""))

    async def fake_create_subprocess_exec(*_args: Any, **_kwargs: Any) -> FakeProcess:
        return fake_process

    monkeypatch.setattr(
        "agenticx.tools.adapters.liteparse.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    adapter = LiteParseAdapter(timeout=30.0)
    monkeypatch.setattr(adapter, "_find_cli", lambda: ["liteparse"])

    result = await adapter._run_liteparse_parse(source)

    assert result["text"] == "ok"
    assert fake_process.kill_called is False
