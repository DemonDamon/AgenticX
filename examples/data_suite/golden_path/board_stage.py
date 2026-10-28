"""Stage 4: config board bind + masking on export sample."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Union

from agenticx.data_suite.dashboard.binder import bind_widget
from agenticx.data_suite.dashboard.spec import load_board
from agenticx.data_suite.masking import MaskingEngine, load_masking_policy

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


def run_board_stage(
    rows: List[Dict[str, Any]],
    *,
    board_yaml: Union[str, Path, None] = None,
    masking_yaml: Union[str, Path, None] = None,
    role: str = "analyst",
) -> Dict[str, Any]:
    board_path = Path(board_yaml) if board_yaml is not None else SEED / "board.yaml"
    mask_path = Path(masking_yaml) if masking_yaml is not None else SEED / "masking.yaml"

    board = load_board(board_path)
    engine = MaskingEngine(load_masking_policy(mask_path))

    widgets = []
    for w in board.widgets:
        series = bind_widget(w, rows, masking=engine, role=role)
        widgets.append(
            {
                "id": w.id,
                "title": w.title,
                "chart": w.chart,
                "points": [{"name": p.name, "value": p.value} for p in series.points],
            }
        )

    sample = dict(rows[0]) if rows else {}
    masked_sample = engine.apply([sample], role=role)[0] if sample else {}
    return {
        "board_id": board.id,
        "widgets": widgets,
        "masked_sample": masked_sample,
        "raw_sample": sample,
        "watermark_env": "NEXT_PUBLIC_PAGE_WATERMARK",
    }
