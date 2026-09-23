#!/usr/bin/env python3
"""Collectible cube portraits for digital avatars.

Same soft official Near mark, with gacha-style colorways (solid, dual, dream).
Custom uploads are never overwritten.

Author: Damon Li
"""

from __future__ import annotations

import base64
import colorsys
import hashlib
import os
import re
import sys
import urllib.parse
from pathlib import Path

# Aligned with desktop/src/utils/avatar-color.ts AVATAR_PALETTE order.
_PALETTE_KEYS: tuple[str, ...] = (
    "cyan",
    "violet",
    "rose",
    "amber",
    "emerald",
    "fuchsia",
    "sky",
    "orange",
)
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
_PALETTE_HEX: dict[str, str] = {
    key: f"{r:02x}{g:02x}{b:02x}"
    for key, (r, g, b) in zip(_PALETTE_KEYS, _PALETTE_RGB, strict=True)
}

PORTRAIT_STYLE = "near-cube-v3"
PORTRAIT_STYLE_LEGACY_GENERATED = "notionists-v1"
PORTRAIT_STYLE_CUSTOM = "custom"
COLLECTION_STYLE_IDS = frozenset(
    {
        "near-cube-v3",
        "blobs",
        "disco",
        "identicon",
        "squircles",
        "waves",
        "adventurer",
        "adventurer-neutral",
        "avataaars",
        "bottts",
        "bottts-neutral",
        "clay",
        "critters",
        "croodles-neutral",
        "cutouts",
        "fun-emoji",
        "gaze",
        "lorelei",
        "micah",
        "thumbs",
        "voxel-art",
        "voxel-bot",
        "landscape",
        "planets",
    }
)
COLLECTION_PORTRAIT_PREFIX = 'data-portrait="dicebear-'

_COLLECTION_BASE = "https://api.dicebear.com/9.x/notionists/svg"
_COLLECTION_TIMEOUT_SEC = 6.0
_COLLECTION_MAX_BYTES = 180_000

# Quiet line-art: transparent disc, ink/hair/borders tinted after download.
_COLLECTION_QUERY = {
    "size": "256",
    "radius": "28",
    "backgroundColor": "transparent",
    "bodyIconProbability": "0",
    "gestureProbability": "0",
    "beardProbability": "8",
    "glassesProbability": "14",
}
_INK_RE = re.compile(
    r"#000(?:000)?\b|#0a0a0a\b|#111(?:111)?\b|\bblack\b",
    re.IGNORECASE,
)
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


def _js_hash_index(text: str, mod: int) -> int:
    """Match desktop/src/utils/avatar-color.ts hashToIndex (signed 32-bit)."""
    h = 0
    for ch in text:
        h = ((h << 5) - h + ord(ch))
        h = ((h + 2**31) % 2**32) - 2**31
    return abs(h) % mod


def resolve_portrait_palette_key(
    *,
    color: str = "",
    avatar_id: str = "",
    name: str = "",
) -> str:
    """Prefer an explicit palette key; otherwise hash id like the desktop swatches."""
    key = str(color or "").strip().lower()
    if key in _PALETTE_HEX:
        return key
    seed = str(avatar_id or "").strip() or str(name or "").strip() or "avatar"
    return _PALETTE_KEYS[_js_hash_index(seed, len(_PALETTE_KEYS))]


def portrait_ink_hex(
    *,
    color: str = "",
    avatar_id: str = "",
    name: str = "",
) -> str:
    """Hex without '#' for line-art / hair / border ink."""
    key = resolve_portrait_palette_key(color=color, avatar_id=avatar_id, name=name)
    return _PALETTE_HEX[key]


def tint_line_art_svg(svg: str, hex_color: str) -> str:
    """Recolor black Notionists ink (strokes, hair, outlines) to a palette color."""
    ink = hex_color if hex_color.startswith("#") else f"#{hex_color}"
    return _INK_RE.sub(ink, svg)


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


def _decode_svg_data_url(avatar_url: str) -> str:
    raw = str(avatar_url or "").strip()
    if not raw.startswith("data:image/svg+xml"):
        return ""
    try:
        payload = raw.split(",", 1)[1]
        if ";base64," in raw:
            return base64.b64decode(payload).decode("utf-8", errors="ignore")
        return urllib.parse.unquote(payload)
    except (IndexError, ValueError, OSError):
        return ""


