#!/usr/bin/env python3
"""Generate macOS menu-bar tray template icons from Near wireframe cutout."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR.parent / "assets"
SRC = ASSETS_DIR / "splash-wireframe-cutout.png"
OUT_1X = ASSETS_DIR / "trayTemplate.png"
OUT_2X = ASSETS_DIR / "trayTemplate@2x.png"


def build_tray(size: int) -> Image.Image:
    src = Image.open(SRC).convert("RGBA")
    w, h = src.size
    template = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sp = src.load()
    tp = template.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = sp[x, y]
            if a < 16:
                continue
            lum = max(r, g, b)
            if lum >= 48:
                tp[x, y] = (0, 0, 0, min(255, int((lum / 255) * a)))

    bbox = template.getbbox()
    if not bbox:
        raise SystemExit(f"No visible content in {SRC}")

    cropped = template.crop(bbox)
    cw, ch = cropped.size
    side = max(cw, ch)
    pad = max(2, int(side * 0.08))
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    ox = (canvas_side - cw) // 2
    oy = (canvas_side - ch) // 2
    canvas.paste(cropped, (ox, oy), cropped)

    out = canvas.resize((size, size), Image.Resampling.LANCZOS)
    alpha = out.split()[3].point(lambda p: 255 if p >= 72 else 0)
    rgb = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rgb.paste((0, 0, 0, 255), mask=alpha)
    return rgb


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Source wireframe not found: {SRC}")

    for size, out in ((16, OUT_1X), (32, OUT_2X)):
        build_tray(size).save(out, optimize=True)
        print(f"Wrote {out} ({size}x{size})")


if __name__ == "__main__":
    main()
