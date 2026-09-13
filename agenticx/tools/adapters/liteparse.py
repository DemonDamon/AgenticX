#!/usr/bin/env python3
"""LiteParse document adapter for lightweight parsing.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.tools.adapters.base import DocumentAdapter, ParsedArtifacts


logger = logging.getLogger(__name__)


class LiteParseCancelled(RuntimeError):
    """Raised when a LiteParse parse is cancelled via cancel_event."""


async def _kill_liteparse_process(process: asyncio.subprocess.Process) -> None:
    """Force-kill a LiteParse child process and best-effort wait for exit."""
    if process.returncode is not None:
        return

    if sys.platform == "win32":
        process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            process.kill()

    try:
        await asyncio.wait_for(process.wait(), timeout=2.0)
    except asyncio.TimeoutError:
        pass


class LiteParseAdapter(DocumentAdapter):
    """Lightweight document parsing adapter backed by LiteParse CLI."""

    SUPPORTED_FORMATS = [
        ".pdf",
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
        ".xls",
        ".xlsx",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
    ]

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        cli_path: Optional[str] = None,
        timeout: float = 300.0,
    ) -> None:
        super().__init__(config=config)
        self.cli_path = cli_path
        self.timeout = timeout

    @staticmethod
    def is_available() -> bool:
        """Return True if an installed LiteParse CLI binary is available.

        Presence of bare ``npx`` alone is not enough: using ``npx liteparse``
        can trigger an implicit network install during chat turns.
        """
        if shutil.which("liteparse"):
            return True
        if shutil.which("liteparse.cmd"):
            return True
        local_paths = [
            Path.cwd() / "node_modules/.bin/liteparse",
            Path(__file__).resolve().parents[4] / "node_modules/.bin/liteparse",
        ]
        return any(path.exists() for path in local_paths)

    def _find_cli(self) -> Optional[List[str]]:
        """Resolve CLI executable command parts."""
        if self.cli_path:
            return [self.cli_path]

        for name in ("liteparse", "liteparse.cmd"):
            liteparse_path = shutil.which(name)
            if liteparse_path:
                return [liteparse_path]

        local_paths = [
            Path.cwd() / "node_modules/.bin/liteparse",
            Path(__file__).resolve().parents[4] / "node_modules/.bin/liteparse",
        ]
        for path in local_paths:
            if path.exists():
                return [str(path)]
        return None

    async def _run_liteparse_parse(
        self,
        file_path: Path,
        *,
        cancel_event: Optional[threading.Event] = None,
    ) -> Dict[str, Any]:
        """Execute LiteParse parse command and decode JSON output."""
        cmd_prefix = self._find_cli()
        if not cmd_prefix:
            raise FileNotFoundError("liteparse CLI not found")

        cmd = [*cmd_prefix, "parse", str(file_path), "--format", "json", "-q"]
        subprocess_kwargs: Dict[str, Any] = {}
        if sys.platform != "win32":
            subprocess_kwargs["start_new_session"] = True

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            **subprocess_kwargs,
        )

        comm_task = asyncio.create_task(process.communicate())
        watcher_tasks: set[asyncio.Task[Any]] = {comm_task}

        try:
            if cancel_event is not None:
                cancel_wait = asyncio.create_task(
                    asyncio.to_thread(cancel_event.wait, self.timeout)
                )
                watcher_tasks.add(cancel_wait)
                done, _pending = await asyncio.wait(
                    watcher_tasks,
                    timeout=self.timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            else:
                done, _pending = await asyncio.wait(
                    {comm_task},
                    timeout=self.timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )

            if cancel_event is not None and cancel_event.is_set():
                await _kill_liteparse_process(process)
                raise LiteParseCancelled("liteparse cancelled")

            if comm_task not in done or not comm_task.done():
                await _kill_liteparse_process(process)
                raise TimeoutError(f"liteparse timed out after {self.timeout:.0f}s")

            stdout, stderr = comm_task.result()

            if process.returncode != 0:
                stderr_text = stderr.decode("utf-8", errors="ignore")
                raise RuntimeError(f"liteparse parse failed: {stderr_text}")

            try:
                return json.loads(stdout.decode("utf-8", errors="ignore"))
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"liteparse JSON decode failed: {exc}") from exc
        except asyncio.CancelledError:
            await _kill_liteparse_process(process)
            raise
        finally:
            for task in watcher_tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*watcher_tasks, return_exceptions=True)

    async def parse(
        self,
        file_path: Path,
        output_dir: Path,
        language: str = "auto",
        enable_formula: bool = True,
        enable_table: bool = True,
        page_ranges: Optional[str] = None,
        *,
        cancel_event: Optional[threading.Event] = None,
        **kwargs: Any,
    ) -> ParsedArtifacts:
        """Parse document and map output to ParsedArtifacts."""
        if not self._validate_file(file_path):
            raise ValueError(f"Invalid file: {file_path}")

        task_id = self._generate_task_id(file_path)
        actual_output_dir = self._prepare_output_dir(output_dir, task_id)

        if cancel_event is not None:
            liteparse_json = await self._run_liteparse_parse(
                file_path,
                cancel_event=cancel_event,
            )
        else:
            liteparse_json = await self._run_liteparse_parse(file_path)
        text_content = self._extract_text_content(liteparse_json)
        page_count = len(liteparse_json.get("pages", []))

        markdown_file = actual_output_dir / f"{file_path.stem}.md"
        markdown_file.write_text(text_content, encoding="utf-8")

        content_list_json = actual_output_dir / f"{file_path.stem}_content_list.json"
        content_list_json.write_text(
            json.dumps(liteparse_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return ParsedArtifacts(
            task_id=task_id,
            source_file=file_path,
            output_dir=actual_output_dir,
            markdown_file=markdown_file,
            content_list_json=content_list_json,
            page_count=page_count,
            backend_type="liteparse",
            language=language,
            enable_formula=enable_formula,
            enable_table=enable_table,
            page_ranges=page_ranges,
            errors=[],
            warnings=[],
        )

    @staticmethod
    def _extract_text_content(liteparse_json: Dict[str, Any]) -> str:
        """Extract text from LiteParse JSON payload.

        LiteParse may return text in two shapes:
        1) {"text": "...", "pages": [...]}
        2) {"pages": [{"text": "..."}, ...]}
        """
        top_text = liteparse_json.get("text")
        if isinstance(top_text, str) and top_text.strip():
            return top_text

        pages = liteparse_json.get("pages")
        if not isinstance(pages, list):
            return ""

        page_texts: List[str] = []
        for page in pages:
            if isinstance(page, dict):
                text = page.get("text")
                if isinstance(text, str) and text:
                    page_texts.append(text)
        return "\n\n".join(page_texts)

    async def parse_to_text(
        self,
        file_path: Path,
        *,
        cancel_event: Optional[threading.Event] = None,
    ) -> str:
        """Parse document and return merged plain text."""
        temp_output = Path(tempfile.mkdtemp(prefix="agenticx_liteparse_"))
        try:
            parse_kwargs: Dict[str, Any] = {
                "file_path": file_path,
                "output_dir": temp_output,
            }
            if cancel_event is not None:
                parse_kwargs["cancel_event"] = cancel_event
            artifacts = await self.parse(**parse_kwargs)
            if artifacts.markdown_file and artifacts.markdown_file.exists():
                return artifacts.markdown_file.read_text(encoding="utf-8", errors="ignore")
            return ""
        finally:
            shutil.rmtree(temp_output, ignore_errors=True)

    def get_supported_formats(self) -> List[str]:
        """Get supported formats for this adapter."""
        return list(self.SUPPORTED_FORMATS)

    def validate_config(self) -> bool:
        """Validate runtime config."""
        return self.is_available()