def is_local_fallback_svg(avatar_url: str) -> bool:
    """True for the retired 128x128 geometric SVG, not a Near cube colorway."""
    decoded = _decode_svg_data_url(avatar_url)
    return 'viewBox="0 0 128 128"' in decoded and 'role="img"' in decoded


def is_near_cube_svg(avatar_url: str) -> bool:
    return 'data-portrait="near-cube' in _decode_svg_data_url(avatar_url)


def is_collection_portrait_svg(avatar_url: str) -> bool:
    return COLLECTION_PORTRAIT_PREFIX in _decode_svg_data_url(avatar_url)


def extract_cube_colorway_id(avatar_url: str) -> str:
    """Read data-colorway from a stored Near cube data URL."""
    match = re.search(r'data-colorway="([^"]+)"', _decode_svg_data_url(avatar_url))
    return str(match.group(1) or "").strip() if match else ""


def needs_portrait_refresh(
    avatar_url: str,
    *,
    portrait_style: str = "",
) -> bool:
    """True when the stored portrait should be replaced with a Near cube colorway."""
    url = str(avatar_url or "").strip()
    style = str(portrait_style or "").strip()
    if not url:
        return True
    if style == PORTRAIT_STYLE_CUSTOM:
        return False
    if is_collection_portrait_svg(url):
        return False
    if is_local_fallback_svg(url):
        return True
    if style == PORTRAIT_STYLE:
        return False
    return True


# Official Near mark placement, same as desktop NearBoxHero LOGO_MARK_BOX.
_LUMA_BOX = (13.4, 8.0, 133.2, 144.0)
_LUMA_HREF: str | None = None


def _luma_data_href() -> str:
    """Grayscale lighting + alpha cut from the official cube mark."""
    global _LUMA_HREF
    if _LUMA_HREF is None:
        path = Path(__file__).with_name("near_cube_luma.png")
        _LUMA_HREF = (
            "data:image/png;base64,"
            + base64.b64encode(path.read_bytes()).decode("ascii")
        )
    return _LUMA_HREF

