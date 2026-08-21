#!/usr/bin/env python3
"""Stable, restrained portraits for digital experts.

The online portrait is deliberately a quiet line-art bust with a soft neutral
background.  It keeps the useful property of a generated human portrait while
avoiding the toy-like proportions, saturated backdrops, and novelty gestures
that made the first rollout feel rough.  The seed is stable per expert, so the
same expert keeps the same face across gallery refreshes.
"""

from __future__ import annotations

import base64
import hashlib
import html
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PORTRAIT_STYLE = "notionists-v1"

_COLLECTION_BASE = "https://api.dicebear.com/9.x/notionists/png"
_COLLECTION_TIMEOUT_SEC = 6.0
_COLLECTION_MAX_BYTES = 180_000

# Valid options for the selected collection.  Keep the visual language quiet:
# no body badges, hand gestures, or saturated backgrounds.
_COLLECTION_QUERY = {
    "size": "256",
    "radius": "28",
    "backgroundColor": "e8eef2,e8e8f0,ede9e3,e7efe9,efe7e9",
    "bodyIconProbability": "0",
    "gestureProbability": "0",
    "beardProbability": "8",
    "glassesProbability": "14",
}
_NOTIONISTS_TRAIT_KEYS = frozenset(
    {
        "beard",
        "beardProbability",
        "body",
        "bodyIcon",
        "bodyIconProbability",
        "brows",
        "eyes",
        "gesture",
        "gestureProbability",
        "glasses",
        "glassesProbability",
        "hair",
        "lips",
        "nose",
    }
)

_FEMALE_HAIR = "variant04,variant08,variant12,variant18,variant24,variant31,variant40,variant48,variant55"
_MALE_HAIR = "variant01,variant03,variant06,variant10,variant14,variant20,variant27,variant35,variant43"
_LONG_HAIR = "variant12,variant18,variant24,variant31,variant40,variant48,variant55,variant63"
_SHORT_HAIR = "variant01,variant03,variant06,variant10,variant14,variant20,variant27"
_CURLY_HAIR = "variant08,variant16,variant23,variant32,variant41,variant50"
_FEMALE_HINTS = ("女", "女士", "女生", "小姐", "她", "female", "woman", "girl")
_MALE_HINTS = ("男士", "男生", "先生", "male", "man", "boy")
_FEMALE_NAME_SUFFIX = set("雯婷娜丽芳娟玲燕红霞梅琳雪慧静敏艳怡萱颖诗雅璐欣悦柔")
_MALE_NAME_SUFFIX = set("强伟军勇磊斌辉杰峰鹏浩宇明刚建岩石诚志涛洋坤")

# Offline fallback only.  It is intentionally neutral and deterministic; it
# should never replace a successfully fetched portrait.
_FALLBACK_PALETTE = (
    (226, 232, 240),
    (224, 231, 255),
    (226, 232, 230),
    (239, 231, 231),
)


def collection_fetch_enabled() -> bool:
    """Return whether fetching a generated portrait is allowed."""
    flag = os.environ.get("AGX_SKIP_AVATAR_FETCH", "").strip().lower()
    if flag in {"1", "true", "yes"} or "pytest" in sys.modules:
        return False
    return True


