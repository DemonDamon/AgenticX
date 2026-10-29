"""End-to-end apply of synthetic delivery pack."""
from __future__ import annotations

from pathlib import Path

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.pack import register_pack
from agenticx.data_suite.store.file_store import BoardFileStore, DictionaryFileStore
from agenticx.data_suite.tags.catalog import TagCatalog

PACK = Path(__file__).resolve().parents[2] / "examples" / "data_suite" / "delivery_pack"


def test_delivery_pack_e2e(tmp_path: Path) -> None:
    registry = ChannelRegistry()
    dict_store = DictionaryFileStore(root=tmp_path)
    board_store = BoardFileStore(root=tmp_path)
    catalog = TagCatalog()
    report = register_pack(
        PACK,
        registry=registry,
        dictionary_store=dict_store,
        board_store=board_store,
        tag_catalog=catalog,
    )
    assert report.pack_id == "brand-a-market-x"
    assert len(report.channels) >= 2
    assert report.dictionary_fields >= 8
    assert report.boards
    assert report.tags >= 3
    assert report.idmapping_profile
    assert report.iam_strategy_id
    # no customer-looking tokens in report
    blob = str(report.as_dict()).lower()
    assert "proposal" not in blob