# Rich finishes first in spirit; solids stay as a small fallback set.
_COLORWAYS: tuple[dict[str, object], ...] = (
    {"id": "matcha-lid", "kind": "dual", "body": "#86EFAC", "lid": "#14532D", "deep": "#166534", "eye": "#FFFFFF"},
    {"id": "strawberry-milk", "kind": "dual", "body": "#FFE4E6", "lid": "#FB7185", "deep": "#FECDD3", "eye": "#FFFFFF"},
    {"id": "ocean-lid", "kind": "dual", "body": "#38BDF8", "lid": "#1E3A5F", "deep": "#0369A1", "eye": "#FFFFFF"},
    {"id": "honey-ink", "kind": "dual", "body": "#F59E0B", "lid": "#1C1917", "deep": "#B45309", "eye": "#FFFBEB"},
    {"id": "blueberry-cap", "kind": "dual", "body": "#C4B5FD", "lid": "#312E81", "deep": "#6D28D9", "eye": "#FFFFFF"},
    {"id": "cocoa-foam", "kind": "dual", "body": "#F3E2D4", "lid": "#5C3A24", "deep": "#C4A892", "eye": "#FFF7ED"},
    {"id": "lemon-ink", "kind": "dual", "body": "#F5D76E", "lid": "#1C1917", "deep": "#D4A017", "eye": "#1C1917"},
    {"id": "rose-jade", "kind": "dual", "body": "#FDA4AF", "lid": "#065F46", "deep": "#BE123C", "eye": "#FFFFFF"},
    {"id": "ink-coral", "kind": "dual", "body": "#FB7185", "lid": "#0F172A", "deep": "#E11D48", "eye": "#FFFFFF"},
    {"id": "moss-clay", "kind": "dual", "body": "#D97757", "lid": "#3F4F2F", "deep": "#9A3412", "eye": "#FFF7ED"},
    {"id": "aurora", "kind": "dream", "stops": ("#A78BFA", "#6EE7B7", "#FDE68A"), "angle": 48, "eye": "#FFFFFF"},
    {"id": "sunset", "kind": "dream", "stops": ("#FB7185", "#FDBA74", "#FDE68A"), "angle": 32, "eye": "#FFFFFF"},
    {"id": "cotton", "kind": "dream", "stops": ("#FBCFE8", "#DDD6FE", "#BAE6FD"), "angle": 64, "eye": "#FFFFFF"},
    {"id": "galaxy", "kind": "dream", "stops": ("#312E81", "#7C3AED", "#F472B6"), "angle": 72, "eye": "#F5F3FF"},
    {"id": "peach-soda", "kind": "dream", "stops": ("#FED7AA", "#FBCFE8", "#FDE68A"), "angle": 20, "eye": "#FFFFFF"},
    {"id": "tide", "kind": "dream", "stops": ("#0EA5E9", "#2DD4BF", "#E0F2FE"), "angle": 56, "eye": "#FFFFFF"},
    {"id": "ember", "kind": "dream", "stops": ("#F97316", "#FB7185", "#FDE68A"), "angle": 28, "eye": "#FFFFFF"},
    {"id": "twilight", "kind": "dream", "stops": ("#1E3A8A", "#7C3AED", "#F9A8D4"), "angle": 70, "eye": "#F5F3FF"},
    {"id": "lime-soda", "kind": "dream", "stops": ("#A3E635", "#FDE68A", "#6EE7B7"), "angle": 24, "eye": "#14532D"},
    {"id": "near-orange", "kind": "shade", "body": "#F9731A", "deep": "#C2410C", "lite": "#FDBA74", "eye": "#FFF7ED"},
    {"id": "cream", "kind": "shade", "body": "#F3E2D4", "deep": "#C4A892", "lite": "#FFF6EE", "eye": "#3F2A1D"},
    {"id": "ink", "kind": "shade", "body": "#334155", "deep": "#0F172A", "lite": "#64748B", "eye": "#F8FAFC"},
    {"id": "mint", "kind": "shade", "body": "#6EE7B7", "deep": "#047857", "lite": "#BBF7D0", "eye": "#FFFFFF"},
)

# Official in-app Near mark. Same cube recipe as experts, reserved so no 分身
# inherits the brand orange dual. Darker lid / brighter body matches gacha cubes.
NEAR_MARK_COLORWAY_ID = "near-mark"
NEAR_MARK_COLORWAY: dict[str, object] = {
    "id": NEAR_MARK_COLORWAY_ID,
    "kind": "dual",
    "body": "#F97316",
    "lid": "#7C2D12",
    "deep": "#431407",
    "eye": "#FFFFFF",
}


def cube_colorway_ids() -> tuple[str, ...]:
    return tuple(str(item["id"]) for item in _COLORWAYS)


def _colorway_is_rich(way: dict[str, object]) -> bool:
    return str(way.get("kind") or "") != "shade"


def _candidates_from(preferred: int) -> list[dict[str, object]]:
    rotated = [_COLORWAYS[(preferred + offset) % len(_COLORWAYS)] for offset in range(len(_COLORWAYS))]
    return [item for item in rotated if _colorway_is_rich(item)] + [
        item for item in rotated if not _colorway_is_rich(item)
    ]


def _shift_hex(color: str, degrees: int) -> str:
    raw = str(color or "").strip()
    if not raw.startswith("#") or len(raw) != 7:
        return raw
    try:
        red = int(raw[1:3], 16) / 255.0
        green = int(raw[3:5], 16) / 255.0
        blue = int(raw[5:7], 16) / 255.0
    except ValueError:
        return raw
    hue, light, sat = colorsys.rgb_to_hls(red, green, blue)
    if sat < 0.04:
        return raw
    shifted = colorsys.hls_to_rgb((hue + degrees / 360.0) % 1.0, light, sat)
    return "#{:02X}{:02X}{:02X}".format(
        max(0, min(255, round(shifted[0] * 255))),
        max(0, min(255, round(shifted[1] * 255))),
        max(0, min(255, round(shifted[2] * 255))),
    )


