from pathlib import Path

import pytest

from agenticx.data_suite.governance.dictionary import (
    DictionaryCatalog,
    FieldNotFoundError,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample_dictionary.yaml"


def test_load_and_get_four_elements():
    cat = DictionaryCatalog()
    cat.load(FIXTURE)
    f = cat.get("member_id")
    assert f.name == "member_id"
    assert f.business_def
    assert f.calc_logic
    assert f.update_freq == "daily"
    assert f.owner == "data-platform"


def test_list_fields_sorted():
    cat = DictionaryCatalog()
    cat.load(FIXTURE)
    names = [x.name for x in cat.list_fields()]
    assert names == sorted(names)
    assert "member_id" in names


def test_missing_field_raises():
    cat = DictionaryCatalog()
    cat.load(FIXTURE)
    with pytest.raises(FieldNotFoundError):
        cat.get("does_not_exist")


def test_reload_replaces_fields(tmp_path):
    p1 = tmp_path / "d1.yaml"
    p1.write_text(
        "fields:\n  - name: a\n    business_def: x\n    calc_logic: y\n"
        "    update_freq: daily\n    owner: o\n",
        encoding="utf-8",
    )
    p2 = tmp_path / "d2.yaml"
    p2.write_text(
        "fields:\n  - name: b\n    business_def: x\n    calc_logic: y\n"
        "    update_freq: weekly\n    owner: o\n",
        encoding="utf-8",
    )
    cat = DictionaryCatalog()
    cat.load(p1)
    cat.load(p2)
    assert [f.name for f in cat.list_fields()] == ["b"]


def test_empty_yaml_lists_nothing(tmp_path):
    p = tmp_path / "empty.yaml"
    p.write_text("fields: []\n", encoding="utf-8")
    cat = DictionaryCatalog()
    cat.load(p)
    assert cat.list_fields() == []
