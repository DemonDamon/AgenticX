#!/usr/bin/env python3
"""Group id derivation and access checks for memory graph partitions.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Optional

# Graphiti/Kuzu 只接受 [字母数字 _ -] 作为 group_id，冒号会被拒绝
# （graphiti_core.helpers.validate_group_id）。因此分区 id 一律用下划线分隔，
# 并把 id 片段中的非法字符净化为下划线。
_SAFE_RE = re.compile(r"[^0-9A-Za-z_-]")

META_GROUP_ID = "meta_default"

SubjectKind = str  # "meta" | "avatar" | "group"


def parse_subject(avatar_id: Optional[str]) -> SubjectKind:
    """Classify session subject from bound avatar_id (shared with workspace routing)."""
    aid = (avatar_id or "").strip()
    if aid.startswith("group:"):
        return "group"
    if aid:
        return "avatar"
    return "meta"


def parse_group_id_from_avatar(avatar_id: Optional[str]) -> str:
    """Extract raw group id from ``group:<gid>`` or plain gid."""
    aid = (avatar_id or "").strip()
    if aid.startswith("group:"):
        return aid[len("group:") :]
    return aid


def classify_subject(avatar_id: Optional[str]) -> SubjectKind:
    """Alias for ``parse_subject`` (plan FR-1.2 naming)."""
    return parse_subject(avatar_id)


def _safe(part: str) -> str:
    """Sanitize an id fragment to Kuzu-safe chars (alnum / dash / underscore)."""
    return _SAFE_RE.sub("_", (part or "").strip())


def derive_group_id(
    scope: str,
    *,
    avatar_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> str:
    """Map UI scope to Graphiti group_id.

    Scopes: meta / avatar / group. (Legacy ``session`` kept for backward compat.)
    群聊会话的 avatar_id 形如 ``group:<gid>``（应用内身份约定），在 group 作用域下
    取其 <gid> 作为分区键；最终 group_id 形如 ``group_<gid>``（Kuzu 安全编码）。
    """
    normalized = (scope or "meta").strip().lower()
    aid = (avatar_id or "").strip()
    if normalized == "meta":
        return META_GROUP_ID
    if normalized == "group":
        gid = aid[len("group:"):] if aid.startswith("group:") else aid
        gid = _safe(gid)
        return f"group_{gid}" if gid else META_GROUP_ID
    if normalized == "avatar":
        # group:<gid> 不是分身分区；空 avatar_id 回落到 meta
        if not aid or aid.startswith("group:"):
            return META_GROUP_ID
        return f"avatar_{_safe(aid)}"
    # legacy session scope（不再对外暴露，保留以兼容旧调用）
    sid = (session_id or "").strip()
    if not sid:
        raise ValueError("session_id required for session scope")
    return f"session_{_safe(sid)}"


def derive_group_id_from_avatar_id(
    avatar_id: Optional[str],
    *,
    session_id: Optional[str] = None,
) -> str:
    """按会话天然归属推导分区：group:* → 群聊，非空普通 → 分身，空 → 元智能体。"""
    aid = (avatar_id or "").strip()
    if aid.startswith("group:"):
        return derive_group_id("group", avatar_id=aid, session_id=session_id)
    if aid:
        return derive_group_id("avatar", avatar_id=aid, session_id=session_id)
    return META_GROUP_ID


def resolve_scope_group_id(
    *,
    scope: Optional[str],
    avatar_id: Optional[str],
    session_id: Optional[str],
    default_scope: str = "session",
) -> str:
    """Resolve group_id using explicit scope or configured default."""
    effective = (scope or default_scope or "session").strip().lower()
    return derive_group_id(effective, avatar_id=avatar_id, session_id=session_id)


def validate_group_access(
    requested_group_id: str,
    *,
    avatar_id: Optional[str],
    session_id: Optional[str],
) -> bool:
    """Return True when requested group_id is allowed for the caller context."""
    gid = (requested_group_id or "").strip()
    if not gid:
        return False
    allowed = {
        derive_group_id("meta"),
        derive_group_id("avatar", avatar_id=avatar_id),
        derive_group_id("group", avatar_id=avatar_id),
    }
    sid = (session_id or "").strip()
    if sid:
        allowed.add(derive_group_id("session", session_id=sid))
    return gid in allowed
