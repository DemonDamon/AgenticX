#!/usr/bin/env python3
"""Render the Desktop application icon as a rounded rectangular tile."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


CANVAS_SIZE = 1024
TILE_MARGIN = 54
CORNER_RADIUS = 210


def render_app_icon(
    source_path: Path,
    output_path: Path,
    icns_output_path: Path | None,
    ico_output_path: Path | None,
) -> None:
    source = Image.open(source_path).convert("RGB")
    tile_size = CANVAS_SIZE - (TILE_MARGIN * 2)
    tile_art = ImageOps.fit(
        source,
        (tile_size, tile_size),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    ).convert("RGBA")

    mask = Image.new("L", (tile_size, tile_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, tile_size - 1, tile_size - 1),
        radius=CORNER_RADIUS,
        fill=255,
    )
    tile_art.putalpha(mask)

    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(tile_art, (TILE_MARGIN, TILE_MARGIN))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)
    if icns_output_path:
        icns_output_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(icns_output_path, format="ICNS")
    if ico_output_path:
        ico_output_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(
            ico_output_path,
            format="ICO",
            sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--icns", type=Path)
    parser.add_argument("--ico", type=Path)
    args = parser.parse_args()
    render_app_icon(args.source, args.output, args.icns, args.ico)


if __name__ == "__main__":
    main()
