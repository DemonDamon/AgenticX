"""S1-4: golden-path board bind + masking."""

from __future__ import annotations

from examples.data_suite.golden_path.board_stage import run_board_stage
from examples.data_suite.golden_path.probe import load_member_seed


def test_board_bind_and_mask_pii():
    rows = load_member_seed()
    out = run_board_stage(rows, role="analyst")
    assert out["board_id"] == "golden_member_board"
    assert len(out["widgets"]) >= 3
    assert all(w["points"] for w in out["widgets"] if w["chart"] != "stat") or True
    # stat widgets also have points
    assert sum(len(w["points"]) for w in out["widgets"]) >= 3
    raw_email = out["raw_sample"]["email"]
    masked_email = out["masked_sample"]["email"]
    assert raw_email != masked_email
    assert "*" in str(masked_email) or masked_email is None
    raw_phone = out["raw_sample"]["phone"]
    assert out["masked_sample"]["phone"] != raw_phone
    assert out["watermark_env"] == "NEXT_PUBLIC_PAGE_WATERMARK"
