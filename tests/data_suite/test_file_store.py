"""JSON file store for dictionary fields and board specs."""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.data_suite.governance.dictionary import FieldDef
from agenticx.data_suite.store.file_store import BoardFileStore, DictionaryFileStore


def test_dictionary_upsert_list_and_persist_reload(tmp_path: Path) -> None:
    store = DictionaryFileStore(tmp_path)
    assert store.list_fields() == []

    store.upsert_field(
        FieldDef(
            name="member_id",
            business_def="Stable member primary key",
            calc_logic="idmapping.merge",
            update_freq="daily",
            owner="data-platform",
        )
    )
    store.upsert_field(
        FieldDef(
            name="mobile_hash",
            business_def="Hashed mobile",
            calc_logic="sha256",
            update_freq="daily",
            owner="data-platform",
        )
    )
    names = [f.name for f in store.list_fields()]
    assert names == ["member_id", "mobile_hash"]

    # Update existing
    store.upsert_field(
        FieldDef(
            name="member_id",
            business_def="Updated def",
            calc_logic="idmapping.merge primary",
            update_freq="hourly",
            owner="platform",
        )
    )
    member = next(f for f in store.list_fields() if f.name == "member_id")
    assert member.business_def == "Updated def"
    assert member.update_freq == "hourly"
    assert member.owner == "platform"

    disk = json.loads((tmp_path / "dictionary.json").read_text(encoding="utf-8"))
    assert len(disk["fields"]) == 2

    reloaded = DictionaryFileStore(tmp_path)
    assert [f.name for f in reloaded.list_fields()] == ["member_id", "mobile_hash"]
    assert reloaded.get_field("member_id").business_def == "Updated def"


def test_dictionary_get_missing_raises(tmp_path: Path) -> None:
    store = DictionaryFileStore(tmp_path)
    try:
        store.get_field("nope")
        assert False, "expected KeyError"
    except KeyError:
        pass


def test_board_upsert_list_get_and_persist(tmp_path: Path) -> None:
    store = BoardFileStore(tmp_path)
    assert store.list_boards() == []

    board = {
        "id": "sample_member_board",
        "title": "Member overview (sample)",
        "drillLevels": ["brand", "line", "config"],
        "widgets": [
            {
                "id": "members_by_region",
                "title": "Members by region",
                "chart": "bar",
                "dataset": "members",
                "group_by": "region",
                "metric": "count",
            }
        ],
    }
    store.upsert_board(board)
    assert [b["id"] for b in store.list_boards()] == ["sample_member_board"]
    got = store.get_board("sample_member_board")
    assert got is not None
    assert got["title"] == "Member overview (sample)"
    assert got["drillLevels"] == ["brand", "line", "config"]
    assert len(got["widgets"]) == 1

    store.upsert_board({**board, "title": "Updated title"})
    assert store.get_board("sample_member_board")["title"] == "Updated title"

    disk = json.loads((tmp_path / "boards.json").read_text(encoding="utf-8"))
    assert disk["boards"][0]["title"] == "Updated title"

    reloaded = BoardFileStore(tmp_path)
    assert reloaded.get_board("sample_member_board")["title"] == "Updated title"
    assert reloaded.get_board("missing") is None


def test_store_dir_from_env(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGX_DATA_SUITE_STORE_DIR", str(tmp_path))
    d = DictionaryFileStore()
    d.upsert_field(
        FieldDef(
            name="a",
            business_def="x",
            calc_logic="y",
            update_freq="daily",
            owner="o",
        )
    )
    assert (tmp_path / "dictionary.json").is_file()
    b = BoardFileStore()
    b.upsert_board({"id": "b1", "title": "t", "drillLevels": [], "widgets": []})
    assert (tmp_path / "boards.json").is_file()