def _shift_colorway(way: dict[str, object], *, new_id: str, degrees: int) -> dict[str, object]:
    out = dict(way)
    out["id"] = new_id
    for key in ("body", "deep", "lite", "lid", "eye", "blob", "blob2"):
        value = out.get(key)
        if isinstance(value, str) and value.startswith("#"):
            out[key] = _shift_hex(value, degrees)
    stops = out.get("stops")
    if isinstance(stops, tuple):
        out["stops"] = tuple(_shift_hex(str(stop), degrees) for stop in stops)
    return out


def colorway_by_id(colorway_id: str) -> dict[str, object] | None:
    key = str(colorway_id or "").strip()
    if not key:
        return None
    if key == NEAR_MARK_COLORWAY_ID:
        return dict(NEAR_MARK_COLORWAY)
    for item in _COLORWAYS:
        if str(item["id"]) == key:
            return dict(item)
    return None


def resolve_cube_colorway(
    *,
    avatar_id: str = "",
    name: str = "",
    taken: set[str] | list[str] | tuple[str, ...] | None = None,
) -> dict[str, object]:
    """Pick a unique colorway. Prefer unused rich finishes, then solids, then a hue shift."""
    seed = str(avatar_id or "").strip() or str(name or "").strip() or "avatar"
    taken_ids = {str(item).strip() for item in (taken or []) if str(item).strip()}
    preferred = _hash_index(f"cube:{seed}", len(_COLORWAYS))
    ordered = _candidates_from(preferred)
    for way in ordered:
        if str(way["id"]) not in taken_ids:
            return dict(way)
    base = next((item for item in ordered if _colorway_is_rich(item)), ordered[0])
    for serial in range(1, 64):
        derived_id = f"{base['id']}~{serial}"
        if derived_id not in taken_ids:
            return _shift_colorway(dict(base), new_id=derived_id, degrees=23 * serial)
    return _shift_colorway(dict(base), new_id=f"{base['id']}~x{seed[-6:]}", degrees=17)


