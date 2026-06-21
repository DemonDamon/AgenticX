#!/usr/bin/env python3
"""Workspace bootstrap and context loader for AgenticX.

Author: Damon Li
"""

from __future__ import annotations

from datetime import date
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.cli.config_manager import ConfigManager
from agenticx.memory.graph.group_id import classify_subject, parse_group_id_from_avatar


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

SUBJECT_USER_PREF_SECTION = "用户偏好（本主体理解）"
GROUP_USER_PREF_SECTION = "用户偏好（本群理解）"

GROUP_IDENTITY_TEMPLATE = """# IDENTITY.md - {name}

- Name: {name}
- Kind: Group chat (multi-avatar)
- Managed by: Meta-Agent (Machi)
"""

GROUP_MEMORY_TEMPLATE = """# MEMORY.md - Group Long-Term Anchors

## {user_pref_section}
- （本群所理解的用户偏好与协作约定，由 Meta-Agent 维护）

## Agent Notes
- Group created: {created_at}
- Keep this file short and curated.
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


_MEMORY_LIST_ITEM_RE = re.compile(r"^(\s*)[-*]\s+(.*)$")
_MEMORY_CHILD_INDENT = "  "


_MEMORY_ENTRY_MAX_CHARS = 400
_MEMORY_NOISE_PATTERNS = re.compile(
    r"(<think>|</think>|```|\buser\b.*\bask|用户.*要求|用户.*让我|创建的文件列表|简历文件路径)",
    re.IGNORECASE,
)


def _sanitize_memory_note(note: str) -> str | None:
    """Return a sanitised single-line note, or None when the note looks like noise.

    Rules:
    - Strip leading/trailing whitespace and collapse internal newlines to spaces.
    - Reject if the result is longer than _MEMORY_ENTRY_MAX_CHARS.
    - Reject if the text matches known noise patterns (think blocks, file lists, etc.).
    """
    collapsed = " ".join(note.split())
    if not collapsed:
        return None
    if len(collapsed) > _MEMORY_ENTRY_MAX_CHARS:
        return None
    if _MEMORY_NOISE_PATTERNS.search(collapsed):
        return None
    return collapsed


def append_long_term_memory(workspace_dir: Path, note: str, *, section: str | None = None) -> None:
    """Append one note to long-term MEMORY.md, optionally under a ## section."""
    sanitised = _sanitize_memory_note(note)
    if sanitised is None:
        return
    note = sanitised
    memory_path = workspace_dir / "MEMORY.md"
    if not memory_path.exists() or not memory_path.is_file():
        workspace_dir.mkdir(parents=True, exist_ok=True)
        memory_path.write_text(MEMORY_TEMPLATE, encoding="utf-8")
    try:
        section_name = (section or "").strip()
        if not section_name:
            with memory_path.open("a", encoding="utf-8") as handle:
                handle.write(f"\n- {note}\n")
            return
        heading = f"## {section_name}"
        lines = memory_path.read_text(encoding="utf-8", errors="replace").split("\n")
        insert_at = len(lines)
        found = False
        for i, raw in enumerate(lines):
            if raw.strip() == heading:
                found = True
                insert_at = i + 1
                j = i + 1
                while j < len(lines):
                    if lines[j].strip().startswith("## "):
                        break
                    insert_at = j + 1
                    j += 1
                break
        if not found:
            if lines and lines[-1].strip():
                lines.append("")
            lines.extend([heading, ""])
            insert_at = len(lines)
        lines.insert(insert_at, f"- {note.strip()}")
        memory_path.write_text("\n".join(lines), encoding="utf-8")
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


def resolve_default_session_workspace_dir(*, avatar_workspace_dir: str | None = None) -> Path:
    """Resolve filesystem workspace for a Studio session.

    Priority:
    1. Avatar-specific ``workspace_dir`` when non-empty
    2. ``AGX_WORKSPACE_ROOT`` env override (dev/tests)
    3. ``config.yaml`` ``workspace_dir`` via :func:`resolve_workspace_dir`
    """
    avatar_raw = (avatar_workspace_dir or "").strip()
    if avatar_raw:
        return Path(avatar_raw).expanduser().resolve(strict=False)
    env_raw = os.getenv("AGX_WORKSPACE_ROOT", "").strip()
    if env_raw:
        return Path(env_raw).expanduser().resolve(strict=False)
    return resolve_workspace_dir()


