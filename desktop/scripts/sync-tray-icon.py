#!/usr/bin/env python3
"""Generate macOS menu-bar tray template icons for the isometric Near box.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR.parent / "assets"
OUT_1X = ASSETS_DIR / "trayTemplate.png"
OUT_2X = ASSETS_DIR / "trayTemplate@2x.png"


def _iso_points(cx: float, cy: float, size: float) -> dict[str, tuple[float, float]]:
    w = size * 0.42
    h = size * 0.24
    d = size * 0.36
    return {
        "top": (cx, cy - d),
        "left": (cx - w, cy - d + h),
        "right": (cx + w, cy - d + h),
        "bottom": (cx, cy - d + h * 2),
        "left_b": (cx - w, cy - d + h + d * 0.72),
        "right_b": (cx + w, cy - d + h + d * 0.72),
        "bottom_b": (cx, cy - d + h * 2 + d * 0.72),
    }


def build_tray(size: int) -> Image.Image:
    scale = 8
    canvas = size * scale
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pts = _iso_points(canvas / 2, canvas / 2 + canvas * 0.04, canvas * 0.88)
    stroke = max(2, int(canvas * 0.07))
    faces = [
        [pts["top"], pts["right"], pts["bottom"], pts["left"]],
        [pts["left"], pts["bottom"], pts["bottom_b"], pts["left_b"]],
        [pts["right"], pts["bottom"], pts["bottom_b"], pts["right_b"]],
    ]
    for face in faces:
        draw.polygon(face, outline=(0, 0, 0, 255))
        draw.line(face + [face[0]], fill=(0, 0, 0, 255), width=stroke, joint="curve")

    eye_r = max(2, int(canvas * 0.045))
    front_cx = (pts["right"][0] + pts["bottom"][0] + pts["bottom_b"][0]) / 3
    front_cy = (pts["right"][1] + pts["bottom"][1] + pts["bottom_b"][1]) / 3
    for dx in (-eye_r * 1.6, eye_r * 1.6):
        x = front_cx + dx
        y = front_cy - eye_r * 0.2
        draw.ellipse([x - eye_r, y - eye_r * 1.4, x + eye_r, y + eye_r * 1.4], fill=(0, 0, 0, 255))
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    for size, out in ((16, OUT_1X), (32, OUT_2X)):
        build_tray(size).save(out, optimize=True)
        print(f"Wrote {out} ({size}x{size})")


if __name__ == "__main__":
    main()
