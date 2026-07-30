#!/usr/bin/env python3
"""Generate monochrome macOS menu-bar icons from the customer brand mark."""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageOps

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR.parent / "assets"
SOURCE = ASSETS_DIR / "hechuang-zhihui-logo.jpg"
OUT_1X = ASSETS_DIR / "trayTemplate.png"
OUT_2X = ASSETS_DIR / "trayTemplate@2x.png"


def build_tray(size: int) -> Image.Image:
    scale = 8
    source = Image.open(SOURCE).convert("RGB")
    fitted = ImageOps.fit(
        source,
        (size * scale, size * scale),
        method=Image.Resampling.LANCZOS,
    )

    alpha = Image.new("L", fitted.size)
    alpha.putdata(
        [
            max(0, min(255, int((max(pixel) - min(pixel) - 8) * 5.2)))
            for pixel in fitted.getdata()
        ]
    )

    template = Image.new("RGBA", fitted.size, (0, 0, 0, 255))
    template.putalpha(alpha)
    return template.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Brand source not found: {SOURCE}")
    for size, out in ((16, OUT_1X), (32, OUT_2X)):
        build_tray(size).save(out, optimize=True)
        print(f"Wrote {out} ({size}x{size})")

if __name__ == "__main__":
    main()
