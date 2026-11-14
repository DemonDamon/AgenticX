#!/usr/bin/env python3
"""拉取 arXiv HTML 版并转 Markdown（比 PDF 快 30 倍且文本更完整）。
可重复运行：已存在的 md 会跳过。HTML 不可用时回退提示手动补 PDF。
"""
import concurrent.futures
import pathlib
import re
import subprocess

import html2text

DEST = pathlib.Path(__file__).resolve().parent / "papers"
DEST.mkdir(parents=True, exist_ok=True)

ITEMS = [
    ("2610.22192", "terminal-rsi"),
    ("2607.03935", "hase"),
    ("2610.14163", "autoenvscaling"),
    ("2610.05923", "vera"),
    ("2611.04277", "harness-s"),
    ("2610.18813", "self-evolving-agent-harness"),
    ("2609.00829", "harnessevolve"),
    ("2605.30621", "harness-update-vs-benefit"),
    ("2610.32813", "harnessmm"),
    ("2606.03108", "evotrainer"),
    ("2606.09498", "self-harness"),
    ("2605.27276", "sia"),
    ("2610.28201", "mad-rsi"),
    ("2609.04128", "environment-evolution"),
    ("2610.32253", "rsihub"),
    ("2608.08311", "ouroboros"),
    ("2609.26760", "grow-the-harness"),
    ("2608.08466", "hsi"),
    ("2609.11873", "last-ai-built-by-humans"),
    ("2609.36892", "harness-evolution-as-learning"),
    ("2609.26457", "aide2"),
    ("2607.10891", "seta"),
    ("2610.02826", "rsr"),
    ("2609.33180", "reuse"),
    ("2610.14224", "harness2"),
    ("2610.10310", "rsigym"),
]

CLEAN = re.compile(r"(?is)<(script|style|nav|header|footer)[^>]*>.*?</\1>")


def fetch_one(item: tuple[str, str]) -> str:
    aid, slug = item
    out = DEST / f"{aid}-{slug}.md"
    if out.exists() and out.stat().st_size > 5000:
        return f"SKIP {aid} {slug}"

    for ver in ("", "v1", "v2", "v3", "v4"):
        url = f"https://arxiv.org/html/{aid}{ver}"
        tmp = pathlib.Path(f"/tmp/_arxiv_{aid}.html")
        proc = subprocess.run(
            ["curl", "-sSL", "-m", "45", "-A", "Mozilla/5.0", "-o", str(tmp),
             "-w", "%{http_code}", url],
            capture_output=True, text=True,
        )
        code = proc.stdout.strip()
        if code != "200" or not tmp.exists() or tmp.stat().st_size < 20000:
            continue
        html = tmp.read_text(encoding="utf-8", errors="ignore")
        html = CLEAN.sub("", html)
        conv = html2text.HTML2Text()
        conv.body_width = 0
        conv.ignore_images = True
        md = conv.handle(html)
        md = re.sub(r"\n{4,}", "\n\n\n", md).strip()
        if len(md) < 5000:
            continue
        header = (
            f"<!-- source: https://arxiv.org/abs/{aid} | html: {url} | "
            f"converted-by: html2text -->\n\n"
            f"# {slug}\n\n> arXiv: `{aid}` · 原文: {url}\n\n---\n\n"
        )
        out.write_text(header + md, encoding="utf-8")
        return f"OK   {aid} {slug} {len(md)} chars"
    return f"FAIL {aid} {slug} (no html)"


def main() -> None:
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for line in pool.map(fetch_one, ITEMS):
            print(line, flush=True)


if __name__ == "__main__":
    main()
