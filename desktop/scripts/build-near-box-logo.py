#!/usr/bin/env python3
"""Cut the isometric Near box mark out of a white-background master.

Author: Damon Li
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR.parent / "assets"
SRC_ASSETS_DIR = SCRIPT_DIR.parent / "src" / "assets"
MASTER_SRC = ASSETS_DIR / "near-box-logo-source.png"
MASTER_OUT = ASSETS_DIR / "icon-master.png"
TRANSPARENT_OUT = SRC_ASSETS_DIR / "machi-logo-transparent.png"
AVATAR_OUT = ASSETS_DIR / "export_embedded.png"
SIZE = 1024
PLATE = (255, 247, 240)


def _luma(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def _flood_white_background(rgb: np.ndarray) -> np.ndarray:
    """White eyes stay inside the cube; only border-connected white is background."""
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    near_white = (_luma(rgb) > 242) & (chroma < 14)
    h, w = near_white.shape
    bg = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if near_white[y, x] and not bg[y, x]:
            bg[y, x] = True
            queue.append((y, x))

    for x in range(w):
        seed(0, x)
        seed(h - 1, x)
    for y in range(h):
        seed(y, 0)
        seed(y, w - 1)

    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                queue.append((ny, nx))
    return bg


def extract_mark(src: Image.Image) -> Image.Image:
    rgba = np.array(src.convert("RGBA"), dtype=np.float32)
    rgb = rgba[..., :3]
    bg = _flood_white_background(rgb)
    mark_mask = ~bg
    ys, xs = np.where(mark_mask)
    if ys.size == 0:
        raise RuntimeError("Could not find the orange box in the master image.")
    pad = 12
    y0 = max(int(ys.min()) - pad, 0)
    y1 = min(int(ys.max()) + pad + 1, src.height)
    x0 = max(int(xs.min()) - pad, 0)
    x1 = min(int(xs.max()) + pad + 1, src.width)
    crop = rgba[y0:y1, x0:x1].copy()
    crop_bg = bg[y0:y1, x0:x1]
    crop[..., 3] = np.where(crop_bg, 0.0, 255.0)
    return Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8))


def fit_square(mark: Image.Image, size: int, fill: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    target = int(size * fill)
    fitted = mark.copy()
    fitted.thumbnail((target, target), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.paste(fitted, (x, y), fitted)
    return canvas


def fill_icon(mark: Image.Image, size: int) -> Image.Image:
    """Cream plate + isometric cube so the three faces still read in the Dock."""
    canvas = Image.new("RGB", (size, size), PLATE)
    target = int(size * 0.78)
    fitted = mark.copy()
    fitted.thumbnail((target, target), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2 + int(size * 0.02)
    canvas.paste(fitted, (x, y), fitted)
    return canvas


def main() -> None:
    if not MASTER_SRC.exists():
        raise FileNotFoundError(MASTER_SRC)
    src = Image.open(MASTER_SRC)
    mark = extract_mark(src)
    fill_icon(mark, SIZE).save(MASTER_OUT, "PNG")
    transparent = fit_square(mark, SIZE, fill=0.90)
    transparent.save(TRANSPARENT_OUT, "PNG")
    transparent.save(AVATAR_OUT, "PNG")
    print(f"Wrote {MASTER_OUT}")
    print(f"Wrote {TRANSPARENT_OUT}")
    print(f"Wrote {AVATAR_OUT}")


if __name__ == "__main__":
    main()
