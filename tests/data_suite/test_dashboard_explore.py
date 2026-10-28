from pathlib import Path

from agenticx.data_suite.dashboard.binder import DatasetStore, bind_widget
from agenticx.data_suite.dashboard.explore import (
    DrillPath,
    apply_drill,
    compare_series,
    next_group_field,
)
from agenticx.data_suite.dashboard.spec import load_board

BOARD = Path(__file__).parent / "fixtures" / "sample_board.yaml"
ROWS = Path(__file__).parent / "fixtures" / "sample_board_rows.json"


def test_drill_cascade():
    store = DatasetStore()
    store.load_json(ROWS)
    rows = store.rows("members")
    path = DrillPath(levels=["brand", "line", "config"], values=["A"])
    drilled = apply_drill(rows, path)
    assert {r["member_id"] for r in drilled} == {"1", "2", "3"}
    assert next_group_field(path) == "line"
    path2 = DrillPath(levels=["brand", "line", "config"], values=["A", "L1", "C1"])
    assert next_group_field(path2) is None
    assert len(apply_drill(rows, path2)) == 1


def test_compare_two_series():
    board = load_board(BOARD)
    store = DatasetStore()
    store.load_json(ROWS)
    w = next(x for x in board.widgets if x.id == "members_by_region")
    series = compare_series(
        w,
        store.rows("members"),
        left_filters={"status": "active"},
        right_filters={"status": "inactive"},
        left_label="active",
        right_label="inactive",
    )
    assert len(series) == 2
    assert "active" in series[0].title
    assert "inactive" in series[1].title
    left = {p.name: p.value for p in series[0].points}
    right = {p.name: p.value for p in series[1].points}
    assert left.get("east") == 2.0
    assert right.get("west") == 1.0


def test_bind_after_drill():
    board = load_board(BOARD)
    store = DatasetStore()
    store.load_json(ROWS)
    w = next(x for x in board.widgets if x.id == "members_by_tier")
    drilled = apply_drill(store.rows("members"), DrillPath(levels=["brand"], values=["B"]))
    series = bind_widget(w, drilled)
    by_name = {p.name: p.value for p in series.points}
    assert by_name == {"bronze": 1.0, "gold": 1.0}
