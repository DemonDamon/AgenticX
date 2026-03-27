#!/usr/bin/env python3
"""LiteParse document adapter for lightweight parsing.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.tools.adapters.base import DocumentAdapter, ParsedArtifacts


logger = logging.getLogger(__name__)


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
        """Return True if LiteParse CLI (or npx) is available."""
        if shutil.which("liteparse"):
            return True
        return shutil.which("npx") is not None

    def _find_cli(self) -> Optional[List[str]]:
        """Resolve CLI executable command parts."""
        if self.cli_path:
            return [self.cli_path]

        liteparse_path = shutil.which("liteparse")
        if liteparse_path:
            return [liteparse_path]

        npx_path = shutil.which("npx")
        if npx_path:
            return [npx_path, "liteparse"]

        local_paths = [
            Path.cwd() / "node_modules/.bin/liteparse",
            Path(__file__).resolve().parents[4] / "node_modules/.bin/liteparse",
        ]
        for path in local_paths:
            if path.exists():
                return [str(path)]
        return None

    async def _run_liteparse_parse(self, file_path: Path) -> Dict[str, Any]:
        """Execute LiteParse parse command and decode JSON output."""
        cmd_prefix = self._find_cli()
        if not cmd_prefix:
            raise FileNotFoundError("liteparse CLI not found")

        cmd = [*cmd_prefix, "parse", str(file_path), "--format", "json", "-q"]
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=self.timeout)

        if process.returncode != 0:
            stderr_text = stderr.decode("utf-8", errors="ignore")
            raise RuntimeError(f"liteparse parse failed: {stderr_text}")

        try:
            return json.loads(stdout.decode("utf-8", errors="ignore"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"liteparse JSON decode failed: {exc}") from exc

    async def parse(
        self,
        file_path: Path,
        output_dir: Path,
        language: str = "auto",
        enable_formula: bool = True,
        enable_table: bool = True,
        page_ranges: Optional[str] = None,
        **kwargs: Any,
    ) -> ParsedArtifacts:
        """Parse document and map output to ParsedArtifacts."""
        if not self._validate_file(file_path):
            raise ValueError(f"Invalid file: {file_path}")

        task_id = self._generate_task_id(file_path)
        actual_output_dir = self._prepare_output_dir(output_dir, task_id)

        liteparse_json = await self._run_liteparse_parse(file_path)
        text_content = liteparse_json.get("text", "")
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

    async def parse_to_text(self, file_path: Path) -> str:
        """Parse document and return merged plain text."""
        temp_output = Path(tempfile.mkdtemp(prefix="agenticx_liteparse_"))
        try:
            artifacts = await self.parse(file_path=file_path, output_dir=temp_output)
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
