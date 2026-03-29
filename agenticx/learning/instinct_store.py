#!/usr/bin/env python3
"""File-based storage for instincts with atomic writes.

Author: Damon Li
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from agenticx.learning.instinct import Instinct


class InstinctStore:
    """Manage instinct documents under ~/.agenticx/instincts."""

    def __init__(self, root_dir: Path | None = None) -> None:
        self.root_dir = root_dir or (Path.home() / ".agenticx" / "instincts")

    def _scope_dir(self, scope: str, project_id: str | None = None) -> Path:
        if scope == "global":
            path = self.root_dir / "global"
        else:
            pid = project_id or "default"
            path = self.root_dir / "projects" / pid / "instincts"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save(self, instinct: Instinct) -> Path:
        """Persist one instinct markdown file with atomic replacement."""
        target_dir = self._scope_dir(instinct.scope, instinct.project_id)
        output_path = target_dir / f"{instinct.id}.md"
        payload = instinct.to_markdown()
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            delete=False,
            dir=str(target_dir),
            prefix=f"{instinct.id}.tmp.",
        ) as handle:
            handle.write(payload)
            temp_path = Path(handle.name)
        temp_path.replace(output_path)
        return output_path

    def list_instincts(self, scope: str = "project", project_id: str | None = None) -> list[Instinct]:
        """Read instincts from the requested scope and skip invalid files."""
        instincts: list[Instinct] = []
        search_dir = self._scope_dir(scope, project_id)
        for file_path in sorted(search_dir.glob("*.md")):
            try:
                instincts.append(Instinct.from_markdown(file_path.read_text(encoding="utf-8")))
            except Exception:
                continue
        return instincts
