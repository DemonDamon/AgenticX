#!/usr/bin/env python3
"""Minimal PDF watermark CLI for Hechuang acceptance.

This implementation appends trace watermark metadata comment to output PDF bytes.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF watermark CLI")
    parser.add_argument("--input", required=True, help="Input PDF file")
    parser.add_argument("--output", required=True, help="Output PDF file")
    parser.add_argument("--text", required=True, help="Watermark text")
    args = parser.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)

    raw = in_path.read_bytes()
    if not raw.startswith(b"%PDF"):
        raise ValueError(f"input is not a PDF: {in_path}")

    marker = f"\n% AGX-WATERMARK: {args.text}\n".encode("utf-8")
    out_path.write_bytes(raw + marker)
    print(json.dumps({"ok": True, "input": str(in_path), "output": str(out_path), "watermark": args.text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
