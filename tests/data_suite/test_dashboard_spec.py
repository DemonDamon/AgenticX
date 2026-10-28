from pathlib import Path

import pytest

from agenticx.data_suite.dashboard.spec import BoardSpecError, load_board

FIXTURE = Path(__file__).parent / "fixtures" / "sample_board.yaml"


def test_load_sample_board():
    board = load_board(FIXTURE)
    assert board.id == "sample_member_board"
    assert len(board.widgets) == 4
    assert board.widgets[0].chart == "bar"
    assert board.widgets[0].id == "members_by_region"


def test_unknown_chart_rejected(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text(
        "id: bad\ntitle: Bad\nwidgets:\n"
        "  - id: w1\n    title: t\n    chart: heatmap\n    dataset: members\n",
        encoding="utf-8",
    )
    with pytest.raises(BoardSpecError):
        load_board(p)


def test_layout_order_preserved():
    board = load_board(FIXTURE)
    assert [w.id for w in board.widgets] == [
        "members_by_region",
        "members_by_tier",
        "active_count",
        "avg_orders",
    ]
