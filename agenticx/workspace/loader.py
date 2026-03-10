#!/usr/bin/env python3
"""Workspace bootstrap and context loader for AgenticX.

Author: Damon Li
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Dict, Optional

from agenticx.cli.config_manager import ConfigManager


DEFAULT_WORKSPACE_DIR = Path.home() / ".agenticx" / "workspace"
MEMORY_DIR_NAME = "memory"
ALLOWED_WORKSPACE_FILES = {"IDENTITY.md", "USER.md", "SOUL.md", "MEMORY.md"}

IDENTITY_TEMPLATE = """# IDENTITY.md - Who You Are

- Name: AgenticX Meta-Agent
- Role: AgenticX Desktop orchestration CEO
- Vibe: Pragmatic, structured, concise, execution-first
- Language: Chinese by default
"""

USER_TEMPLATE = """# USER.md - About Your User

- Name: (fill me)
- Preferred address: (fill me)
- Timezone: Asia/Shanghai
- Preferences:
  - All replies in Chinese
  - Keep responses concise and actionable
"""

SOUL_TEMPLATE = """# SOUL.md - How You Behave

## Principles
- Be helpful without mechanical boilerplate.
- Lead with conclusion, then supporting evidence.
- Do real work first; ask only when necessary.
- Preserve user trust through accurate execution.

## Boundaries
- Do not fabricate tools, files, or capabilities.
- Do not expose private data to external surfaces.
- Ask before taking public or destructive actions.
"""

MEMORY_TEMPLATE = """# MEMORY.md - Long-Term Anchors

## User Anchors
- Name: (unknown)
- Role: (unknown)
- Language policy: Chinese response, key technical terms can stay English

## Agent Notes
- Keep this file short and curated.
- Move transient details into daily memory files.
"""

DAILY_MEMORY_TEMPLATE = """# Daily Memory

- Date: {today}
- Notes:
  - (add important session outcomes here)
"""


def _resolve_workspace_dir() -> Path:
    """Resolve workspace path from config with safe fallback."""
    try:
        cfg = ConfigManager.load()
        raw = (cfg.workspace_dir or "").strip()
    except Exception:
        raw = ""
    if raw.lower() in {"none", "null"}:
        raw = ""
    if not raw:
        return DEFAULT_WORKSPACE_DIR
    return Path(raw).expanduser().resolve(strict=False)


def _workspace_files() -> Dict[str, str]:
    return {
        "IDENTITY.md": IDENTITY_TEMPLATE,
        "USER.md": USER_TEMPLATE,
        "SOUL.md": SOUL_TEMPLATE,
        "MEMORY.md": MEMORY_TEMPLATE,
    }


def ensure_workspace() -> Path:
    """Create workspace and default files if they do not exist."""
    workspace_dir = _resolve_workspace_dir()
    workspace_dir.mkdir(parents=True, exist_ok=True)
    memory_dir = workspace_dir / MEMORY_DIR_NAME
    memory_dir.mkdir(parents=True, exist_ok=True)

    for filename, content in _workspace_files().items():
        target = workspace_dir / filename
        if not target.exists():
            target.write_text(content, encoding="utf-8")

    today_file = memory_dir / f"{date.today().isoformat()}.md"
    if not today_file.exists():
        today_file.write_text(
            DAILY_MEMORY_TEMPLATE.format(today=date.today().isoformat()),
            encoding="utf-8",
        )
    return workspace_dir


def load_workspace_file(name: str) -> Optional[str]:
    """Load a workspace markdown file and return None when absent."""
    if name not in ALLOWED_WORKSPACE_FILES:
        return None
    workspace_dir = _resolve_workspace_dir()
    try:
        workspace_real = workspace_dir.resolve(strict=False)
        file_path = (workspace_dir / name).resolve(strict=True)
    except OSError:
        return None
    try:
        file_path.relative_to(workspace_real)
    except ValueError:
        return None
    if not file_path.exists() or not file_path.is_file():
        return None
    try:
        content = file_path.read_text(encoding="utf-8")
    except OSError:
        return None
    return content.strip()


def _load_today_memory(workspace_dir: Path) -> str:
    memory_path = workspace_dir / MEMORY_DIR_NAME / f"{date.today().isoformat()}.md"
    if not memory_path.exists() or not memory_path.is_file():
        return ""
    try:
        return memory_path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def load_workspace_context() -> Dict[str, str]:
    """Load identity, user, soul, long-term memory and today's memory."""
    workspace_dir = ensure_workspace()
    return {
        "identity": load_workspace_file("IDENTITY.md") or "",
        "user": load_workspace_file("USER.md") or "",
        "soul": load_workspace_file("SOUL.md") or "",
        "memory": load_workspace_file("MEMORY.md") or "",
        "daily_memory": _load_today_memory(workspace_dir),
        "workspace_dir": str(workspace_dir),
    }
