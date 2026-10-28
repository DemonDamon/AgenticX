from pathlib import Path

import pytest

from agenticx.data_suite.masking import MaskingEngine, load_masking_policy

FIXTURE = Path(__file__).parent / "fixtures" / "sample_masking.yaml"

ROWS = [
    {"phone": "13812345678", "email": "alice@example.com", "member_id": "M-001", "region": "east"},
]


def test_load_policy():
    policy = load_masking_policy(FIXTURE)
    assert policy.id == "sample_masking"
    assert len(policy.rules) == 3
    assert policy.rules[0].field == "phone"


def test_admin_sees_full():
    engine = MaskingEngine(load_masking_policy(FIXTURE))
    out = engine.apply(ROWS, role="admin")
    assert out[0]["phone"] == "13812345678"
    assert out[0]["email"] == "alice@example.com"
    assert out[0]["member_id"] == "M-001"
    assert out[0]["region"] == "east"
    assert out is not ROWS and out[0] is not ROWS[0]


def test_analyst_partial_phone_and_email():
    engine = MaskingEngine(load_masking_policy(FIXTURE))
    out = engine.apply(ROWS, role="analyst")
    assert out[0]["phone"] == "1*********8"
    assert out[0]["email"] == "a***************m"
    assert out[0]["member_id"] != "M-001"
    assert len(out[0]["member_id"]) == 12
    assert out[0]["region"] == "east"


def test_guest_drops_restricted_and_confidential():
    engine = MaskingEngine(load_masking_policy(FIXTURE))
    out = engine.apply(ROWS, role="guest")
    assert out[0]["phone"] is None
    assert out[0]["email"] == "a***************m"  # default partial for email
    assert out[0]["member_id"] is None


def test_unknown_strategy_rejected(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text(
        "id: bad\nrules:\n  - field: x\n    sensitivity: public\n    default_strategy: wipe\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        load_masking_policy(p)