def build_avatar_portrait_svg(
    *,
    name: str,
    role: str = "",
    avatar_id: str = "",
    color: str = "",
    taken: set[str] | list[str] | tuple[str, ...] | None = None,
    colorway_id: str = "",
) -> str:
    """Build the Near cube portrait. Colorway is unique among `taken` siblings."""
    del role, color
    seed = str(avatar_id or "").strip() or str(name or "").strip() or "avatar"
    forced = colorway_by_id(colorway_id)
    way = forced or resolve_cube_colorway(avatar_id=avatar_id, name=name, taken=taken)
    uid = f"n{_hash_index(seed, 16_777_619):x}"
    kind = str(way["kind"])
    eye = str(way["eye"])
    luma = _luma_data_href()
    lx, ly, lw, lh = _LUMA_BOX
    luma_img = (
        f'<image href="{luma}" x="{lx}" y="{ly}" width="{lw}" height="{lh}" '
        f'preserveAspectRatio="xMidYMid meet"/>'
    )
    defs = [
        f'<mask id="{uid}-cut" maskUnits="userSpaceOnUse" mask-type="alpha">{luma_img}</mask>'
    ]
    paint = f'<rect x="8" y="4" width="144" height="152" fill="{way.get("body", "#F9731A")}"/>'
    if kind == "dream":
        stops = way["stops"]
        assert isinstance(stops, tuple)
        angle = int(way["angle"])
        defs.append(
            f'<linearGradient id="{uid}-fill" x1="0%" y1="0%" x2="100%" y2="100%" '
            f'gradientTransform="rotate({angle} 0.5 0.5)">'
            f'<stop offset="0%" stop-color="{stops[0]}"/>'
            f'<stop offset="52%" stop-color="{stops[1]}"/>'
            f'<stop offset="100%" stop-color="{stops[2]}"/>'
            f"</linearGradient>"
        )
        paint = f'<rect x="8" y="4" width="144" height="152" fill="url(#{uid}-fill)"/>'
    elif kind == "dual":
        defs.append(
            f'<linearGradient id="{uid}-fill" x1="48%" y1="2%" x2="72%" y2="78%">'
            f'<stop offset="0%" stop-color="{way["lid"]}"/>'
            f'<stop offset="28%" stop-color="{way["lid"]}"/>'
            f'<stop offset="58%" stop-color="{way["body"]}"/>'
            f'<stop offset="100%" stop-color="{way["body"]}"/>'
            f"</linearGradient>"
        )
        paint = f'<rect x="8" y="4" width="144" height="152" fill="url(#{uid}-fill)"/>'
    elif kind == "marble":
        speckle = str(way["id"]).split("~", 1)[0] in {"confetti-cream", "sesame"}
        count = 9 if speckle else 6
        defs.append(
            f'<filter id="{uid}-soft" x="-20%" y="-20%" width="140%" height="140%">'
            f'<feGaussianBlur stdDeviation="{"2.2" if speckle else "3.4"}"/>'
            f"</filter>"
        )
        blobs: list[str] = []
        for i in range(count):
            cx = 36 + _hash_index(f"bx:{i}:{seed}", 88)
            cy = 30 + _hash_index(f"by:{i}:{seed}", 96)
            if speckle:
                rx = 5 + _hash_index(f"brx:{i}:{seed}", 7)
                ry = 4 + _hash_index(f"bry:{i}:{seed}", 6)
                op = 0.78
            else:
                rx = 11 + _hash_index(f"brx:{i}:{seed}", 14)
                ry = 9 + _hash_index(f"bry:{i}:{seed}", 12)
                op = 0.38 + _hash_index(f"bo:{i}:{seed}", 16) / 100
            fill = way["blob"] if i % 2 == 0 else way["blob2"]
            blobs.append(
                f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" '
                f'fill="{fill}" opacity="{op:.2f}"/>'
            )
        paint = (
            f'<rect x="8" y="4" width="144" height="152" fill="{way["body"]}"/>'
            f'<g filter="url(#{uid}-soft)">{"".join(blobs)}</g>'
        )
    lean = _hash_index(f"eye:{seed}", 2)
    rx, ry, rot = (5.4, 11.0, 2) if lean else (5.8, 11.6, 1)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" '
        f'data-portrait="{PORTRAIT_STYLE}" data-colorway="{way["id"]}">'
        f"<defs>{''.join(defs)}</defs>"
        f'<g mask="url(#{uid}-cut)">{paint}</g>'
        f'<g style="mix-blend-mode:soft-light" opacity="0.92">{luma_img}</g>'
        f'<ellipse cx="106" cy="104" rx="{rx}" ry="{ry}" fill="{eye}" '
        f'transform="rotate({rot} 106 104)"/>'
        f'<ellipse cx="128" cy="92" rx="{rx}" ry="{ry}" fill="{eye}" '
        f'transform="rotate({rot} 128 92)"/>'
        f"</svg>"
    )


def build_near_mark_svg() -> str:
    """Official Near in-app mark: same cube mold as experts, reserved orange dual."""
    return build_avatar_portrait_svg(
        name="Near",
        avatar_id="near-mark",
        colorway_id=NEAR_MARK_COLORWAY_ID,
    )


def _local_svg_data_url(
    *,
    name: str,
    role: str,
    avatar_id: str,
    color: str = "",
    taken: set[str] | list[str] | tuple[str, ...] | None = None,
) -> str:
    svg = build_avatar_portrait_svg(
        name=name, role=role, avatar_id=avatar_id, color=color, taken=taken
    )
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
    color: str = "",
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
    color: str = "",
    taken_colorways: list[str] | None = None,
) -> str | None:
    """Return a local Near cube data URL. No network; custom uploads stay elsewhere."""
    del description, tags
    return _local_svg_data_url(
        name=name,
        role=role,
        avatar_id=avatar_id,
        color=color,
        taken=taken_colorways,
    )


def generate_avatar_portrait_url(
    *,
    name: str,
    role: str = "",
    description: str = "",
    tags: list[str] | None = None,
    avatar_id: str = "",
    color: str = "",
    taken_colorways: list[str] | None = None,
) -> str:
    """Return a collectible cube data URL suitable for AvatarConfig.avatar_url."""
    del description, tags
    return _local_svg_data_url(
        name=name,
        role=role,
        avatar_id=avatar_id,
        color=color,
        taken=taken_colorways,
    )
