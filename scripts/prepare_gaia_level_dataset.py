#!/usr/bin/env python3
"""Download GAIA level metadata from HuggingFace and export JSONL.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET_ROOT = REPO_ROOT / ".dataset" / "gaia"
HF_REPO_ID = "gaia-benchmark/GAIA"


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Prepare GAIA level dataset (parquet download + JSONL export)."
    )
    parser.add_argument(
        "--level",
        type=int,
        choices=[1, 2, 3],
        required=True,
        help="GAIA difficulty level (1/2/3)",
    )
    parser.add_argument(
        "--split",
        choices=["validation", "test"],
        default="validation",
        help="Dataset split (default: validation)",
    )
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=DEFAULT_DATASET_ROOT,
        help="Local GAIA dataset root (default: .dataset/gaia)",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Only convert existing parquet; do not download from HuggingFace",
    )
    return parser.parse_args()


def main() -> int:
    """Entry point."""
    args = parse_args()
    dataset_root = args.dataset_root.resolve()
    dataset_root.mkdir(parents=True, exist_ok=True)

    parquet_name = f"metadata.level{args.level}.{args.split}.parquet"
    jsonl_name = f"metadata.level{args.level}.{args.split}.jsonl"
    parquet_path = dataset_root / parquet_name
    jsonl_path = dataset_root / jsonl_name
    hf_relative = f"2023/{args.split}/metadata.level{args.level}.parquet"

    if not args.skip_download and not parquet_path.exists():
        try:
            from huggingface_hub import hf_hub_download
        except ImportError:
            print("huggingface_hub is required. Install with: pip install huggingface-hub", file=sys.stderr)
            return 1

        hf_cache_dir = dataset_root / "hf"
        hf_cache_dir.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {HF_REPO_ID}:{hf_relative} ...", flush=True)
        try:
            downloaded = hf_hub_download(
                repo_id=HF_REPO_ID,
                repo_type="dataset",
                filename=hf_relative,
                local_dir=str(hf_cache_dir),
            )
        except Exception as exc:
            print(
                "Failed to download gated GAIA dataset. Authenticate first:\n"
                "  hf auth login\n"
                "Then accept the dataset terms at:\n"
                "  https://huggingface.co/datasets/gaia-benchmark/GAIA\n"
                f"\nUnderlying error: {exc}",
                file=sys.stderr,
            )
            return 1

        source = Path(downloaded)
        if source.resolve() != parquet_path.resolve():
            parquet_path.write_bytes(source.read_bytes())

    if not parquet_path.exists():
        print(f"Parquet not found: {parquet_path}", file=sys.stderr)
        print("Run without --skip-download after `hf auth login`, or place the parquet manually.", file=sys.stderr)
        return 1

    try:
        import pyarrow.parquet as pq
    except ImportError:
        print("pyarrow is required. Install with: pip install pyarrow", file=sys.stderr)
        return 1

    table = pq.read_table(parquet_path)
    rows = table.to_pylist()
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(
        "GAIA dataset prepared:\n"
        f"  parquet: {parquet_path} ({len(rows)} rows)\n"
        f"  jsonl:   {jsonl_path}\n"
        f"  hint: pass --dataset-root {dataset_root} when attachments use file_path"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
