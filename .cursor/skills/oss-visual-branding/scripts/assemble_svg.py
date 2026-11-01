#!/usr/bin/env python3
"""
Assemble a hybrid SVG: transparent PNG graphic + vector text.

Usage:
    python assemble_svg.py graphic.png output.svg \
        --title "ProjectName" --subtitle "Tagline" \
        --width 2688 --height 1152
"""
import argparse
import base64
import io
from PIL import Image


def assemble_svg(graphic_path, output_path, title, subtitle, width, height):
    img = Image.open(graphic_path).convert('RGBA')
    gw, gh = img.size

    buffer = io.BytesIO()
    img.save(buffer, format='PNG', optimize=True)
    b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

    gx = (width - gw) / 2
    gy = 10
    title_y = gy + gh + 120
    subtitle_y = title_y + 100

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 {width} {height}"
     width="{width}" height="{height}">
  <image x="{gx}" y="{gy}" width="{gw}" height="{gh}"
         href="data:image/png;base64,{b64}"/>
  <text x="{width/2}" y="{title_y}" text-anchor="middle"
        font-family="Inter, -apple-system, sans-serif"
        font-size="180" font-weight="400"
        fill="#ffffff">{title}</text>
  <text x="{width/2}" y="{subtitle_y}" text-anchor="middle"
        font-family="Inter, -apple-system, sans-serif"
        font-size="48" font-weight="300"
        fill="#9ca3af">{subtitle}</text>
</svg>
'''
    with open(output_path, 'w') as f:
        f.write(svg)
    print(f"SVG saved: {output_path} ({len(svg)/1024:.1f} KB)")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Assemble hybrid SVG')
    parser.add_argument('graphic', help='Transparent PNG graphic')
    parser.add_argument('output', help='Output SVG path')
    parser.add_argument('--title', required=True, help='Main title text')
    parser.add_argument('--subtitle', default='', help='Subtitle text')
    parser.add_argument('--width', type=int, default=2688, help='SVG width')
    parser.add_argument('--height', type=int, default=1152, help='SVG height')
    args = parser.parse_args()
    assemble_svg(args.graphic, args.output, args.title, args.subtitle,
                 args.width, args.height)
