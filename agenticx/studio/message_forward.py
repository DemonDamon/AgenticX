#!/usr/bin/env python3
"""Build persisted forward-card entries for Desktop merge-forward.

Author: Damon Li
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any


def normalize_forward_attachment(raw: Any) -> dict[str, Any] | None:
    """Normalize one attachment payload from the Desktop forward client."""
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name", "") or "").strip() or "file"
    mime = str(raw.get("mime_type", "") or raw.get("mimeType", "") or "").strip()
    data_url = str(raw.get("data_url", "") or raw.get("dataUrl", "") or "").strip()
    storage_path = str(raw.get("storage_path", "") or raw.get("storagePath", "") or "").strip()
    source_path = str(raw.get("source_path", "") or raw.get("sourcePath", "") or "").strip()
    size_raw = raw.get("size")
    try:
        size = int(size_raw) if size_raw is not None else 0
    except (TypeError, ValueError):
        size = 0
    if not mime and data_url.startswith("data:"):
        semi = data_url.find(";")
        if data_url.startswith("data:") and semi > 5:
            mime = data_url[5:semi]
    if not mime:
        mime = "application/octet-stream"
    # Prefer resolving a missing data:image URL from a readable storage_path.
    if (not data_url.startswith("data:image/")) and storage_path and os.path.isfile(storage_path):
        try:
            from agenticx.studio.chat_attachments import image_data_url_from_attachment

            resolved = image_data_url_from_attachment(
                {"data_url": data_url, "storage_path": storage_path, "mime_type": mime}
            )
            if resolved.startswith("data:image/"):
                data_url = resolved
                if not mime.startswith("image/"):
                    mime = "image/png"
        except Exception:
            pass
    if not data_url and not storage_path and not source_path:
        # Keep named chips even without bytes so the UI can still show "had a file".
        if name == "file":
            return None
    out: dict[str, Any] = {
        "name": name,
        "mime_type": mime,
        "size": max(0, size),
    }
    if data_url:
        out["data_url"] = data_url
    if storage_path:
        out["storage_path"] = storage_path
    if source_path:
        out["source_path"] = source_path
    return out


def normalize_forward_items(messages: list[Any]) -> list[dict[str, Any]]:
    """Normalize client forward message rows (text + attachments)."""
    normalized: list[dict[str, Any]] = []
    for item in messages:
        if not isinstance(item, dict):
            continue
        sender = str(item.get("sender", "") or "").strip() or "unknown"
        role = str(item.get("role", "") or "").strip() or "assistant"
        avatar_url = str(item.get("avatar_url", "") or "").strip()
        content = str(item.get("content", "") or "").strip()
        timestamp_raw = item.get("timestamp")
        try:
            timestamp = int(timestamp_raw) if timestamp_raw is not None else None
        except (TypeError, ValueError):
            timestamp = None
        atts_raw = item.get("attachments")
        attachments: list[dict[str, Any]] = []
        if isinstance(atts_raw, list):
            for att in atts_raw:
                normalized_att = normalize_forward_attachment(att)
                if normalized_att is not None:
                    attachments.append(normalized_att)
        if not content and attachments:
            names = "、".join(a["name"] for a in attachments[:3])
            content = f"（见附件：{names}）" if names else "（见附件）"
        if not content and not attachments:
            continue
        row: dict[str, Any] = {
            "sender": sender,
            "role": role,
            "content": content,
            "avatar_url": avatar_url or None,
            "timestamp": timestamp,
        }
        if attachments:
            row["attachments"] = attachments
        normalized.append(row)
    return normalized


def _attachment_labels(attachments: list[dict[str, Any]] | None) -> str:
    if not attachments:
        return ""
    labels: list[str] = []
    for att in attachments:
        name = str(att.get("name", "") or "").strip() or "file"
        mime = str(att.get("mime_type", "") or "").strip()
        if mime.startswith("image/"):
            labels.append(f"[图片附件: {name}]")
        else:
            labels.append(f"[文件附件: {name}]")
    return "\n".join(labels)


def build_forward_model_content(
    *,
    source_name: str,
    items: list[dict[str, Any]],
    follow_up_note: str,
) -> str:
    """Full transcript the model must see (forwarded_history is stripped before LLM)."""
    lines: list[str] = [f"【转发的聊天记录 · 来自 {source_name}】"]
    for item in items:
        sender = str(item.get("sender", "") or "").strip() or "unknown"
        body = str(item.get("content", "") or "").strip()
        lines.append(f"{sender}: {body}" if body else f"{sender}:")
        labels = _attachment_labels(item.get("attachments") if isinstance(item.get("attachments"), list) else None)
        if labels:
            lines.append(labels)
    note = str(follow_up_note or "").strip()
    if note:
        lines.append("")
        lines.append(f"附加说明: {note}")
    return "\n".join(lines).strip()


def collect_forward_attachments(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten attachments from all forwarded items (for UI chips + vision promote)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        atts = item.get("attachments")
        if not isinstance(atts, list):
            continue
        for att in atts:
            if not isinstance(att, dict):
                continue
            key = (
                str(att.get("data_url", "") or "")[:96]
                + "|"
                + str(att.get("storage_path", "") or "")
                + "|"
                + str(att.get("name", "") or "")
                + "|"
                + str(att.get("size", "") or "")
            )
            if key in seen:
                continue
            seen.add(key)
            out.append(dict(att))
    return out


def build_forward_entry(
    *,
    source_session_id: str,
    source_name: str,
    items: list[dict[str, Any]],
    follow_up_note: str,
    target_session_id: str = "",
) -> dict[str, Any]:
    """Assemble the chat_history / agent_messages user row for a forward card."""
    note = str(follow_up_note or "").strip() or "请阅读刚转发的聊天记录并继续回复。"
    content = build_forward_model_content(
        source_name=source_name,
        items=items,
        follow_up_note=note,
    )
    attachments = collect_forward_attachments(items)
    if attachments and target_session_id:
        try:
            from agenticx.studio.chat_attachments import materialize_session_image_uploads

            attachments = materialize_session_image_uploads(target_session_id, attachments)
        except Exception:
            pass
    ts = int(datetime.now().timestamp() * 1000)
    entry: dict[str, Any] = {
        "role": "user",
        "content": content,
        "timestamp": ts,
        "forwarded_history": {
            "title": f"聊天记录 · 来自 {source_name}",
            "source_session": source_session_id,
            "note": note,
            "items": items,
        },
    }
    if attachments:
        entry["attachments"] = attachments
    return entry


def forward_note_already_on_tail(chat_history: list[Any] | None, note: str) -> bool:
    """True when the last user row is a forward card already carrying this follow-up note."""
    ui_text = str(note or "").strip()
    if not ui_text:
        return False
    for item in reversed(chat_history or []):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        fh = item.get("forwarded_history")
        if isinstance(fh, dict):
            existing_note = str(fh.get("note") or "").strip()
            if existing_note and existing_note == ui_text:
                return True
        content = str(item.get("content") or "").strip()
        if content.endswith(f"附加说明: {ui_text}"):
            return True
        return False
    return False
