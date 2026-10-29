#!/usr/bin/env python3
"""Apply a delivery pack (default: this skeleton) and print RegisterReport."""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Allow running from repo root without install
ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.pack import register_pack
from agenticx.data_suite.store.file_store import BoardFileStore, DictionaryFileStore
from agenticx.data_suite.tags.catalog import TagCatalog

DEFAULT_PACK = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    pack_root = Path(args[0]) if args else DEFAULT_PACK
    store_root = Path(args[1]) if len(args) > 1 else Path.cwd() / ".runtime" / "data-suite-pack-demo"
    registry = ChannelRegistry()
    dict_store = DictionaryFileStore(root=store_root)
    board_store = BoardFileStore(root=store_root)
    catalog = TagCatalog()
    report = register_pack(
        pack_root,
        registry=registry,
        dictionary_store=dict_store,
        board_store=board_store,
        tag_catalog=catalog,
    )
    print(json.dumps(report.as_dict(), indent=2, ensure_ascii=False))
    print(f"store={store_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
