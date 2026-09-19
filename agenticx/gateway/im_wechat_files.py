#!/usr/bin/env python3
"""Select and encode WeChat outbound files.

Author: Damon Li
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_FILES_PER_TURN = 5
MAX_WALK_FILES = 3000
MAX_WALK_DEPTH = 6

ALLOWED_EXTENSIONS = frozenset(
    {
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".md",
        ".txt",
        ".csv",
        ".rtf",
        ".odt",
        ".ods",
        ".odp",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".zip",
        ".7z",
        ".tar",
        ".gz",
        ".html",
    }
)

_DENIED_DIR_NAMES = frozenset({".ssh", ".gnupg", ".aws", ".kube"})
_DENIED_ROOT_PREFIXES = ("/etc/", "/proc/", "/sys/", "/dev/")
_DENIED_NAME_FRAGMENTS = (
    ".env",
    "credentials",
    "id_rsa",
    ".pem",
    ".key",
    ".p12",
)
_SKIP_DIR_NAMES = frozenset({".git", "node_modules", "__pycache__", ".venv", "venv"})

_SEND_INTENT_RE = re.compile(
    r"(发我|发给我|发文件|发附件|发到微信|发给微信|send me|send the file)",
    re.IGNORECASE,
)
_ABS_PATH_RE = re.compile(
    r"(?:(?:/?(?:Users|home|tmp|var|opt|private|Volumes)[^\s`<>\[\]()]+)"
    r"|(?:[A-Za-z]:[\\/][^\s`<>\[\]()]+)"
    r"|(?:~/[^\s`<>\[\]()]+))"
)
_OK_WROTE_RE = re.compile(
    r"OK:\s*(?:wrote|edited)\s+(\S.*?)(?:\s+\(\d+\s+chars?\))?(?=\s*(?:\n|$))",
    re.IGNORECASE,
)
_BOOK_TITLE_RE = re.compile(r"《([^》]+\.[A-Za-z0-9]{1,8})》")
_BACKTICK_FILE_RE = re.compile(r"`([^`\n]+\.[A-Za-z0-9]{1,8})`")

_FILE_TOOLS_PRODUCED = frozenset({"file_write"})
_FILE_TOOLS_REFERENCED = frozenset({"file_read", "file_edit"})


@dataclass(frozen=True)
class WeChatChatResult:
    text: str
    file_paths: tuple[str, ...] = ()
    bubbles: tuple[str, ...] = ()


def user_wants_file_delivery(text: str) -> bool:
    return bool(_SEND_INTENT_RE.search(str(text or "")))


def extract_absolute_paths(text: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    raw = str(text or "")
    for match in _ABS_PATH_RE.finditer(raw):
        path = match.group(0).rstrip(".,;:，。；：")
        if path not in seen:
            seen.add(path)
            out.append(path)
    for match in _OK_WROTE_RE.finditer(raw):
        path = str(match.group(1) or "").strip().rstrip(".,;:，。；：")
        if path and path not in seen:
            seen.add(path)
            out.append(path)
    return out


def extract_mentioned_filenames(text: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    raw = str(text or "")
    for regex in (_BOOK_TITLE_RE, _BACKTICK_FILE_RE):
        for match in regex.finditer(raw):
            name = Path(str(match.group(1) or "").strip()).name
            if name and name not in seen:
                seen.add(name)
                out.append(name)
    return out


def _tool_path(data: dict) -> str:
    args = data.get("arguments") or data.get("args") or {}
    if not isinstance(args, dict):
        return ""
    return str(args.get("path") or args.get("file") or "").strip()


def _tool_name(data: dict) -> str:
    return str(data.get("name") or data.get("tool_name") or "").strip()


def _result_text(data: dict) -> str:
    raw = data.get("result", data.get("content", data.get("text", "")))
    if isinstance(raw, dict):
        return str(raw.get("text") or raw.get("output") or raw.get("stdout") or "")
    return str(raw or "")


def paths_from_sse_payload(
    event_type: str, data: dict | None
) -> tuple[list[str], list[str]]:
    """Return (produced_paths, referenced_paths) from one SSE payload."""
    produced: list[str] = []
    referenced: list[str] = []
    payload = data if isinstance(data, dict) else {}
    et = str(event_type or "")

    if et in {"group_reply", "group_clarification"}:
        artifacts = payload.get("artifacts") or []
        if isinstance(artifacts, list):
            for item in artifacts:
                if not isinstance(item, dict):
                    continue
                path = str(item.get("source_path") or "").strip()
                if path:
                    produced.append(path)

    if et == "tool_call":
        name = _tool_name(payload)
        path = _tool_path(payload)
        if path and name in _FILE_TOOLS_PRODUCED:
            produced.append(path)
        elif path and name in _FILE_TOOLS_REFERENCED:
            referenced.append(path)

    if et == "tool_result":
        name = _tool_name(payload)
        path = _tool_path(payload)
        if path and name in _FILE_TOOLS_PRODUCED:
            produced.append(path)
        for wrote in extract_absolute_paths(_result_text(payload)):
            produced.append(wrote)
        for match in _OK_WROTE_RE.finditer(_result_text(payload)):
            wrote = str(match.group(1) or "").strip()
            if wrote:
                produced.append(wrote)

    return produced, referenced


def _expand_user(path: Path) -> Path:
    try:
        return path.expanduser()
    except OSError:
        return path


def _denied_by_name(path: Path) -> bool:
    name = path.name.lower()
    if name in {".env", "id_rsa", "credentials"}:
        return True
    return any(frag in name for frag in _DENIED_NAME_FRAGMENTS)


def _denied_by_dir(path: Path) -> bool:
    parts = {part.lower() for part in path.parts}
    if parts & _DENIED_DIR_NAMES:
        return True
    posix = path.as_posix()
    if posix in {"/etc", "/proc", "/sys", "/dev"}:
        return True
    return any(posix.startswith(prefix) for prefix in _DENIED_ROOT_PREFIXES)


def is_sendable_file(path: str | Path) -> bool:
    raw = _expand_user(Path(str(path or "").strip()))
    if not raw.suffix.lower() in ALLOWED_EXTENSIONS:
        return False
    if _denied_by_name(raw) or _denied_by_dir(raw):
        return False
    try:
        resolved = raw.resolve(strict=False)
    except OSError:
        return False
    if _denied_by_name(resolved) or _denied_by_dir(resolved):
        return False
    try:
        if not resolved.is_file():
            return False
        if resolved.stat().st_size > MAX_FILE_BYTES:
            return False
    except OSError:
        return False
    return True


def resolve_filename(name: str, search_roots: Sequence[Path]) -> Path | None:
    needle = Path(str(name or "").strip()).name
    if not needle or "/" in needle or "\\" in needle:
        return None
    if Path(needle).suffix.lower() not in ALLOWED_EXTENSIONS:
        return None
    seen_files = 0
    for root in search_roots:
        base = _expand_user(Path(root))
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in _walk_limited(base):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_NAMES]
            for filename in filenames:
                seen_files += 1
                if seen_files > MAX_WALK_FILES:
                    return None
                if filename == needle:
                    candidate = Path(dirpath) / filename
                    if is_sendable_file(candidate):
                        return candidate.resolve()
    return None


def _walk_limited(root: Path):
    root_depth = len(root.resolve().parts)
    for dirpath, dirnames, filenames in os_walk(root):
        depth = len(Path(dirpath).resolve().parts) - root_depth
        if depth >= MAX_WALK_DEPTH:
            dirnames[:] = []
        yield dirpath, dirnames, filenames


def os_walk(root: Path):
    import os

    return os.walk(root, followlinks=False)


def default_search_roots(session_id: str = "") -> list[Path]:
    home = Path.home() / ".agenticx"
    roots = [
        home / "workspace",
        home / "taskspaces",
    ]
    avatars = home / "avatars"
    if avatars.is_dir():
        for child in avatars.iterdir():
            ws = child / "workspace"
            if ws.is_dir():
                roots.append(ws)
    sid = str(session_id or "").strip()
    if sid:
        roots.append(home / "sessions" / sid)
    return roots


def _normalize_existing(path: str) -> Path | None:
    raw = str(path or "").strip()
    if not raw:
        return None
    candidate = _expand_user(Path(raw))
    if is_sendable_file(candidate):
        return candidate.resolve()
    return None


def select_outbound_files(
    *,
    user_input: str,
    produced_paths: Iterable[str],
    referenced_paths: Iterable[str],
    reply_text: str,
    search_roots: Sequence[Path] | None = None,
    session_id: str = "",
) -> list[Path]:
    chosen: list[Path] = []
    seen: set[str] = set()

    def _add(path: Path | None) -> None:
        if path is None:
            return
        key = str(path)
        if key in seen:
            return
        if not is_sendable_file(path):
            return
        seen.add(key)
        chosen.append(path)

    for raw in produced_paths:
        _add(_normalize_existing(raw))

    if user_wants_file_delivery(user_input):
        roots = list(search_roots) if search_roots is not None else default_search_roots(session_id)
        for raw in referenced_paths:
            _add(_normalize_existing(raw))
        blob = f"{user_input}\n{reply_text}"
        for raw in extract_absolute_paths(blob):
            _add(_normalize_existing(raw))
        for name in extract_mentioned_filenames(blob):
            _add(resolve_filename(name, roots))

    return chosen[:MAX_FILES_PER_TURN]


def build_sidecar_file_payload(
    path: Path,
    *,
    recipient: str,
    context_token: str,
    caption: str = "",
) -> dict:
    target = Path(path)
    raw = target.read_bytes()
    filename = target.name
    payload = {
        "recipient": recipient,
        "context_token": context_token,
        "file": base64.standard_b64encode(raw).decode("ascii"),
        "filename": filename,
    }
    caption_text = str(caption or "").strip()
    if caption_text:
        payload["caption"] = caption_text
    return payload


_SENT_NOTICE_PREFIX = "已通过微信附件发送："
_SPEAKER_PREFIX_RE = re.compile(r"^[^\n：:]{1,32}[：:]\s*")


def is_redundant_wechat_file_text(text: str, paths: Sequence[Path]) -> bool:
    """True when a text bubble would only repeat the file names being sent."""
    names = {Path(p).name for p in paths if Path(p).name}
    if not names:
        return False
    body = str(text or "").strip()
    if not body:
        return True
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = _SPEAKER_PREFIX_RE.sub("", line, count=1).strip()
        if line.startswith(_SENT_NOTICE_PREFIX):
            rest = line[len(_SENT_NOTICE_PREFIX) :].strip()
            parts = [part.strip() for part in re.split(r"[、,，]", rest) if part.strip()]
            if any(part not in names for part in parts):
                return False
            continue
        if line not in names:
            return False
    return True


def append_sent_files_notice(text: str, paths: Sequence[Path]) -> str:
    names = [Path(p).name for p in paths if Path(p).name]
    if not names:
        return str(text or "")
    notice = "已通过微信附件发送：" + "、".join(names)
    body = str(text or "").strip()
    if notice in body:
        return body
    if not body:
        return notice
    return f"{body}\n\n{notice}"


def coerce_chat_result(value: object) -> WeChatChatResult:
    if isinstance(value, WeChatChatResult):
        return value
    return WeChatChatResult(text=str(value or ""), file_paths=())
