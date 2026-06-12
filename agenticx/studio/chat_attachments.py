#!/usr/bin/env python3
"""Session-scoped chat image attachment helpers.

Persist user-uploaded images under ~/.agenticx/sessions/<id>/uploads/ and
resolve them for vision replay / view_image without fragile client paths.

Author: Damon Li
"""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
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
