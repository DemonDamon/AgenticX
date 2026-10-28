from pathlib import Path

import yaml

from agenticx.data_suite.audience.dsl import select_audience

FIXTURE = Path(__file__).parent / "fixtures" / "sample_audience.yaml"


def test_and_or_select():
    spec = yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))
    rows = [
        {"member_id": "1", "tag_status_active": True, "tag_premium": True, "channel": "web"},
        {"member_id": "2", "tag_status_active": True, "tag_premium": False, "channel": "app"},
        {"member_id": "3", "tag_status_active": False, "tag_premium": True, "channel": "app"},
        {"member_id": "4", "tag_status_active": True, "tag_premium": False, "channel": "web"},
    ]
    ids = select_audience(rows, spec["query"], id_field=spec["id_field"])
    assert ids == ["1", "2"]


def test_not_and_empty():
    rows = [{"member_id": "1", "tag_premium": False}]
    ids = select_audience(
        rows,
        {"op": "not", "args": [{"tag": "tag_premium", "op": "eq", "value": True}]},
    )
    assert ids == ["1"]
    assert select_audience(rows, {"tag": "tag_premium", "op": "eq", "value": True}) == []
