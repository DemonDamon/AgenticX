"""Register dictionary / tags / boards from delivery pack."""
from __future__ import annotations

from pathlib import Path

from agenticx.data_suite.pack import load_pack, register_pack
from agenticx.data_suite.store.file_store import BoardFileStore, DictionaryFileStore
from agenticx.data_suite.tags.catalog import TagCatalog

PACK = Path(__file__).resolve().parents[2] / "examples" / "data_suite" / "delivery_pack"


def test_register_gov_tags_boards(tmp_path: Path) -> None:
    dict_store = DictionaryFileStore(root=tmp_path)
    board_store = BoardFileStore(root=tmp_path)
    catalog = TagCatalog()
    report = register_pack(
        load_pack(PACK),
        dictionary_store=dict_store,
        board_store=board_store,
        tag_catalog=catalog,
    )
    assert report.dictionary_fields >= 8
    assert dict_store.get_field("member_id").name == "member_id"
    assert "brand_a_member_overview" in report.boards
    assert board_store.get_board("brand_a_member_overview") is not None
    assert report.tags >= 3
    assert catalog.get("status_active").layer == "L1"
    assert report.quality_rules >= 2
    assert report.audiences >= 1
