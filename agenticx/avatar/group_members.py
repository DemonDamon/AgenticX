#!/usr/bin/env python3
"""Human member ids for group rooms.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Iterable, Literal

HumanPlatform = Literal["desktop", "feishu", "wechat", "wecom"]
ALLOWED_PLATFORMS = frozenset({"desktop", "feishu", "wechat", "wecom"})


def make_human_member_id(platform: str, external_id: str) -> str:
    plat = str(platform or "").strip().lower()
    ext = str(external_id or "").strip()
    if plat not in ALLOWED_PLATFORMS:
        raise ValueError(f"invalid human platform: {platform!r}")
    if not ext or ":" in ext or "/" in ext:
        raise ValueError("invalid human external_id")
    return f"human:{plat}:{ext}"


def parse_human_member_id(member_id: str) -> tuple[str, str]:
    raw = str(member_id or "").strip()
    parts = raw.split(":", 2)
    if len(parts) != 3 or parts[0] != "human" or parts[1] not in ALLOWED_PLATFORMS or not parts[2]:
        raise ValueError(f"invalid human member id: {member_id!r}")
    return parts[1], parts[2]


def normalize_human_member(
    raw: dict[str, Any],
    *,
    avatar_ids: Iterable[str],
) -> dict[str, str]:
    platform = str(raw.get("platform") or "").strip().lower()
    external_id = str(raw.get("external_id") or "").strip()
    member_id = str(raw.get("id") or "").strip()
    if member_id:
        platform, external_id = parse_human_member_id(member_id)
    else:
        member_id = make_human_member_id(platform, external_id)
    if member_id in {str(x).strip() for x in avatar_ids}:
        raise ValueError("human member id collides with avatar_id")
    display = str(raw.get("display_name") or "").strip() or external_id
    return {
        "id": member_id,
        "platform": platform,
        "external_id": external_id,
        "display_name": display,
        "joined_at": str(raw.get("joined_at") or ""),
    }
