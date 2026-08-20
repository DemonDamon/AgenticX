#!/usr/bin/env python3
"""Session-scoped chat attachment helpers.

Persist user-uploaded images and text context files under
~/.agenticx/sessions/<id>/uploads/ for stable file_read / reload paths.

Author: Damon Li
"""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import unquote_to_bytes

_SESSIONS_ROOT = Path(os.path.expanduser("~")) / ".agenticx" / "sessions"

_MIME_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}

_TEXT_PLACEHOLDER_PREFIXES = (
    "[附件] ",
    "[文件引用] ",
    "[附件解析失败]",
    "[图片:",
)


def parse_data_image_url(target: str) -> tuple[bytes, str] | None:
    raw = str(target or "").strip()
    if not raw.startswith("data:image/"):
        return None
    header, _, payload = raw.partition(",")
    if not payload:
        return None
    mime = header[5:].split(";", 1)[0].strip() or "image/png"
    try:
        if ";base64" in header.lower():
            data = base64.b64decode(payload, validate=False)
        else:
            data = unquote_to_bytes(payload)
    except Exception:
        return None
    return data, mime


def _attachment_has_image_data_url(att: dict[str, Any]) -> bool:
    if str(att.get("data_url", "") or "").strip().startswith("data:image/"):
        return True
    sp = str(att.get("storage_path", "") or "").strip()
    return bool(sp and os.path.isfile(sp))


def image_data_url_from_attachment(att: dict[str, Any]) -> str:
    """Return a data:image URL for vision APIs from attachment fields."""
    du = str(att.get("data_url", "") or "").strip()
    if du.startswith("data:image/"):
        return du
    storage_path = str(att.get("storage_path", "") or "").strip()
    if storage_path and os.path.isfile(storage_path):
        data = Path(storage_path).read_bytes()
        mime = str(att.get("mime_type", "") or "").strip() or "image/png"
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"
    return ""


def _clean_image_attachment_rows(atts: Sequence[Any]) -> list[dict[str, Any]]:
    return [dict(a) for a in atts if isinstance(a, dict) and _attachment_has_image_data_url(a)]


def session_uploads_dir(session_id: str) -> Path:
    return _SESSIONS_ROOT / str(session_id or "").strip() / "uploads"


def _display_name_from_context_key(key: str) -> str:
    base = os.path.basename(str(key or "").replace("\\", "/"))
    # Composer keys may append ":snippet" / ":1-10" after the filename.
    name = base.split(":", 1)[0] if base else ""
    return name.strip() or "attachment.txt"


def _text_ext_from_context_key(key: str) -> str:
    name = _display_name_from_context_key(key)
    _, ext = os.path.splitext(name)
    if ext and 1 < len(ext) <= 10 and all(ch.isalnum() or ch == "." for ch in ext):
        return ext.lower()
    return ".txt"


def _safe_upload_basename(key: str) -> str:
    """Stable, filesystem-safe basename preserving original extension when possible."""
    name = _display_name_from_context_key(key)
    # Keep unicode filenames (user expectation: 断舍离待办清单.html); strip path separators only.
    cleaned = name.replace("/", "_").replace("\\", "_").replace("\x00", "").strip()
    if not cleaned or cleaned in {".", ".."}:
        cleaned = f"attachment{_text_ext_from_context_key(key)}"
    return cleaned


def _is_readable_abs_file(key: str) -> bool:
    text = str(key or "").strip()
    if not text:
        return False
    expanded = os.path.expanduser(text)
    if not os.path.isabs(expanded):
        return False
    try:
        return Path(expanded).is_file()
    except (OSError, ValueError):
        return False


#: 交给专门的文档抽取器处理的扩展名（与 context_file_hydration.ALLOWED_EXTENSIONS 同源）。
#: 这些文件**不能**当纯文本直接读进上下文：读得出来不代表读对了。
def _needs_document_extraction(key: str) -> bool:
    """True when this attachment must go through the document extractor.

    ``rehydrate_session_text_context_files`` 会把「能按 utf-8 读出来的绝对路径文件」
    直接当正文塞进上下文。PDF 里只要内容流没压缩，整份文件就是可解码的 ASCII——于是
    占位符被替换成 PDF 源码，后面的 hydrate_turn_context_files 一看已经不是占位符就
    跳过，模型最终读到的是 `%PDF-1.4`、`/MediaBox`、`endobj` 这些东西，而不是正文。

    Word/Chrome 导出的 PDF 多数带压缩流（二进制，解码失败）所以侥幸没事；不压缩的那
    一类就会中招。是否走文档抽取不能取决于「这份文件的字节碰巧能不能解码」。
    """
    from agenticx.studio.context_file_hydration import ALLOWED_EXTENSIONS

    return os.path.splitext(str(key or ""))[1].lower() in ALLOWED_EXTENSIONS


