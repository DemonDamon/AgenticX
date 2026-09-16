#!/usr/bin/env python3
"""Illustrated portraits for digital avatars.

Prefers DiceBear Notionists (quiet line-art busts). Falls back to a local
SVG if the collection cannot be reached. Tests skip the network fetch.

Author: Damon Li
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
from typing import Iterable

# Aligned with desktop/src/utils/avatar-color.ts AVATAR_PALETTE order.
_PALETTE_RGB: tuple[tuple[int, int, int], ...] = (
    (8, 145, 178),    # cyan
    (124, 58, 237),   # violet
    (225, 29, 72),    # rose
    (217, 119, 6),    # amber
    (5, 150, 105),    # emerald
    (192, 38, 211),   # fuchsia
    (2, 132, 199),    # sky
    (234, 88, 12),    # orange
)

PORTRAIT_STYLE = "notionists-v1"
PORTRAIT_STYLE_CUSTOM = "custom"

_COLLECTION_BASE = "https://api.dicebear.com/9.x/notionists/png"
_COLLECTION_TIMEOUT_SEC = 6.0
_COLLECTION_MAX_BYTES = 180_000

# Quiet line-art: no badges, gestures, or saturated cartoon backdrops.
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

_FEMALE_HAIR = (
    "variant04,variant08,variant12,variant18,variant24,variant31,variant40,variant48,variant55"
)
_MALE_HAIR = (
    "variant01,variant03,variant06,variant10,variant14,variant20,variant27,variant35,variant43"
)
_LONG_HAIR = (
    "variant12,variant18,variant24,variant31,variant40,variant48,variant55,variant63"
)
_SHORT_HAIR = "variant01,variant03,variant06,variant10,variant14,variant20,variant27"
_CURLY_HAIR = "variant08,variant16,variant23,variant32,variant41,variant50"
_FEMALE_HINTS = ("女", "女士", "女生", "小姐", "她", "female", "woman", "girl")
_MALE_HINTS = ("男士", "男生", "先生", "male", "man", "boy")
_FEMALE_NAME_SUFFIX = set("雯婷娜丽芳娟玲燕红霞梅琳雪慧静敏艳怡萱颖诗雅璐欣悦柔")
_MALE_NAME_SUFFIX = set("强伟军勇磊斌辉杰峰鹏浩宇明刚建岩石诚志涛洋坤")


def collection_fetch_enabled() -> bool:
    """Skip remote fetch in tests or when explicitly disabled."""
    flag = os.environ.get("AGX_SKIP_AVATAR_FETCH", "").strip().lower()
    if flag in {"1", "true", "yes"}:
        return False
    if "pytest" in sys.modules:
        return False
    return True


def _hash_index(seed: str, mod: int) -> int:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % mod


def _pick_rgb(seed: str) -> tuple[int, int, int]:
    return _PALETTE_RGB[_hash_index(seed, len(_PALETTE_RGB))]


def _portrait_blob(*, name: str, role: str, description: str, tags: list[str] | None) -> str:
    parts = [name, role, description]
    if tags:
        parts.extend(str(item) for item in tags if str(item).strip())
    return " ".join(str(item or "") for item in parts).strip()


def infer_portrait_traits(
    *,
    name: str = "",
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
) -> dict[str, str]:
    """Map name/role/description into Notionists query params."""
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


def _infer_gender(*, name: str, blob: str, lower: str) -> str:
    if any(key in blob for key in _FEMALE_HINTS) or "woman" in lower or "female" in lower:
        return "female"
    if any(key in blob for key in _MALE_HINTS) or re.search(r"\b(he|man|male|boy)\b", lower):
        return "male"
    # Bare "男" is checked after female hints so "男女" does not flip randomly.
    if "男" in blob:
        return "male"
    given = re.split(r"[\s·\-—]+", str(name or "").strip())
    last = given[-1][-1] if given and given[-1] else ""
    if last in _FEMALE_NAME_SUFFIX:
        return "female"
    if last in _MALE_NAME_SUFFIX:
        return "male"
    return "female" if _hash_index(f"gender:{name}", 2) == 0 else "male"


def needs_portrait_refresh(
    avatar_url: str,
    *,
    portrait_style: str = "",
) -> bool:
    """True when the stored portrait should be replaced with Notionists line art."""
    url = str(avatar_url or "").strip()
    style = str(portrait_style or "").strip()
    if not url or url.startswith("data:image/svg+xml"):
        return True
    if style in {PORTRAIT_STYLE_CUSTOM, PORTRAIT_STYLE}:
        return False
    return True


def _initials(name: str) -> str:
    text = str(name or "").strip()
    if not text:
        return "?"
    parts = re.split(r"[\s·\-—]+", text)
    parts = [p for p in parts if p]
    if len(parts) >= 2:
        return (parts[0][:1] + parts[1][:1]).upper()
    if len(text) >= 2:
        return text[:2]
    return text[:1]


def _role_glyph(role: str, seed: str) -> str:
    """Pick a simple role motif index (0-5) from role text."""
    role_text = str(role or "").lower()
    keywords: Iterable[tuple[str, int]] = (
        ("安全", 0),
        ("测试", 1),
        ("架构", 2),
        ("后端", 3),
        ("算法", 4),
        ("美术", 5),
        ("运营", 5),
        ("engineer", 3),
        ("architect", 2),
        ("security", 0),
        ("test", 1),
        ("design", 5),
    )
    for key, idx in keywords:
        if key in role_text:
            return str(idx)
    return str(_hash_index(f"{seed}:{role_text}", 6))


def _svg_face_features(seed: str) -> str:
    """Return SVG paths for abstract line-art facial features."""
    variant = _hash_index(seed, 4)
    if variant == 0:
        return (
            '<circle cx="64" cy="58" r="22" fill="none" stroke="#0a0a0a" stroke-width="3"/>'
            '<circle cx="56" cy="54" r="2.5" fill="#0a0a0a"/>'
            '<circle cx="72" cy="54" r="2.5" fill="#0a0a0a"/>'
            '<path d="M56 66 Q64 72 72 66" fill="none" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round"/>'
        )
    if variant == 1:
        return (
            '<rect x="42" y="40" width="44" height="36" rx="10" fill="none" stroke="#0a0a0a" stroke-width="3"/>'
            '<line x1="52" y1="54" x2="60" y2="54" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round"/>'
            '<line x1="68" y1="54" x2="76" y2="54" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round"/>'
            '<line x1="58" y1="66" x2="70" y2="66" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round"/>'
        )
    if variant == 2:
        return (
            '<path d="M64 36 L82 52 L76 78 L52 78 L46 52 Z" fill="none" stroke="#0a0a0a" stroke-width="3" stroke-linejoin="round"/>'
            '<circle cx="58" cy="56" r="2" fill="#0a0a0a"/>'
            '<circle cx="70" cy="56" r="2" fill="#0a0a0a"/>'
            '<path d="M58 67 L64 70 L70 67" fill="none" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round"/>'
        )
    return (
        '<ellipse cx="64" cy="58" rx="24" ry="26" fill="none" stroke="#0a0a0a" stroke-width="3"/>'
        '<path d="M52 52 h6 M72 52 h6" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M58 68 Q64 73 70 68" fill="none" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round"/>'
    )


def _svg_hair(seed: str) -> str:
    variant = _hash_index(f"hair:{seed}", 3)
    if variant == 0:
        return '<path d="M36 52 C36 28 92 28 92 52" fill="none" stroke="#0a0a0a" stroke-width="4" stroke-linecap="round"/>'
    if variant == 1:
        return (
            '<path d="M38 48 C42 24 86 24 90 48" fill="none" stroke="#0a0a0a" stroke-width="4"/>'
            '<path d="M38 48 L38 58 M90 48 L90 58" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round"/>'
        )
    return '<path d="M34 56 C40 30 88 30 94 56 L94 62 L34 62 Z" fill="#0a0a0a" opacity="0.12"/>'


def build_avatar_portrait_svg(
    *,
    name: str,
    role: str = "",
    avatar_id: str = "",
) -> str:
    """Build a square SVG portrait (128x128 viewBox). Used as offline fallback."""
    seed = avatar_id or name or "avatar"
    r, g, b = _pick_rgb(seed)
    bg = f"rgb({r},{g},{b})"
    label = html.escape(_initials(name))
    motif = _role_glyph(role, seed)
    accent_x = 18 + (_hash_index(f"accent:{seed}", 5) * 14)
    features = _svg_face_features(seed)
    hair = _svg_hair(seed)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">'
        f'<rect width="128" height="128" rx="28" fill="{bg}"/>'
        f'<circle cx="{accent_x}" cy="22" r="6" fill="#ffffff" opacity="0.22"/>'
        f'<circle cx="{accent_x + 52}" cy="104" r="10" fill="#ffffff" opacity="0.14"/>'
        f"{hair}"
        f"{features}"
        f'<text x="64" y="112" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" '
        f'font-size="14" font-weight="700" fill="#ffffff" opacity="0.92">{label}</text>'
        f'<text x="112" y="20" text-anchor="end" font-family="ui-monospace, monospace" '
        f'font-size="9" fill="#0a0a0a" opacity="0.35">{motif}</text>'
        f"</svg>"
    )


def _local_svg_data_url(*, name: str, role: str, avatar_id: str) -> str:
    svg = build_avatar_portrait_svg(name=name, role=role, avatar_id=avatar_id)
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def portrait_seed(*, name: str, avatar_id: str = "") -> str:
    """Stable collection seed so the same expert keeps the same face."""
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
    """HTTP URL for the illustrated-people collection (deterministic by seed)."""
    params = dict(_COLLECTION_QUERY)
    traits = infer_portrait_traits(
        name=name, role=role, description=description, tags=tags
    )
    params.update(
        {key: value for key, value in traits.items() if key in _NOTIONISTS_TRAIT_KEYS}
    )
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
    """Download a PNG from the illustrated collection and return a data URL."""
    url = build_collection_portrait_url(
        name=name,
        role=role,
        description=description,
        tags=tags,
        avatar_id=avatar_id,
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "AgenticX-avatar-portrait/1.0", "Accept": "image/png"},
    )
    try:
        with urllib.request.urlopen(req, timeout=_COLLECTION_TIMEOUT_SEC) as resp:
            content_type = str(resp.headers.get("Content-Type") or "").lower()
            data = resp.read(_COLLECTION_MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if len(data) < 32 or len(data) > _COLLECTION_MAX_BYTES:
        return None
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    if content_type and "png" not in content_type and "octet-stream" not in content_type:
        return None
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def generate_avatar_portrait_url(
    *,
    name: str,
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
    avatar_id: str = "",
) -> str:
    """Return a data URL suitable for AvatarConfig.avatar_url."""
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
