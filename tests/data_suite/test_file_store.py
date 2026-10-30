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


def test_cleaning_rule_upsert_list_and_persist(tmp_path: Path) -> None:
    from agenticx.data_suite.store.file_store import CleaningRuleStore

    store = CleaningRuleStore(tmp_path)
    assert store.list_rules() == []

    store.upsert_rule(
        {
            "id": "not_null_id",
            "template": "not_null",
            "field": "member_id",
            "params": {},
            "enabled": True,
        }
    )
    store.upsert_rule(
        {
            "id": "trim_name",
            "template": "trim",
            "field": "display_name",
            "params": {},
            "enabled": False,
        }
    )
    ids = [r["id"] for r in store.list_rules()]
    assert ids == ["not_null_id", "trim_name"]
    assert store.get_rule("trim_name")["enabled"] is False

    store.upsert_rule(
        {
            "id": "not_null_id",
            "template": "not_null",
            "field": "member_id",
            "params": {},
            "enabled": False,
        }
    )
    assert store.get_rule("not_null_id")["enabled"] is False

    disk = json.loads((tmp_path / "cleaning_rules.json").read_text(encoding="utf-8"))
    assert len(disk["rules"]) == 2

    reloaded = CleaningRuleStore(tmp_path)
    assert [r["id"] for r in reloaded.list_rules()] == ["not_null_id", "trim_name"]
    assert reloaded.get_rule("missing") is None


def test_classification_seeds_default_grades_and_upsert(tmp_path: Path) -> None:
    from agenticx.data_suite.store.file_store import ClassificationStore

    store = ClassificationStore(tmp_path)
    grades = store.list_grades()
    assert [g["id"] for g in grades] == ["S", "A", "B", "C"]
    assert grades[0]["rank"] == 4

    store.upsert_grade({"id": "S", "label": "Superior", "rank": 5})
    assert store.get_grade("S")["label"] == "Superior"
    assert store.get_grade("S")["rank"] == 5

    store.upsert_grade({"id": "D", "label": "D", "rank": 0})
    assert "D" in [g["id"] for g in store.list_grades()]

    reloaded = ClassificationStore(tmp_path)
    assert reloaded.get_grade("S")["label"] == "Superior"
    assert reloaded.get_grade("D")["rank"] == 0


def test_quality_metric_upsert_and_run_day(tmp_path: Path) -> None:
    from agenticx.data_suite.store.file_store import QualityMetricStore

    store = QualityMetricStore(tmp_path)
    assert store.list_metrics() == []
    assert store.get_last_run() is None

    store.upsert_metric({"id": "null_rate_x", "type": "null_rate", "field": "x"})
    store.upsert_metric({"id": "distinct_x", "type": "distinct_count", "field": "x"})
    assert [m["id"] for m in store.list_metrics()] == ["distinct_x", "null_rate_x"]

    snap = store.run_day(
        "2026-10-30",
        [{"x": "a"}, {"x": None}, {"x": "a"}],
        quarantine=[{"rule_id": "r1"}],
    )
    assert snap["day"] == "2026-10-30"
    assert snap["metrics"]["null_rate_x"] == 1 / 3
    assert snap["metrics"]["distinct_x"] == 1.0
    assert snap["meta"]["row_count"] == 3

    assert store.get_last_run()["day"] == "2026-10-30"
    disk = json.loads((tmp_path / "quality_metrics.json").read_text(encoding="utf-8"))
    assert disk["last_run"]["day"] == "2026-10-30"

    reloaded = QualityMetricStore(tmp_path)
    assert reloaded.get_last_run()["metrics"]["null_rate_x"] == 1 / 3


def test_review_action_append_only(tmp_path: Path) -> None:
    from agenticx.data_suite.store.file_store import ReviewActionStore

    store = ReviewActionStore(tmp_path)
    assert store.list_actions() == []

    a1 = store.append_action(
        {
            "id": "act-1",
            "target_rule_id": "not_null_id",
            "decision": "approve",
            "note": "ok",
            "at": "2026-10-30T09:00:00Z",
        }
    )
    assert a1["decision"] == "approve"
    store.append_action(
        {
            "id": "act-2",
            "target_rule_id": "not_null_id",
            "decision": "reject",
            "note": "bad",
            "at": "2026-10-30T10:00:00Z",
        }
    )
    assert [a["id"] for a in store.list_actions()] == ["act-1", "act-2"]

    try:
        store.append_action({"id": "x", "decision": "maybe", "target_rule_id": "r", "at": ""})
        assert False, "expected ValueError"
    except ValueError:
        pass

    reloaded = ReviewActionStore(tmp_path)
    assert len(reloaded.list_actions()) == 2