def _is_text_attachment_placeholder(body: str) -> bool:
    stripped = str(body or "").strip()
    if not stripped:
        return True
    if stripped == "[图片文件]":
        return True
    return any(stripped.startswith(prefix) for prefix in _TEXT_PLACEHOLDER_PREFIXES)


def _should_skip_text_context_materialize(key: str, body: str) -> bool:
    if not key:
        return True
    if key.startswith("skill:") or key.startswith("@dir:"):
        return True
    if _is_text_attachment_placeholder(body):
        return True
    if _is_readable_abs_file(key):
        return True
    return False


def _read_text_file(path: Path) -> str | None:
    try:
        if not path.is_file():
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError, ValueError):
        return None


def _find_upload_by_basename(session_id: str, basename: str) -> Path | None:
    name = str(basename or "").strip()
    if not name:
        return None
    uploads = session_uploads_dir(session_id)
    if not uploads.is_dir():
        return None
    direct = uploads / name
    if direct.is_file():
        return direct
    # Legacy digest-named uploads: <sha16>.ext or <sha16>_<name>
    lower = name.casefold()
    stem, ext = os.path.splitext(name)
    for cand in uploads.iterdir():
        if not cand.is_file():
            continue
        cname = cand.name
        if cname.casefold() == lower:
            return cand
        if stem and cname.endswith(f"_{name}"):
            return cand
        if ext and cname.endswith(ext) and len(cname) == 16 + len(ext) and cname[:16].isalnum():
            # Ambiguous digest-only legacy file: only match when unique for this ext.
            continue
    # Second pass for unique legacy digest+ext when basename matches one upload.
    matches = [
        cand
        for cand in uploads.iterdir()
        if cand.is_file()
        and cand.suffix.casefold() == ext.casefold()
        and len(cand.stem) == 16
        and cand.stem.isalnum()
    ]
    if len(matches) == 1 and name:
        return matches[0]
    return None


def _source_path_from_chat_history(
    chat_history: Sequence[Any] | None,
    basename: str,
) -> str:
    want = str(basename or "").strip().casefold()
    if not want or not chat_history:
        return ""
    for row in reversed(list(chat_history)):
        if not isinstance(row, dict) or str(row.get("role", "")).strip() != "user":
            continue
        atts = row.get("attachments")
        if not isinstance(atts, list):
            continue
        for att in atts:
            if not isinstance(att, dict):
                continue
            name = str(att.get("name", "") or "").strip()
            if name.casefold() != want:
                continue
            sp = str(att.get("source_path", "") or att.get("storage_path", "") or "").strip()
            if sp and _is_readable_abs_file(sp):
                return sp
    return ""


def rehydrate_session_text_context_files(
    session_id: str,
    context_files: Mapping[str, str],
    *,
    chat_history: Sequence[Any] | None = None,
) -> dict[str, str]:
    """Fill ``[附件] name`` placeholders from session uploads / history source_path.

    Enables retry of an earlier user turn when Desktop only has attachment metadata
    (name/size) but the body was previously materialized under session/uploads.
    """
    sid = str(session_id or "").strip()
    if not sid or not context_files:
        return {str(k): str(v or "") for k, v in (context_files or {}).items() if str(k or "").strip()}

    out: dict[str, str] = {}
    for raw_key, raw_body in context_files.items():
        key = str(raw_key or "").strip()
        body = str(raw_body or "")
        if not key:
            continue
        if not _is_text_attachment_placeholder(body):
            out[key] = body
            continue
        # 文档类附件保留占位符，交给文档抽取器；当纯文本读会把 PDF 源码灌进上下文。
        if _needs_document_extraction(key):
            out[key] = body
            continue
        # Prefer reading the key itself when it already points at a durable file.
        if _is_readable_abs_file(key):
            text = _read_text_file(Path(os.path.expanduser(key)))
            if text is not None:
                out[key] = text
                continue
        display = _display_name_from_context_key(key)
        if body.strip().startswith("[附件] "):
            display = body.strip()[len("[附件] ") :].strip() or display
        # History source_path (may already be session/uploads/…).
        hist_path = _source_path_from_chat_history(chat_history, display)
        if hist_path:
            text = _read_text_file(Path(os.path.expanduser(hist_path)))
            if text is not None:
                out[hist_path] = text
                continue
        upload = _find_upload_by_basename(sid, display)
        if upload is not None:
            text = _read_text_file(upload)
            if text is not None:
                out[str(upload)] = text
                continue
        out[key] = body
    return out