def _bound_avatar_id_from_session(session: Any) -> str:
    """Read avatar_id from StudioSession or managed session wrapper."""
    if session is None:
        return ""
    for attr in ("bound_avatar_id", "avatar_id"):
        raw = getattr(session, attr, None)
        if raw is not None and str(raw).strip():
            return str(raw).strip()
    studio = getattr(session, "studio_session", None)
    if studio is not None:
        for attr in ("bound_avatar_id", "avatar_id"):
            raw = getattr(studio, attr, None)
            if raw is not None and str(raw).strip():
                return str(raw).strip()
    return ""


def resolve_subject_workspace_dir(
    avatar_id: Optional[str] = None,
    *,
    session: Any = None,
) -> Path:
    """Resolve workspace directory for the current memory subject (meta/avatar/group)."""
    aid = (avatar_id or "").strip() or _bound_avatar_id_from_session(session)
    subject = classify_subject(aid)
    if subject == "meta":
        return resolve_workspace_dir()
    if subject == "group":
        gid = parse_group_id_from_avatar(aid)
        if not gid:
            return resolve_workspace_dir()
        return ensure_group_workspace(gid)
    from agenticx.avatar.registry import AvatarRegistry

    cfg = AvatarRegistry().get_avatar(aid)
    if cfg is not None and str(cfg.workspace_dir or "").strip():
        return Path(cfg.workspace_dir).expanduser().resolve(strict=False)
    return (DEFAULT_AGENTICX_HOME / "avatars" / aid / "workspace").expanduser().resolve(strict=False)


def ensure_group_workspace(group_id: str, *, group_name: str = "") -> Path:
    """Bootstrap group text memory workspace (lazy for existing groups)."""
    gid = (group_id or "").strip()
    if not gid:
        raise ValueError("group_id is required")
    ws = (DEFAULT_AGENTICX_HOME / "groups" / gid / "workspace").expanduser().resolve(strict=False)
    ws.mkdir(parents=True, exist_ok=True)
    memory_dir = ws / MEMORY_DIR_NAME
    memory_dir.mkdir(parents=True, exist_ok=True)

    display_name = (group_name or "").strip() or gid
    identity_path = ws / "IDENTITY.md"
    if not identity_path.exists():
        identity_path.write_text(
            GROUP_IDENTITY_TEMPLATE.format(name=display_name),
            encoding="utf-8",
        )

    memory_path = ws / "MEMORY.md"
    if not memory_path.exists():
        memory_path.write_text(
            GROUP_MEMORY_TEMPLATE.format(
                user_pref_section=GROUP_USER_PREF_SECTION,
                created_at=date.today().isoformat(),
            ),
            encoding="utf-8",
        )

    today_file = memory_dir / f"{date.today().isoformat()}.md"
    if not today_file.exists():
        today_file.write_text(
            DAILY_MEMORY_TEMPLATE.format(today=date.today().isoformat()),
            encoding="utf-8",
        )
    return ws


def append_user_global_preference(note: str) -> None:
    """Append one preference line to global USER.md (user-level baseline for all subjects)."""
    sanitised = _sanitize_memory_note(note)
    if sanitised is None:
        return
    workspace_dir = resolve_workspace_dir()
    workspace_dir.mkdir(parents=True, exist_ok=True)
    user_path = workspace_dir / "USER.md"
    if not user_path.exists():
        user_path.write_text(USER_TEMPLATE, encoding="utf-8")
    try:
        lines = user_path.read_text(encoding="utf-8", errors="replace").split("\n")
        insert_at = len(lines)
        found = False
        for i, raw in enumerate(lines):
            if raw.strip() == "- Preferences:":
                found = True
                insert_at = i + 1
                j = i + 1
                while j < len(lines):
                    stripped = lines[j].strip()
                    if stripped.startswith("- ") and not lines[j].startswith("  "):
                        break
                    if stripped.startswith("## "):
                        break
                    insert_at = j + 1
                    j += 1
                break
        if not found:
            if lines and lines[-1].strip():
                lines.append("")
            lines.extend(["- Preferences:", f"  - {sanitised}"])
        else:
            lines.insert(insert_at, f"  - {sanitised}")
        user_path.write_text("\n".join(lines), encoding="utf-8")
    except OSError:
        return


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
    return load_workspace_file_from_dir(resolve_workspace_dir(), name)


