#!/usr/bin/env python3
"""Build /api/chat fields for an IM speaker in a group room.

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
from typing import Any, Mapping, Sequence

from agenticx.avatar.group_members import make_human_member_id

logger = logging.getLogger(__name__)

IM_CLARIFY_RELEASE_ANSWER = (
    "用户会在下一轮继续补充。本回合到此结束，不要再追问有没有收到附件，也不要再发新内容。"
)


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


def _clarification_option_label(item: Any) -> str:
    if isinstance(item, Mapping):
        return str(item.get("label") or item.get("text") or item.get("value") or "").strip()
    return str(item or "").strip()


def format_im_clarification(data: Mapping[str, Any] | None) -> str:
    """Flatten a Desktop clarification card into WeChat/Feishu plain text.

    Group ``group_clarification`` rows are marked ``skipped`` so they do not
    look like a finished reply; IM still needs the prompt itself.
    """
    raw = data if isinstance(data, Mapping) else {}
    prompt = str(
        raw.get("prompt") or raw.get("content") or raw.get("question") or ""
    ).strip()
    options = raw.get("clarify_options")
    if not isinstance(options, list):
        options = raw.get("options")
    if not isinstance(options, list):
        options = []
    lines: list[str] = []
    if prompt:
        lines.append(prompt)
    for idx, item in enumerate(options, 1):
        label = _clarification_option_label(item)
        if label:
            lines.append(f"{idx}. {label}")
    if not lines:
        return ""
    name = str(raw.get("avatar_name") or raw.get("agent_id") or "").strip()
    body = "\n".join(lines)
    return f"{name}：{body}" if name else body


def im_clarification_request_id(data: Mapping[str, Any] | None) -> str:
    raw = data if isinstance(data, Mapping) else {}
    return str(
        raw.get("confirm_request_id")
        or raw.get("id")
        or raw.get("request_id")
        or ""
    ).strip()


def im_clarify_agent_id(data: Mapping[str, Any] | None) -> str:
    raw = data if isinstance(data, Mapping) else {}
    agent_id = str(raw.get("agent_id") or "").strip()
    if agent_id in {"", "meta", "__meta__"}:
        return "meta"
    return agent_id


def latest_unanswered_clarification(
    messages: Sequence[Mapping[str, Any]] | None,
) -> tuple[str, str, str]:
    """Last unanswered card: request_id, agent_id, flattened IM text."""
    rows = [row for row in (messages or []) if isinstance(row, Mapping)]
    for row in reversed(rows):
        meta = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
        if not isinstance(meta, Mapping):
            continue
        if str(meta.get("kind") or "") != "clarification":
            continue
        if meta.get("clarification_answered") is True:
            continue
        request_id = im_clarification_request_id(meta)
        agent_id = im_clarify_agent_id(
            {"agent_id": row.get("agent_id") or row.get("sender_id") or ""}
        )
        text = format_im_clarification(
            {
                "prompt": meta.get("prompt") or row.get("content") or "",
                "options": meta.get("options") or [],
                "avatar_name": row.get("avatar_name") or row.get("sender_name") or "",
            }
        )
        if text:
            return request_id, agent_id, text
    return "", "meta", ""


def latest_clarification_prompt(
    messages: Sequence[Mapping[str, Any]] | None,
) -> str:
    """Last unanswered clarification card, flattened for IM."""
    _request_id, _agent_id, text = latest_unanswered_clarification(messages)
    return text


_JOINED_SPEAKER_SPLIT_RE = re.compile(r"\n\n(?=\S+：)")


def im_outbound_bubbles(
    *,
    final_text: str,
    group_chunks: Sequence[str],
    token_text: str = "",
    progress_block: str = "",
) -> list[str]:
    """One IM message per group speaker; progress prefixes the first bubble."""
    chunks = [str(c).strip() for c in group_chunks if str(c).strip()]
    final = str(final_text or "").strip()
    token = str(token_text or "").strip()
    if chunks:
        bubbles = list(chunks)
        if final and final not in bubbles:
            bubbles.insert(0, final)
    elif final:
        bubbles = [final]
    elif token:
        bubbles = [token]
    else:
        bubbles = []
    progress = str(progress_block or "").strip()
    if progress:
        if bubbles:
            bubbles[0] = f"{progress}\n\n{bubbles[0]}"
        else:
            bubbles = [progress]
    return bubbles


def split_im_joined_bubbles(text: str) -> list[str]:
    """Split a previously joined `Name：…\\n\\nName：…` blob into bubbles."""
    raw = str(text or "").strip()
    if not raw:
        return []
    parts = [part.strip() for part in _JOINED_SPEAKER_SPLIT_RE.split(raw) if part.strip()]
    return parts or [raw]


def merge_im_sse_reply_text(
    final_text: str,
    group_chunks: list[str],
    token_text: str = "",
) -> str:
    return "\n\n".join(
        im_outbound_bubbles(
            final_text=final_text,
            group_chunks=group_chunks,
            token_text=token_text,
        )
    )


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
