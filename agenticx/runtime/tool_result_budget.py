#!/usr/bin/env python3
"""Tool-loop context budget: archive, classify, and decay old tool results.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Per-tool result size class for budget decay (default: medium).
TOOL_RESULT_CLASS: Dict[str, str] = {
    "scratchpad_read": "small",
    "memory_search": "small",
    "session_search": "small",
    "skill_list": "small",
    "todo_write": "small",
    "list_scheduled_tasks": "small",
    "get_automation_task_logs": "small",
    "show_widget": "small",
    "list_data_sources": "small",
    "query_data_source": "medium",
    "file_read": "large",
    "bash_exec": "large",
    "liteparse": "large",
    "code_search": "medium",
    "mcp_call": "medium",
    "web_search": "medium",
    "skill_import_repo": "medium",
    "desktop_screenshot": "blob",
    "screencapture": "blob",
}

OBSERVATION_ID_RE = re.compile(r"^obs_[a-f0-9]{64}$")
SAFE_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
OBSERVATION_PREFIX = "[tool-result-observation]"
OBSERVATION_TOOLS = frozenset(
    {
        "bash_exec",
        "bash_bg_poll",
        "file_read",
        "liteparse",
        "mcp_call",
        "web_fetch",
        "web_search",
        "code_search",
        "knowledge_search",
    }
)
_RECALL_PAGE_BYTES = 3072
_RECALL_PAGE_LINES = 200
_RECALL_MAX_MATCHES = 20
_RECALL_QUERY_MAX = 256
_RECALL_CONTEXT_MAX = 3
_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


def approx_tokens(text: str) -> int:
    """Approximate token count (len/4), aligned with overflow_recovery heuristic."""
    if not text:
        return 0
    return max(0, len(text) // 4)


def get_result_class(tool_name: str, content: str = "") -> str:
    """Resolve result class for a tool; infer large from content when unmapped."""
    cls = TOOL_RESULT_CLASS.get(str(tool_name or "").strip(), "medium")
    if cls == "medium" and approx_tokens(content) >= 4000:
        return "large"
    return cls


@dataclass
class ToolResultBudgetConfig:
    """Runtime knobs for tool-result budget governance."""

    enabled: bool = True
    keep_rounds: int = 8  # batch doc read + late summarize; 2 rounds caused re-parse loops
    large_threshold_tokens: int = 4000
    archive_batch_tokens: int = 8000
    archive_subdir: str = "tool_archives"


@dataclass
class ApplyBudgetStats:
    """Summary returned by apply_tool_result_budget."""

    archived_replaced: int = 0
    tool_result_tokens_round: int = 0
    tool_result_tokens_session: int = 0


@dataclass
class ToolResultMeta:
    """Metadata for one tool result entry."""

    round_idx: int
    tool_name: str
    result_class: str
    original_chars: int
    archive_path: Optional[str] = None
    one_line_summary: str = ""
    observation_id: Optional[str] = None


@dataclass(frozen=True)
class ToolResultObservation:
    """Prepared tool result: optional content-addressed archive plus projected text."""

    observation_id: Optional[str]
    archive_path: Optional[Path]
    raw_chars: int
    raw_bytes: int
    projected_text: str
    projected_chars: int


def load_config() -> ToolResultBudgetConfig:
    """Load config from env and ~/.agenticx/config.yaml runtime.tool_result_budget."""
    cfg = ToolResultBudgetConfig()
    raw_enabled = os.environ.get("AGX_TOOL_RESULT_BUDGET_ENABLED", "").strip().lower()
    if raw_enabled in {"0", "false", "no", "off"}:
        cfg.enabled = False
    elif raw_enabled in {"1", "true", "yes", "on"}:
        cfg.enabled = True
    raw_keep = os.environ.get("AGX_TOOL_RESULT_KEEP_ROUNDS", "").strip()
    if raw_keep:
        try:
            cfg.keep_rounds = max(0, int(raw_keep))
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        section = ConfigManager.get_value("runtime.tool_result_budget")
        if isinstance(section, dict):
            if "enabled" in section:
                cfg.enabled = bool(section["enabled"])
            if section.get("keep_rounds") is not None:
                cfg.keep_rounds = max(0, int(section["keep_rounds"]))
            if section.get("large_threshold_tokens") is not None:
                cfg.large_threshold_tokens = max(500, int(section["large_threshold_tokens"]))
            if section.get("archive_batch_tokens") is not None:
                cfg.archive_batch_tokens = max(0, int(section["archive_batch_tokens"]))
            sub = str(section.get("archive_subdir") or "").strip()
            if sub:
                cfg.archive_subdir = sub
    except Exception:
        pass
    return cfg


def _resolve_session_id(session: Any) -> Optional[str]:
    """Return a safe session id, preferring _session_id → session_id → _owner_session_id."""
    for attr in ("_session_id", "session_id", "_owner_session_id"):
        text = str(getattr(session, attr, None) or "").strip()
        if not text:
            continue
        if SAFE_SESSION_ID_RE.match(text):
            return text
        return None
    return None


def _session_archive_dir(session: Any, cfg: ToolResultBudgetConfig) -> Optional[Path]:
    sid = getattr(session, "_session_id", None) or getattr(session, "session_id", None)
    text = str(sid or "").strip()
    if not text:
        return None
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    sub = str(cfg.archive_subdir or "tool_archives").strip() or "tool_archives"
    return Path.home() / ".agenticx" / "sessions" / safe / sub


def _safe_call_id(tool_call_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(tool_call_id or "")).strip("_")
    return safe or "unknown"


def _one_line_summary(tool_name: str, content: str) -> str:
    text = str(content or "").replace("\n", " ").strip()
    if len(text) > 160:
        text = text[:157] + "..."
    return f"{tool_name}: {text}" if text else tool_name


def archive_tool_result(
    session: Any,
    *,
    round_idx: int,
    tool_call_id: str,
    tool_name: str,
    content: str,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> Optional[Path]:
    """Persist original tool result text under the session tool_archives directory."""
    cfg = cfg or load_config()
    text = str(content or "")
    if not text:
        return None
    archive_dir = _session_archive_dir(session, cfg)
    if archive_dir is None:
        return None
    try:
        archive_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    fname = f"r{round_idx}-{_safe_call_id(tool_call_id)}-{tool_name}.txt"
    out_path = archive_dir / fname
    try:
        out_path.write_text(text, encoding="utf-8")
    except OSError:
        return None
    return out_path


def record_tool_result_meta(
    session: Any,
    *,
    round_idx: int,
    tool_call_id: str,
    tool_name: str,
    content: str,
    archive_path: Optional[Path] = None,
    observation_id: Optional[str] = None,
) -> None:
    """Store per-call metadata on the session for later budget decay."""
    store: Dict[str, ToolResultMeta] = getattr(session, "_tool_result_meta", None) or {}
    if not isinstance(store, dict):
        store = {}
    rclass = get_result_class(tool_name, content)
    store[str(tool_call_id)] = ToolResultMeta(
        round_idx=round_idx,
        tool_name=tool_name,
        result_class=rclass,
        original_chars=len(content),
        archive_path=str(archive_path) if archive_path else None,
        one_line_summary=_one_line_summary(tool_name, content),
        observation_id=observation_id,
    )
    session._tool_result_meta = store
    session._tool_result_tokens_session = (
        int(getattr(session, "_tool_result_tokens_session", 0) or 0) + approx_tokens(content)
    )


def _recall_instruction(observation_id: str) -> str:
    return (
        f'recall=call tool_result_recall with {{"id":"{observation_id}","query":"literal"}} '
        f'to find exact evidence, or {{"id":"{observation_id}","offset_bytes":0}} '
        f"to page the original"
    )


def _build_archived_summary(meta: ToolResultMeta) -> str:
    if meta.observation_id and OBSERVATION_ID_RE.match(str(meta.observation_id)):
        oid = str(meta.observation_id)
        return (
            f"[tool-result-archived] tool={meta.tool_name} round_first_seen={meta.round_idx}\n"
            f"id={oid}\n"
            f"original_chars={meta.original_chars}\n"
            f"{_recall_instruction(oid)}\n"
            f"one_line_summary: {meta.one_line_summary}"
        )
    path_part = meta.archive_path or "(no archive path)"
    return (
        f"[tool-result-archived] tool={meta.tool_name} round_first_seen={meta.round_idx}\n"
        f"original_chars={meta.original_chars}, archived at {path_part}\n"
        f"one_line_summary: {meta.one_line_summary}"
    )


def _build_observation_aged_summary(
    *,
    observation_id: str,
    tool_name: str,
    original_chars: int,
    one_line_summary: str,
    round_idx: int = 0,
) -> str:
    return (
        f"[tool-result-archived] tool={tool_name} round_first_seen={round_idx}\n"
        f"id={observation_id}\n"
        f"original_chars={original_chars}\n"
        f"{_recall_instruction(observation_id)}\n"
        f"one_line_summary: {one_line_summary}"
    )


def _parse_observation_wrapper(content: str) -> Optional[Dict[str, str]]:
    text = str(content or "")
    if OBSERVATION_PREFIX not in text:
        return None
    parsed: Dict[str, str] = {}
    for key in ("id", "tool", "original_chars", "original_bytes", "projected_chars"):
        match = re.search(rf"^{key}=(.+)$", text, flags=re.M)
        if match:
            parsed[key] = match.group(1).strip()
    oid = parsed.get("id", "")
    if not OBSERVATION_ID_RE.match(oid):
        return None
    return parsed


def _assistant_age_by_index(messages: List[Any]) -> Dict[int, int]:
    age_by_index: Dict[int, int] = {}
    assistant_count = 0
    for index in range(len(messages) - 1, -1, -1):
        age_by_index[index] = assistant_count
        item = messages[index]
        if isinstance(item, dict) and str(item.get("role", "")).lower() == "assistant":
            assistant_count += 1
    return age_by_index


def _observation_body_summary(tool_name: str, content: str) -> str:
    lines = str(content or "").splitlines()
    body_start = 0
    for idx, line in enumerate(lines):
        if line.startswith("recall="):
            body_start = idx + 1
            break
    body = "\n".join(lines[body_start:])
    return _one_line_summary(tool_name, body)


def apply_tool_result_budget(
    messages: List[Dict[str, Any]],
    *,
    current_round: int,
    session: Any,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> Tuple[List[Dict[str, Any]], ApplyBudgetStats]:
    """Return a copy of messages with aged large tool results replaced by summaries."""
    cfg = cfg or load_config()
    stats = ApplyBudgetStats(
        tool_result_tokens_session=int(getattr(session, "_tool_result_tokens_session", 0) or 0),
    )
    if not cfg.enabled:
        for msg in messages:
            if isinstance(msg, dict) and str(msg.get("role", "")).lower() == "tool":
                stats.tool_result_tokens_round += approx_tokens(str(msg.get("content", "")))
        return list(messages), stats

    meta_store: Dict[str, ToolResultMeta] = getattr(session, "_tool_result_meta", None) or {}
    if not isinstance(meta_store, dict):
        meta_store = {}
    age_by_index = _assistant_age_by_index(messages)

    eligible_tokens = 0
    for index, msg in enumerate(messages):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role", "")).lower() != "tool":
            continue
        content = str(msg.get("content", "") or "")
        if "[tool-result-archived]" in content:
            continue
        parsed = _parse_observation_wrapper(content)
        if parsed is not None:
            if age_by_index.get(index, 0) > cfg.keep_rounds:
                eligible_tokens += approx_tokens(content)
            continue
        tool_call_id = str(msg.get("tool_call_id") or msg.get("id") or "")
        meta = meta_store.get(tool_call_id)
        if meta is None:
            continue
        age = current_round - meta.round_idx
        if meta.result_class in {"large", "blob"} and age > cfg.keep_rounds:
            eligible_tokens += approx_tokens(content)
    allow_new_archive = (
        int(cfg.archive_batch_tokens or 0) <= 0
        or eligible_tokens >= int(cfg.archive_batch_tokens)
    )

    out: List[Dict[str, Any]] = []
    for index, msg in enumerate(messages):
        if not isinstance(msg, dict):
            out.append(msg)
            continue
        role = str(msg.get("role", "")).lower()
        if role != "tool":
            out.append(dict(msg))
            continue
        content = str(msg.get("content", "") or "")
        stats.tool_result_tokens_round += approx_tokens(content)
        if "[tool-result-archived]" in content:
            out.append(dict(msg))
            continue
        parsed = _parse_observation_wrapper(content)
        if parsed is not None:
            age = age_by_index.get(index, 0)
            if age > cfg.keep_rounds and allow_new_archive:
                tool_name = parsed.get("tool") or str(msg.get("name") or msg.get("tool_name") or "")
                try:
                    original_chars = int(parsed.get("original_chars") or 0)
                except ValueError:
                    original_chars = len(content)
                meta = meta_store.get(str(msg.get("tool_call_id") or msg.get("id") or ""))
                summary = (
                    meta.one_line_summary
                    if meta is not None and meta.one_line_summary
                    else _observation_body_summary(tool_name, content)
                )
                replaced = dict(msg)
                replaced["content"] = _build_observation_aged_summary(
                    observation_id=parsed["id"],
                    tool_name=tool_name,
                    original_chars=original_chars,
                    one_line_summary=summary,
                    round_idx=meta.round_idx if meta is not None else 0,
                )
                out.append(replaced)
                stats.archived_replaced += 1
            else:
                out.append(dict(msg))
            continue
        tool_call_id = str(msg.get("tool_call_id") or msg.get("id") or "")
        meta = meta_store.get(tool_call_id)
        if meta is None:
            out.append(dict(msg))
            continue
        age = current_round - meta.round_idx
        should_archive = meta.result_class in {"large", "blob"} and age > cfg.keep_rounds
        if should_archive and allow_new_archive:
            replaced = dict(msg)
            replaced["content"] = _build_archived_summary(meta)
            out.append(replaced)
            stats.archived_replaced += 1
        else:
            out.append(dict(msg))

    stats.tool_result_tokens_session = int(getattr(session, "_tool_result_tokens_session", 0) or 0)
    return out, stats


def persist_context_stats(session: Any, payload: Dict[str, Any]) -> None:
    """Append one context_stats line to the session directory."""
    sid = getattr(session, "_session_id", None) or getattr(session, "session_id", None)
    text = str(sid or "").strip()
    if not text:
        return
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    out_path = Path.home() / ".agenticx" / "sessions" / safe / "context_stats.jsonl"
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _observation_id(raw_text: str) -> str:
    digest = hashlib.sha256(str(raw_text or "").encode("utf-8")).hexdigest()
    return f"obs_{digest}"


def _objects_root(session: Any, cfg: ToolResultBudgetConfig) -> Optional[Path]:
    sid = _resolve_session_id(session)
    if sid is None:
        return None
    sub = str(cfg.archive_subdir or "tool_archives").strip() or "tool_archives"
    return Path.home() / ".agenticx" / "sessions" / sid / sub / "objects"


def _observation_object_path(
    session: Any,
    observation_id: str,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> Optional[Path]:
    cfg = cfg or load_config()
    if not OBSERVATION_ID_RE.match(str(observation_id or "")):
        return None
    root = _objects_root(session, cfg)
    if root is None:
        return None
    digest = str(observation_id)[4:]
    return root / digest[:2] / f"{digest}.txt"


def _is_symlink(path: Path) -> bool:
    try:
        return stat.S_ISLNK(path.lstat().st_mode)
    except OSError:
        return path.is_symlink()


def _ensure_secure_dir(path: Path, *, root: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
    cursor = path
    root_resolved = root.resolve()
    seen_root = False
    while True:
        if _is_symlink(cursor):
            raise OSError("symlink directory")
        try:
            resolved = cursor.resolve()
        except OSError as exc:
            raise OSError("path escape") from exc
        if resolved == root_resolved:
            seen_root = True
        if cursor == root or cursor.parent == cursor:
            break
        cursor = cursor.parent
    if not seen_root:
        raise OSError("path escape")
    try:
        if root_resolved not in path.resolve().parents and path.resolve() != root_resolved:
            raise OSError("path escape")
    except OSError:
        raise


def _open_nofollow(path: Path, flags: int, mode: int = 0o600) -> int:
    return os.open(str(path), flags | _O_NOFOLLOW, mode)


def _read_secure_file(path: Path) -> bytes:
    if _is_symlink(path):
        raise OSError("symlink object")
    fd = _open_nofollow(path, os.O_RDONLY)
    try:
        chunks: List[bytes] = []
        while True:
            piece = os.read(fd, 1024 * 64)
            if not piece:
                break
            chunks.append(piece)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _verify_existing_object(path: Path, raw_bytes: bytes) -> None:
    if _is_symlink(path):
        raise OSError("symlink object")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise OSError("not a regular file")
    existing = _read_secure_file(path)
    if len(existing) != len(raw_bytes):
        raise OSError("observation hash mismatch")
    if hashlib.sha256(existing).hexdigest() != hashlib.sha256(raw_bytes).hexdigest():
        raise OSError("observation hash mismatch")


def archive_tool_observation(
    session: Any,
    *,
    raw_text: str,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> Optional[Tuple[str, Path]]:
    """Write a content-addressed observation object for the current session."""
    cfg = cfg or load_config()
    text = str(raw_text or "")
    if not text:
        return None
    observation_id = _observation_id(text)
    path = _observation_object_path(session, observation_id, cfg)
    root = _objects_root(session, cfg)
    if path is None or root is None:
        return None
    raw_bytes = text.encode("utf-8")
    try:
        _ensure_secure_dir(path.parent, root=root)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        try:
            fd = _open_nofollow(path, flags, 0o600)
        except FileExistsError:
            _verify_existing_object(path, raw_bytes)
            return observation_id, path
        try:
            os.write(fd, raw_bytes)
            try:
                os.fchmod(fd, 0o600)
            except OSError:
                pass
        finally:
            os.close(fd)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        _verify_existing_object(path, raw_bytes)
    except OSError:
        return None
    return observation_id, path


def build_tool_observation_projection(
    *,
    observation_id: str,
    tool_name: str,
    raw_text: str,
    compacted_text: str,
) -> str:
    """Wrap an already-shortened tool result with a stable recall handle."""
    raw = str(raw_text or "")
    compact = str(compacted_text or "")
    header = (
        f"{OBSERVATION_PREFIX}\n"
        f"id={observation_id}\n"
        f"tool={tool_name}\n"
        f"original_chars={len(raw)}\n"
        f"original_bytes={len(raw.encode('utf-8'))}\n"
        f"projected_chars={len(compact)}\n"
        f"{_recall_instruction(observation_id)}\n"
    )
    return header + compact


def prepare_tool_result_observation(
    session: Any,
    *,
    round_idx: int,
    tool_call_id: str,
    tool_name: str,
    raw_text: str,
    compacted_text: str,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> ToolResultObservation:
    """Archive a large tool result when possible and return the provider projection."""
    cfg = cfg or load_config()
    raw = str(raw_text or "")
    compact = str(compacted_text or "")
    raw_bytes = len(raw.encode("utf-8"))
    name = str(tool_name or "").strip()

    def _plain(projected: str, *, observation_id: Optional[str] = None, archive_path: Optional[Path] = None) -> ToolResultObservation:
        record_tool_result_meta(
            session,
            round_idx=round_idx,
            tool_call_id=tool_call_id,
            tool_name=name,
            content=raw,
            archive_path=archive_path,
            observation_id=observation_id,
        )
        return ToolResultObservation(
            observation_id=observation_id,
            archive_path=archive_path,
            raw_chars=len(raw),
            raw_bytes=raw_bytes,
            projected_text=projected,
            projected_chars=len(projected),
        )

    if name == "tool_result_recall":
        return _plain(compact)

    should_wrap = (
        bool(cfg.enabled)
        and name in OBSERVATION_TOOLS
        and len(compact) < len(raw)
        and bool(raw)
    )
    if not should_wrap:
        return _plain(compact)

    try:
        archived = archive_tool_observation(session, raw_text=raw, cfg=cfg)
    except Exception:
        archived = None
    if archived is None:
        return _plain(compact)

    observation_id, archive_path = archived
    projected = build_tool_observation_projection(
        observation_id=observation_id,
        tool_name=name,
        raw_text=raw,
        compacted_text=compact,
    )
    return _plain(projected, observation_id=observation_id, archive_path=archive_path)


def _is_utf8_boundary(data: bytes, offset: int) -> bool:
    if offset < 0 or offset > len(data):
        return False
    if offset == 0 or offset == len(data):
        return True
    return (data[offset] & 0xC0) != 0x80


def _take_utf8_page(data: bytes, offset: int) -> bytes:
    end = min(len(data), offset + _RECALL_PAGE_BYTES)
    while end > offset and end < len(data) and not _is_utf8_boundary(data, end):
        end -= 1
    chunk = data[offset:end]
    newline_at = 0
    lines = 0
    for idx, byte in enumerate(chunk):
        if byte == 0x0A:
            lines += 1
            newline_at = idx + 1
            if lines >= _RECALL_PAGE_LINES:
                return chunk[:newline_at]
    return chunk


def _count_lines(chunk: bytes) -> int:
    if not chunk:
        return 0
    lines = chunk.count(b"\n")
    if not chunk.endswith(b"\n"):
        lines += 1
    return lines


def _load_observation_bytes(session: Any, observation_id: str, cfg: ToolResultBudgetConfig) -> bytes:
    oid = str(observation_id or "").strip()
    if not OBSERVATION_ID_RE.match(oid):
        raise ValueError("invalid observation id")
    path = _observation_object_path(session, oid, cfg)
    if path is None:
        raise FileNotFoundError("unknown observation")
    try:
        if not path.exists() or _is_symlink(path):
            raise FileNotFoundError("unknown observation")
        data = _read_secure_file(path)
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise FileNotFoundError("unknown observation") from exc
    expected = oid[4:]
    if hashlib.sha256(data).hexdigest() != expected:
        raise FileNotFoundError("unknown observation")
    return data


def _iter_object_lines(data: bytes) -> Iterable[Tuple[int, str]]:
    start = 0
    line_no = 1
    while start <= len(data):
        end = data.find(b"\n", start)
        if end < 0:
            if start < len(data) or (start == len(data) and data.endswith(b"\n") is False and start == 0):
                yield line_no, data[start:].decode("utf-8")
            elif start < len(data):
                yield line_no, data[start:].decode("utf-8")
            break
        yield line_no, data[start:end].decode("utf-8")
        line_no += 1
        start = end + 1
        if start == len(data) and data.endswith(b"\n"):
            break


def _snippet_around_query(text: str, query: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    lower = text.lower()
    pos = lower.find(query.lower())
    if pos < 0:
        return text[:max_chars]
    start = max(0, pos - max(32, max_chars // 3))
    end = min(len(text), start + max_chars)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet


def _recall_search(data: bytes, *, observation_id: str, query: str, context_lines: int) -> str:
    needle = query.lower()
    lines = list(_iter_object_lines(data))
    match_rows = [idx for idx, text in lines if needle in text.lower()]
    truncated = False
    if len(match_rows) > _RECALL_MAX_MATCHES:
        match_rows = match_rows[:_RECALL_MAX_MATCHES]
        truncated = True
    match_set = set(match_rows)
    windows: List[Tuple[int, int]] = []
    for row in match_rows:
        start = max(1, row - context_lines)
        end = row + context_lines
        if windows and start <= windows[-1][1]:
            prev_start, prev_end = windows[-1]
            windows[-1] = (prev_start, max(prev_end, end))
        else:
            windows.append((start, end))

    by_no = {num: text for num, text in lines}
    body_lines: List[str] = []
    emitted = 0
    body_bytes = 0
    for start, end in windows:
        ordered = list(range(start, end + 1))
        ordered.sort(key=lambda num: (0 if num in match_set else 1, num))
        pending: List[str] = []
        for num in ordered:
            if num not in by_no:
                continue
            remaining = _RECALL_PAGE_BYTES - body_bytes
            if emitted >= _RECALL_PAGE_LINES or remaining <= 0:
                truncated = True
                break
            text = by_no[num]
            if num in match_set:
                text = _snippet_around_query(text, query, max(64, remaining - 1))
            encoded = (text + "\n").encode("utf-8")
            if len(encoded) > remaining:
                if num in match_set:
                    text = _snippet_around_query(text, query, max(32, remaining - 1))
                    encoded = (text + "\n").encode("utf-8")
                    if len(encoded) > remaining:
                        truncated = True
                        continue
                else:
                    truncated = True
                    continue
            pending.append(text)
            emitted += 1
            body_bytes += len(encoded)
        body_lines.extend(pending)
        if truncated and (emitted >= _RECALL_PAGE_LINES or body_bytes >= _RECALL_PAGE_BYTES):
            break

    header = (
        f"[tool_result_recall id={observation_id} query={query} "
        f"matches={len(match_rows)} truncated={str(truncated).lower()}]"
    )
    if not body_lines:
        return header
    return header + "\n" + "\n".join(body_lines)


def recall_tool_observation(
    session: Any,
    observation_id: str,
    *,
    offset_bytes: Optional[int] = None,
    query: Optional[str] = None,
    context_lines: int = 2,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> str:
    """Read or search a previously archived tool observation in the current session."""
    cfg = cfg or load_config()
    oid = str(observation_id or "").strip()
    if not OBSERVATION_ID_RE.match(oid):
        raise ValueError("invalid observation id")
    query_text = str(query or "")
    if query is not None and query_text and offset_bytes is not None:
        raise ValueError("query and offset_bytes are mutually exclusive")
    if len(query_text) > _RECALL_QUERY_MAX:
        raise ValueError("query too long")
    ctx = int(context_lines)
    if ctx < 0 or ctx > _RECALL_CONTEXT_MAX:
        raise ValueError("context_lines out of range")
    data = _load_observation_bytes(session, oid, cfg)
    if query is not None and query_text:
        return _recall_search(data, observation_id=oid, query=query_text, context_lines=ctx)

    offset = 0 if offset_bytes is None else int(offset_bytes)
    if offset < 0 or offset > len(data):
        raise ValueError("offset out of range")
    if not _is_utf8_boundary(data, offset):
        raise ValueError("offset is not a UTF-8 character boundary")
    chunk = _take_utf8_page(data, offset)
    next_offset = offset + len(chunk)
    eof = next_offset >= len(data)
    header = (
        f"[tool_result_recall id={oid} offset={offset} next_offset={next_offset} "
        f"eof={str(eof).lower()}]\n"
        f"[chunk_bytes={len(chunk)} chunk_lines={_count_lines(chunk)}]\n"
    )
    return header + chunk.decode("utf-8")
