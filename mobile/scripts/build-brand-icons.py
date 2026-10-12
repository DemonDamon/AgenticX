#!/usr/bin/env python3
"""Generate Near Mobile brand icon set from the desktop transparent box mark.

Outputs (mobile/assets/):
  icon.png                      1024  cream plate + orange box (Expo app icon)
  splash-icon.png               1024  transparent mark (splash center)
  android-icon-foreground.png   1024  adaptive foreground, mark at ~62% safe zone
  android-icon-background.png   1024  solid cream plate
  android-icon-monochrome.png   1024  white silhouette for themed icons
  favicon.png                    196  cream + mark

Brand: orange isometric box, cream plate #FFF7F0, tagline "Near, Always Near."
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
MOBILE_DIR = SCRIPT_DIR.parent
ASSETS = MOBILE_DIR / "assets"
MARK_SRC = Path("/Users/damonli/myWork/AgenticX/desktop/src/assets/machi-logo-transparent.png")
PLATE = (255, 247, 240, 255)  # #FFF7F0 — same as desktop dock plate
SIZE = 1024


def load_mark() -> Image.Image:
    mark = Image.open(MARK_SRC).convert("RGBA")
    # strip any near-white fringe so it stays crisp on cream / dark launch screens
    return mark


def fit(mark: Image.Image, ratio: float) -> Image.Image:
    target = int(SIZE * ratio)
    m = mark.copy()
    m.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(m, ((SIZE - m.width) // 2, (SIZE - m.height) // 2), m)
    return canvas


def plate_with(mark: Image.Image, ratio: float) -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), PLATE)
    m = mark.copy()
    m.thumbnail((int(SIZE * ratio),) * 2, Image.Resampling.LANCZOS)
    canvas.paste(m, ((SIZE - m.width) // 2, (SIZE - m.height) // 2), m)
    return canvas


def monochrome(mark: Image.Image, ratio: float) -> Image.Image:
    """White silhouette: keep alpha, replace RGB with white."""
    m = fit(mark, ratio)
    arr = np.array(m)
    arr[..., :3] = 255
    return Image.fromarray(arr)


def main() -> None:
    mark = load_mark()
    plate_with(mark, 0.72).save(ASSETS / "icon.png")
    fit(mark, 0.62).save(ASSETS / "splash-icon.png")
    fit(mark, 0.62).save(ASSETS / "android-icon-foreground.png")
    Image.new("RGBA", (SIZE, SIZE), PLATE).save(ASSETS / "android-icon-background.png")
    monochrome(mark, 0.62).save(ASSETS / "android-icon-monochrome.png")
    fav = plate_with(mark, 0.74).resize((196, 196), Image.Resampling.LANCZOS)
    fav.save(ASSETS / "favicon.png")
    print("Near Mobile brand icons written to", ASSETS)


if __name__ == "__main__":
    main()
