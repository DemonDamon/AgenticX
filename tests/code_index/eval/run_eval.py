#!/usr/bin/env python3
"""Benchmark B1 (grep) vs B3 (code_search hybrid) on agx_queries.jsonl.

Usage:
  python tests/code_index/eval/run_eval.py --repo /path/to/AgenticX
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def _grep_hits(repo: Path, query: str, limit: int = 10) -> list[str]:
    try:
        out = subprocess.run(
            ["rg", "-l", query.replace(" ", "|"), str(repo)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError:
        out = subprocess.run(
            ["grep", "-r", "-l", query.split()[0], str(repo)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    lines = [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]
    return lines[:limit]


def _code_search_hits(repo: Path, query: str, limit: int = 10) -> list[str]:
    from agenticx.code_index.config import CodeIndexConfig
    from agenticx.code_index.manager import CodeIndexManager
    from unittest.mock import patch

    cfg = CodeIndexConfig(enabled=True)
    mgr = CodeIndexManager.instance()
    with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
        hits, _, _ = mgr.search(repo, query, top_k=limit, wait_for_index=True)
    return [str(h.file_path) for h in hits]


def recall_at_k(gold: list[str], found: list[str], k: int) -> float:
    if not gold:
        return 0.0
    top = found[:k]
    hit = any(any(g in f for f in top) for g in gold)
    return 1.0 if hit else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--queries", type=Path, default=Path(__file__).with_name("agx_queries.jsonl"))
    args = parser.parse_args()
    repo = args.repo.resolve()
    rows = []
    for line in args.queries.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))

    b1, b3 = [], []
    for row in rows:
        q = row["query"]
        gold = row.get("gold_files", [])
        g = _grep_hits(repo, q)
        c = _code_search_hits(repo, q)
        b1.append(recall_at_k(gold, g, 10))
        b3.append(recall_at_k(gold, c, 10))
        print(f"{row['id']}: grep={g[:2]} code_search={c[:2]}")

    r1 = sum(b1) / max(len(b1), 1)
    r3 = sum(b3) / max(len(b3), 1)
    print(f"Recall@10 grep={r1:.2%} code_search={r3:.2%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