def load_workspace_file_from_dir(workspace_dir: Path, name: str) -> Optional[str]:
    """Load a markdown file from a specific workspace directory."""
    if name not in ALLOWED_WORKSPACE_FILES:
        return None
    workspace = Path(workspace_dir).expanduser().resolve(strict=False)
    file_path = workspace / name
    if not file_path.exists() or not file_path.is_file():
        return None
    try:
        return file_path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def load_subject_workspace_context(
    avatar_id: Optional[str] = None,
    *,
    session: Any = None,
    subject_label: str = "",
) -> Dict[str, str]:
    """Load global user baseline plus subject-scoped identity/memory files."""
    global_ws = resolve_workspace_dir()
    subject_ws = resolve_subject_workspace_dir(avatar_id, session=session)
    label = (subject_label or "").strip()
    if not label:
        from agenticx.memory.graph.group_id import classify_subject

        kind = classify_subject(avatar_id or _bound_avatar_id_from_session(session))
        if kind == "group":
            label = "群聊"
        elif kind == "avatar":
            label = "数字分身"
        else:
            label = "元智能体"
    return {
        "global_user": load_workspace_file_from_dir(global_ws, "USER.md") or "",
        "identity": load_workspace_file_from_dir(subject_ws, "IDENTITY.md") or "",
        "soul": load_workspace_file_from_dir(subject_ws, "SOUL.md") or "",
        "memory": load_workspace_file_from_dir(subject_ws, "MEMORY.md") or "",
        "daily_memory": _load_today_memory(subject_ws),
        "workspace_dir": str(subject_ws),
        "global_workspace_dir": str(global_ws),
        "subject_label": label,
        "is_meta_subject": subject_ws.resolve(strict=False) == global_ws.resolve(strict=False),
    }


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


def _memory_list_item_indent(raw: str) -> int | None:
    match = _MEMORY_LIST_ITEM_RE.match(raw)
    if not match:
        return None
    return len(match.group(1).replace("\t", "    "))


def _memory_list_item_text(raw: str) -> str | None:
    match = _MEMORY_LIST_ITEM_RE.match(raw)
    if not match:
        return None
    return match.group(2).strip()


def read_memory_entries(workspace_dir: Path) -> List[dict]:
    """Parse MEMORY.md into structured list entries grouped by section.

    Top-level bullets become indexed entries; indented nested bullets are
    attached as ``children`` on the preceding top-level entry.

    Args:
        workspace_dir: The workspace directory.

    Returns:
        A flat list of top-level entries, each with section, index (0-based
        within the section), text, optional children, and 1-based line number.
    """
    memory_file = workspace_dir / "MEMORY.md"
    if not memory_file.exists():
        return []
    lines = memory_file.read_text(encoding="utf-8", errors="replace").splitlines()
    current_section = ""
    counters: dict[str, int] = {}
    section_top: dict[str, dict | None] = {}
    entries: List[dict] = []
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if stripped.startswith("## "):
            current_section = stripped[3:].strip()
            counters.setdefault(current_section, 0)
            section_top[current_section] = None
            continue
        indent = _memory_list_item_indent(raw)
        text = _memory_list_item_text(raw)
        if indent is None or not current_section or text is None:
            continue
        if indent == 0:
            idx = counters[current_section]
            entry = {
                "section": current_section,
                "index": idx,
                "text": text,
                "line": i + 1,
                "children": [],
            }
            entries.append(entry)
            counters[current_section] = idx + 1
            section_top[current_section] = entry
        else:
            parent = section_top.get(current_section)
            if parent is not None:
                parent["children"].append(text)
    return entries


def _trim_entry_block_end(lines: List[str], start: int, end: int) -> int:
    """Drop trailing blank or non-list lines from an entry block."""
    while end > start + 1:
        stripped = lines[end - 1].strip()
        if not stripped or _memory_list_item_indent(lines[end - 1]) is None:
            end -= 1
        else:
            break
    return end