def patch_chat_history_attachment_source_paths(
    chat_history: Sequence[Any] | None,
    context_files: Mapping[str, str],
) -> bool:
    """Write materialized abs paths back onto matching history attachment rows."""
    if not chat_history or not context_files:
        return False
    name_to_path: dict[str, str] = {}
    for key, body in context_files.items():
        path = str(key or "").strip()
        if not path or _is_text_attachment_placeholder(str(body or "")):
            continue
        if not _is_readable_abs_file(path):
            continue
        name_to_path[_display_name_from_context_key(path).casefold()] = path
    if not name_to_path:
        return False
    changed = False
    for row in chat_history:
        if not isinstance(row, dict) or str(row.get("role", "")).strip() != "user":
            continue
        atts = row.get("attachments")
        if not isinstance(atts, list):
            continue
        for att in atts:
            if not isinstance(att, dict):
                continue
            name = str(att.get("name", "") or "").strip().casefold()
            if not name or name not in name_to_path:
                continue
            new_path = name_to_path[name]
            old = str(att.get("source_path", "") or "").strip()
            if old != new_path:
                att["source_path"] = new_path
                changed = True
    return changed


def materialize_session_text_context_files(
    session_id: str,
    context_files: Mapping[str, str],
) -> dict[str, str]:
    """Write bare-name text context bodies to session uploads/ and rewrite keys.

    Uses the original basename under ``uploads/`` so retry can rehydrate by name.
    Keys that already point at readable absolute files (or placeholders / skill /
    dir refs) are left unchanged. Returns a new dict; values are unchanged.
    """
    sid = str(session_id or "").strip()
    if not sid or not context_files:
        return {str(k): str(v or "") for k, v in (context_files or {}).items() if str(k or "").strip()}

    uploads_dir = session_uploads_dir(sid)
    out: dict[str, str] = {}
    for raw_key, raw_body in context_files.items():
        key = str(raw_key or "").strip()
        body = str(raw_body or "")
        if not key:
            continue
        if _should_skip_text_context_materialize(key, body):
            out[key] = body
            continue
        uploads_dir.mkdir(parents=True, exist_ok=True)
        safe_name = _safe_upload_basename(key)
        dest = uploads_dir / safe_name
        if dest.is_file():
            existing = _read_text_file(dest)
            if existing is not None and existing != body:
                digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:8]
                stem, ext = os.path.splitext(safe_name)
                dest = uploads_dir / f"{stem}_{digest}{ext or _text_ext_from_context_key(key)}"
        if not dest.is_file():
            dest.write_text(body, encoding="utf-8")
        else:
            # Same content already present — keep path stable for retries.
            pass
        # Ensure content matches (overwrite identical-name when equal path reused).
        if _read_text_file(dest) != body:
            dest.write_text(body, encoding="utf-8")
        out[str(dest)] = body
    return out


