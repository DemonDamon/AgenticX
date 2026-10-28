from pathlib import Path

import pytest

from agenticx.data_suite.tags.catalog import (
    TagCatalog,
    TagConflictError,
    TagNotFoundError,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample_tags.yaml"


def test_load_and_list_by_layer():
    cat = TagCatalog()
    cat.load(FIXTURE)
    l2 = cat.list_tags(layer="L2")
    assert {t.meaning_key for t in l2} == {"default", "active_only"}
    assert all(t.layer == "L2" for t in l2)
    assert any(t.name == "lifecycle_stage" for t in cat.list_tags(layer="L1"))


def test_same_name_different_meaning_ok():
    cat = TagCatalog()
    cat.load(FIXTURE)
    a = cat.get("has_vehicle", meaning_key="default")
    b = cat.get("has_vehicle", meaning_key="active_only")
    assert a.owner == "cdp-team"
    assert b.owner == "research"
    assert a.calc_logic != b.calc_logic


def test_ambiguous_get_without_meaning_key():
    cat = TagCatalog()
    cat.load(FIXTURE)
    with pytest.raises(TagNotFoundError):
        cat.get("has_vehicle")


def test_duplicate_name_and_meaning_raises(tmp_path):
    p = tmp_path / "dup.yaml"
    p.write_text(
        "tags:\n"
        "  - name: x\n    layer: L1\n    business_def: a\n    calc_logic: b\n"
        "    update_freq: daily\n    owner: o\n    meaning_key: default\n"
        "  - name: x\n    layer: L1\n    business_def: a2\n    calc_logic: b2\n"
        "    update_freq: daily\n    owner: o\n    meaning_key: default\n",
        encoding="utf-8",
    )
    cat = TagCatalog()
    with pytest.raises(TagConflictError):
        cat.load(p)