def _locate_entry_block(lines: List[str], section: str, index: int) -> tuple[int, int]:
    """Return ``[start, end)`` line indices for a top-level entry block.

    The block includes nested child bullets under the top-level item.

    Raises:
        ValueError: When the section or index cannot be found.
    """
    current_section = ""
    top_level_idx = 0
    block_start: int | None = None
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if stripped.startswith("## "):
            if block_start is not None:
                return block_start, _trim_entry_block_end(lines, block_start, i)
            current_section = stripped[3:].strip()
            top_level_idx = 0
            block_start = None
            continue
        if current_section != section:
            continue
        indent = _memory_list_item_indent(raw)
        if indent is None:
            continue
        if indent == 0:
            if block_start is not None:
                return block_start, _trim_entry_block_end(lines, block_start, i)
            if top_level_idx == index:
                block_start = i
            top_level_idx += 1
    if block_start is not None:
        for j in range(block_start + 1, len(lines)):
            if lines[j].strip().startswith("## "):
                return block_start, _trim_entry_block_end(lines, block_start, j)
        return block_start, _trim_entry_block_end(lines, block_start, len(lines))
    raise ValueError(f"memory entry not found: section={section!r} index={index}")


def _locate_entry_line(lines: List[str], section: str, index: int) -> int:
    """Return the 0-based line number of the index-th top-level list item.

    Raises:
        ValueError: When the section or the index-th item cannot be found.
    """
    start, _ = _locate_entry_block(lines, section, index)
    return start


def _ensure_memory_file(workspace_dir: Path) -> Path:
    memory_file = workspace_dir / "MEMORY.md"
    if not memory_file.exists():
        workspace_dir.mkdir(parents=True, exist_ok=True)
        memory_file.write_text(MEMORY_TEMPLATE, encoding="utf-8")
    return memory_file


def update_memory_entry(
    workspace_dir: Path,
    section: str,
    index: int,
    new_text: str,
    children: Optional[List[str]] = None,
) -> None:
    """Replace one top-level MEMORY.md entry and optional nested children."""
    memory_file = _ensure_memory_file(workspace_dir)
    lines = memory_file.read_text(encoding="utf-8", errors="replace").split("\n")
    start, end = _locate_entry_block(lines, section, index)
    if children is None:
        children = []
        for raw in lines[start + 1:end]:
            indent = _memory_list_item_indent(raw)
            child_text = _memory_list_item_text(raw)
            if indent is not None and indent > 0 and child_text:
                children.append(child_text)
    new_block = [f"- {new_text.strip()}"]
    for child in children:
        child_text = str(child).strip()
        if child_text:
            new_block.append(f"{_MEMORY_CHILD_INDENT}- {child_text}")
    lines = lines[:start] + new_block + lines[end:]
    memory_file.write_text("\n".join(lines), encoding="utf-8")


def delete_memory_entry(workspace_dir: Path, section: str, index: int) -> None:
    """Delete one top-level MEMORY.md entry block, including nested children."""
    memory_file = _ensure_memory_file(workspace_dir)
    lines = memory_file.read_text(encoding="utf-8", errors="replace").split("\n")
    start, end = _locate_entry_block(lines, section, index)
    del lines[start:end]
    memory_file.write_text("\n".join(lines), encoding="utf-8")


def delete_memory_entries_batch(workspace_dir: Path, targets: List[tuple[str, int]]) -> int:
    """Delete multiple MEMORY.md list entries in a single file write.

    Args:
        workspace_dir: The workspace directory.
        targets: ``(section, index)`` pairs using pre-delete indices within each section.

    Returns:
        Number of list lines removed.
    """
    if not targets:
        return 0
    memory_file = _ensure_memory_file(workspace_dir)
    lines = memory_file.read_text(encoding="utf-8", errors="replace").split("\n")
    line_numbers: set[int] = set()
    for section, index in targets:
        try:
            start, end = _locate_entry_block(lines, section, index)
            for line_no in range(start, end):
                line_numbers.add(line_no)
        except ValueError:
            continue
    if not line_numbers:
        return 0
    for line_no in sorted(line_numbers, reverse=True):
        del lines[line_no]
    memory_file.write_text("\n".join(lines), encoding="utf-8")
    return len(line_numbers)
