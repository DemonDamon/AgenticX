from pathlib import Path

from agenticx.data_suite.dashboard.binder import DatasetStore, bind_widget
from agenticx.data_suite.dashboard.spec import load_board

BOARD = Path(__file__).parent / "fixtures" / "sample_board.yaml"
ROWS = Path(__file__).parent / "fixtures" / "sample_board_rows.json"


def _store():
    s = DatasetStore()
    s.load_json(ROWS)
    return s


def test_count_by_region():
    board = load_board(BOARD)
    store = _store()
    w = next(x for x in board.widgets if x.id == "members_by_region")
    series = bind_widget(w, store.rows("members"))
    by_name = {p.name: p.value for p in series.points}
    assert by_name == {"east": 2.0, "north": 1.0, "west": 2.0}


def test_avg_with_filter():
    board = load_board(BOARD)
    store = _store()
    w = next(x for x in board.widgets if x.id == "avg_orders")
    series = bind_widget(w, store.rows("members"), filters={"status": "active"})
    by_name = {p.name: p.value for p in series.points}
    assert by_name["east"] == 2.0  # (3+1)/2
    assert by_name["west"] == 2.0  # only member 4 active in west


def test_stat_and_empty():
    board = load_board(BOARD)
    store = _store()
    w = next(x for x in board.widgets if x.id == "active_count")
    series = bind_widget(w, store.rows("members"), filters={"status": "active"})
    assert series.points[0].value == 4.0
    empty = bind_widget(w, store.rows("members"), filters={"region": "nowhere"})
    assert empty.points[0].value == 0.0
