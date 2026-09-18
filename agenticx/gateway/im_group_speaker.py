#!/usr/bin/env python3
"""Build /api/chat fields for an IM speaker in a group room.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Sequence

from agenticx.avatar.group_members import make_human_member_id

logger = logging.getLogger(__name__)


def speaker_user_id(platform: str, external_id: str) -> str:
    return make_human_member_id(platform, external_id)


def group_id_from_session_avatar_id(avatar_id: str | None) -> str:
    raw = str(avatar_id or "").strip()
    if raw.startswith("group:"):
        return raw.split(":", 1)[1].strip()
    return ""


def merge_im_group_chat_fields(
    body: dict[str, Any],
    *,
    platform: str,
    external_id: str,
    display_name: str,
    session_avatar_id: str | None,
) -> dict[str, Any]:
    """Return a shallow copy. Only group sessions get speaker/group fields."""
    out = dict(body)
    name = str(display_name or "").strip() or str(external_id or "").strip()
    if name:
        out["user_display_name"] = name
    gid = group_id_from_session_avatar_id(session_avatar_id)
    if not gid:
        return out
    out["group_id"] = gid
    out["speaker_user_id"] = speaker_user_id(platform, external_id)
    return out


def human_member_payload(platform: str, external_id: str, display_name: str) -> dict[str, str]:
    return {
        "platform": platform,
        "external_id": str(external_id or "").strip(),
        "display_name": str(display_name or "").strip() or str(external_id or "").strip(),
    }


def should_register_human(session_avatar_id: str | None) -> bool:
    return bool(group_id_from_session_avatar_id(session_avatar_id))


def format_im_group_reply(data: Mapping[str, Any] | None) -> str:
    """Turn a group SSE payload into one IM paragraph. Skip progress/skipped rows."""
    raw = data if isinstance(data, Mapping) else {}
    if raw.get("skipped"):
        return ""
    if str(raw.get("tool_phase") or "").strip():
        return ""
    content = str(raw.get("content") or "").strip()
    if not content:
        return ""
    name = str(raw.get("avatar_name") or raw.get("agent_id") or "").strip()
    return f"{name}：{content}" if name else content


def merge_im_sse_reply_text(
    final_text: str,
    group_chunks: list[str],
    token_text: str = "",
) -> str:
    out = str(final_text or "").strip()
    grouped = "\n\n".join(str(c).strip() for c in group_chunks if str(c).strip())
    if out and grouped:
        return f"{out}\n\n{grouped}"
    if out or grouped:
        return out or grouped
    return str(token_text or "").strip()


def latest_assistant_reply_after_user(
    messages: Sequence[Mapping[str, Any]] | None,
    user_text: str,
) -> str:
    """Pick assistant text written after the latest matching user row.

    Used when IM SSE closed empty but Studio already persisted the reply.
    """
    rows = [row for row in (messages or []) if isinstance(row, Mapping)]
    needle = str(user_text or "").strip()
    if not needle:
        return ""
    last_user_idx = -1
    for idx, row in enumerate(rows):
        if str(row.get("role") or "").strip() != "user":
            continue
        if str(row.get("content") or "").strip() == needle:
            last_user_idx = idx
    if last_user_idx < 0:
        return ""
    parts: list[str] = []
    for row in rows[last_user_idx + 1 :]:
        if str(row.get("role") or "").strip() != "assistant":
            continue
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        name = str(row.get("avatar_name") or row.get("sender_name") or "").strip()
        parts.append(f"{name}：{content}" if name else content)
    return "\n\n".join(parts)


async def register_human_member_best_effort(
    *,
    client: Any,
    studio_base: str,
    headers: dict[str, str],
    session_avatar_id: str | None,
    platform: str,
    external_id: str,
    display_name: str,
) -> None:
    gid = group_id_from_session_avatar_id(session_avatar_id)
    if not gid:
        return
    try:
        payload = human_member_payload(platform, external_id, display_name)
        resp = await client.post(
            f"{str(studio_base).rstrip('/')}/api/groups/{gid}/human-members",
            headers=headers,
            json=payload,
        )
        status = int(getattr(resp, "status_code", 0) or 0)
        if status >= 400:
            text = str(getattr(resp, "text", "") or "")[:200]
            logger.warning("register human member failed: %s %s", status, text)
    except Exception as exc:
        logger.warning("register human member skipped: %s", exc)