def _hash_index(seed: str, modulo: int) -> int:
    digest = hashlib.sha256(str(seed).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % modulo


def _portrait_blob(*, name: str, role: str, description: str, tags: list[str] | None) -> str:
    parts = [name, role, description]
    parts.extend(str(tag) for tag in (tags or []) if str(tag).strip())
    return " ".join(str(part or "") for part in parts).strip()


def _infer_gender(*, name: str, blob: str, lower: str) -> str:
    if any(hint in blob for hint in _FEMALE_HINTS) or "woman" in lower or "female" in lower:
        return "female"
    if any(hint in blob for hint in _MALE_HINTS) or re.search(r"\b(he|man|male|boy)\b", lower):
        return "male"
    if "男" in blob:
        return "male"
    final = re.split(r"[\s·\-—]+", str(name or "").strip())[-1:]
    last = final[0][-1] if final and final[0] else ""
    if last in _FEMALE_NAME_SUFFIX:
        return "female"
    if last in _MALE_NAME_SUFFIX:
        return "male"
    return "female" if _hash_index(f"gender:{name}", 2) == 0 else "male"


def infer_portrait_traits(
    *,
    name: str = "",
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
) -> dict[str, str]:
    """Map optional identity cues to valid collection parameters."""
    blob = _portrait_blob(name=name, role=role, description=description, tags=tags)
    lower = blob.lower()
    female = _infer_gender(name=name, blob=blob, lower=lower) == "female"
    traits: dict[str, str] = {
        "hair": _FEMALE_HAIR if female else _MALE_HAIR,
        "beardProbability": "0" if female else "18",
        "glassesProbability": "14",
    }
    if any(key in blob for key in ("长发", "长头发", "披肩")):
        traits["hair"] = _LONG_HAIR
        traits["beardProbability"] = "0"
    elif any(key in blob for key in ("马尾", "丸子", "盘发")):
        traits["hair"] = "variant24,variant31,variant40,variant48"
        traits["beardProbability"] = "0"
    elif any(key in blob for key in ("卷发", "羊毛卷")):
        traits["hair"] = _CURLY_HAIR
    elif any(key in blob for key in ("短发", "寸头", "板寸")):
        traits["hair"] = _SHORT_HAIR
    elif any(key in blob for key in ("光头", "秃")):
        traits["hair"] = "variant01,variant03,variant06"

    if any(key in blob for key in ("眼镜", "glasses", "spectacles")):
        traits["glasses"] = "variant01,variant02,variant03,variant04"
        traits["glassesProbability"] = "100"
    elif any(key in lower for key in ("墨镜", "sunglasses")):
        traits["glasses"] = "variant09,variant10,variant11"
        traits["glassesProbability"] = "100"
    return traits


def needs_portrait_refresh(
    avatar_url: str,
    *,
    portrait_style: str = "",
    created_by: str = "",
) -> bool:
    """Return whether an automatically generated portrait should be replaced."""
    url = str(avatar_url or "").strip()
    if not url or url.startswith("data:image/svg+xml"):
        return True
    # Old AI/meta portraits were stored as unmarked PNG data URLs.  Refresh
    # those once, while preserving explicit user uploads (marked custom).
    if url.startswith("data:image/png;base64,") and not str(portrait_style or "").strip():
        return str(created_by or "").strip().lower() in {"ai", "meta", "session_fork"}
    return False


def portrait_seed(*, name: str, avatar_id: str = "") -> str:
    name_part = str(name or "").strip() or "avatar"
    id_part = str(avatar_id or "").strip()
    return f"{name_part}:{id_part}" if id_part else name_part


def build_collection_portrait_url(
    *,
    name: str,
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
    avatar_id: str = "",
) -> str:
    """Build a deterministic URL using only valid style options."""
    params = dict(_COLLECTION_QUERY)
    traits = infer_portrait_traits(name=name, role=role, description=description, tags=tags)
    params.update({key: value for key, value in traits.items() if key in _NOTIONISTS_TRAIT_KEYS})
    params["seed"] = portrait_seed(name=name, avatar_id=avatar_id)
    return f"{_COLLECTION_BASE}?{urllib.parse.urlencode(params)}"


def fetch_collection_portrait_url(
    *,
    name: str,
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
    avatar_id: str = "",
) -> str | None:
    """Fetch a PNG and return it as a self-contained data URL."""
    req = urllib.request.Request(
        build_collection_portrait_url(
            name=name,
            role=role,
            description=description,
            tags=tags,
            avatar_id=avatar_id,
        ),
        headers={"User-Agent": "AgenticX-avatar-portrait/1.0", "Accept": "image/png"},
    )
    try:
        with urllib.request.urlopen(req, timeout=_COLLECTION_TIMEOUT_SEC) as response:
            content_type = str(response.headers.get("Content-Type") or "").lower()
            data = response.read(_COLLECTION_MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if len(data) < 32 or len(data) > _COLLECTION_MAX_BYTES:
        return None
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    if content_type and "png" not in content_type and "octet-stream" not in content_type:
        return None
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _initials(name: str) -> str:
    text = str(name or "").strip()
    if not text:
        return "?"
    parts = [part for part in re.split(r"[\s·\-—]+", text) if part]
    return (parts[0][:1] + parts[1][:1]).upper() if len(parts) > 1 else text[:2]


def build_avatar_portrait_svg(*, name: str, role: str = "", avatar_id: str = "") -> str:
    """Build a deterministic neutral fallback for offline use."""
    seed = avatar_id or name or "avatar"
    r, g, b = _FALLBACK_PALETTE[_hash_index(seed, len(_FALLBACK_PALETTE))]
    label = html.escape(_initials(name))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">'
        f'<rect width="128" height="128" rx="28" fill="rgb({r},{g},{b})"/>'
        '<circle cx="64" cy="54" r="25" fill="#f8fafc" opacity=".94"/>'
        '<path d="M31 128c2-25 15-38 33-38s31 13 33 38" fill="#111827" opacity=".86"/>'
        '<path d="M45 53h8m22 0h8M55 70q9 7 18 0" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M39 48q5-28 25-28t25 28" fill="none" stroke="#111827" stroke-width="7" stroke-linecap="round"/>'
        f'<text x="64" y="116" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#111827">{label}</text>'
        '</svg>'
    )


def _local_svg_data_url(*, name: str, role: str, avatar_id: str) -> str:
    encoded = base64.b64encode(
        build_avatar_portrait_svg(name=name, role=role, avatar_id=avatar_id).encode("utf-8")
    ).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def generate_avatar_portrait_url(
    *,
    name: str,
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
    avatar_id: str = "",
) -> str:
    """Return a self-contained generated portrait, with an offline fallback."""
    if collection_fetch_enabled():
        fetched = fetch_collection_portrait_url(
            name=name,
            role=role,
            description=description,
            tags=tags,
            avatar_id=avatar_id,
        )
        if fetched:
            return fetched
    return _local_svg_data_url(name=name, role=role, avatar_id=avatar_id)
