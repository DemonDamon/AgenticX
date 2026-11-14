#!/usr/bin/env python3
"""把 refs/papers 下的 PDF 转成 Markdown，便于溯源检索。可重复运行（已转的跳过）。"""
import re
import sys
from pathlib import Path

import pymupdf4llm

BASE = Path(__file__).resolve().parent
PAPERS = BASE / "papers"


def parse_name(pdf: Path) -> tuple[str, str]:
    m = re.match(r"(\d{4}\.\d{4,5})-(.+)\.pdf$", pdf.name)
    return (m.group(1), m.group(2)) if m else ("", pdf.stem)


def main() -> int:
    pdfs = sorted(PAPERS.glob("*.pdf"))
    if not pdfs:
        print("没有找到 PDF")
        return 1
    for pdf in pdfs:
        out = pdf.with_suffix(".md")
        if out.exists() and out.stat().st_size > 2000:
            print(f"SKIP {pdf.name}")
            continue
        arxiv_id, slug = parse_name(pdf)
        try:
            md = pymupdf4llm.to_markdown(str(pdf), show_progress=False)
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {pdf.name}: {exc}")
            continue
        header = (
            f"<!-- source: arXiv:{arxiv_id} | pdf: {pdf.name} | "
            f"converted-by: pymupdf4llm -->\n\n"
            f"# {slug}\n\n"
            f"> arXiv: `{arxiv_id}` · 原始 PDF: `{pdf.name}`\n\n---\n\n"
        )
        out.write_text(header + md, encoding="utf-8")
        print(f"OK   {pdf.name} -> {out.name} ({len(md)} chars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
