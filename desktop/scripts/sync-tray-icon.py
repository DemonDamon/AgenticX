#!/usr/bin/env python3
"""Generate macOS menu-bar tray template icons.
Uses a clean, anti-aliased geometric eye design to represent 'Near' (insightful/rational).
"""

from __future__ import annotations

import math
from pathlib import Path
from PIL import Image, ImageDraw

SCRIPT_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPT_DIR.parent / "assets"
OUT_1X = ASSETS_DIR / "trayTemplate.png"
OUT_2X = ASSETS_DIR / "trayTemplate@2x.png"

def build_tray(size: int) -> Image.Image:
    scale = 8
    img = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    cx = size * scale / 2
    cy = size * scale / 2
    
    ew = size * scale * 0.8
    eh = size * scale * 0.5
    
    pts_top = []
    pts_bottom = []
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        x = cx - ew/2 + t * ew
        y_offset = math.sin(t * math.pi) * (eh / 2)
        pts_top.append((x, cy - y_offset))
        pts_bottom.append((x, cy + y_offset))
        
    pts_bottom.reverse()
    pts = pts_top + pts_bottom
    
    thickness = int(size * scale * 0.08)
    draw.line(pts + [pts[0]], fill=(0, 0, 0, 255), width=thickness, joint="curve")
    
    pr = size * scale * 0.18
    draw.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=(0, 0, 0, 255))
    
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    return img

def main() -> None:
    for size, out in ((16, OUT_1X), (32, OUT_2X)):
        build_tray(size).save(out, optimize=True)
        print(f"Wrote {out} ({size}x{size})")

if __name__ == "__main__":
    main()
