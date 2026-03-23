#!/usr/bin/env python3
"""Workspace bootstrap and context loader for AgenticX.

Author: Damon Li
"""

from __future__ import annotations

from datetime import date
import json
from pathlib import Path
from typing import Dict, Optional

from agenticx.cli.config_manager import ConfigManager


DEFAULT_WORKSPACE_DIR = Path.home() / ".agenticx" / "workspace"
DEFAULT_AGENTICX_HOME = Path.home() / ".agenticx"
MEMORY_DIR_NAME = "memory"
SKILLS_DIR_NAME = "skills"
MCP_FILE_NAME = "mcp.json"
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


def append_daily_memory(workspace_dir: Path, note: str) -> None:
    """Append one note to today's daily memory file."""
    memory_path = workspace_dir / MEMORY_DIR_NAME / f"{date.today().isoformat()}.md"
    if not memory_path.exists() or not memory_path.is_file():
        return
    try:
        with memory_path.open("a", encoding="utf-8") as handle:
            handle.write(f"\n  - {note}\n")
    except OSError:
        return


def append_long_term_memory(workspace_dir: Path, note: str) -> None:
    """Append one note to long-term MEMORY.md."""
    memory_path = workspace_dir / "MEMORY.md"
    if not memory_path.exists() or not memory_path.is_file():
        return
    try:
        with memory_path.open("a", encoding="utf-8") as handle:
            handle.write(f"\n- {note}\n")
    except OSError:
        return


def load_favorites(workspace_dir: Path) -> list[dict]:
    """Load global favorites list from workspace (JSON array of dicts)."""
    path = workspace_dir / "favorites.json"
    if not path.exists() or not path.is_file():
        return []
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def upsert_favorite(workspace_dir: Path, entry: dict) -> bool:
    """Append one favorite if not duplicate by non-empty message_id.

    Returns True when a new row was written, False when message_id already exists
    or when the file could not be written.
    """
    message_id = str(entry.get("message_id") or "").strip()
    content_norm = str(entry.get("content") or "").strip()
    favorites = load_favorites(workspace_dir)
    # Duplicate = same (message_id, content), so one chat message can have multiple excerpt favorites.
    if message_id:
        for row in favorites:
            r_mid = str(row.get("message_id") or "").strip()
            r_content = str(row.get("content") or "").strip()
            if r_mid == message_id and r_content == content_norm:
                return False
    if content_norm:
        for row in favorites:
            if str(row.get("content") or "").strip() == content_norm:
                return False
    favorites.append(entry)
    path = workspace_dir / "favorites.json"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(favorites, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        return False
    return True


def remove_favorite_memory_note(workspace_dir: Path, content: str) -> bool:
    """Remove matching [用户收藏] note(s) from MEMORY.md by content."""
    text = str(content or "").strip()
    if not text:
        return False
    memory_path = workspace_dir / "MEMORY.md"
    if not memory_path.exists() or not memory_path.is_file():
        return False
    try:
        raw = memory_path.read_text(encoding="utf-8")
    except OSError:
        return False
    target = f"[用户收藏] {text[:500].strip()}"
    removed = False
    kept_lines: list[str] = []
    for line in raw.splitlines():
        normalized = line.strip()
        if normalized.startswith("- "):
            normalized = normalized[2:].strip()
        if normalized == target:
            removed = True
            continue
        kept_lines.append(line)
    if not removed:
        return False
    new_raw = "\n".join(kept_lines)
    if raw.endswith("\n"):
        new_raw += "\n"
    try:
        memory_path.write_text(new_raw, encoding="utf-8")
    except OSError:
        return False
    return True


def delete_favorite(workspace_dir: Path, message_id: str) -> bool:
    """Remove entry by message_id. Returns True if deleted."""
    mid = str(message_id or "").strip()
    if not mid:
        return False
    favorites = load_favorites(workspace_dir)
    new_list = [x for x in favorites if str(x.get("message_id") or "").strip() != mid]
    if len(new_list) == len(favorites):
        return False
    path = workspace_dir / "favorites.json"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(new_list, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        return False
    return True


def update_favorite_tags(workspace_dir: Path, message_id: str, tags: list[str]) -> bool:
    """Set tags for a favorite by message_id. Returns True if updated."""
    mid = str(message_id or "").strip()
    if not mid:
        return False
    seen: set[str] = set()
    norm: list[str] = []
    for t in tags:
        s = str(t).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        norm.append(s)
    favorites = load_favorites(workspace_dir)
    updated = False
    for row in favorites:
        if str(row.get("message_id") or "").strip() == mid:
            row["tags"] = norm
            updated = True
            break
    if not updated:
        return False
    path = workspace_dir / "favorites.json"
    try:
        path.write_text(json.dumps(favorites, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        return False
    return True


def resolve_workspace_dir() -> Path:
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


def ensure_workspace(*, index_memory: bool = True) -> Path:
    """Create workspace and default files if they do not exist."""
    workspace_dir = resolve_workspace_dir()
    workspace_dir.mkdir(parents=True, exist_ok=True)
    agenticx_home = DEFAULT_AGENTICX_HOME
    agenticx_home.mkdir(parents=True, exist_ok=True)
    (agenticx_home / SKILLS_DIR_NAME).mkdir(parents=True, exist_ok=True)
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

    mcp_path = agenticx_home / MCP_FILE_NAME
    if not mcp_path.exists():
        cursor_mcp = Path.home() / ".cursor" / MCP_FILE_NAME
        imported_ok = False
        if cursor_mcp.exists():
            try:
                from agenticx.cli.studio_mcp import import_mcp_config

                result = import_mcp_config(str(cursor_mcp), str(mcp_path))
                imported_ok = bool(result.get("ok"))
                if imported_ok:
                    append_daily_memory(
                        workspace_dir,
                        f"Imported MCP config from {cursor_mcp} to {mcp_path}.",
                    )
            except Exception:
                imported_ok = False
        if not imported_ok:
            mcp_path.write_text(
                json.dumps({"mcpServers": {}}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    if index_memory:
        try:
            from agenticx.memory.workspace_memory import WorkspaceMemoryStore

            store = WorkspaceMemoryStore()
            store.index_workspace_sync(workspace_dir)
        except Exception:
            pass
    return workspace_dir


def load_workspace_file(name: str) -> Optional[str]:
    """Load a workspace markdown file and return None when absent."""
    if name not in ALLOWED_WORKSPACE_FILES:
        return None
    workspace_dir = resolve_workspace_dir()
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
    workspace_dir = ensure_workspace(index_memory=False)
    return {
        "identity": load_workspace_file("IDENTITY.md") or "",
        "user": load_workspace_file("USER.md") or "",
        "soul": load_workspace_file("SOUL.md") or "",
        "memory": load_workspace_file("MEMORY.md") or "",
        "daily_memory": _load_today_memory(workspace_dir),
        "workspace_dir": str(workspace_dir),
    }