def materialize_session_image_uploads(
    session_id: str,
    attachments: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Write data:image attachments to session uploads/ and set storage_path."""
    sid = str(session_id or "").strip()
    if not sid or not attachments:
        return [dict(a) for a in attachments if isinstance(a, dict)]

    uploads_dir = session_uploads_dir(sid)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for raw in attachments:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        data_url = str(row.get("data_url", "") or "").strip()
        if not data_url.startswith("data:image/"):
            out.append(row)
            continue
        storage_path = str(row.get("storage_path", "") or "").strip()
        if storage_path and os.path.isfile(storage_path):
            out.append(row)
            continue
        parsed = parse_data_image_url(data_url)
        if parsed is None:
            out.append(row)
            continue
        data, mime = parsed
        digest = hashlib.sha256(data_url.encode("utf-8")).hexdigest()[:16]
        ext = _MIME_EXT.get(mime.lower(), ".png")
        dest = uploads_dir / f"{digest}{ext}"
        if not dest.is_file():
            dest.write_bytes(data)
        row["storage_path"] = str(dest)
        out.append(row)
    return out


def materialize_message_lists_image_uploads(
    session_id: str,
    message_lists: Sequence[List[Dict[str, Any]]],
) -> bool:
    """Ensure inline data:image attachments are written under session uploads/."""
    sid = str(session_id or "").strip()
    if not sid:
        return False
    changed = False
    for messages in message_lists:
        if not isinstance(messages, list):
            continue
        for msg in messages:
            if not isinstance(msg, dict) or msg.get("role") != "user":
                continue
            atts = msg.get("attachments")
            if not isinstance(atts, list) or not atts:
                continue
            dict_atts = [dict(a) for a in atts if isinstance(a, dict)]
            if not dict_atts:
                continue
            needs = any(
                str(a.get("data_url", "") or "").strip().startswith("data:image/")
                and not (
                    str(a.get("storage_path", "") or "").strip()
                    and os.path.isfile(str(a.get("storage_path", "")))
                )
                for a in dict_atts
            )
            if not needs:
                continue
            updated = materialize_session_image_uploads(sid, dict_atts)
            if updated != dict_atts or any(
                str(u.get("storage_path", "") or "") != str(d.get("storage_path", "") or "")
                for u, d in zip(updated, dict_atts)
            ):
                msg["attachments"] = updated
                changed = True
    return changed


def sync_agent_messages_attachments_from_chat_history(
    agent_messages: List[Dict[str, Any]],
    chat_history: Sequence[Dict[str, Any]],
) -> None:
    """Copy image-bearing attachments from chat_history onto agent_messages user rows."""
    if not chat_history:
        return

    rich_by_content: dict[str, list[dict[str, Any]]] = {}
    rich_ordered: list[list[dict[str, Any]]] = []
    for item in chat_history:
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        atts = item.get("attachments")
        if not isinstance(atts, list) or not atts:
            continue
        clean = _clean_image_attachment_rows(atts)
        if not clean:
            continue
        rich_ordered.append(clean)
        txt = str(item.get("content", "") or "").strip()
        if txt and txt not in rich_by_content:
            rich_by_content[txt] = clean

    if not rich_ordered:
        return

    order_idx = 0
    for msg in agent_messages:
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        existing = msg.get("attachments")
        has_image = (
            isinstance(existing, list)
            and any(_attachment_has_image_data_url(a) for a in existing if isinstance(a, dict))
        )
        if has_image:
            order_idx += 1
            continue
        txt = str(msg.get("content", "") or "").strip()
        if txt and txt in rich_by_content:
            msg["attachments"] = list(rich_by_content[txt])
        elif order_idx < len(rich_ordered):
            msg["attachments"] = list(rich_ordered[order_idx])
        order_idx += 1


def iter_session_image_attachments(session: Any) -> list[dict[str, Any]]:
    """Collect image attachment dicts from chat_history then agent_messages."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for source_name in ("chat_history", "agent_messages"):
        rows = getattr(session, source_name, None) or []
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict) or row.get("role") != "user":
                continue
            atts = row.get("attachments")
            if not isinstance(atts, list):
                continue
            for att in atts:
                if not isinstance(att, dict):
                    continue
                if not (
                    _attachment_has_image_data_url(att)
                    or str(att.get("storage_path", "") or "").strip()
                ):
                    continue
                key = (
                    str(att.get("storage_path", "") or "").strip()
                    or str(att.get("data_url", "") or "")[:96]
                    or str(att.get("name", "") or "")
                )
                if not key or key in seen:
                    continue
                seen.add(key)
                out.append(att)
    return out


def resolve_session_chat_image(
    session: Any,
    target: str,
) -> Optional[Tuple[bytes, str, str, str]]:
    """Resolve a user chat upload by storage_path, basename, or data_url."""
    raw = str(target or "").strip()
    if not raw or session is None:
        return None
    basename = os.path.basename(raw.replace("\\", "/")).casefold()
    if not basename:
        return None

    for att in iter_session_image_attachments(session):
        name = str(att.get("name", "") or "").strip()
        storage_path = str(att.get("storage_path", "") or "").strip()
        data_url = str(att.get("data_url", "") or "").strip()
        mime = str(att.get("mime_type", "") or "").strip() or "image/png"

        if storage_path:
            sp_base = os.path.basename(storage_path.replace("\\", "/")).casefold()
            if raw == storage_path or raw.endswith(storage_path) or sp_base == basename:
                path = Path(storage_path)
                if path.is_file():
                    return path.read_bytes(), mime, name or path.name, str(path)

        if name and name.casefold() == basename:
            if storage_path and os.path.isfile(storage_path):
                path = Path(storage_path)
                return path.read_bytes(), mime, name, str(path)
            parsed = parse_data_image_url(data_url)
            if parsed is not None:
                data, parsed_mime = parsed
                return data, parsed_mime or mime, name, data_url[:120]

    return None
